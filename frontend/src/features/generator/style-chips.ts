// Stil-Karten sind Schalter: an = steht im Stil-Feld (gold umrandet), aus = wird dort wieder entfernt.
import { renderChips } from "./chips.ts";
import { STYLE_TAGS } from "./random-content.ts";

export class StyleChips {
  private readonly field: HTMLTextAreaElement;
  private readonly container: HTMLElement;

  constructor(field: HTMLTextAreaElement, container: HTMLElement) {
    this.field = field;
    this.container = container;
    renderChips(container, STYLE_TAGS, (tag) => this.toggle(tag));
    field.addEventListener("input", () => this.sync());
  }

  /** Nach Änderungen am Stil-Feld von außen aufrufen. */
  sync(): void {
    const active = new Set(this.parts().map((x) => x.toLowerCase()));
    this.container.querySelectorAll<HTMLElement>(".chip").forEach((chip) => {
      const on = active.has((chip.textContent ?? "").toLowerCase());
      chip.classList.toggle("on", on);
      chip.setAttribute("aria-pressed", String(on));
    });
  }

  private parts(): string[] {
    return this.field.value.split(",").map((x) => x.trim()).filter(Boolean);
  }

  private toggle(tag: string): void {
    const parts = this.parts();
    const rest = parts.filter((x) => x.toLowerCase() !== tag.toLowerCase());
    this.field.value = (rest.length < parts.length ? rest : [...parts, tag]).join(", ");
    this.field.dispatchEvent(new Event("input"));   // synchronisiert die Karten und die Stil-Regler
  }
}
