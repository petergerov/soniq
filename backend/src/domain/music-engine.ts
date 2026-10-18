// Abstraktion des Modellservers. Die Services kennen nur diese Schnittstelle, nicht acestep.cpp selbst.
import type { HealthInfo, Settings, SongResultMeta, StemModel, StemTrack } from "../../../shared/api.ts";

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

/** Abschnitt eines fertigen Songs neu erzeugen (task_type "repaint", Klangmodell ohne Sprachmodell). */
export interface RepaintRequest {
  /** Der ganze Song */
  source: Uint8Array;
  /** Dateiname inkl. Endung, damit der Modellserver MP3/WAV erkennt */
  sourceName: string;
  /** Sekunden */
  start: number;
  end: number;
  /** Felder wie bei generate (caption, lyrics, bpm, keyscale, seed, inference_steps …) */
  params: Record<string, unknown>;
}

/** Audiodatei für den Modellserver; der Name (mit Endung) sagt ihm, ob MP3 oder WAV */
export interface AudioFile {
  data: Uint8Array;
  name: string;
}

/** Vorlage im neuen Stil (task_type "cover" / "cover-nofsq", Klangmodell ohne Sprachmodell); Länge = Vorlage. */
export interface CoverRequest {
  source: AudioFile;
  /** Klang-Referenz (ref_audio): ab Stufe 2 das Original selbst, bei freiem Cover keine */
  reference?: AudioFile | undefined;
  task: CoverTask;
  /** audio_cover_strength: Anteil der Schritte, die die Vorlage hören */
  strength: number;
  /** Felder wie bei generate (caption, lyrics, bpm, keyscale, seed, inference_steps …) */
  params: Record<string, unknown>;
}

export type CoverTask = "cover" | "cover-nofsq";

/**
 * Stufen der Nähe zum Original (1 … COVER_LEVELS). Gemessen an 30 s Funk als Jazz-Trio (2026-10-18, Harmonie =
 * Chroma-Korrelation zur Vorlage, fremde Songs ~0,2): "cover" kam unabhängig von der Stärke (0,2–1,0) auf ~0,4 und
 * neuen Klang. "cover-nofsq" ohne Referenz ebenso (~0,4); erst mit der Vorlage als eigener Klang-Referenz steuert die
 * Stärke die Nähe: 0,15 → 0,47 · 0,3 → 0,56 · 0,5 → 0,71 · 0,7 → 0,83 · 1,0 → 0,94 (fast eine Kopie).
 */
export const COVER_STEPS: readonly { task: CoverTask; strength: number; selfReference: boolean }[] = [
  { task: "cover", strength: 1.0, selfReference: false },
  { task: "cover-nofsq", strength: 0.15, selfReference: true },
  { task: "cover-nofsq", strength: 0.3, selfReference: true },
  { task: "cover-nofsq", strength: 0.5, selfReference: true },
  { task: "cover-nofsq", strength: 0.7, selfReference: true },
];

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
  /** Song mit neu erzeugtem Abschnitt; außerhalb des Abschnitts bleibt das Audio unverändert. */
  repaint(request: RepaintRequest, progress: ProgressReporter, signal: AbortSignal): Promise<GeneratedAudio>;
  /** Vorlage im neuen Stil; Länge, Aufbau und (je nach Stufe) Klang kommen von der Vorlage. */
  cover(request: CoverRequest, progress: ProgressReporter, signal: AbortSignal): Promise<GeneratedAudio>;
  /** Erzeugt einen Song. `signal` bricht ab (der Server-Job wird dann ebenfalls beendet). */
  generate(params: Record<string, unknown>, progress: ProgressReporter, signal: AbortSignal): Promise<GeneratedAudio>;
  analyze(audio: Blob, filename: string): Promise<AnalysisResult>;
  health(): Promise<HealthInfo>;
}

/** Baut die Engine mit den jeweils aktuellen Einstellungen. */
export type MusicEngineFactory = (settings: Settings) => MusicEngine;

/** Klangmodelle (DiT): SFT mit 50 Schritten. Standard mit 2 Mrd. Parametern, optional XL mit 4 Mrd. */
export const DIT_MODELS = { standard: "acestep-v15-sft-Q8_0.gguf", xl: "acestep-v15-xl-sft-Q8_0.gguf" } as const;

/**
 * Spuren-Modelle: nur die Base-Modelle sind für lego, extract und complete trainiert (SFT und Turbo nicht).
 * Standard mit 2 Mrd. Parametern, optional XL-Base mit 4 Mrd. (rechnet etwa doppelt so lange).
 */
export const STEM_MODELS = { standard: "acestep-v15-base-Q8_0.gguf", xl: "acestep-v15-xl-base-Q8_0.gguf" } as const;

/** Gewähltes Spuren-Modell; fehlt seine Datei, aber das andere ist da, nimmt es das andere. */
export function effectiveStemModel(choice: StemModel, installed: (file: string) => boolean): StemModel {
  const other: StemModel = choice === "xl" ? "standard" : "xl";
  return !installed(STEM_MODELS[choice]) && installed(STEM_MODELS[other]) ? other : choice;
}
/**
 * Sampling für die Spur-Aufgaben (lego, extract, complete) wie in der Referenz-Implementierung von ACE-Step 1.5
 * (acestep/api/http/release_task_models.py: shift 3.0 "nur für Base-Modelle wirksam", acestep/inference.py:
 * guidance_scale 7.0, 32–100 Schritte für Base). Das Beispiel in acestep.cpp (shift 1.0, CFG 1.0) setzt die
 * Spur-Anweisung kaum durch: extract drums gab mit XL den ganzen Song zurück (Korrelation 0,993), mit Standard die
 * Gitarre, lego auf Stille einen Mix mit Flöten. Mit shift 3 und CFG 7 lieferten beide Modelle aus einem Funk-Song
 * echte Drums (Standard hörbar sauberer, 2026-10-17).
 */
export const STEM_STEPS = 50;
export const STEM_SHIFT = 3.0;
export const STEM_GUIDANCE = 7.0;
