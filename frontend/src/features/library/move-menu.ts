// Kleines Menü mit allen Ordnern, geöffnet über den Ordner-Knopf einer Songzeile.
import { escapeHtml } from "../../core/dom.ts";

export interface MenuItem {
  id: string;
  label: string;
  selected: boolean;
}

export class MoveMenu {
  private menu: HTMLElement | undefined;

  constructor() {
    window.addEventListener("scroll", () => this.close(), true);
  }

  open(anchor: HTMLElement, items: MenuItem[], onPick: (id: string) => void): void {
    this.close();
    const menu = document.createElement("div");
    menu.className = "movemenu";
    menu.innerHTML = items
      .map((i) => `<button type="button" data-f="${escapeHtml(i.id)}" class="${i.selected ? "on" : ""}">${escapeHtml(i.label)}</button>`)
      .join("");
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8)}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
    menu.addEventListener("click", (e) => {
      const button = (e.target as Element).closest<HTMLElement>("[data-f]");
      if (!button) return;
      this.close();
      onPick(button.dataset.f!);
    });
    this.menu = menu;
    // Klick daneben schließt (erst nach diesem Klick scharf schalten)
    setTimeout(() => {
      const outside = (e: MouseEvent) => {
        if (menu.contains(e.target as Node)) return;
        this.close();
        document.removeEventListener("click", outside);
      };
      document.addEventListener("click", outside);
    }, 0);
  }

  close(): void {
    this.menu?.remove();
    this.menu = undefined;
  }
}
