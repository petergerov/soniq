// Formular zum Erzeugen: liest die Eingaben, schickt den Auftrag, übernimmt Werte aus Songs und Analysen.
import type { AnalyzeResult, GenerateRequest, Song } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { byId, restartAnimation, scrollToTop } from "../../core/dom.ts";
import { storage } from "../../core/storage.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { BubbleSlider } from "./bubble-slider.ts";
import { LyricsEditor } from "./lyrics-editor.ts";
import { PromptBlocks } from "./prompt-blocks.ts";
import { isThemeId, promptBlock, randomPrompt, randomStyle, randomTitle, setPromptBlock, type DiceOptions, type ThemeId, varyPrompt, varyStyle } from "./random-content.ts";
import { StyleAxisSliders } from "./style-axis-sliders.ts";
import { StyleChips } from "./style-chips.ts";

interface FormControls extends HTMLFormControlsCollection {
  title: HTMLInputElement;
  prompt: HTMLTextAreaElement;
  style: HTMLTextAreaElement;
  instrumental: HTMLInputElement;
  keep_caption: HTMLInputElement;
  lyrics: HTMLTextAreaElement;
  vocal_language: HTMLSelectElement;
  keyscale: HTMLSelectElement;
  timesignature: HTMLSelectElement;
  seed: HTMLInputElement;
}

export interface GeneratorFormDeps {
  api: ApiClient;
  t: Translate;
  /** Ordner, in dem neue Songs landen (null = unsortiert) */
  targetFolder: () => string | null;
  /** Nach erfolgreichem Auftrag */
  onQueued: () => void;
  /** Begriffe aus den Favoriten; die Würfel greifen öfter zu ihnen */
  preferredTerms: () => ReadonlySet<string>;
}

const DEFAULTS = { duration: 90, inferenceSteps: 50, lmTemperature: 0.85, language: "en" };

/** Felder, die Zufall und Variation unverändert lassen (pro Browser gemerkt). */
type LockableField = "prompt" | "style";
const LOCKS_KEY = "lockedFields";
const THEME_KEY = "diceTheme";
/** So viele Würfelschritte lassen sich mit ↶ zurücknehmen. */
const HISTORY_LIMIT = 30;

interface DiceSnapshot { prompt: string; style: string }

/** Auswahlfeld setzen; unbekannte Werte werden ergänzt (Tonart aus der Analyse) oder fallen auf Auto zurück. */
function setSelect(select: HTMLSelectElement, value: string | null | undefined, addUnknown = false): void {
  let v = value || "";
  if (![...select.options].some((o) => o.value === v)) {
    if (addUnknown) select.add(new Option(v, v));
    else v = "";
  }
  select.value = v;
}

/** Nur echter Text außerhalb von [Strukturmarkern] zählt als Gesang. */
function hasVocals(lyrics: string): boolean {
  return lyrics.replace(/\[[^\]]*\]/g, "").trim().length > 0;
}

export class GeneratorForm {
  private readonly deps: GeneratorFormDeps;
  private readonly form: HTMLFormElement;
  private readonly f: FormControls;
  private readonly button: HTMLButtonElement;
  private readonly styleChips: StyleChips;
  private readonly styleAxes: StyleAxisSliders;
  private readonly lyrics: LyricsEditor;
  private readonly sliders: Record<"duration" | "bpm" | "steps" | "temperature" | "variants", BubbleSlider>;
  private readonly locked = new Set<LockableField>(storage.getJson<LockableField[]>(LOCKS_KEY, []));
  /** Prompt und Stil vor jedem Würfeln, für ↶ */
  private readonly history: DiceSnapshot[] = [];
  private readonly undoButton: HTMLButtonElement;
  private readonly themeSelect: HTMLSelectElement;
  private readonly blocks: PromptBlocks;
  private readonly similarButton: HTMLButtonElement;
  /** Letzte Analyse, für „Ähnlich, aber anders“ */
  private lastAnalysis: AnalyzeResult | null = null;

  constructor(deps: GeneratorFormDeps) {
    this.deps = deps;
    this.form = byId<HTMLFormElement>("genForm");
    this.f = this.form.elements as FormControls;
    this.button = byId<HTMLButtonElement>("genBtn");
    this.undoButton = byId<HTMLButtonElement>("undoBtn");
    this.themeSelect = byId<HTMLSelectElement>("themeSelect");
    const savedTheme = storage.get(THEME_KEY);
    this.themeSelect.value = isThemeId(savedTheme) ? savedTheme : "all";
    this.blocks = new PromptBlocks({ field: this.f.prompt, root: this.form.querySelector(".blocks")!, dice: () => this.dice, beforeChange: () => this.remember() });
    this.similarButton = byId<HTMLButtonElement>("similarBtn");
    this.styleChips = new StyleChips(this.f.style, byId("tagChips"));
    this.styleAxes = new StyleAxisSliders(this.f.style, this.form.querySelector(".axes")!, () => this.remember());
    this.lyrics = new LyricsEditor({ instrumental: this.f.instrumental, lyrics: this.f.lyrics }, deps.t);
    const slider = (name: string, onChange?: () => void) => new BubbleSlider(this.form.querySelector(`input[name="${name}"]`)!.closest<HTMLElement>(".slider")!, onChange);
    this.sliders = {
      duration: slider("duration"),
      bpm: slider("bpm"),
      steps: slider("inference_steps"),
      temperature: slider("lm_temperature"),
      variants: slider("variants", () => this.updateButton()),
    };
    this.bindDice();
    this.bindSubmit();
    this.updateButton();
  }

  /** Zufall: Prompt und Stil neu würfeln, gesperrte Felder bleiben. */
  random(): void {
    this.rollBoth(() => randomPrompt(this.dice), (_, withVocals) => randomStyle(withVocals, this.dice), byId("randomBtn"));
  }

  /** Variation: Prompt und Stil leicht abwandeln, gesperrte Felder bleiben. */
  vary(): void {
    this.rollBoth((text) => varyPrompt(text, this.dice), (text, withVocals) => varyStyle(text, withVocals, this.dice), byId("varyBtn"));
  }

  /** Letzten Würfelschritt zurücknehmen. */
  undo(): void {
    const last = this.history.pop();
    if (!last) return;
    this.f.prompt.value = last.prompt;
    this.f.style.value = last.style;
    this.syncStyle();
    this.blocks.sync();
    this.updateUndo();
  }

  /** Zwei Songs kreuzen: Stil von A, Szene von B (ohne erkannte Szene: der ganze Prompt von B). */
  cross(a: Song, b: Song): void {
    this.remember();
    const promptA = a.params.prompt ?? "";
    const promptB = b.params.prompt ?? b.params.caption;
    const sceneB = promptBlock(promptB, "scene");
    this.f.style.value = a.params.style || a.params.caption;   // ohne Stil: die ganze Beschreibung von A
    this.f.prompt.value = sceneB && promptA ? setPromptBlock(promptA, "scene", sceneB) : promptB;
    this.f.title.value = randomTitle();
    this.syncStyle();
    this.blocks.sync();
    scrollToTop();
  }

  /** Wie ein Klick auf Generieren (Tastenkürzel). */
  submit(): void {
    this.form.requestSubmit();
  }

  /** Texte neu setzen (nach Sprachwechsel). */
  refreshTexts(): void {
    Object.values(this.sliders).forEach((s) => s.update());
    this.lyrics.sync();
    this.updateButton();
  }

  /** Einstellungen eines vorhandenen Songs übernehmen ("wiederverwenden"). */
  fill(song: Song): void {
    const p = song.params;
    this.f.title.value = song.title || "";
    this.f.style.value = p.style ?? p.caption;   // ältere Songs haben nur einen Text
    this.f.prompt.value = p.prompt ?? "";
    this.syncStyle();
    this.blocks.sync();
    this.f.keep_caption.checked = true;          // Prompt wörtlich ist fest die Vorgabe
    this.lyrics.load(p.lyrics || "");
    this.sliders.duration.value = p.duration || DEFAULTS.duration;
    this.sliders.bpm.value = p.bpm || this.sliders.bpm.min;
    this.sliders.steps.value = p.inference_steps || DEFAULTS.inferenceSteps;
    this.sliders.temperature.value = p.lm_temperature ?? DEFAULTS.lmTemperature;   // ältere Songs liefen mit der Modell-Vorgabe
    this.sliders.variants.value = 1;
    this.updateButton();
    setSelect(this.f.keyscale, p.keyscale, true);
    setSelect(this.f.timesignature, p.timesignature);
    this.f.vocal_language.value = p.vocal_language || DEFAULTS.language;
    this.f.seed.value = String(p.seed);
    byId<HTMLDetailsElement>("advBox").open = true;
    scrollToTop();
  }

  /** Ergebnis der Song-Analyse als Vorschlag übernehmen. */
  applyAnalysis(r: AnalyzeResult): void {
    this.lastAnalysis = r;
    this.similarButton.hidden = false;
    this.remember();
    this.f.prompt.value = r.caption || "";
    this.f.style.value = "";
    this.applyAnalysisMusic(r);
    scrollToTop();
  }

  /** „Ähnlich, aber anders“: Tempo, Tonart, Länge und Beschreibung der letzten Analyse, dazu ein neu gewürfelter Stil. */
  similar(): void {
    const r = this.lastAnalysis;
    if (!r) return;
    this.remember();
    if (!this.locked.has("prompt")) this.f.prompt.value = r.caption || "";
    this.applyAnalysisMusic(r);
    if (!this.locked.has("style")) this.f.style.value = randomStyle(!this.lyrics.instrumental, this.dice);
    this.syncStyle();
    restartAnimation(this.similarButton, "roll");
  }

  /** Alles aus der Analyse außer Prompt und Stil. */
  private applyAnalysisMusic(r: AnalyzeResult): void {
    this.syncStyle();
    this.blocks.sync();
    this.f.title.value = randomTitle();
    if (hasVocals(r.lyrics || "")) {
      // Nicht den transkribierten Text übernehmen, sondern wie beim Lyrics-Würfel das Modell selbst schreiben lassen
      this.lyrics.setAutomatic();
      const lang = (r.vocal_language || "").toLowerCase();
      if ([...this.f.vocal_language.options].some((o) => o.value === lang)) this.f.vocal_language.value = lang;
    } else {
      this.lyrics.setInstrumental();
    }
    if (r.bpm) this.sliders.bpm.value = r.bpm;
    if (r.duration) {
      const d = this.sliders.duration;
      d.value = Math.min(d.max, Math.max(d.min, Math.round(r.duration / 5) * 5));
    }
    setSelect(this.f.keyscale, r.keyscale, true);
    setSelect(this.f.timesignature, String(r.timesignature || ""));
  }

  private read(): GenerateRequest {
    const instrumental = this.lyrics.instrumental;
    const seed = this.f.seed.value.trim();
    const bpm = this.sliders.bpm;
    return {
      folder_id: this.deps.targetFolder(),
      title: this.f.title.value,
      prompt: this.f.prompt.value,
      style: this.f.style.value,
      lyrics: this.lyrics.text,
      instrumental,
      keep_caption: this.f.keep_caption.checked,
      duration: this.sliders.duration.value,
      bpm: bpm.value <= bpm.min ? 0 : bpm.value,
      keyscale: this.f.keyscale.value,
      timesignature: this.f.timesignature.value,
      vocal_language: instrumental ? "" : this.f.vocal_language.value || DEFAULTS.language,
      seed: seed === "" ? -1 : Number(seed),
      variants: this.sliders.variants.value,
      inference_steps: this.sliders.steps.value,
      lm_temperature: this.sliders.temperature.value,
    };
  }

  private updateButton(): void {
    const n = this.sliders.variants.value;
    this.button.textContent = n > 1 ? this.deps.t("generate_n", n) : this.deps.t("generate");
  }

  private bindDice(): void {
    const roll = (buttonId: string, field: HTMLInputElement | HTMLTextAreaElement, generate: () => string, after?: () => void) =>
      byId(buttonId).addEventListener("click", (e) => {
        if (field !== this.f.title) this.remember();
        field.value = generate();
        restartAnimation(e.currentTarget as HTMLElement, "roll");
        after?.();
      });
    roll("diceBtn", this.f.prompt, () => randomPrompt(this.dice), () => this.blocks.sync());
    roll("titleDice", this.f.title, () => randomTitle());
    roll("styleDice", this.f.style, () => randomStyle(!this.lyrics.instrumental, this.dice), () => this.syncStyle());
    this.themeSelect.addEventListener("change", () => {
      storage.set(THEME_KEY, this.theme);
      this.blocks.sync();
    });
    this.similarButton.addEventListener("click", () => this.similar());
    byId("randomBtn").addEventListener("click", () => this.random());
    byId("varyBtn").addEventListener("click", () => this.vary());
    this.undoButton.addEventListener("click", () => this.undo());
    this.updateUndo();
    this.form.querySelectorAll<HTMLButtonElement>("button[data-lock]").forEach((button) => {
      const field = button.dataset.lock as LockableField;
      button.setAttribute("aria-pressed", String(this.locked.has(field)));
      button.addEventListener("click", () => {
        if (!this.locked.delete(field)) this.locked.add(field);
        button.setAttribute("aria-pressed", String(this.locked.has(field)));
        storage.setJson(LOCKS_KEY, [...this.locked]);
      });
    });
  }

  private rollBoth(prompt: (text: string) => string, style: (text: string, withVocals: boolean) => string, button: HTMLElement): void {
    if (this.locked.has("prompt") && this.locked.has("style")) return;
    this.remember();
    if (!this.locked.has("prompt")) this.f.prompt.value = prompt(this.f.prompt.value);
    if (!this.locked.has("style")) this.f.style.value = style(this.f.style.value, !this.lyrics.instrumental);
    this.syncStyle();
    this.blocks.sync();
    restartAnimation(button, "roll");
  }

  /** Stand vor dem Würfeln merken; gleiche Stände hintereinander nur einmal. */
  private remember(): void {
    const snap = { prompt: this.f.prompt.value, style: this.f.style.value };
    const last = this.history.at(-1);
    if (last && last.prompt === snap.prompt && last.style === snap.style) return;
    this.history.push(snap);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.updateUndo();
  }

  /** Stil-Karten und Stil-Regler an den Stil-Text anpassen. */
  private syncStyle(): void {
    this.styleChips.sync();
    this.styleAxes.sync();
  }

  /** Thema und Vorlieben aus den Favoriten für alle Würfel. */
  private get dice(): DiceOptions {
    return { theme: this.theme, prefer: this.deps.preferredTerms() };
  }

  private get theme(): ThemeId {
    return isThemeId(this.themeSelect.value) ? this.themeSelect.value : "all";
  }

  private updateUndo(): void {
    this.undoButton.disabled = this.history.length === 0;
  }

  private bindSubmit(): void {
    this.form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!this.f.prompt.value.trim() && !this.f.style.value.trim()) {
        this.f.prompt.focus();
        return;
      }
      if (this.button.disabled) return;
      this.button.disabled = true;
      try {
        await this.deps.api.generate(this.read());
        this.deps.onQueued();
      } catch (err) {
        alert(`${this.deps.t("error")}: ${(err as Error).message}`);
      }
      setTimeout(() => { this.button.disabled = false; }, 600);
    });
    // Enter in einem Eingabefeld soll nicht versehentlich generieren
    this.form.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
    });
  }
}
