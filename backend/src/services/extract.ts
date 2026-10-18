// Stem Separation: aus einem fertigen Song einzelne Spuren, mit Demucs (alle Spuren eines Modells in einem Durchgang)
// oder mit ACE-Step `extract` (je Spur ein Durchgang). Der Song bleibt "done" und spielbar; Fortschritt steht in
// message und in der Spurenliste.
import { DEMUCS_TRACKS, type DemucsModel, type ExtractRequest, type Separator, type SongParams, type StemTrack } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import type { MusicEngine, ProgressReporter, StemRequest } from "../domain/music-engine.ts";
import { INSTRUMENTAL, nowIso } from "../domain/song.ts";
import { formatElapsed, stemFileName, VOCAL_TRACKS, type StemRecord } from "../domain/stem.ts";
import type { SongRecord } from "../domain/song.ts";
import type { DemucsSeparator } from "../infrastructure/demucs-separator.ts";
import type { SongRepository } from "../infrastructure/song-repository.ts";
import type { SongStorage } from "../infrastructure/song-storage.ts";
import type { StemRepository } from "../infrastructure/stem-repository.ts";
import { encodeWav, parseWav, type Pcm, type WavDepth } from "../infrastructure/wav.ts";
import { newId } from "../domain/ids.ts";

export interface ExtractDeps {
  stems: StemRepository;
  songs: SongRepository;
  storage: SongStorage;
  stemsAvailable: () => boolean;
  demucs: Pick<DemucsSeparator, "available" | "separate">;
}

/** Trennverfahren einer wartenden Spur (steht im recipe-Feld; ältere Einträge ohne = ACE-Step) */
function separatorOf(stem: StemRecord): Separator {
  try {
    const sep = stem.recipe ? (JSON.parse(stem.recipe) as { separator?: Separator }).separator : undefined;
    return sep === "demucs_ft" || sep === "demucs_6s" ? sep : "ace";
  } catch {
    return "ace";
  }
}

export class ExtractTracks {
  private readonly deps: ExtractDeps;

  constructor(deps: ExtractDeps) {
    this.deps = deps;
  }

  /** Spuren einreihen. Schon vorhandene (fertig/wartend/laufend) derselben Art werden übersprungen. */
  enqueue(songId: string, request: ExtractRequest): void {
    const { stems, songs } = this.deps;
    const demucs = request.separator !== "ace";
    if (demucs && !this.deps.demucs.available(request.separator)) throw new AppError("bad_request", "demucs_missing");
    if (!demucs && !this.deps.stemsAvailable()) throw new AppError("bad_request", "stems_model_missing");
    const tracks = demucs ? DEMUCS_TRACKS[request.separator] : request.tracks;
    const song = songs.find(songId);
    if (!song) throw new AppError("not_found");
    if (!song.file || song.status !== "done") throw new AppError("bad_request", "song_not_ready");
    // Nur Stereo-Mix (voll erzeugter Song) — Spur-für-Spur / Replace haben schon Einzelspuren
    const mode = (JSON.parse(song.params) as SongParams).mode;
    if (mode && mode !== "full" && mode !== "repaint") throw new AppError("bad_request", "extract_mix_only");
    // Demucs liest WAV (umgerechnet wird hier, ein MP3-Decoder fehlt dem Server bewusst)
    if (demucs && !/\.wav$/i.test(song.file)) throw new AppError("bad_request", "demucs_wav_only");
    const taken = new Set(stems.forSong(songId).filter((s) => s.kind === "extracted" && s.status !== "error").map((s) => s.track));
    const fresh = tracks.filter((t) => !taken.has(t));
    if (!fresh.length) throw new AppError("bad_request", "no_new_tracks");
    const start = stems.forSong(songId).length;
    const at = nowIso();
    const recipe = demucs ? JSON.stringify({ separator: request.separator }) : undefined;
    fresh.forEach((track, i) => stems.insert({ id: newId(), songId, track, kind: "extracted", position: start + i, createdAt: at, recipe }));
  }

  /** Wartende Extract-Spuren streichen; eine laufende bricht der Worker ab. */
  cancel(songId: string): void {
    const at = nowIso();
    for (const s of this.deps.stems.forSong(songId)) {
      if (s.kind === "extracted" && (s.status === "queued" || s.status === "running")) this.deps.stems.markError(s.id, "cancelled", at);
    }
    this.deps.songs.setProgress(songId, null);
  }

  async run(songId: string, engine: MusicEngine, depth: WavDepth, progress: ProgressReporter, signal: AbortSignal): Promise<void> {
    const { stems, songs, storage } = this.deps;
    const song = songs.find(songId);
    if (!song?.file) throw new AppError("not_found");
    const jobs = stems.forSong(songId).filter((s) => s.kind === "extracted" && s.status === "queued");
    if (!jobs.length) return;
    const source = await storage.read(song.file);
    const start = performance.now();
    const elapsed = () => formatElapsed(Math.floor((performance.now() - start) / 1000));
    const base = this.requestBase(song, source);
    const aceJobs = jobs.filter((j) => separatorOf(j) === "ace");
    try {
      for (const model of ["demucs_ft", "demucs_6s"] as const) {
        const group = jobs.filter((j) => separatorOf(j) === model);
        if (group.length) await this.runDemucs(songId, model, group, parseWav(source), depth, () => progress(`Demucs ${group.length} Stems · ${elapsed()}`), signal);
      }
      for (const [i, job] of aceJobs.entries()) {
        signal.throwIfAborted();
        if (songs.find(songId)?.status !== "done") return;   // Song wurde gelöscht oder neu gestartet
        stems.markRunning(job.id);
        const label = `${i + 1}/${aceJobs.length} ${job.track}`;
        progress(`Extract ${label} · ${elapsed()}`);
        const wav = await engine.stem({
          ...base, task: "extract", track: job.track as StemTrack,
          lyrics: VOCAL_TRACKS.includes(job.track as StemTrack) ? (song.lyrics || INSTRUMENTAL) : INSTRUMENTAL,
        }, () => progress(`Extract ${label} · ${elapsed()}`), signal);
        const file = stemFileName(songId, job.track as StemTrack, "extracted");
        await storage.save(file, encodeWav(parseWav(wav), depth));
        stems.markDone(job.id, file, nowIso());
      }
    } catch (e) {
      const message = signal.aborted ? "cancelled" : e instanceof Error ? e.message || e.name : String(e);
      for (const job of jobs) if (stems.find(job.id)?.status !== "done") stems.markError(job.id, message, nowIso());
      throw e;
    } finally {
      if (songs.find(songId)?.status === "done") songs.setProgress(songId, null);
    }
  }

  /** Ein Demucs-Lauf für alle wartenden Spuren dieses Modells; die Laufzeit steht im Fortschritt (alle 2 s). */
  private async runDemucs(songId: string, model: DemucsModel, group: StemRecord[], song: Pcm, depth: WavDepth, tick: () => void, signal: AbortSignal): Promise<void> {
    const { stems, songs, storage } = this.deps;
    if (songs.find(songId)?.status !== "done") return;
    for (const job of group) stems.markRunning(job.id);
    tick();
    const timer = setInterval(tick, 2000);
    let result: Map<StemTrack, Pcm>;
    try {
      result = await this.deps.demucs.separate(model, song, signal);
    } finally {
      clearInterval(timer);
    }
    for (const job of group) {
      const pcm = result.get(job.track as StemTrack);
      if (!pcm) throw new AppError("bad_request", "demucs_missing");
      const file = stemFileName(songId, job.track as StemTrack, "extracted");
      await storage.save(file, encodeWav(pcm, depth));
      stems.markDone(job.id, file, nowIso());
    }
  }

  private requestBase(song: SongRecord, source: Uint8Array): Omit<StemRequest, "task" | "track" | "lyrics"> {
    const params = JSON.parse(song.params) as { bpm?: number; keyscale?: string; timesignature?: string; duration?: number; caption?: string };
    const meta = song.result_meta ? JSON.parse(song.result_meta) as { bpm?: number; keyscale?: string; timesignature?: string; duration?: number } : {};
    return {
      source, sourceName: song.file ?? "source.wav", caption: song.caption || params.caption || "",
      bpm: meta.bpm || params.bpm || null, keyscale: meta.keyscale || params.keyscale || null,
      timesignature: meta.timesignature ? String(meta.timesignature) : params.timesignature || null,
      duration: meta.duration || params.duration || null,
    };
  }
}
