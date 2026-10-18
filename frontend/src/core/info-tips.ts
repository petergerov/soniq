// ⓘ neben jeder Beschriftung mit Erklärung (ideas.md, Idee 24). Die Erklärung bleibt das title-Attribut der
// Beschriftung (Hover, übersetzt über data-i18n-title); der Knopf zeigt sie zusätzlich als Hinweis, auch auf
// Touch-Geräten ohne Hover. Er sitzt neben der Beschriftung, nicht darin (data-i18n ersetzt deren Text); beide stehen
// in einer gemeinsamen Zeile (.lbl-wrap), sonst rutschte der Knopf im spaltenweisen .field in eine eigene Zeile.
import type { Translate } from "../i18n/i18n.ts";

const SELECTOR = ".lbl[title]";

export class InfoTips {
  private readonly t: Translate;
  private readonly pop = document.createElement("div");
  private openFor: HTMLButtonElement | null = null;

  constructor(t: Translate) {
    this.t = t;
    this.pop.className = "info-pop";
    this.pop.id = "infoPop";
    this.pop.setAttribute("role", "tooltip");
    this.pop.hidden = true;
    document.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button.info");
      if (!button) return this.close();
      e.preventDefault();          // in <summary> nicht auf- und zuklappen, in <label> nicht das Feld wählen
      e.stopPropagation();
      if (this.openFor === button) this.close();
      else this.show(button);
    }, true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.openFor) {
        this.openFor.focus();
        this.close();
      }
    });
    for (const type of ["scroll", "resize"]) window.addEventListener(type, () => this.close(), { passive: true, capture: true });
  }

  /** Knöpfe anlegen (nach dem Übersetzen, damit leere Erklärungen übersprungen werden); mehrfach aufrufbar. */
  attach(root: ParentNode = document): void {
    root.querySelectorAll<HTMLElement>(SELECTOR).forEach((label) => {
      if (label.nextElementSibling?.classList.contains("info") || !label.title.trim()) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "info";
      button.textContent = "i";
      button.setAttribute("aria-expanded", "false");
      const wrap = document.createElement("span");
      wrap.className = "lbl-wrap";
      label.replaceWith(wrap);
      wrap.append(label, button);
    });
    this.refreshTexts();
  }

  /** Nach einem Sprachwechsel */
  refreshTexts(): void {
    document.querySelectorAll<HTMLButtonElement>("button.info").forEach((b) => {
      b.setAttribute("aria-label", this.t("info_show", (b.previousElementSibling as HTMLElement | null)?.textContent?.trim() ?? ""));
    });
    this.close();
  }

  private show(button: HTMLButtonElement): void {
    const text = (button.previousElementSibling as HTMLElement | null)?.title ?? "";
    if (!text) return;
    this.close();
    // Im modalen Dialog (oberste Ebene) muss der Hinweis im Dialog liegen, sonst liegt er dahinter
    (button.closest("dialog") ?? document.body).append(this.pop);
    this.pop.textContent = text;
    this.pop.hidden = false;
    const r = button.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 32);
    this.pop.style.maxWidth = `${width}px`;
    this.pop.style.left = `${Math.max(16, Math.min(r.left - 12, window.innerWidth - width - 16))}px`;
    const below = r.bottom + 8;
    const height = this.pop.offsetHeight;
    this.pop.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 8) : below}px`;
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-describedby", this.pop.id);
    this.openFor = button;
  }

  private close(): void {
    if (!this.openFor) return;
    this.openFor.setAttribute("aria-expanded", "false");
    this.openFor.removeAttribute("aria-describedby");
    this.openFor = null;
    this.pop.hidden = true;
  }
}
