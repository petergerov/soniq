// Kopf der Bibliothek: Suche, Favoriten-Filter, Ausgeblendete zeigen, Anzahl und Größe der Songs.
import { byId } from "../../core/dom.ts";
import { formatSize } from "../../core/format.ts";
import type { I18n } from "../../i18n/i18n.ts";
import type { LibraryStore } from "./library-store.ts";

export class LibraryHeader {
  private readonly store: LibraryStore;
  private readonly i18n: I18n;
  private readonly stats = byId("libStats");
  private readonly favButton = byId<HTMLButtonElement>("onlyFav");
  private readonly hiddenButton = byId<HTMLButtonElement>("showHidden");

  constructor(store: LibraryStore, i18n: I18n) {
    this.store = store;
    this.i18n = i18n;
    byId<HTMLInputElement>("search").addEventListener("input", (e) => store.setSearch((e.target as HTMLInputElement).value));
    this.favButton.addEventListener("click", () => {
      store.toggleFavoritesOnly();
      this.render();
    });
    this.hiddenButton.addEventListener("click", () => {
      store.toggleShowHidden();
      this.render();
    });
  }

  render(): void {
    const on = this.store.favoritesOnly;
    this.favButton.setAttribute("aria-pressed", String(on));
    this.favButton.textContent = on ? "★" : "☆";
    this.hiddenButton.setAttribute("aria-pressed", String(this.store.showHidden));
    const s = this.store.stats;
    if (s) this.stats.textContent = s.count ? `${s.count} Songs · ${formatSize(s.bytes, this.i18n.lang)}` : "";
  }
}
