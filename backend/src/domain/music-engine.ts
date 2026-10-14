// Abstraktion des Modellservers. Die Services kennen nur diese Schnittstelle, nicht acestep.cpp selbst.
import type { HealthInfo, Settings, SongResultMeta } from "../../../shared/api.ts";

/** Fehler des Modellservers, der so im UI angezeigt werden darf. */
export class EngineError extends Error {
  override name = "EngineError";
}

export type ProgressReporter = (message: string) => void;

export interface GeneratedAudio {
  audio: Uint8Array;
  extension: "wav" | "mp3";
  meta: SongResultMeta;
}

export interface AnalysisResult {
  caption?: string;
  lyrics?: string;
  bpm?: number | null;
  keyscale?: string | null;
  timesignature?: string | number | null;
  vocal_language?: string | null;
  duration?: number | null;
}

export interface MusicEngine {
  readonly name: string;
  /** Erzeugt einen Song. `signal` bricht ab (der Server-Job wird dann ebenfalls beendet). */
  generate(params: Record<string, unknown>, progress: ProgressReporter, signal: AbortSignal): Promise<GeneratedAudio>;
  analyze(audio: Blob, filename: string): Promise<AnalysisResult>;
  health(): Promise<HealthInfo>;
}

/** Baut die Engine mit den jeweils aktuellen Einstellungen. */
export type MusicEngineFactory = (settings: Settings) => MusicEngine;

/** Klangmodelle (DiT): SFT mit 50 Schritten. Standard mit 2 Mrd. Parametern, optional XL mit 4 Mrd. */
export const DIT_MODELS = { standard: "acestep-v15-sft-Q8_0.gguf", xl: "acestep-v15-xl-sft-Q8_0.gguf" } as const;
