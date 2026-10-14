// Typisierter Zugriff auf die HTTP-API des Backends. Einzige Stelle, die fetch() für /api benutzt.
import type {
  AnalyzeResult, ErrorBody, FolderOverview, GenerateRequest, GenerateResponse, HealthInfo, QueueInfo,
  Settings, SettingsView, Song, SongPatch, UpdateCheck, UpdateStatus,
} from "../../../shared/api.ts";

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

  updateSong(id: string, patch: SongPatch): Promise<Song> { return this.send("PATCH", `/api/songs/${id}`, patch); }
  retrySong(id: string): Promise<Song> { return this.send("POST", `/api/songs/${id}/retry`); }
  deleteSong(id: string): Promise<{ cancelled?: true; deleted?: true }> { return this.send("DELETE", `/api/songs/${id}`); }

  folders(): Promise<FolderOverview> { return this.send("GET", "/api/folders"); }
  createFolder(name: string): Promise<{ id: string; name: string }> { return this.send("POST", "/api/folders", { name }); }
  renameFolder(id: string, name: string): Promise<{ id: string; name: string }> { return this.send("PATCH", `/api/folders/${id}`, { name }); }
  deleteFolder(id: string): Promise<{ deleted: true }> { return this.send("DELETE", `/api/folders/${id}`); }
  downloadUrl(folder: string): string { return `/api/download?folder=${encodeURIComponent(folder)}`; }

  queue(): Promise<QueueInfo> { return this.send("GET", "/api/queue"); }
  health(): Promise<HealthInfo> { return this.send("GET", "/api/health"); }
  settings(): Promise<SettingsView> { return this.send("GET", "/api/settings"); }
  saveSettings(values: Partial<Settings>): Promise<Settings> { return this.send("PUT", "/api/settings", values); }
  shutdown(): Promise<{ ok: true }> { return this.send("POST", "/api/shutdown"); }
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
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as Partial<ErrorBody>;
      throw new ApiError(r.status, typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail) || r.statusText);
    }
    return (await r.json()) as T;
  }
}
