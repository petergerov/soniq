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

const shownHtml = new WeakMap<Element, string>();

/** innerHTML nur setzen, wenn sich das Markup geändert hat (sonst bleiben Knöpfe, Fokus und Hover erhalten). true = ersetzt. */
export function setHtml(el: Element, html: string): boolean {
  if (shownHtml.get(el) === html) return false;
  el.innerHTML = html;
  shownHtml.set(el, html);
  return true;
}

/**
 * Hält Neuzeichnen zurück, solange die Maustaste (oder ein Finger) auf `root` liegt. Ersetzt ein Neuzeichnen den Knopf
 * unter dem Zeiger zwischen Drücken und Loslassen, löst der Browser keinen Klick aus. Die Bibliothek zeichnet bei
 * laufenden Aufträgen alle 1,5 s neu; gemessen ging dabei jeder dritte Klick auf ▶ verloren.
 */
export class PressGuard {
  private pressed = false;
  private pending: (() => void) | undefined;

  constructor(root: HTMLElement) {
    root.addEventListener("pointerdown", (e) => {
      if (e.button === 0) this.pressed = true;
    });
    const release = () => {
      if (!this.pressed) return;
      this.pressed = false;
      const run = this.pending;
      this.pending = undefined;
      if (run) setTimeout(run);   // erst nach dem click, der auf pointerup folgt
    };
    for (const type of ["pointerup", "pointercancel", "dragstart", "contextmenu"]) document.addEventListener(type, release, true);
    window.addEventListener("blur", release);
  }

  /** Gedrückt: `fn` läuft nach dem Loslassen, Rückgabe true. Sonst false (der Aufrufer zeichnet sofort). */
  defer(fn: () => void): boolean {
    if (!this.pressed) return false;
    this.pending = fn;
    return true;
  }
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
