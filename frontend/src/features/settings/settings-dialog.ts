// Einstellungs-Dialog (Zahnrad): Server-Adressen, Timeout, Klangmodell, Ausgabeformat, Song-Ordner.
import type { OutputFormat } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { byId } from "../../core/dom.ts";

interface SettingsControls extends HTMLFormControlsCollection {
  server_url: HTMLInputElement;
  lm_url: HTMLInputElement;
  timeout_minutes: HTMLInputElement;
  songs_dir: HTMLInputElement;
  dit: HTMLSelectElement;
  output_format: HTMLSelectElement;
}

const DEFAULT_TIMEOUT = 30;

export class SettingsDialog {
  private readonly api: ApiClient;
  private readonly onOpen: () => void;
  private readonly onSaved: () => void;
  private readonly dialog = byId<HTMLDialogElement>("settingsDlg");
  private readonly f = byId<HTMLFormElement>("settingsForm").elements as SettingsControls;

  /**
   * @param onOpen   beim Öffnen (z. B. Update-Bereich zurücksetzen)
   * @param onSaved  nach dem Speichern (z. B. Serverstatus neu prüfen)
   */
  constructor(api: ApiClient, onOpen: () => void, onSaved: () => void) {
    this.api = api;
    this.onOpen = onOpen;
    this.onSaved = onSaved;
    byId("btnSettings").addEventListener("click", () => void this.open());
    this.dialog.addEventListener("close", () => {
      if (this.dialog.returnValue === "save") void this.save();
    });
  }

  async open(): Promise<void> {
    const s = await this.api.settings();
    this.f.server_url.value = s.server_url;
    this.f.lm_url.value = s.lm_url;
    this.f.timeout_minutes.value = String(s.timeout_minutes);
    this.f.songs_dir.value = s.songs_dir;
    this.f.songs_dir.placeholder = s.songs_dir_default;   // Standard als Platzhalter, leer lassen = Standard
    this.f.dit.value = s.dit;
    this.f.output_format.value = s.output_format;
    this.f.dit.querySelector<HTMLOptionElement>('option[value="xl"]')!.disabled = !s.dit_xl_available;   // XL nur, wenn die Datei da ist
    byId("ditHint").hidden = s.dit_xl_available;
    this.onOpen();
    this.dialog.showModal();
  }

  private async save(): Promise<void> {
    try {
      await this.api.saveSettings({
        server_url: this.f.server_url.value.trim(),
        lm_url: this.f.lm_url.value.trim(),
        timeout_minutes: Number(this.f.timeout_minutes.value) || DEFAULT_TIMEOUT,
        songs_dir: this.f.songs_dir.value.trim(),
        dit: this.f.dit.value === "xl" ? "xl" : "standard",
        output_format: this.f.output_format.value as OutputFormat,   // Optionen im HTML, der Server prüft den Wert
      });
      this.onSaved();
    } catch (err) {
      alert((err as Error).message);
      void this.open();   // Eingaben korrigieren lassen
    }
  }
}
