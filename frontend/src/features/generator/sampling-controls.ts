// Erweitert › Sampling (ideas.md, Idee 23): Prompt-Treue (lm_cfg_scale), Top-P, Top-K, Vermeiden (lm_negative_prompt)
// und Verfahren (solver). Vorgabe = Vorgabe des Modellservers; abweichende Werte zeigt die Zusammenfassung an.
import { SAMPLING_DEFAULTS, SOLVERS, type Sampling, type Solver } from "../../../../shared/api.ts";
import { byId } from "../../core/dom.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { BubbleSlider } from "./bubble-slider.ts";

type NumericField = "lm_cfg_scale" | "lm_top_p" | "lm_top_k";
const NUMERIC: readonly NumericField[] = ["lm_cfg_scale", "lm_top_p", "lm_top_k"];

export class SamplingControls {
  private readonly t: Translate;
  private readonly box = byId<HTMLDetailsElement>("samplingBox");
  private readonly hint = byId("samplingHint");
  private readonly sliders = {} as Record<NumericField, BubbleSlider>;
  private readonly negative: HTMLInputElement;
  private readonly solver: HTMLSelectElement;

  constructor(t: Translate) {
    this.t = t;
    for (const name of NUMERIC) {
      this.sliders[name] = new BubbleSlider(this.box.querySelector(`input[name="${name}"]`)!.closest<HTMLElement>(".slider")!, () => this.render());
    }
    this.negative = this.box.querySelector<HTMLInputElement>('input[name="lm_negative_prompt"]')!;
    this.solver = this.box.querySelector<HTMLSelectElement>('select[name="solver"]')!;
    this.negative.addEventListener("input", () => this.render());
    this.solver.addEventListener("change", () => this.render());
    byId("samplingReset").addEventListener("click", () => this.set({}));
    this.set({});
  }

  /** Nur abweichende Werte (leer = alles auf Vorgabe) */
  get value(): Sampling {
    const d = SAMPLING_DEFAULTS;
    const out: Sampling = {};
    for (const name of NUMERIC) if (this.sliders[name].value !== d[name]) out[name] = this.sliders[name].value;
    const negative = this.negative.value.trim();
    if (negative) out.lm_negative_prompt = negative;
    if (this.solver.value !== d.solver) out.solver = this.solver.value as Solver;
    return out;
  }

  /** Fehlende Felder gehen auf die Vorgabe zurück; sind Werte abweichend, klappt der Bereich auf */
  set(s: Sampling): void {
    const v = { ...SAMPLING_DEFAULTS, ...s };
    for (const name of NUMERIC) this.sliders[name].value = v[name];
    this.negative.value = v.lm_negative_prompt;
    this.solver.value = (SOLVERS as readonly string[]).includes(v.solver) ? v.solver : SAMPLING_DEFAULTS.solver;
    this.render();
    if (Object.keys(this.value).length) this.box.open = true;
  }

  refreshTexts(): void {
    Object.values(this.sliders).forEach((s) => s.update());
    this.render();
  }

  /** "2 geändert" neben der Überschrift */
  private render(): void {
    const n = Object.keys(this.value).length;
    this.hint.textContent = n ? this.t("sampling_changed", n) : "";
  }
}
