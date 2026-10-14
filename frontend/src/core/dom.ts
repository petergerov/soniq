// Kleine DOM-Helfer.

/** Element per ID; fehlt es, ist das ein Programmierfehler. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} fehlt im HTML`);
  return el as T;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Nächstes Element mit Selektor, ausgehend vom Ereignisziel. */
export function closest<T extends Element = HTMLElement>(target: EventTarget | null, selector: string): T | null {
  return target instanceof Element ? (target.closest(selector) as T | null) : null;
}

/** Elemente mit role="button" sind per Tab erreichbar; Enter und Leertaste lösen einen Klick aus. */
export function enableKeyboardButtons(root: Document = document): void {
  root.addEventListener("keydown", (e) => {
    const el = closest<HTMLElement>(e.target, '[role="button"]');
    if (el && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      el.click();
    }
  });
}

/** Startet eine CSS-Animation erneut (Klasse entfernen, Reflow, wieder setzen). */
export function restartAnimation(el: HTMLElement, className: string): void {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

/** Symbolknöpfe: Tooltip auch als Name für Screenreader. */
export function labelIconButtons(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("button[title]:not([aria-label]), a[title]:not([aria-label])")
    .forEach((el) => el.setAttribute("aria-label", el.title));
}

export function scrollToTop(): void {
  window.scrollTo({ top: 0, behavior: "smooth" });
}
