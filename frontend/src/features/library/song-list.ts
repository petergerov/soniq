// Songliste der Bibliothek: zeichnet die Zeilen und setzt Klicks in Befehle um.
import type { Song } from "../../../../shared/api.ts";
import { byId, closest, labelIconButtons } from "../../core/dom.ts";
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
}

export class SongList {
  private readonly deps: SongListDeps;
  private readonly root = byId("library");
  private readonly moveMenu = new MoveMenu();
  /** Songs, deren generierte Lyrics gerade aufgeklappt sind */
  private readonly openLyrics = new Set<string>();
  /** Song, dessen Titel gerade bearbeitet wird */
  private editingId: string | null = null;
  /** Kreuzen: zuerst gewählter Song (A) */
  private crossFrom: string | null = null;

  constructor(deps: SongListDeps) {
    this.deps = deps;
    this.bindEvents();
  }

  /** Neu zeichnen, außer beim Umbenennen (Feld verlöre den Fokus) oder Ziehen. */
  refresh(): void {
    if (!this.editingId && !this.deps.drag.active) this.render();
  }

  render(): void {
    const { store, t, played, playback } = this.deps;
    const songs = store.songs;
    if (!songs.length) {
      this.root.innerHTML = `<div class="empty">${t("empty")}</div>`;
      return;
    }
    this.root.innerHTML = songs.map((s, i) => renderSongRow(s, {
      t,
      isCurrent: s.id === playback.currentId,
      isPlaying: s.id === playback.currentId && playback.isPlaying(),
      wasPlayed: played.has(s.id),
      lyricsOpen: this.openLyrics.has(s.id),
      editing: s.id === this.editingId,
      hasFolders: store.hasFolders,
      startsGroup: i > 0 && songs[i - 1]!.group_id !== s.group_id,
      crossing: !this.crossFrom ? null : s.id === this.crossFrom ? "from" : "pick",
    })).join("");
    this.root.classList.toggle("crossing", !!this.crossFrom);
    labelIconButtons(this.root);
  }

  private async handleAction(action: string, song: Song, button: HTMLElement): Promise<void> {
    const { store, t } = this.deps;
    switch (action) {
      case "play": return this.deps.play(song);
      case "reuse": return this.deps.reuse(song);
      case "cross": return this.cross(song);
      case "rename": return this.startRename(song.id);
      case "move": return this.openMoveMenu(button, song);
      case "lyrics":
        if (!this.openLyrics.delete(song.id)) this.openLyrics.add(song.id);
        return this.render();
      case "fav": return store.toggleFavorite(song);
      case "retry": return store.retry(song.id);
      case "more": return store.generateAnother(song);
      case "del": {
        const active = song.status === "queued" || song.status === "running";
        if (!active && !confirm(t("del_q"))) return;
        return store.remove(song.id);
      }
    }
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
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this.crossFrom) return;
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
