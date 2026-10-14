// Lautstärke: Regler klappt beim Zeigen auf den Lautsprecher aus; Klick auf den Lautsprecher = stumm.
import { byId } from "../../core/dom.ts";
import { storage } from "../../core/storage.ts";
import type { Translate } from "../../i18n/i18n.ts";

export class VolumeControl {
  private readonly t: Translate;
  private readonly apply: (volume: number) => void;
  private readonly box = byId("vol");
  private readonly range = byId<HTMLInputElement>("volRange");
  private readonly button = byId<HTMLButtonElement>("volBtn");
  private volume = 1;
  private muted = false;

  /** @param apply setzt die tatsächliche Lautstärke (0…1) am Player */
  constructor(t: Translate, apply: (volume: number) => void) {
    this.t = t;
    this.apply = apply;
    const saved = Number(storage.get("volume") ?? NaN);
    if (Number.isFinite(saved)) this.volume = Math.min(1, Math.max(0, saved));
    this.muted = storage.get("muted") === "1";
    this.range.addEventListener("input", () => {
      this.volume = Number(this.range.value) / 100;
      this.muted = false;
      this.update();
    });
    this.button.addEventListener("click", () => {
      this.muted = !this.muted;
      if (!this.muted && this.volume === 0) this.volume = 0.5;
      this.update();
    });
    this.update();
  }

  get effective(): number {
    return this.muted ? 0 : this.volume;
  }

  update(): void {
    const v = this.effective;
    this.apply(v);
    this.box.dataset.level = v === 0 ? "off" : v < 0.5 ? "low" : "high";
    this.box.style.setProperty("--v", String(this.volume));
    this.range.value = String(Math.round(this.volume * 100));
    const label = this.t(this.muted ? "unmute" : "mute");
    this.button.title = label;
    this.button.setAttribute("aria-label", label);
    storage.set("volume", String(this.volume));
    storage.set("muted", this.muted ? "1" : "0");
  }
}
