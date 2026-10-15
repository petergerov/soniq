// Abstraktion des Modellservers. Die Services kennen nur diese Schnittstelle, nicht acestep.cpp selbst.
import type { HealthInfo, Settings, SongResultMeta, StemTrack } from "../../../shared/api.ts";

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

/** Aufgaben für Einzelspuren: lego = neue Spur passend zum Playback, extract = Spur aus einem Mix herauslösen */
export type StemTask = "lego" | "extract";

export interface StemRequest {
  task: StemTask;
  track: StemTrack;
  /** Playback (lego) bzw. Mix (extract) */
  source: Uint8Array;
  /** Dateiname inkl. Endung, damit der Modellserver MP3/M4A/WAV erkennt */
  sourceName?: string;
  caption: string;
  lyrics?: string;
  bpm?: number | null;
  keyscale?: string | null;
  timesignature?: string | null;
  duration?: number | null;
  seed?: number;
}

export interface MusicEngine {
  readonly name: string;
  /**
   * Nur das Sprachmodell, ohne Audio-Codes: plant Tempo, Tonart, Takt, Länge.
   * writeLyrics: auch Lyrics schreiben (Modus "inspire", ~15 s; ändert dabei Länge und Beschreibung), sonst
   * Modus "format" (~3 s, Lyrics bleiben wie übergeben).
   */
  plan(params: Record<string, unknown>, writeLyrics: boolean, progress: ProgressReporter, signal: AbortSignal): Promise<SongResultMeta>;
  /** Eine Einzelspur mit dem Spuren-Modell (Base); liefert WAV (Float 32). */
  stem(request: StemRequest, progress: ProgressReporter, signal: AbortSignal): Promise<Uint8Array>;
  /** Erzeugt einen Song. `signal` bricht ab (der Server-Job wird dann ebenfalls beendet). */
  generate(params: Record<string, unknown>, progress: ProgressReporter, signal: AbortSignal): Promise<GeneratedAudio>;
  analyze(audio: Blob, filename: string): Promise<AnalysisResult>;
  health(): Promise<HealthInfo>;
}

/** Baut die Engine mit den jeweils aktuellen Einstellungen. */
export type MusicEngineFactory = (settings: Settings) => MusicEngine;

/** Klangmodelle (DiT): SFT mit 50 Schritten. Standard mit 2 Mrd. Parametern, optional XL mit 4 Mrd. */
export const DIT_MODELS = { standard: "acestep-v15-sft-Q8_0.gguf", xl: "acestep-v15-xl-sft-Q8_0.gguf" } as const;

/** Spuren-Modell: nur das Base-Modell ist für lego, extract und complete trainiert (SFT und Turbo nicht). */
export const STEM_MODEL = "acestep-v15-base-Q8_0.gguf";
/** Empfehlung von acestep.cpp für das Base-Modell (docs/ARCHITECTURE.md, Beispiel lego) */
export const STEM_STEPS = 50;
