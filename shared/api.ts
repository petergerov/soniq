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
}

export type UpdateCheck = ({ ok: true } & UpdateStatus) | { ok: false; error: string };

export interface ErrorBody {
  detail: string;
}
