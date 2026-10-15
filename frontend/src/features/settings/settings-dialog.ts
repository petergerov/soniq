// Einstellungs-Dialog (Zahnrad): Server-Adressen, Timeout, Klangmodell, Ausgabeformat, Song-Ordner.
import type { OutputFormat } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { byId } from "../../core/dom.ts";
import { setPackagedApp, stemsMissingText } from "../../core/stems-hint.ts";
import type { Translate } from "../../i18n/i18n.ts";

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
  private readonly t: Translate;
  private readonly onGetXl: () => void;
  private readonly onGetStems: () => void;
  private readonly dialog = byId<HTMLDialogElement>("settingsDlg");
  private readonly f = byId<HTMLFormElement>("settingsForm").elements as SettingsControls;

  /**
   * @param onOpen   beim Öffnen (z. B. Update-Bereich zurücksetzen)
   * @param onSaved  nach dem Speichern (z. B. Serverstatus neu prüfen)
   * @param onGetXl  fertige App: XL-Klangmodell nachladen (über die Einrichtung)
   * @param onGetStems fertige App: Spuren-Modell nachladen (über die Einrichtung)
   */
  constructor(api: ApiClient, t: Translate, onOpen: () => void, onSaved: () => void, onGetXl: () => void, onGetStems: () => void) {
    this.api = api;
    this.t = t;
    this.onOpen = onOpen;
    this.onSaved = onSaved;
    this.onGetXl = onGetXl;
    this.onGetStems = onGetStems;
    byId("stemsGet").addEventListener("click", () => {
      this.dialog.close();
      this.onGetStems();
    });
    byId("ditGetXl").addEventListener("click", () => {
      this.dialog.close();
      this.onGetXl();
    });
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
    // Fehlt XL: in der fertigen App ein Knopf zum Nachladen, sonst der Hinweis auf den Installer
    byId("ditHint").hidden = s.dit_xl_available || s.packaged;
    byId("ditGetXl").hidden = s.dit_xl_available || !s.packaged;
    // Spuren-Modell: da, in der fertigen App nachladbar, sonst Hinweis auf den Installer
    setPackagedApp(s.packaged);
    byId("stemsState").textContent = s.stems_available ? this.t("stems_model_ok") : s.packaged ? "" : stemsMissingText(this.t);
    byId("stemsGet").hidden = s.stems_available || !s.packaged;
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
