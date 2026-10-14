// Vorlagen: aktuelle Einstellungen unter einem Namen speichern und mit einem Klick laden (gespeichert auf dem Server).
import type { Preset, PresetValues } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { byId } from "../../core/dom.ts";
import type { Translate } from "../../i18n/i18n.ts";

export interface PresetPickerDeps {
  api: ApiClient;
  t: Translate;
  /** Einstellungen des Formulars lesen bzw. setzen */
  read: () => PresetValues;
  apply: (values: PresetValues) => void;
}

export class PresetPicker {
  private readonly deps: PresetPickerDeps;
  private readonly select = byId<HTMLSelectElement>("presetSelect");
  private readonly deleteButton = byId<HTMLButtonElement>("presetDelete");
  private presets: Preset[] = [];

  constructor(deps: PresetPickerDeps) {
    this.deps = deps;
    this.select.addEventListener("change", () => {
      const preset = this.presets.find((p) => p.name === this.select.value);
      if (preset) deps.apply(preset.values);
      this.updateDelete();
    });
    byId("presetSave").addEventListener("click", () => void this.save());
    this.deleteButton.addEventListener("click", () => void this.remove());
    void this.load();
  }

  /** Texte neu setzen (nach Sprachwechsel). */
  refreshTexts(): void {
    this.render();
  }

  private async load(): Promise<void> {
    try {
      this.presets = await this.deps.api.presets();
    } catch {
      this.presets = [];   // Server noch nicht bereit: dann eben ohne Vorlagen
    }
    this.render();
  }

  private async save(): Promise<void> {
    const name = prompt(this.deps.t("preset_name_q"), this.select.value)?.trim();
    if (!name) return;
    try {
      this.presets = await this.deps.api.savePreset(name, this.deps.read());
      this.render(name);
    } catch (err) {
      alert(`${this.deps.t("error")}: ${(err as Error).message}`);
    }
  }

  private async remove(): Promise<void> {
    const name = this.select.value;
    if (!name || !confirm(this.deps.t("preset_del_q", name))) return;
    this.presets = await this.deps.api.deletePreset(name);
    this.render("");
  }

  private render(selected = this.select.value): void {
    const placeholder = new Option(this.deps.t(this.presets.length ? "preset_pick" : "preset_none"), "");
    this.select.replaceChildren(placeholder, ...this.presets.map((p) => new Option(p.name, p.name)));
    this.select.value = this.presets.some((p) => p.name.toLowerCase() === selected.toLowerCase())
      ? this.presets.find((p) => p.name.toLowerCase() === selected.toLowerCase())!.name : "";
    this.updateDelete();
  }

  private updateDelete(): void {
    this.deleteButton.disabled = !this.select.value;
  }
}
