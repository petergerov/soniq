// Lyrics-Bereich: eingeklappt = instrumental ("[Instrumental]" im Feld), leer = Modell schreibt selbst ("automatisch"),
// sonst eigene Lyrics. Ein Klick ins Feld schaltet Instrumental aus.
import { byId, restartAnimation } from "../../core/dom.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { renderChips } from "./chips.ts";
import { SECTIONS } from "./random-content.ts";

const INSTRUMENTAL = "[Instrumental]";
const PLACEHOLDER = "[verse]\n…\n\n[chorus]\n…";

export interface LyricsElements {
  instrumental: HTMLInputElement;
  lyrics: HTMLTextAreaElement;
  box: HTMLDetailsElement;
}

export class LyricsEditor {
  private readonly el: LyricsElements;
  private readonly t: Translate;
  private readonly hint: HTMLElement;
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
    this.open(!instrumental && !!lyrics.trim());
  }

  open(open: boolean): void {
    this.el.box.open = open;
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
    lyrics.classList.toggle("dim", on);
    const auto = !on && !lyrics.value.trim();
    lyrics.classList.toggle("auto", auto);
    lyrics.placeholder = auto ? this.t("auto_ph") : PLACEHOLDER;
    this.hint.textContent = on ? INSTRUMENTAL : auto ? this.t("auto_lbl") : this.t("own_lyrics");
  }

  private insertSection(section: string): void {
    if (section === "[instrumental]") return this.setInstrumental();   // zurück zu ohne Gesang
    const f = this.el.lyrics, pos = f.selectionStart ?? f.value.length;
    const before = f.value.slice(0, pos);
    const insert = (before && !before.endsWith("\n") ? "\n\n" : "") + section + "\n";
    f.value = before + insert + f.value.slice(pos);
    f.focus();
    f.selectionStart = f.selectionEnd = pos + insert.length;
  }

  private bindEvents(): void {
    const { instrumental, lyrics, box } = this.el;
    // Lyrics-Würfel: das Modell schreibt bei der Generierung eigene Lyrics (hier erscheint kein Text)
    byId("lyricsDice").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();   // <summary> soll dabei nicht auf-/zuklappen
      this.setAutomatic();
      restartAnimation(e.currentTarget as HTMLElement, "roll");
    });
    // Einklappen (Klick auf die Kopfzeile) heißt: Instrumental
    box.querySelector("summary")!.addEventListener("click", () => {
      if (box.open && !this.instrumental) this.setInstrumental();
    });
    instrumental.addEventListener("change", () => {
      this.sync();
      if (!this.instrumental) box.open = true;
    });
    lyrics.addEventListener("focus", () => {
      if (this.instrumental) {
        instrumental.checked = false;
        this.sync();
      }
    });
    lyrics.addEventListener("input", () => this.sync());
  }
}
