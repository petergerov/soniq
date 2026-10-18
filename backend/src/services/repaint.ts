// Repaint: einen Abschnitt eines fertigen Songs neu erzeugen, der Rest bleibt unverändert (task_type "repaint").
import type { SongParams } from "../../../shared/api.ts";
import { EngineError, type GeneratedAudio, type MusicEngine, type ProgressReporter } from "../domain/music-engine.ts";
import type { SongRepository } from "../infrastructure/song-repository.ts";
import type { SongStorage } from "../infrastructure/song-storage.ts";

export function hasRepaint(params: SongParams): params is SongParams & { repaint: NonNullable<SongParams["repaint"]> } {
  return params.mode === "repaint" && !!params.repaint?.song_id;
}

export interface RepaintDeps {
  songs: SongRepository;
  storage: SongStorage;
}

/** Liest die Vorlage erst jetzt: so braucht ein wartender Repaint keine Kopie des Songs. */
export async function runRepaint(
  deps: RepaintDeps, params: SongParams & { repaint: NonNullable<SongParams["repaint"]> }, engine: MusicEngine,
  progress: ProgressReporter, signal: AbortSignal,
): Promise<GeneratedAudio> {
  const source = deps.songs.find(params.repaint.song_id);
  // Text wird in der Oberfläche erkannt und übersetzt (shortError)
  if (!source?.file || !(await deps.storage.exists(source.file))) throw new EngineError("Repaint: Vorlage gelöscht");
  const { repaint, mode: _mode, prompt: _prompt, style: _style, ...rest } = params;
  return engine.repaint({
    source: await deps.storage.read(source.file), sourceName: source.file,
    start: repaint.start, end: repaint.end, params: { ...rest },
  }, progress, signal);
}
