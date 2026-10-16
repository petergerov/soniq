// Typisierter Zugriff auf die HTTP-API des Backends. Einzige Stelle, die fetch() für /api benutzt.
import type { AnalyzeResult, ErrorBody, FolderOverview, GenerateRequest, GenerateResponse, HealthInfo, NewVersionRequest, Preset, PresetValues, QueueInfo, SetupRequest, SetupStatus, Stem, StemIntent, StemTrack, Settings, SettingsView, Song, SongPatch, UpdateCheck, UpdateStatus } from "../../../shared/api.ts";

export class ApiError extends Error {
  override name = "ApiError";
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface SongListQuery {
  search: string;
  favoritesOnly: boolean;
  folder: string;
  /** Ausgeblendete Songs mitliefern */
  showHidden: boolean;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class ApiClient {
  /** Liefert die aktuelle Sprache: Meldungen des Servers kommen in dieser Sprache zurück (Header X-Lang). */
  private readonly lang: () => string;

  constructor(lang: () => string) {
    this.lang = lang;
  }

  generate(req: GenerateRequest): Promise<GenerateResponse> { return this.send("POST", "/api/generate", req); }

  songs(q: SongListQuery): Promise<Song[]> {
    const params = new URLSearchParams({ q: q.search, favorites: String(q.favoritesOnly), folder: q.folder, hidden: String(q.showHidden) });
    return this.send("GET", `/api/songs?${params}`);
  }

  song(id: string): Promise<Song> { return this.send("GET", `/api/songs/${id}`); }
  stems(songId: string): Promise<Stem[]> { return this.send("GET", `/api/songs/${songId}/stems`); }
  extractStems(songId: string, tracks: StemTrack[]): Promise<Stem[]> {
    return this.send("POST", `/api/songs/${songId}/stems`, { tracks });
  }
  cancelExtract(songId: string): Promise<Stem[]> { return this.send("POST", `/api/songs/${songId}/stems/cancel`); }
  deleteAllStems(songId: string): Promise<Stem[]> { return this.send("DELETE", `/api/songs/${songId}/stems`); }
  deleteStem(stemId: string): Promise<Stem[]> { return this.send("DELETE", `/api/stems/${stemId}`); }
  /** Neue Version(en) einer Spur einreihen; die alte bleibt erhalten. */
  createVersions(stemId: string, request: NewVersionRequest): Promise<Stem[]> { return this.send("POST", `/api/stems/${stemId}/versions`, request); }
  /** Diese Version ihrer Spur hörbar machen (Mixer, Mix-Download, ZIP). */
  activateStem(stemId: string): Promise<Stem[]> { return this.send("PUT", `/api/stems/${stemId}/active`); }
  /** Mix nach Reglerstellung als WAV: Kanal-ID (Spur oder Vorlage) → Lautstärke 0…1, fehlende Kanäle sind stumm. */
  async mixdown(songId: string, gains: ReadonlyMap<string, number>): Promise<{ blob: Blob; filename: string }> {
    const list = [...gains].map(([id, gain]) => `${id}:${Math.round(gain * 1000) / 1000}`).join(",");
    const r = await fetch(`/api/songs/${songId}/mix?gains=${encodeURIComponent(list)}`, { headers: { "X-Lang": this.lang() } });
    if (!r.ok) throw await this.error(r);
    const name = /filename\*=UTF-8''([^;]+)/.exec(r.headers.get("content-disposition") ?? "")?.[1];
    return { blob: await r.blob(), filename: name ? decodeURIComponent(name) : "mix.wav" };
  }
  uploadStems(file: File, request: {
    intent: StemIntent; tracks: StemTrack[]; keepers?: StemTrack[]; title?: string; caption: string; lyrics?: string;
    duration?: number; bpm?: number; keyscale?: string; timesignature?: string; vocal_language?: string; seed?: number;
    folder_id?: string | null;
  }): Promise<GenerateResponse> {
    const body = new FormData();
    body.append("audio", file);
    body.append("request", JSON.stringify(request));
    return this.send("POST", "/api/stems/upload", body);
  }
  updateSong(id: string, patch: SongPatch): Promise<Song> { return this.send("PATCH", `/api/songs/${id}`, patch); }
  retrySong(id: string): Promise<Song> { return this.send("POST", `/api/songs/${id}/retry`); }
  deleteSong(id: string): Promise<{ cancelled?: true; deleted?: true }> { return this.send("DELETE", `/api/songs/${id}`); }

  presets(): Promise<Preset[]> { return this.send("GET", "/api/presets"); }
  savePreset(name: string, values: PresetValues): Promise<Preset[]> { return this.send("PUT", `/api/presets/${encodeURIComponent(name)}`, values); }
  deletePreset(name: string): Promise<Preset[]> { return this.send("DELETE", `/api/presets/${encodeURIComponent(name)}`); }

  setup(): Promise<SetupStatus> { return this.send("GET", "/api/setup"); }
  startSetup(request: SetupRequest): Promise<SetupStatus> { return this.send("POST", "/api/setup", request); }
  addXl(): Promise<SetupStatus> { return this.send("POST", "/api/setup/xl"); }
  addStems(): Promise<SetupStatus> { return this.send("POST", "/api/setup/stems"); }
  cancelSetup(): Promise<SetupStatus> { return this.send("POST", "/api/setup/cancel"); }

  folders(): Promise<FolderOverview> { return this.send("GET", "/api/folders"); }
  createFolder(name: string): Promise<{ id: string; name: string }> { return this.send("POST", "/api/folders", { name }); }
  renameFolder(id: string, name: string): Promise<{ id: string; name: string }> { return this.send("PATCH", `/api/folders/${id}`, { name }); }
  deleteFolder(id: string): Promise<{ deleted: true }> { return this.send("DELETE", `/api/folders/${id}`); }
  downloadUrl(folder: string): string { return `/api/download?folder=${encodeURIComponent(folder)}`; }

  queue(): Promise<QueueInfo> { return this.send("GET", "/api/queue"); }
  health(): Promise<HealthInfo> { return this.send("GET", "/api/health"); }
  settings(): Promise<SettingsView> { return this.send("GET", "/api/settings"); }
  saveSettings(values: Partial<Settings>): Promise<Settings> { return this.send("PUT", "/api/settings", values); }
  shutdown(): Promise<{ ok: true; packaged?: boolean }> { return this.send("POST", "/api/shutdown"); }
  checkUpdate(): Promise<UpdateCheck> { return this.send("GET", "/api/update/check"); }
  applyUpdate(): Promise<{ ok: true } & UpdateStatus> { return this.send("POST", "/api/update/apply"); }

  analyze(file: File): Promise<AnalyzeResult> {
    const body = new FormData();
    body.append("audio", file);
    return this.send("POST", "/api/analyze", body);
  }

  /** Antwortet der Server? (ohne Fehlermeldung, z. B. während eines Neustarts) */
  async isReachable(): Promise<boolean> {
    try {
      return (await fetch("/api/queue", { cache: "no-store" })).ok;
    } catch {
      return false;
    }
  }

  private async send<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "X-Lang": this.lang() };
    let payload: BodyInit | undefined;
    // Bei FormData setzt der Browser Content-Type samt Boundary selbst
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const r = await fetch(path, { method, headers, body: payload });
    if (!r.ok) throw await this.error(r);
    return (await r.json()) as T;
  }

  private async error(r: Response): Promise<ApiError> {
    const err = (await r.json().catch(() => ({}))) as Partial<ErrorBody>;
    return new ApiError(r.status, typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail) || r.statusText);
  }
}
