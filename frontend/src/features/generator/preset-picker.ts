// Vorlagen: aktuelle Einstellungen unter einem Namen speichern und mit einem Klick laden (gespeichert auf dem Server).
// Darunter fest eingebaute Beispiel-Songs (nur laden, nicht löschen).
import type { Preset, PresetValues } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { confirmDialog, errorDialog, promptDialog } from "../../core/dialogs.ts";
import { byId } from "../../core/dom.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { EXAMPLE_PREFIX, EXAMPLE_SONGS, type ExampleSong } from "./example-songs.ts";

export interface PresetPickerDeps {
  api: ApiClient;
  t: Translate;
  /** Einstellungen des Formulars lesen bzw. setzen */
  read: () => PresetValues;
  apply: (values: PresetValues) => void;
  /** Beispiel-Song laden: Einstellungen samt Titel, Prompt und Lyrics */
  applyExample: (example: ExampleSong) => void;
}

export class PresetPicker {
  private readonly deps: PresetPickerDeps;
  private readonly select = byId<HTMLSelectElement>("presetSelect");
  private readonly deleteButton = byId<HTMLButtonElement>("presetDelete");
  private presets: Preset[] = [];

  constructor(deps: PresetPickerDeps) {
    this.deps = deps;
    this.select.addEventListener("change", () => {
      const example = this.example;
      const preset = this.presets.find((p) => p.name === this.select.value);
      if (example) deps.applyExample(example);
      else if (preset) deps.apply(preset.values);
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
    const { t } = this.deps;
    const name = await promptDialog({
      title: t("preset_save_title"), message: t("preset_save_tip"), label: t("preset_name_q"), value: this.example ? "" : this.select.value, confirmLabel: t("preset_save"), cancelLabel: t("cancel"),
    });
    if (!name) return;
    try {
      this.presets = await this.deps.api.savePreset(name, this.deps.read());
      this.render(name);
    } catch (err) {
      await errorDialog(t, err);
    }
  }

  private async remove(): Promise<void> {
    const name = this.select.value;
    const { t } = this.deps;
    if (!name || this.example) return;
    const ok = await confirmDialog({ title: t("preset_del"), message: t("preset_del_q", name), confirmLabel: t("del"), cancelLabel: t("cancel"), danger: true });
    if (!ok) return;
    this.presets = await this.deps.api.deletePreset(name);
    this.render("");
  }

  /** Gewählter Beispiel-Song, sonst undefined */
  private get example(): ExampleSong | undefined {
    const value = this.select.value;
    return value.startsWith(EXAMPLE_PREFIX) ? EXAMPLE_SONGS.find((e) => EXAMPLE_PREFIX + e.id === value) : undefined;
  }

  private render(selected = this.select.value): void {
    const { t } = this.deps;
    const examples = document.createElement("optgroup");
    examples.label = t("preset_examples");
    examples.append(...EXAMPLE_SONGS.map((e) => new Option(t(`ex_${e.id}`), EXAMPLE_PREFIX + e.id)));
    this.select.replaceChildren(new Option(t("preset_pick"), ""), ...this.presets.map((p) => new Option(p.name, p.name)), examples);
    const own = this.presets.find((p) => p.name.toLowerCase() === selected.toLowerCase());
    this.select.value = own ? own.name : selected.startsWith(EXAMPLE_PREFIX) ? selected : "";
    this.updateDelete();
  }

  /** Beispiele sind fest eingebaut */
  private updateDelete(): void {
    this.deleteButton.disabled = !this.select.value || !!this.example;
  }
}
