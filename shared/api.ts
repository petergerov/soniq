// Vertrag zwischen Frontend und Backend: Form aller JSON-Daten der HTTP-API.
// Nur Typen (keine Laufzeit-Werte), damit beide Seiten sie ohne Build einbinden können.

export type SongStatus = "queued" | "running" | "done" | "error" | "cancelled";

/** Parameter, mit denen ein Song erzeugt wurde (so an den Modellserver geschickt). */
export interface SongParams {
  prompt?: string;
  style?: string;
  caption: string;
  lyrics: string;
  duration: number;
  bpm: number;
  keyscale: string;
  timesignature: string;
  vocal_language: string;
  seed: number;
  inference_steps: number;
  lm_temperature?: number | null;
  use_cot_caption?: boolean;
}

/** Vom Modell ergänzte Werte. */
export interface SongResultMeta {
  bpm?: number | null;
  duration?: number | null;
  keyscale?: string | null;
  timesignature?: string | null;
  vocal_language?: string | null;
  lyrics?: string | null;
  caption?: string | null;
}

export interface Song {
  id: string;
  group_id: string;
  created_at: string;
  finished_at: string | null;
  status: SongStatus;
  message: string | null;
  title: string | null;
  caption: string;
  lyrics: string | null;
  seed: number;
  params: SongParams;
  result_meta: SongResultMeta | null;
  engine: string | null;
  file: string | null;
  favorite: boolean;
  folder_id: string | null;
  /** Ausgeblendet (Fehlversuch); erscheint nur, wenn die Bibliothek Ausgeblendete zeigt */
  hidden: boolean;
  /** Beginn der Rechenzeit (ältere Songs: null) */
  started_at: string | null;
  /** Versionen desselben Prompts heißen A, B, C … ("" bei Einzelstücken). */
  letter: string;
  url: string | null;
}

export interface GenerateRequest {
  prompt?: string;
  style?: string;
  caption?: string;
  lyrics?: string;
  instrumental?: boolean;
  keep_caption?: boolean;
  title?: string;
  duration?: number;
  bpm?: number;
  keyscale?: string;
  timesignature?: string;
  vocal_language?: string;
  seed?: number;
  variants?: number;
  inference_steps?: number;
  lm_temperature?: number | null;
  group_id?: string | null;
  folder_id?: string | null;
}

export interface GenerateResponse {
  group_id: string;
  ids: string[];
}

export interface SongPatch {
  favorite?: boolean;
  hidden?: boolean;
  title?: string;
  /** null/"" = unsortiert. Nur ausgewertet, wenn mitgeschickt. */
  folder_id?: string | null;
}

/** Einstellungen einer Vorlage: alles außer Idee (Prompt), Titel, Lyrics und Seed. */
export interface PresetValues {
  style: string;
  /** Gesang: "instrumental" oder "song" (Lyrics schreibt dann das Modell, sofern keine eigenen da sind) */
  vocals: "instrumental" | "song";
  vocal_language: string;
  duration: number;
  /** 0 = Auto */
  bpm: number;
  keyscale: string;
  timesignature: string;
  inference_steps: number;
  lm_temperature: number;
  variants: number;
  /** Würfel-Thema ("all", "film" …) */
  theme: string;
}

export interface Preset {
  name: string;
  values: PresetValues;
}

/** Spurnamen, die ACE-Step für Einzelspuren kennt (lego, extract, complete), in der Reihenfolge "Rhythmus zuerst". */
export const STEM_TRACKS = [
  "drums", "percussion", "bass", "guitar", "keyboard", "synth", "strings", "brass", "woodwinds", "fx", "vocals", "backing_vocals",
] as const;
export type StemTrack = (typeof STEM_TRACKS)[number];
/** generated = Spur für Spur erzeugt, extracted = aus dem Song herausgelöst, replacement / accompaniment = zu einer hochgeladenen Datei */
export type StemKind = "generated" | "extracted" | "replacement" | "accompaniment";
export type StemStatus = "queued" | "running" | "done" | "error";

export interface Stem {
  id: string;
  song_id: string;
  track: StemTrack;
  kind: StemKind;
  status: StemStatus;
  position: number;
  message: string | null;
  url: string | null;
}

export interface Folder {
  id: string;
  name: string;
  count: number;
}

export interface FolderOverview {
  folders: Folder[];
  all: number;
  none: number;
}

export interface QueueInfo {
  running: { id: string; status: SongStatus; message: string | null; caption: string }[];
  queued: number;
  library: { count: number; bytes: number };
  /** Geschätzte Sekunden, bis ein laufender oder wartender Song fertig ist (fehlt, solange es keine Erfahrungswerte gibt) */
  estimates: Record<string, number>;
}

export type DitModel = "standard" | "xl";

/** Dateiformat der erzeugten Songs. */
export type OutputFormat = "wav16" | "wav24" | "wav32" | "mp3-320" | "mp3-192" | "mp3-128";

export interface Settings {
  server_url: string;
  lm_url: string;
  lm_model: string;
  poll_interval: number;
  timeout_minutes: number;
  dit: DitModel;
  output_format: OutputFormat;
  songs_dir: string;
}

export interface SettingsView extends Settings {
  songs_dir_default: string;
  dit_xl_available: boolean;
  /** Spuren-Modell (Base) liegt im Modellordner: Spur für Spur, Herauslösen, Ersetzen möglich */
  stems_available: boolean;
  /** Fertige App: XL lässt sich über die Einrichtung nachladen statt über den Installer */
  packaged: boolean;
}

export interface AnalyzeResult {
  caption: string;
  lyrics: string;
  bpm: number;
  keyscale: string;
  timesignature: string;
  vocal_language: string;
  duration: number;
}

export interface HealthInfo {
  ok: boolean;
  error?: string;
  health?: unknown;
  props?: { models?: Record<string, string[]> } & Record<string, unknown>;
}

export interface UpdateStatus {
  current: string;
  latest: string;
  behind: number;
  ahead: number;
  changes: string[];
  dirty: boolean;
  needs_install: boolean;
  nogit?: boolean;
  /** Fertige App: Update kommt als neue DMG (download_url), nicht per git */
  packaged?: boolean;
  download_url?: string;
}

export type UpdateCheck = ({ ok: true } & UpdateStatus) | { ok: false; error: string };

/** Größe des Sprachmodells (plant Struktur, Tempo, Tonart; größer = bessere Songs, mehr Speicher) */
export type LmSize = "0.6B" | "1.7B" | "4B";

/** Einrichtung der fertigen App: Modelle laden, Grafikchip testen, Modellserver starten. */
export interface SetupStatus {
  /** Läuft als fertige App (MG_PACKAGED) */
  packaged: boolean;
  /** Fertige App, deren Einrichtung fehlt oder unvollständig ist (dann zeigt die Oberfläche die Einrichtung) */
  needed: boolean;
  /** verifying = vorhandene Dateien per Prüfsumme kontrollieren (file, done_mb, total_mb wie beim Download) */
  phase: "idle" | "verifying" | "downloading" | "testing" | "starting" | "done" | "error";
  ram_gb: number;
  free_gb: number;
  recommended_lm: LmSize;
  lm_options: { size: LmSize; mb: number; present: boolean }[];
  xl: { mb: number; present: boolean };
  /** Noch fehlende feste Dateien (VAE, Text-Embedding, Klangmodell) in MB */
  base_mb: number;
  /** Datei, die gerade geladen wird */
  file: string;
  done_mb: number;
  total_mb: number;
  /** Fehlermeldung bei phase "error" */
  error: string;
}

export interface SetupRequest {
  lm: LmSize;
  xl: boolean;
}

export interface ErrorBody {
  detail: string;
}
