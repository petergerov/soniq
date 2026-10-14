// Gesang: Schalter Instrumental | Song. Bei Song zeigt der Bereich Sprache und Lyrics;
// leeres Feld = Modell schreibt selbst ("automatisch"), sonst eigene Lyrics.
import { byId, restartAnimation } from "../../core/dom.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { renderChips } from "./chips.ts";
import { SECTIONS } from "./random-content.ts";

const INSTRUMENTAL = "[Instrumental]";
const PLACEHOLDER = "[verse]\n…\n\n[chorus]\n…";

export interface LyricsElements {
  instrumental: HTMLInputElement;
  lyrics: HTMLTextAreaElement;
}

export class LyricsEditor {
  private readonly el: LyricsElements;
  private readonly t: Translate;
  private readonly hint: HTMLElement;
  private readonly panel = byId("lyricsPanel");
  private readonly switches = document.querySelectorAll<HTMLButtonElement>("[data-vocals]");
  /** Eigene Lyrics, solange auf Instrumental umgeschaltet ist */
  private stash = "";

  constructor(el: LyricsElements, t: Translate) {
    this.el = el;
    this.t = t;
    this.hint = byId("lyricsHint");
    renderChips(byId("sectionChips"), SECTIONS, (s) => this.insertSection(s));
    this.bindEvents();
    this.sync();
  }

  get instrumental(): boolean {
    return this.el.instrumental.checked;
  }

  /** Lyrics für die Anfrage ("" = instrumental oder automatisch). */
  get text(): string {
    return this.instrumental ? "" : this.el.lyrics.value;
  }

  setInstrumental(): void {
    this.el.instrumental.checked = true;
    this.sync();
  }

  /** Modell schreibt beim Generieren eigene Lyrics. */
  setAutomatic(): void {
    this.setOwn("");
  }

  setOwn(text: string): void {
    this.el.instrumental.checked = false;
    this.stash = "";
    this.el.lyrics.value = text;
    this.sync();
  }

  /** Lyrics eines gespeicherten Songs übernehmen. */
  load(lyrics: string): void {
    const instrumental = lyrics === INSTRUMENTAL;
    this.stash = "";
    this.el.lyrics.value = instrumental ? "" : lyrics;
    this.el.instrumental.checked = instrumental;
    this.sync();
  }

  /** Feld, Platzhalter und Hinweis an den Zustand anpassen (auch nach Sprachwechsel). */
  sync(): void {
    const { lyrics } = this.el;
    const on = this.instrumental;
    if (on) {
      if (lyrics.value !== INSTRUMENTAL) this.stash = lyrics.value;
      lyrics.value = INSTRUMENTAL;
    } else if (lyrics.value === INSTRUMENTAL) {
      lyrics.value = this.stash;
    }
    this.panel.hidden = on;
    this.switches.forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.vocals === "instrumental") === on)));
    const auto = !on && !lyrics.value.trim();
    lyrics.classList.toggle("auto", auto);
    lyrics.placeholder = auto ? this.t("auto_ph") : PLACEHOLDER;
    this.hint.textContent = on ? INSTRUMENTAL : auto ? this.t("auto_lbl") : this.t("own_lyrics");
  }

  private insertSection(section: string): void {
    const f = this.el.lyrics, pos = f.selectionStart ?? f.value.length;
    const before = f.value.slice(0, pos);
    const insert = (before && !before.endsWith("\n") ? "\n\n" : "") + section + "\n";
    f.value = before + insert + f.value.slice(pos);
    f.focus();
    f.selectionStart = f.selectionEnd = pos + insert.length;
  }

  private bindEvents(): void {
    const { instrumental, lyrics } = this.el;
    // Lyrics-Würfel: das Modell schreibt bei der Generierung eigene Lyrics (hier erscheint kein Text)
    byId("lyricsDice").addEventListener("click", (e) => {
      this.setAutomatic();
      restartAnimation(e.currentTarget as HTMLElement, "roll");
    });
    this.switches.forEach((b) => b.addEventListener("click", () => {
      instrumental.checked = b.dataset.vocals === "instrumental";
      this.sync();
    }));
    lyrics.addEventListener("input", () => this.sync());
  }
}
