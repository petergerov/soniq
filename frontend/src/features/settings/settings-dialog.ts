// Einstellungs-Dialog (Zahnrad): Server-Adressen, Timeout, Klangmodell, Spuren-Modell, Demucs, Ausgabeformat, Song-Ordner.
import type { OutputFormat } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { errorDialog } from "../../core/dialogs.ts";
import { byId } from "../../core/dom.ts";
import { setPackagedApp, stemsMissingText } from "../../core/stems-hint.ts";
import type { Translate } from "../../i18n/i18n.ts";

interface SettingsControls extends HTMLFormControlsCollection {
  server_url: HTMLInputElement;
  lm_url: HTMLInputElement;
  timeout_minutes: HTMLInputElement;
  songs_dir: HTMLInputElement;
  dit: HTMLSelectElement;
  stem_model: HTMLSelectElement;
  output_format: HTMLSelectElement;
  demucs_device: HTMLSelectElement;
}

const DEFAULT_TIMEOUT = 30;

export class SettingsDialog {
  private readonly api: ApiClient;
  private readonly onOpen: () => void;
  private readonly onSaved: () => void;
  private readonly t: Translate;
  private readonly onGetXl: () => void;
  private readonly onGetStems: () => void;
  private readonly onGetXlStems: () => void;
  private readonly onGetDemucs: () => void;
  /** Rechnet ein Demucs-Modell als Core ML? Sonst gibt es die Auswahl GPU/CPU nicht. */
  private demucsCoreml = false;
  /** Liegt beim Öffnen ein Spuren-Modell im Ordner? Sonst wird die Auswahl nicht gespeichert. */
  private stemsAvailable = false;
  private readonly dialog = byId<HTMLDialogElement>("settingsDlg");
  private readonly f = byId<HTMLFormElement>("settingsForm").elements as SettingsControls;

  /**
   * @param onOpen   beim Öffnen (z. B. Update-Bereich zurücksetzen)
   * @param onSaved  nach dem Speichern (z. B. Serverstatus neu prüfen)
   * @param onGetXl  fertige App: XL-Klangmodell nachladen (über die Einrichtung)
   * @param onGetStems fertige App: Spuren-Modell nachladen (über die Einrichtung)
   * @param onGetXlStems fertige App: XL-Spuren-Modell nachladen (über die Einrichtung)
   * @param onGetDemucs fertige App: Demucs-Modelle nachladen (über die Einrichtung)
   */
  constructor(api: ApiClient, t: Translate, onOpen: () => void, onSaved: () => void, onGetXl: () => void, onGetStems: () => void,
    onGetXlStems: () => void, onGetDemucs: () => void) {
    this.api = api;
    this.t = t;
    this.onOpen = onOpen;
    this.onSaved = onSaved;
    this.onGetXl = onGetXl;
    this.onGetStems = onGetStems;
    this.onGetXlStems = onGetXlStems;
    this.onGetDemucs = onGetDemucs;
    byId("demucsGet").addEventListener("click", () => {
      this.dialog.close();
      this.onGetDemucs();
    });
    byId("stemsGet").addEventListener("click", () => {
      this.dialog.close();
      this.onGetStems();
    });
    byId("stemsGetXl").addEventListener("click", () => {
      this.dialog.close();
      this.onGetXlStems();
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
    // Auswahl Standard/XL, sobald ein Spuren-Modell da ist; XL nur wählbar, wenn seine Datei da ist
    this.stemsAvailable = s.stems_available;
    this.f.stem_model.value = s.stem_model;
    this.f.stem_model.hidden = !s.stems_available;
    this.f.stem_model.querySelector<HTMLOptionElement>('option[value="xl"]')!.disabled = !s.stems_xl_available;
    byId("stemsXlHint").hidden = !s.stems_available || s.stems_xl_available || s.packaged;
    byId("stemsGetXl").hidden = !s.stems_available || s.stems_xl_available || !s.packaged;
    // Demucs: installiert, in der fertigen App nachladbar (wenn die Programme dabei sind), sonst Hinweis auf den Installer.
    // Auf dem Mac gehört das Core-ML-Modell dazu; fehlt nur es, lädt der Knopf es nach.
    const coremlMissing = s.demucs_coreml_supported && !Object.values(s.demucs_coreml).every(Boolean);
    const demucsReady = Object.values(s.demucs).every(Boolean) && !coremlMissing;
    byId("demucsField").hidden = s.packaged && !s.demucs_supported;
    byId("demucsState").textContent = demucsReady ? this.t("stems_model_ok") : s.packaged ? "" : this.t("demucs_missing_install");
    const get = byId("demucsGet");
    get.hidden = demucsReady || !s.packaged;
    get.textContent = this.t(Object.values(s.demucs).every(Boolean) && coremlMissing ? "demucs_get_gpu" : s.demucs_coreml_supported ? "demucs_get_mac" : "demucs_get");
    // GPU oder CPU, sobald ein Modell als Core ML rechnet
    this.demucsCoreml = Object.values(s.demucs_coreml).some(Boolean);
    byId("demucsDeviceRow").hidden = !this.demucsCoreml;
    this.f.demucs_device.value = s.demucs_device;
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
        ...(this.stemsAvailable ? { stem_model: this.f.stem_model.value === "xl" ? "xl" : "standard" } : {}),
        output_format: this.f.output_format.value as OutputFormat,   // Optionen im HTML, der Server prüft den Wert
        ...(this.demucsCoreml ? { demucs_device: this.f.demucs_device.value === "cpu" ? "cpu" as const : "gpu" as const } : {}),
      });
      this.onSaved();
    } catch (err) {
      await errorDialog(this.t, err);
      void this.open();   // Eingaben korrigieren lassen
    }
  }
}
