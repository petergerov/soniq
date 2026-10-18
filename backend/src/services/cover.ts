// Cover: eine Vorlage (Song der Bibliothek oder hochgeladene Datei) im neuen Stil (task_type "cover" / "cover-nofsq").
import { COVER_LEVELS, type CoverSettings, type SongParams } from "../../../shared/api.ts";
import { COVER_STEPS, type GeneratedAudio, type MusicEngine, type ProgressReporter } from "../domain/music-engine.ts";
import type { SourceAudio } from "./source-audio.ts";
import { planSong } from "./track-by-track.ts";

export function hasCover(params: SongParams): params is SongParams & { cover: CoverSettings } {
  return params.mode === "cover" && !!params.cover?.source;
}

/** Stufe 1 … COVER_LEVELS auf Aufgabe und Stärke des Modellservers */
export function coverStep(closeness: number): (typeof COVER_STEPS)[number] {
  return COVER_STEPS[Math.min(COVER_LEVELS, Math.max(1, Math.round(closeness))) - 1]!;
}

/**
 * Liest Vorlage und Referenz erst jetzt. Das Klangmodell bekommt Caption und Lyrics wörtlich (kein Sprachmodell);
 * fehlen bei einem Song mit Gesang die Lyrics, schreibt sie vorher das Sprachmodell passend zur Länge der Vorlage.
 */
export async function runCover(
  sources: SourceAudio, params: SongParams & { cover: CoverSettings }, engine: MusicEngine,
  progress: ProgressReporter, signal: AbortSignal,
): Promise<GeneratedAudio> {
  const { cover, mode: _mode, prompt: _prompt, style: _style, ...rest } = params;
  const step = coverStep(cover.closeness);
  const source = await sources.read(cover.source);
  // Ab Stufe 2 ist das Original seine eigene Klang-Referenz: erst dann steuert die Stärke die Nähe
  const ref = step.selfReference ? source : undefined;
  const fields: Record<string, unknown> = { ...rest };
  if (!rest.lyrics.trim()) {
    const plan = await planSong({ ...params, duration: cover.source.duration || rest.duration }, true, engine, progress, signal);
    fields.lyrics = plan.lyrics || "";
  }
  return engine.cover({ source, reference: ref, task: step.task, strength: step.strength, params: fields }, progress, signal);
}
