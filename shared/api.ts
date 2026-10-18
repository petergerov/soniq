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
  /** "tracks" = Spur für Spur; "replace" / "accompany" = hochgeladene Datei (newfeatures.md C) */
  mode?: GenerationMode;
  /** Bei mode "tracks" / "replace" / "accompany": die neuen Spuren, in Reihenfolge "Rhythmus zuerst" */
  tracks?: StemTrack[];
  /** Bei mode "replace": herausgelöste Spuren, die bleiben */
  keepers?: StemTrack[];
  /** Bei replace/accompany: Dateiname der hochgeladenen Vorlage */
  source?: string;
}

export type GenerationMode = "full" | "tracks" | "replace" | "accompany";
export type StemIntent = "replace" | "accompany";

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
  /** Anzahl fertiger Einzelspuren (Spur für Spur, herausgelöst …) */
  stems: number;
  /** Wartende oder laufende Einzelspuren (z. B. Herauslösen auf einem fertigen Song) */
  stems_pending: number;
  /** Versionen desselben Prompts heißen A, B, C … ("" bei Einzelstücken). */
  letter: string;
  url: string | null;
  /** Hochgeladene Vorlage (Ersetzen/Begleiten), sonst null */
  source_url: string | null;
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
  /** "tracks" = Spur für Spur (braucht das Spuren-Modell, siehe SettingsView.stems_available) */
  mode?: GenerationMode;
  tracks?: StemTrack[];
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
/**
 * Restspur von Demucs: alles, was nicht Drums, Bass, Gesang (bzw. Gitarre, Klavier) ist. ACE-Step kennt sie nicht,
 * daher steht sie nicht in STEM_TRACKS (keine neue Version, kein Spur für Spur).
 */
export const OTHER_TRACK = "other";
export type StemTrack = (typeof STEM_TRACKS)[number] | typeof OTHER_TRACK;

/**
 * Stem Separation: Demucs (eigenes Trennmodell, demucs.cpp) oder ACE-Step (extract je Spur).
 * demucs_ft = htdemucs_ft, vier nachtrainierte Modelle, beste Qualität; demucs_6s = htdemucs_6s mit Gitarre und Klavier.
 */
export const SEPARATORS = ["demucs_ft", "demucs_6s", "ace"] as const;
export type Separator = (typeof SEPARATORS)[number];
export type DemucsModel = Exclude<Separator, "ace">;

/** Spuren der Demucs-Modelle in der Reihenfolge des Mixers (Klavier landet auf "keyboard") */
export const DEMUCS_TRACKS: Record<DemucsModel, readonly StemTrack[]> = {
  demucs_ft: ["drums", "bass", "vocals", "other"],
  demucs_6s: ["drums", "bass", "guitar", "keyboard", "vocals", "other"],
};

/** POST /api/songs/:id/stems: ACE-Step mit gewählten Spuren, oder ein Demucs-Modell (seine Spuren stehen fest). */
export type ExtractRequest = { separator: "ace"; tracks: StemTrack[] } | { separator: DemucsModel };

/** Spuren, die der Text nahelegt (Stil/Beschreibung), für die Vorauswahl beim Herauslösen. */
const TRACK_HINTS: readonly [RegExp, StemTrack][] = [
  [/backing\s*vocal|harmony|harmon|chor(?:us)?|choir/i, "backing_vocals"],
  [/vocal|gesang|sing(?:er|ing)?|voice|stimme/i, "vocals"],
  [/drum|schlagzeug|\bbeat\b|kit/i, "drums"],
  [/percussion|shaker|conga|bongo|tambour/i, "percussion"],
  [/\bbass\b/i, "bass"],
  [/guitar|gitarre/i, "guitar"],
  [/piano|keyboard|\bkeys\b|klav/i, "keyboard"],
  [/synth/i, "synth"],
  [/string|streich|violin|cello|orchestra/i, "strings"],
  [/brass|trumpet|horn|posaune|trombone|bläser/i, "brass"],
  [/woodwind|sax|flute|clarinet|holzbl/i, "woodwinds"],
  [/\bfx\b|effect|effekt/i, "fx"],
];

export function tracksFromText(text: string): StemTrack[] {
  return TRACK_HINTS.filter(([re]) => re.test(text)).map(([, track]) => track);
}

/** Stem Separation: Anzahl statt einzelner Spurennamen. */
export const EXTRACT_COUNTS = [2, 4, 6] as const;
export type ExtractCount = (typeof EXTRACT_COUNTS)[number];

const EXTRACT_VOCAL: Record<ExtractCount, readonly StemTrack[]> = {
  2: ["drums", "vocals"],
  4: ["drums", "bass", "guitar", "vocals"],
  6: ["drums", "bass", "guitar", "keyboard", "vocals", "backing_vocals"],
};

const EXTRACT_INSTRUMENTAL: Record<ExtractCount, readonly StemTrack[]> = {
  2: ["drums", "bass"],
  4: ["drums", "bass", "guitar", "keyboard"],
  6: ["drums", "percussion", "bass", "guitar", "keyboard", "synth"],
};

/** Feste Spur-Sets für 2 / 4 / 6 Stems (ohne manuelle Spurwahl). */
export function extractPreset(count: ExtractCount, instrumental: boolean): StemTrack[] {
  return [...(instrumental ? EXTRACT_INSTRUMENTAL : EXTRACT_VOCAL)[count]];
}
/**
 * generated = Spur für Spur erzeugt, extracted = aus dem Song herausgelöst, replacement / accompaniment = zu einer
 * hochgeladenen Datei, version = im Mixer neu erzeugte Version einer vorhandenen Spur (die alte bleibt erhalten)
 */
export type StemKind = "generated" | "extracted" | "replacement" | "accompaniment" | "version";
export type StemStatus = "queued" | "running" | "done" | "error";
/** Kanal der hochgeladenen Vorlage im Mixer (Schlüssel neben den Spur-IDs in GET /api/songs/:id/mix?gains=…) */
export const SOURCE_CHANNEL = "source";

export interface Stem {
  id: string;
  song_id: string;
  track: StemTrack;
  kind: StemKind;
  status: StemStatus;
  position: number;
  message: string | null;
  url: string | null;
  /** 1 = die ursprüngliche Spur, ab 2 die neu erzeugten Versionen derselben Spur */
  version: number;
  /** Diese Version ist im Mix, im Mixer und im ZIP zu hören (je Spur genau eine) */
  active: boolean;
  /** Wünsche, mit denen eine Version erzeugt wurde (nur kind "version") */
  recipe: StemRecipe | null;
}

/** Wünsche für eine neue Version einer Spur (Mixer › Neue Version), siehe shared/track-variation.ts */
export interface VersionRecipe {
  /** Regler −2…+2 je Achse; fehlende Achsen stehen auf 0 */
  axes: Partial<Record<VariationAxis, number>>;
  /** gewählte Schnellwahl-Knöpfe (IDs aus chipsFor) */
  chips: string[];
  /** Freitext, wird wörtlich in die Caption übernommen */
  text: string;
}

export interface StemRecipe extends VersionRecipe {
  /** Caption, die an die Engine ging */
  caption: string;
  /** Seed dieser Version (fehlt bei Versionen, die vor dem Speichern des Seeds entstanden sind) */
  seed?: number;
}

export interface NewVersionRequest extends VersionRecipe {
  /** Anzahl Versionen mit verschiedenen Seeds (1–3) */
  count: number;
  /** Seed der ersten Version, weitere zählen hoch; fehlt = zufällig */
  seed?: number;
}

export const VARIATION_AXES = ["intensity", "body", "character", "density", "room"] as const;
export type VariationAxis = (typeof VARIATION_AXES)[number];

/**
 * Je Spur die Version, die zu hören ist: die aktive fertige, sonst die erste fertige. Reihenfolge wie die erste
 * Version jeder Spur; Spuren ohne fertige Version fehlen.
 */
export function activeTakes<T extends { track: string; status: string; active: boolean | number }>(stems: readonly T[]): T[] {
  const byTrack = new Map<string, T>();
  for (const s of stems) {
    if (s.status !== "done") continue;
    const current = byTrack.get(s.track);
    if (!current || (s.active && !current.active)) byTrack.set(s.track, s);
  }
  return [...byTrack.values()];
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
  /** Herauslösen auf fertigen Songs (zählen zur Warteschlange, der Song bleibt "done") */
  stem_jobs: number;
}

export type DitModel = "standard" | "xl";

/** Spuren-Modell (lego, extract, complete): "standard" = Base mit 2 Mrd. Parametern, "xl" = XL-Base mit 4 Mrd. */
export type StemModel = "standard" | "xl";

/** Dateiformat der erzeugten Songs. */
export type OutputFormat = "wav16" | "wav24" | "wav32" | "mp3-320" | "mp3-192" | "mp3-128";

export interface Settings {
  server_url: string;
  lm_url: string;
  lm_model: string;
  poll_interval: number;
  timeout_minutes: number;
  dit: DitModel;
  stem_model: StemModel;
  output_format: OutputFormat;
  songs_dir: string;
}

export interface SettingsView extends Settings {
  songs_dir_default: string;
  dit_xl_available: boolean;
  /** Spuren-Modell (Base) liegt im Modellordner: Spur für Spur, Herauslösen, Ersetzen möglich */
  stems_available: boolean;
  /** XL-Spuren-Modell liegt im Modellordner (in den Einstellungen wählbar) */
  stems_xl_available: boolean;
  /** Demucs-Modelle samt Programm installiert (Stem Separation) */
  demucs: Record<DemucsModel, boolean>;
  /** Programme von demucs.cpp vorhanden (dann lassen sich die Demucs-Modelle laden) */
  demucs_supported: boolean;
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

/** Synthese-Backend aus dem ace-server-Log (Stem Separation / DiT). */
export type SynthComputeMode = "gpu" | "cpu" | "unknown";
export interface SynthCompute {
  mode: SynthComputeMode;
  /** Rohname z. B. MTL0, CUDA0, CPU */
  device: string;
  /** Kurzlabel z. B. Metal, CUDA, Vulkan, CPU */
  kind: string;
}

export interface HealthInfo {
  ok: boolean;
  error?: string;
  health?: unknown;
  props?: { models?: Record<string, string[]> } & Record<string, unknown>;
  /** CPU oder GPU des Synth-Servers (für Stem Separation) */
  synth_compute?: SynthCompute;
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
  /** Spuren-Modell (Base): Spur für Spur, Herauslösen, Ersetzen */
  stems: { mb: number; present: boolean };
  /** XL-Spuren-Modell (XL-Base), nur über Einstellungen › Spuren-Modell nachladbar */
  stems_xl: { mb: number; present: boolean };
  /** Demucs-Modelle (htdemucs_ft und htdemucs_6s) für die Stem Separation; supported = Programme sind dabei */
  demucs: { mb: number; present: boolean; supported: boolean };
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
  /** Spuren-Modell mitladen */
  stems?: boolean;
  /** XL-Spuren-Modell mitladen */
  stems_xl?: boolean;
}

export interface ErrorBody {
  detail: string;
}
