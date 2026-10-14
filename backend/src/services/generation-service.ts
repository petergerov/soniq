// Neue Songs in Auftrag geben, wiederholen, abbrechen oder löschen.
import type { GenerateResponse, SongParams } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { newId, randomSeed } from "../domain/ids.ts";
import { INSTRUMENTAL, nowIso } from "../domain/song.ts";
import type { FolderRepository } from "../infrastructure/folder-repository.ts";
import type { SongRepository } from "../infrastructure/song-repository.ts";
import type { SongStorage } from "../infrastructure/song-storage.ts";
import type { JobRunner } from "./generation-worker.ts";

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
}

export type RemoveOutcome = { cancelled: true } | { deleted: true };

export interface GenerationServiceDeps {
  songs: SongRepository;
  folders: FolderRepository;
  storage: SongStorage;
  jobs: JobRunner;
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

  enqueue(cmd: GenerateCommand): GenerateResponse {
    const caption = buildCaption(cmd.style, cmd.prompt, cmd.caption);
    if (!caption) throw new AppError("invalid", "no_prompt");
    const lyrics = cmd.instrumental ? INSTRUMENTAL : cmd.lyrics.trim();
    const base: Omit<SongParams, "seed"> = {
      prompt: cmd.prompt,
      style: cmd.style,
      caption,
      lyrics,
      duration: cmd.duration,
      bpm: cmd.bpm,
      keyscale: cmd.keyscale,
      timesignature: cmd.timesignature,
      vocal_language: cmd.vocalLanguage,
      inference_steps: cmd.inferenceSteps,
      lm_temperature: cmd.lmTemperature,
      use_cot_caption: !cmd.keepCaption,
    };
    const groupId = cmd.groupId || newId();
    const folderId = cmd.folderId && this.deps.folders.find(cmd.folderId) ? cmd.folderId : null;
    const ids: string[] = [];
    for (let i = 0; i < cmd.variants; i++) {
      // Erste Variante nimmt den festen Seed, weitere zählen hoch -> alles reproduzierbar
      const seed = cmd.seed < 0 ? randomSeed() : cmd.seed + i;
      const id = newId();
      this.deps.songs.insert({
        id, group_id: groupId, created_at: nowIso(), title: cmd.title.trim() || null,
        caption, lyrics, seed, params: JSON.stringify({ ...base, seed }), folder_id: folderId,
      });
      ids.push(id);
    }
    this.deps.jobs.wake();
    return { group_id: groupId, ids };
  }

  retry(id: string): void {
    this.deps.songs.requeue(id);
    this.deps.jobs.wake();
  }

  /** Wartende/laufende Songs werden abgebrochen, fertige samt Datei gelöscht. */
  async remove(id: string): Promise<RemoveOutcome> {
    const song = this.deps.songs.find(id);
    if (!song) throw new AppError("not_found");
    if (song.status === "queued") {
      this.deps.songs.markCancelled(id, null);
      return { cancelled: true };
    }
    if (song.status === "running") {
      this.deps.songs.markCancelled(id, nowIso());
      this.deps.jobs.cancel(id);
      return { cancelled: true };
    }
    if (song.file) await this.deps.storage.remove(song.file);
    this.deps.songs.delete(id);
    return { deleted: true };
  }
}
