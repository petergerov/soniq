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
   * Nur das Sprachmodell: plant Tempo, Tonart, Takt, Länge.
   * writeLyrics: auch Lyrics schreiben (Modus "generate" wie beim ganzen Song, ~10 s je 30 s Musik; "inspire" wäre
   * schneller, entschied sich im Test aber oft für "[Instrumental]"), sonst Modus "format" (~3 s, ohne Audio-Codes).
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
/**
 * CFG-Stärke für lego (neue Einzelspur): mit 1.0 (CFG aus, Vorgabe von acestep.cpp) mischt das Modell oft andere
 * Instrumente in die Spur. Gemessen an einer Bass-Spur auf Schlagzeug (Energie über 400 Hz, 2 Seeds): 1.0 → 0,076,
 * 3.0 → 0,033, 5.0 → 0,011 (Referenz guter Bass: 0,019). Kostet etwa 45 % mehr Rechenzeit je Spur.
 * extract bleibt bei 1.0 (nicht getestet).
 */
export const LEGO_GUIDANCE = 5.0;
