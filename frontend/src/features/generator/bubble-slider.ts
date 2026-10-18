// Schieberegler mit Füllstand und Wert im Knopf. Das Format steht im HTML (data-fmt).
import { formatDuration } from "../../core/format.ts";

type Formatter = (value: number, min: number) => { text: string; small?: boolean };

const FORMATS: Record<string, Formatter> = {
  dur: (v) => ({ text: formatDuration(v) }),
  int: (v) => ({ text: String(v) }),
  temp: (v) => ({ text: v.toFixed(2) }),
  dec1: (v) => ({ text: v.toFixed(1) }),
  off: (v, min) => (v <= min ? { text: "OFF", small: true } : { text: String(v) }),   // ganz links = aus
  bpm: (v, min) => (v <= min ? { text: "AUTO", small: true } : { text: String(v) }),   // ganz links = Auto
};

export class BubbleSlider {
  readonly input: HTMLInputElement;
  private readonly box: HTMLElement;
  private readonly label: HTMLElement;
  private readonly format: Formatter;

  constructor(box: HTMLElement, onChange?: (value: number) => void) {
    this.box = box;
    this.input = box.querySelector("input")!;
    this.label = box.querySelector(".knob span")!;
    this.format = FORMATS[box.dataset.fmt ?? "int"] ?? FORMATS.int!;
    this.input.addEventListener("input", () => {
      this.update();
      onChange?.(this.value);
    });
    this.update();
  }

  get value(): number {
    return Number(this.input.value);
  }

  set value(v: number) {
    this.input.value = String(v);
    this.update();
  }

  get min(): number { return Number(this.input.min); }
  get max(): number { return Number(this.input.max); }

  update(): void {
    this.box.style.setProperty("--p", String((this.value - this.min) / (this.max - this.min)));
    const out = this.format(this.value, this.min);
    this.label.textContent = out.text;
    this.label.classList.toggle("small", !!out.small);
  }
}
