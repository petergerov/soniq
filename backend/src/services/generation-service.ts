// Neue Songs in Auftrag geben, wiederholen, abbrechen oder löschen.
import { MIN_REPAINT_SECONDS, type CoverSettings, type Sampling, type GenerateResponse, type GenerationMode, type SongParams, type SongResultMeta, type StemIntent, type StemTrack } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { newId, randomSeed } from "../domain/ids.ts";
import { INSTRUMENTAL, nowIso } from "../domain/song.ts";
import { sourceFileName, VOCAL_TRACKS } from "../domain/stem.ts";
import type { FolderRepository } from "../infrastructure/folder-repository.ts";
import type { SongRepository } from "../infrastructure/song-repository.ts";
import type { SongStorage } from "../infrastructure/song-storage.ts";
import { MAX_UPLOAD_BYTES } from "./analysis-service.ts";
import type { JobRunner } from "./generation-worker.ts";
import type { SourceAudio } from "./source-audio.ts";

/** Geprüfte Anfrage (siehe http/validation.ts). */
export interface GenerateCommand {
  prompt: string;
  style: string;
  caption: string;         // nur für ältere Songs: fertiger Text; sonst aus Stil + Prompt gebaut
  lyrics: string;
  instrumental: boolean;
  keepCaption: boolean;    // true = Modell schreibt die Beschreibung nicht um
  title: string;
  duration: number;        // 0 = Modell entscheidet
  bpm: number;
  keyscale: string;
  timesignature: string;
  vocalLanguage: string;
  seed: number;            // -1 = zufällig (wird trotzdem gespeichert)
  variants: number;
  inferenceSteps: number;
  lmTemperature: number | null;
  groupId: string | null;  // für "weitere Variante" einer bestehenden Gruppe
  folderId: string | null; // Ordner der Bibliothek, in dem die neuen Songs landen
  mode: GenerationMode;    // "tracks" = Spur für Spur (siehe services/track-by-track.ts)
  tracks: StemTrack[];     // bei "tracks", schon in Reihenfolge
  cover: CoverSettings | null;     // bei "cover"
  sampling: Sampling;              // nur von der Vorgabe abweichende Werte
}

/** Geprüfte Anfrage für Ersetzen / Begleiten (Upload + JSON). */
export interface StemUploadCommand {
  intent: StemIntent;
  tracks: StemTrack[];
  keepers: StemTrack[];
  title: string;
  caption: string;
  lyrics: string;
  duration: number;
  bpm: number;
  keyscale: string;
  timesignature: string;
  vocalLanguage: string;
  seed: number;
  folderId: string | null;
}

/** Geprüfte Anfrage für Repaint (siehe http/validation.ts). */
export interface RepaintCommand {
  start: number;
  end: number;
  caption: string | undefined;   // fehlt = Beschreibung des Songs
  lyrics: string | undefined;    // fehlt = Lyrics des Songs
  count: number;
}

export type RemoveOutcome = { cancelled: true } | { deleted: true };

export interface GenerationServiceDeps {
  songs: SongRepository;
  folders: FolderRepository;
  storage: SongStorage;
  jobs: JobRunner;
  /** Einzelspuren des Songs samt Dateien löschen */
  removeStems: (songId: string) => Promise<void>;
  /** Spuren-Modell (Base) vorhanden? Nötig für "Spur für Spur" */
  stemsAvailable: () => boolean;
  sources: SourceAudio;
}

export function buildCaption(style: string, prompt: string, fallback: string): string {
  const parts = [style, prompt].map((p) => p.trim().replace(/^,+|,+$/g, "").trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : fallback.trim();
}

export class GenerationService {
  private readonly deps: GenerationServiceDeps;

  constructor(deps: GenerationServiceDeps) {
    this.deps = deps;
  }

  async enqueue(cmd: GenerateCommand): Promise<GenerateResponse> {
    const caption = buildCaption(cmd.style, cmd.prompt, cmd.caption);
    if (!caption) throw new AppError("invalid", "no_prompt");
    const lyrics = cmd.instrumental ? INSTRUMENTAL : cmd.lyrics.trim();
    // Spur für Spur: Gesangsspuren nur bei Songs mit Gesang; braucht das Spuren-Modell
    const tracks = cmd.mode === "tracks" ? cmd.tracks.filter((t) => !cmd.instrumental || !VOCAL_TRACKS.includes(t)) : [];
    if (cmd.mode === "tracks") {
      if (!tracks.length) throw new AppError("invalid", "no_tracks");
      if (!this.deps.stemsAvailable()) throw new AppError("bad_request", "stems_model_missing");
    }
    // Cover: Länge von der Vorlage, Tempo/Tonart/Takt auf Auto von ihr (bei einem Song der Bibliothek)
    const cover = cmd.mode === "cover" && cmd.cover ? await this.deps.sources.check(cmd.cover.source) : null;
    const m = cover?.meta ?? {};
    const base: Omit<SongParams, "seed"> = {
      prompt: cmd.prompt,
      style: cmd.style,
      caption,
      lyrics,
      duration: cover?.ref.duration || cmd.duration,
      bpm: cmd.bpm || (cover && m.bpm) || 0,
      keyscale: cmd.keyscale || (cover && m.keyscale) || "",
      timesignature: cmd.timesignature || (cover && m.timesignature) || "",
      vocal_language: cmd.vocalLanguage,
      inference_steps: cmd.inferenceSteps,
      lm_temperature: cmd.lmTemperature,
      use_cot_caption: !cmd.keepCaption,
      ...cmd.sampling,
      ...(tracks.length ? { mode: "tracks" as const, tracks } : {}),
      ...(cover && cmd.cover ? { mode: "cover" as const, cover: { source: cover.ref, closeness: cmd.cover.closeness } } : {}),
    };
    const groupId = cmd.groupId || newId();
    const folderId = cmd.folderId && this.deps.folders.find(cmd.folderId) ? cmd.folderId : null;
    const ids: string[] = [];
    for (let i = 0; i < cmd.variants; i++) {
      // Erste Variante nimmt den festen Seed, weitere zählen hoch -> alles reproduzierbar
      const seed = cmd.seed < 0 ? randomSeed() : cmd.seed + i;
      const id = newId();
      this.deps.songs.insert({
        id, group_id: groupId, created_at: nowIso(), title: cmd.title.trim() || cover?.ref.name || null,
        caption, lyrics, seed, params: JSON.stringify({ ...base, seed }), folder_id: folderId,
      });
      ids.push(id);
    }
    this.deps.jobs.wake();
    return { group_id: groupId, ids };
  }

  /** Hochgeladene Datei: Keeper herauslösen und ersetzen, oder Begleitung um eine isolierte Aufnahme. */
  async enqueueUpload(file: File, cmd: StemUploadCommand): Promise<GenerateResponse> {
    if (!this.deps.stemsAvailable()) throw new AppError("bad_request", "stems_model_missing");
    if (!cmd.tracks.length) throw new AppError("invalid", "no_tracks");
    if (cmd.intent === "replace" && !cmd.keepers.length) throw new AppError("invalid", "no_keepers");
    if (file.size > MAX_UPLOAD_BYTES) throw new AppError("too_large", "too_big");
    const id = newId();
    const name = file.name || "upload.wav";
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "wav";
    const source = sourceFileName(id, ext === "mp3" ? "mp3" : "wav");
    await this.deps.storage.save(source, new Uint8Array(await file.arrayBuffer()));
    const caption = cmd.caption.trim();
    if (!caption) throw new AppError("invalid", "no_prompt");
    const seed = cmd.seed < 0 ? randomSeed() : cmd.seed;
    const title = cmd.title.trim() || name.replace(/\.[^.]+$/, "") || caption.slice(0, 40);
    const folderId = cmd.folderId && this.deps.folders.find(cmd.folderId) ? cmd.folderId : null;
    const params: SongParams = {
      caption, lyrics: cmd.lyrics || INSTRUMENTAL, duration: cmd.duration, bpm: cmd.bpm,
      keyscale: cmd.keyscale, timesignature: cmd.timesignature, vocal_language: cmd.vocalLanguage,
      seed, inference_steps: 0, mode: cmd.intent, tracks: cmd.tracks, source,
      ...(cmd.intent === "replace" ? { keepers: cmd.keepers } : {}),
    };
    this.deps.songs.insert({
      id, group_id: id, created_at: nowIso(), title, caption, lyrics: params.lyrics, seed,
      params: JSON.stringify(params), folder_id: folderId,
    });
    this.deps.jobs.wake();
    return { group_id: id, ids: [id] };
  }

  /**
   * Abschnitt eines fertigen Songs neu erzeugen: neue Versionen in seiner Gruppe (A/B-Vergleich an derselben Stelle).
   * Die Vorlage bleibt der Song selbst (params.repaint.song_id), der Worker liest seine Datei erst beim Rechnen.
   */
  enqueueRepaint(songId: string, cmd: RepaintCommand): GenerateResponse {
    const song = this.deps.songs.find(songId);
    if (!song) throw new AppError("not_found");
    if (song.status !== "done" || !song.file) throw new AppError("bad_request", "repaint_done_only");
    const p = JSON.parse(song.params) as SongParams;
    const meta = (song.result_meta ? JSON.parse(song.result_meta) : {}) as SongResultMeta;
    const duration = meta.duration || p.duration || 0;
    const end = duration > 0 ? Math.min(cmd.end, duration) : cmd.end;
    if (end - cmd.start < MIN_REPAINT_SECONDS) throw new AppError("invalid", "repaint_region");
    const caption = cmd.caption?.trim() || meta.caption || song.caption;
    // Lyrics des ganzen Songs, damit der Gesang im Abschnitt an der richtigen Stelle des Texts weitermacht
    const lyrics = cmd.lyrics?.trim() || meta.lyrics || song.lyrics || INSTRUMENTAL;
    const base: Omit<SongParams, "seed"> = {
      ...(p.prompt !== undefined ? { prompt: p.prompt } : {}),
      ...(p.style !== undefined ? { style: p.style } : {}),
      caption, lyrics, duration,
      bpm: meta.bpm ?? p.bpm, keyscale: meta.keyscale ?? p.keyscale, timesignature: meta.timesignature ?? p.timesignature,
      vocal_language: meta.vocal_language ?? p.vocal_language, inference_steps: p.inference_steps || 0,
      mode: "repaint", repaint: { song_id: song.id, start: cmd.start, end },
    };
    const ids: string[] = [];
    for (let i = 0; i < cmd.count; i++) {
      const seed = randomSeed();
      const id = newId();
      this.deps.songs.insert({
        id, group_id: song.group_id, created_at: nowIso(), title: song.title, caption, lyrics, seed,
        params: JSON.stringify({ ...base, seed }), folder_id: song.folder_id,
      });
      ids.push(id);
    }
    this.deps.jobs.wake();
    return { group_id: song.group_id, ids };
  }

  retry(id: string): void {
    this.deps.songs.requeue(id);
    this.deps.jobs.wake();
  }

  /** Wartende/laufende Songs werden abgebrochen, fertige samt Datei gelöscht. */
  async remove(id: string): Promise<RemoveOutcome> {
    const song = this.deps.songs.find(id);
    if (!song) throw new AppError("not_found");
    this.deps.jobs.cancel(id);
    if (song.status === "queued") {
      this.deps.songs.markCancelled(id, null);
      return { cancelled: true };
    }
    if (song.status === "running") {
      this.deps.songs.markCancelled(id, nowIso());
      return { cancelled: true };
    }
    if (song.file) await this.deps.storage.remove(song.file);
    const params = JSON.parse(song.params) as SongParams;
    if (params.source) await this.deps.storage.remove(params.source);
    await this.deps.removeStems(id);
    this.deps.songs.delete(id);
    await this.deps.sources.release(params);
    return { deleted: true };
  }
}
