import { escapeHtml } from "../../core/dom.ts";

/** Füllt einen Container mit anklickbaren Karten. */
export function renderChips(container: HTMLElement, items: readonly string[], onClick: (item: string) => void): void {
  container.innerHTML = items.map((t) => `<span class="chip" role="button" tabindex="0">${escapeHtml(t)}</span>`).join("");
  container.querySelectorAll<HTMLElement>(".chip").forEach((chip, i) => chip.addEventListener("click", () => onClick(items[i]!)));
}
