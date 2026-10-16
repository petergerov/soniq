// Ordnerleiste: Ansicht wählen, Ordner anlegen/umbenennen/löschen, ZIP laden, Songs per Ziehen einsortieren.
import { confirmDialog, errorDialog, promptDialog } from "../../core/dialogs.ts";
import { byId, closest, escapeHtml as esc, PressGuard, setHtml } from "../../core/dom.ts";
import type { Translate } from "../../i18n/i18n.ts";
import type { LibraryStore } from "./library-store.ts";
import { SongDrag, SONG_DRAG_TYPE } from "./song-drag.ts";

export class FolderBar {
  private readonly store: LibraryStore;
  private readonly drag: SongDrag;
  private readonly t: Translate;
  private readonly root = byId("folderBar");
  private readonly press = new PressGuard(this.root);

  constructor(store: LibraryStore, drag: SongDrag, t: Translate) {
    this.store = store;
    this.drag = drag;
    this.t = t;
    this.bindClicks();
    this.bindDrop();
  }

  refresh(): void {
    if (!this.drag.active) this.render();
  }

  render(): void {
    if (this.press.defer(() => this.refresh())) return;   // Klick auf einen Ordner nicht verschlucken (siehe PressGuard)
    const { store, t } = this;
    const current = store.currentFolderInfo;
    // Tastaturfokus nach dem Neuzeichnen behalten
    const focused = document.activeElement?.closest("#folderBar") ? (document.activeElement as HTMLElement).dataset.f : undefined;
    const chip = (id: string, name: string, count: number) => {
      const on = id === store.currentFolder;
      return `<span class="chip fold${on ? " on" : ""}" role="button" tabindex="0" aria-pressed="${on}" data-f="${esc(id)}" title="${esc(name)}">${esc(name)} <b>${count}</b></span>`;
    };
    const folders = store.folders;
    const html =
      chip("", t("f_all"), folders.all) +
      (store.hasFolders ? chip("none", t("f_none"), folders.none) : "") +
      folders.folders.map((f) => chip(f.id, f.name, f.count)).join("") +
      `<button type="button" class="chip add" data-fa="new" title="${t("f_new")}" aria-label="${t("f_new")}">＋</button>` +
      `<span class="fold-actions">` +
      (current ? `<button type="button" class="sek mini" data-fa="rename">${t("f_rename")}</button><button type="button" class="sek mini" data-fa="delete">${t("f_delete")}</button>` : "") +
      `<a class="download mini" data-fa="zip" href="${esc(store.downloadUrl())}" title="${t("f_zip_tip")}">${current ? t("f_zip") : t("f_zip_all")}</a></span>`;
    if (!setHtml(this.root, html)) return;
    if (focused !== undefined) this.root.querySelector<HTMLElement>(`[data-f="${CSS.escape(focused)}"]`)?.focus();
  }

  private async handleAction(action: string | undefined, e: Event): Promise<void> {
    const { store, t } = this;
    const current = store.currentFolderInfo;
    if (action === "new") {
      const name = await promptDialog({ title: t("f_new"), label: t("f_name_q"), confirmLabel: t("f_create"), cancelLabel: t("cancel") });
      if (name) await store.createFolder(name);
    } else if (action === "rename" && current) {
      const name = await promptDialog({
        title: t("f_rename"), label: t("f_name_q"), value: current.name, confirmLabel: t("f_rename"), cancelLabel: t("cancel"),
      });
      if (name && name !== current.name) await store.renameFolder(current.id, name);
    } else if (action === "delete" && current) {
      const ok = await confirmDialog({
        title: t("f_delete"), message: t("f_delete_q", current.name), confirmLabel: t("del"), cancelLabel: t("cancel"), danger: true,
      });
      if (ok) await store.deleteFolder(current.id);
    } else if (action === "zip" && !store.songs.some((s) => s.status === "done")) {
      e.preventDefault();   // nichts zum Herunterladen
    }
  }

  private bindClicks(): void {
    this.root.addEventListener("click", (e) => {
      const chip = closest<HTMLElement>(e.target, "[data-f]");
      if (chip) return this.store.setFolder(chip.dataset.f!);
      const action = closest<HTMLElement>(e.target, "[data-fa]")?.dataset.fa;
      this.handleAction(action, e).catch((err: Error) => void errorDialog(this.t, err));
    });
  }

  private bindDrop(): void {
    // Ziel: nur echte Ordner (nicht "Alle")
    const target = (e: DragEvent) => (SongDrag.carriesSong(e) ? closest<HTMLElement>(e.target, ".chip.fold:not([data-f=''])") : null);
    this.root.addEventListener("dragover", (e) => {
      const chip = target(e);
      if (!chip) return;
      e.preventDefault();
      chip.classList.add("drop");
    });
    this.root.addEventListener("dragleave", (e) => closest(e.target, ".chip")?.classList.remove("drop"));
    this.root.addEventListener("drop", (e) => {
      const chip = target(e);
      if (!chip) return;
      e.preventDefault();
      this.drag.end();
      const songId = e.dataTransfer!.getData(SONG_DRAG_TYPE);
      this.store.move(songId, chip.dataset.f!).catch((err: Error) => void errorDialog(this.t, err));
    });
  }
}
