// Zustand der Bibliothek (Songs, Ordner, Filter) und alle Befehle, die ihn ändern.
// Fragt regelmäßig beim Server nach: zügig, solange gerechnet wird, sonst selten.
import type { FolderOverview, QueueInfo, Song } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { storage } from "../../core/storage.ts";
import { termsOf } from "../generator/random-content.ts";

const POLL_BUSY_MS = 1500;
const POLL_IDLE_MS = 8000;
const SEARCH_DEBOUNCE_MS = 250;
/** "" = alle, "none" = unsortiert, sonst Ordner-ID */
export type FolderView = string;

export class LibraryStore {
  songs: Song[] = [];
  folders: FolderOverview = { folders: [], all: 0, none: 0 };
  stats: QueueInfo["library"] | null = null;
  /** Songs, die gerade gerechnet werden oder warten */
  activeCount = 0;
  currentFolder: FolderView = storage.get("folder") ?? "";
  favoritesOnly = false;
  /** Ausgeblendete Songs (Fehlversuche) trotzdem zeigen */
  showHidden = false;
  /** Begriffe aus Stil und Prompt aller Favoriten; die Würfel greifen öfter zu ihnen */
  favoriteTerms: ReadonlySet<string> = new Set();
  search = "";

  private readonly api: ApiClient;
  private readonly listeners: (() => void)[] = [];
  private pollTimer: number | undefined;
  private searchTimer: number | undefined;
  /** Favoriten neu einlesen (beim Start und nach jedem Stern) */
  private favoritesStale = true;

  constructor(api: ApiClient) {
    this.api = api;
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  get hasFolders(): boolean {
    return this.folders.folders.length > 0;
  }

  /** Ordner, in dem neue Songs landen (null = unsortiert). */
  get targetFolder(): string | null {
    return this.currentFolder && this.currentFolder !== "none" ? this.currentFolder : null;
  }

  get currentFolderInfo() {
    return this.folders.folders.find((f) => f.id === this.currentFolder);
  }

  find(id: string): Song | undefined {
    return this.songs.find((s) => s.id === id);
  }

  async refresh(): Promise<void> {
    let busy = true;   // bei einem Fehler (Server startet gerade neu) zügig erneut versuchen
    try {
      this.folders = await this.api.folders();
      if (this.currentFolder && this.currentFolder !== "none" && !this.currentFolderInfo) this.setFolder("", false);
      this.songs = await this.api.songs({ search: this.search, favoritesOnly: this.favoritesOnly, folder: this.currentFolder, showHidden: this.showHidden });
      if (this.favoritesStale) {
        const favorites = await this.api.songs({ search: "", favoritesOnly: true, folder: "", showHidden: true });
        this.favoriteTerms = termsOf(favorites.flatMap((s) => [s.params.style ?? "", s.params.prompt ?? ""]));
        this.favoritesStale = false;
      }
      const queue = await this.api.queue();
      this.activeCount = queue.running.length + queue.queued;
      busy = this.activeCount > 0;
      this.stats = queue.library;
      this.notify();
    } catch {
      // nächster Versuch folgt
    }
    this.schedule(busy ? POLL_BUSY_MS : POLL_IDLE_MS);
  }

  stopPolling(): void {
    clearTimeout(this.pollTimer);
  }

  setFolder(id: FolderView, reload = true): void {
    this.currentFolder = id;
    storage.set("folder", id);
    if (reload) void this.refresh();
  }

  setSearch(text: string): void {
    this.search = text;
    clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => void this.refresh(), SEARCH_DEBOUNCE_MS);
  }

  toggleShowHidden(): void {
    this.showHidden = !this.showHidden;
    void this.refresh();
  }

  toggleFavoritesOnly(): void {
    this.favoritesOnly = !this.favoritesOnly;
    void this.refresh();
  }

  // ------------------------------------------------------------ Songs

  async toggleFavorite(song: Song): Promise<void> {
    await this.api.updateSong(song.id, { favorite: !song.favorite });
    this.favoritesStale = true;
    await this.refresh();
  }

  /** Fehlversuch ausblenden (bleibt erhalten) oder wieder einblenden. */
  async toggleHidden(song: Song): Promise<void> {
    await this.api.updateSong(song.id, { hidden: !song.hidden });
    await this.refresh();
  }

  async rename(id: string, title: string): Promise<void> {
    const song = this.find(id);
    if (song && title !== (song.title || "")) await this.api.updateSong(id, { title });
    await this.refresh();
  }

  async move(id: string, folder: FolderView): Promise<void> {
    await this.api.updateSong(id, { folder_id: folder === "none" ? null : folder });
    await this.refresh();
  }

  async retry(id: string): Promise<void> {
    await this.api.retrySong(id);
    await this.refresh();
  }

  /** Bricht wartende/laufende Songs ab, löscht fertige. */
  async remove(id: string): Promise<void> {
    await this.api.deleteSong(id);
    await this.refresh();
  }

  /** Eine weitere Version desselben Prompts (gleiche Gruppe, neuer Seed). */
  async generateAnother(song: Song): Promise<void> {
    const p = song.params;
    await this.api.generate({
      ...p, instrumental: false, keep_caption: p.use_cot_caption !== true, title: song.title || "",
      seed: -1, variants: 1, group_id: song.group_id, folder_id: song.folder_id,
    });
    await this.refresh();
  }

  // ------------------------------------------------------------ Ordner

  async createFolder(name: string): Promise<void> {
    const folder = await this.api.createFolder(name);
    this.setFolder(folder.id);
  }

  async renameFolder(id: string, name: string): Promise<void> {
    await this.api.renameFolder(id, name);
    await this.refresh();
  }

  async deleteFolder(id: string): Promise<void> {
    await this.api.deleteFolder(id);
    this.setFolder("");
  }

  downloadUrl(): string {
    return this.api.downloadUrl(this.currentFolder);
  }

  private schedule(ms: number): void {
    clearTimeout(this.pollTimer);
    this.pollTimer = window.setTimeout(() => void this.refresh(), ms);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }
}
