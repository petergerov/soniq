// Anordnung: Generator und Bibliothek untereinander oder nebeneinander (ab ca. 1000 px Breite).
import { storage } from "../../core/storage.ts";

type Layout = "stack" | "side";

export class LayoutSwitcher {
  private readonly buttons = document.querySelectorAll<HTMLButtonElement>("[data-layout]");

  constructor() {
    this.buttons.forEach((b) => b.addEventListener("click", () => this.set(b.dataset.layout === "side" ? "side" : "stack")));
    this.set(storage.get("layout") === "side" ? "side" : "stack");
  }

  set(layout: Layout): void {
    const side = layout === "side";
    document.querySelector(".wrap")?.classList.toggle("side", side);
    document.documentElement.classList.toggle("side", side);
    this.buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layout === layout)));
    storage.set("layout", layout);
  }
}
