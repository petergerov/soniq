// Songliste der Bibliothek: zeichnet die Zeilen und setzt Klicks in Befehle um.
import { extractPreset, type ExtractCount, type Song, type Stem, type StemTrack } from "../../../../shared/api.ts";
import { confirmDialog } from "../../core/confirm-dialog.ts";
import { byId, closest, labelIconButtons, PressGuard, setHtml } from "../../core/dom.ts";
import type { Translate } from "../../i18n/i18n.ts";
import type { LibraryStore } from "./library-store.ts";
import { MoveMenu } from "./move-menu.ts";
import type { PlayedSongs } from "./played-songs.ts";
import { SongDrag } from "./song-drag.ts";
import { renderSongRow } from "./song-row.ts";

/** Was die Liste vom Player wissen muss. */
export interface PlaybackState {
  readonly currentId: string | null;
  isPlaying(): boolean;
}

export interface SongListDeps {
  store: LibraryStore;
  played: PlayedSongs;
  playback: PlaybackState;
  drag: SongDrag;
  t: Translate;
  play: (song: Song) => void;
  reuse: (song: Song) => void;
  /** Stil von a, Szene von b ins Formular */
  cross: (a: Song, b: Song) => void;
  /** Einzelspuren eines Songs laden bzw. eine davon im Player abspielen */
  loadStems: (songId: string) => Promise<Stem[]>;
  playStem: (song: Song, stem: Stem) => void;
  /** Hochgeladene Vorlage (Ersetzen/Begleiten) im Player abspielen */
  playSource: (song: Song) => void;
  extractStems: (songId: string, tracks: StemTrack[]) => Promise<Stem[]>;
  cancelExtract: (songId: string) => Promise<Stem[]>;
  deleteAllStems: (songId: string) => Promise<Stem[]>;
  /** Mixer öffnen (Waveforms, Mute, Solo) */
  openMixer: (song: Song) => void;
}

const DEFAULT_EXTRACT_COUNT: ExtractCount = 4;

export class SongList {
  private readonly deps: SongListDeps;
  private readonly root = byId("library");
  private readonly press = new PressGuard(this.root);
  private readonly moveMenu = new MoveMenu();
  /** Songs, deren generierte Lyrics gerade aufgeklappt sind */
  private readonly openLyrics = new Set<string>();
  /** Song, dessen Titel gerade bearbeitet wird */
  private editingId: string | null = null;
  /** Kreuzen: zuerst gewählter Song (A) */
  private crossFrom: string | null = null;
  /** Songs mit aufgeklappter Spurenliste und ihre geladenen Spuren */
  private readonly openStems = new Set<string>();
  private readonly stemCache = new Map<string, Stem[]>();
  private readonly stemLoading = new Set<string>();
  /** Gewählte Stem-Anzahl zum Herauslösen, je Song */
  private readonly extractCounts = new Map<string, ExtractCount>();
  /** Song-ID mit offenem ⋮-Menü */
  private menuOpenId: string | null = null;

  constructor(deps: SongListDeps) {
    this.deps = deps;
    this.bindEvents();
  }

  /** Neu zeichnen, außer beim Umbenennen (Feld verlöre den Fokus) oder Ziehen. */
  refresh(): void {
    if (!this.editingId && !this.deps.drag.active) this.render();
    // Aufgeklappte Spurenlisten nachladen, solange sich etwas tut (Spur für Spur läuft, neue Spuren fertig)
    for (const id of this.openStems) {
      const song = this.deps.store.find(id);
      const cached = this.stemCache.get(id);
      const doneCount = cached?.filter((s) => s.status === "done").length;
      if (song && (song.status === "running" || song.stems_pending > 0 || doneCount !== song.stems)) void this.loadStems(id);
    }
  }

  private async loadStems(songId: string): Promise<void> {
    if (this.stemLoading.has(songId)) return;
    this.stemLoading.add(songId);
    try {
      this.stemCache.set(songId, await this.deps.loadStems(songId));
    } finally {
      this.stemLoading.delete(songId);
    }
    this.render();
  }

  render(): void {
    // Während eines Klicks nicht: sonst verschwindet der Knopf unter dem Zeiger (nachholen, außer beim Ziehen)
    if (this.press.defer(() => { if (!this.deps.drag.active) this.render(); })) return;
    const { store, t, played, playback } = this.deps;
    const songs = store.songs;
    if (!songs.length) {
      setHtml(this.root, `<div class="empty">${t("empty")}</div>`);
      return;
    }
    const html = songs.map((s, i) => renderSongRow(s, {
      t,
      isCurrent: s.id === playback.currentId,
      isPlaying: s.id === playback.currentId && playback.isPlaying(),
      wasPlayed: played.has(s.id),
      lyricsOpen: this.openLyrics.has(s.id),
      editing: s.id === this.editingId,
      hasFolders: store.hasFolders,
      startsGroup: i > 0 && songs[i - 1]!.group_id !== s.group_id,
      crossing: !this.crossFrom ? null : s.id === this.crossFrom ? "from" : "pick",
      eta: store.estimates[s.id],
      stemsOpen: this.openStems.has(s.id),
      stems: this.stemCache.get(s.id),
      currentStemId: playback.currentId,
      stemPlaying: playback.isPlaying(),
      stemsAvailable: store.stemsAvailable,
      extractCount: this.extractCount(s),
      synthCompute: store.synthCompute,
      menuOpen: s.id === this.menuOpenId,
    })).join("");
    if (setHtml(this.root, html)) labelIconButtons(this.root);
    this.root.classList.toggle("crossing", !!this.crossFrom);
  }

  private closeMenu(): void {
    if (!this.menuOpenId) return;
    this.menuOpenId = null;
    this.render();
  }

  private async handleAction(action: string, song: Song, button: HTMLElement): Promise<void> {
    const { store, t } = this.deps;
    const fromMenu = !!button.closest(".song-menu");
    if (action === "menu") {
      this.menuOpenId = this.menuOpenId === song.id ? null : song.id;
      return this.render();
    }
    // Menüpunkt gewählt → schließen, dann Aktion
    if (fromMenu && this.menuOpenId) this.menuOpenId = null;
    switch (action) {
      case "play": return this.deps.play(song);
      case "reuse": return this.deps.reuse(song);
      case "cross": return this.cross(song);
      case "rename": return this.startRename(song.id);
      case "move": return this.openMoveMenu(button, song);
      case "lyrics":
        if (!this.openLyrics.delete(song.id)) this.openLyrics.add(song.id);
        return this.render();
      case "stems":
        if (this.openStems.delete(song.id)) return this.render();
        this.openStems.add(song.id);
        this.render();
        return this.loadStems(song.id);
      case "stem-play": {
        const stem = this.stemCache.get(song.id)?.find((s) => s.id === button.dataset.stem);
        if (stem?.url) this.deps.playStem(song, stem);
        return;
      }
      case "source-play":
        if (song.source_url) this.deps.playSource(song);
        return;
      case "stems-del-all": {
        const ok = await confirmDialog({
          title: t("stems_del_all"),
          message: t("stems_del_all_q"),
          confirmLabel: t("stems_del_all"),
          cancelLabel: t("cancel"),
          danger: true,
        });
        if (!ok) return;
        this.stemCache.set(song.id, await this.deps.deleteAllStems(song.id));
        await this.deps.store.refresh();
        return;
      }
      case "extract-count": {
        const n = Number(button.dataset.count);
        if (n !== 2 && n !== 4 && n !== 6 || song.stems_pending > 0) return;
        this.extractCounts.set(song.id, n);
        return this.render();
      }
      case "extract-go": {
        const tracks = this.tracksForExtract(song);
        if (!tracks.length) return;
        this.stemCache.set(song.id, await this.deps.extractStems(song.id, tracks));
        this.openStems.add(song.id);
        await this.deps.store.refresh();
        return;
      }
      case "extract-cancel":
        this.stemCache.set(song.id, await this.deps.cancelExtract(song.id));
        await this.deps.store.refresh();
        return;
      case "mixer":
        return this.deps.openMixer(song);
      case "download":
        return; // <a href> lädt selbst; Menü ist schon zu
      case "fav": return store.toggleFavorite(song);
      case "hide": return store.toggleHidden(song);
      case "retry": return store.retry(song.id);
      case "more": return store.generateAnother(song);
      case "del": {
        const active = song.status === "queued" || song.status === "running";
        if (!active && !confirm(t("del_q"))) return;
        return store.remove(song.id);
      }
    }
  }

  private extractCount(song: Song): ExtractCount {
    return this.extractCounts.get(song.id) ?? DEFAULT_EXTRACT_COUNT;
  }

  private tracksForExtract(song: Song): StemTrack[] {
    const instrumental = !song.lyrics || song.lyrics === "[Instrumental]";
    const taken = new Set(
      (this.stemCache.get(song.id) ?? [])
        .filter((s) => s.kind === "extracted" && s.status !== "error")
        .map((s) => s.track),
    );
    return extractPreset(this.extractCount(song), instrumental).filter((t) => !taken.has(t));
  }

  /** Erster Klick wählt A, zweiter Klick auf einen anderen Song kreuzt; nochmal A (oder Escape) bricht ab. */
  private cross(song: Song): void {
    const a = this.crossFrom ? this.deps.store.find(this.crossFrom) : undefined;
    this.crossFrom = !a ? song.id : null;
    if (a && a.id !== song.id) this.deps.cross(a, song);
    this.render();
  }

  private startRename(id: string): void {
    this.editingId = id;
    this.render();
    const input = this.root.querySelector<HTMLInputElement>(`.t-edit[data-id="${CSS.escape(id)}"]`);
    input?.focus();
    input?.select();
  }

  private async commitRename(input: HTMLInputElement): Promise<void> {
    const id = input.dataset.id!;
    if (this.editingId !== id) return;   // per Escape schon abgebrochen
    this.editingId = null;
    await this.deps.store.rename(id, input.value.trim()).catch((e: Error) => alert(e.message));
  }

  private openMoveMenu(button: HTMLElement, song: Song): void {
    const { store, t } = this.deps;
    const current = song.folder_id || "none";
    const items = [{ id: "none", label: t("f_none") }, ...store.folders.folders.map((f) => ({ id: f.id, label: f.name }))]
      .map((i) => ({ ...i, selected: i.id === current }));
    this.moveMenu.open(button, items, (folder) => void store.move(song.id, folder).catch((e: Error) => alert(e.message)));
  }

  private bindEvents(): void {
    const { root } = this;
    root.addEventListener("click", (e) => {
      const button = closest<HTMLElement>(e.target, "[data-a]");
      const id = button?.closest<HTMLElement>(".song")?.dataset.id;
      const song = id ? this.deps.store.find(id) : undefined;
      if (!button || !song) return;
      this.handleAction(button.dataset.a!, song, button).catch((err: Error) => alert(`${this.deps.t("error")}: ${err.message}`));
    });
    // Text in den Lyrics soll markierbar bleiben, Knöpfe sollen klicken statt ziehen
    root.addEventListener("mousedown", (e) => {
      const row = closest<HTMLElement>(e.target, ".song");
      if (row) row.draggable = this.deps.store.hasFolders && !closest(e.target, ".lyr, .t-edit, button, a");
    });
    root.addEventListener("dragstart", (e) => {
      const row = closest<HTMLElement>(e.target, ".song");
      if (row) this.deps.drag.start(e, row.dataset.id!);
    });
    root.addEventListener("focusout", (e) => {
      const input = closest<HTMLInputElement>(e.target, ".t-edit");
      if (input) void this.commitRename(input);
    });
    document.addEventListener("pointerdown", (e) => {
      if (!this.menuOpenId) return;
      if (closest(e.target, ".song-menu-wrap.open")) return;
      this.closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (this.menuOpenId) {
        this.closeMenu();
        return;
      }
      if (!this.crossFrom) return;
      this.crossFrom = null;
      this.render();
    });
    root.addEventListener("keydown", (e) => {
      const input = closest<HTMLInputElement>(e.target, ".t-edit");
      if (!input) return;
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.editingId = null;
        this.render();
      }
    });
  }
}
