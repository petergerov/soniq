// Einrichtung der fertigen App: Sprachmodell wählen, Modelle laden, Grafikchip testen. Erscheint nur, wenn das
// Backend sie verlangt (MG_PACKAGED und Modelle fehlen); lässt sich bis zum Ende nicht wegklicken.
import type { LmSize, SetupStatus } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { errorDialog } from "../../core/dialogs.ts";
import { byId } from "../../core/dom.ts";
import type { Translate } from "../../i18n/i18n.ts";

const POLL_MS = 1000;
const LM_HINT: Record<LmSize, string> = { "0.6B": "setup_lm_small", "1.7B": "setup_lm_medium", "4B": "setup_lm_large" };

/** Vorauswahl: ein schon vorhandenes Sprachmodell (die Empfehlung, wenn sie dabei ist, sonst das größte), sonst die Empfehlung. */
function initialLm(s: SetupStatus): LmSize {
  const present = s.lm_options.filter((o) => o.present).map((o) => o.size);
  if (!present.length || present.includes(s.recommended_lm)) return s.recommended_lm;
  return present[present.length - 1]!;
}

function gb(mb: number): string {
  return (mb / 1000).toFixed(1);
}

export class SetupDialog {
  private readonly api: ApiClient;
  private readonly t: Translate;
  /** Einrichtung fertig: z. B. Status des Modellservers neu prüfen */
  private readonly onDone: () => void;
  private readonly dialog = byId<HTMLDialogElement>("setupDlg");
  private readonly lmBox = byId("setupLm");
  private readonly xl = byId<HTMLInputElement>("setupXl");
  private readonly stems = byId<HTMLInputElement>("setupStems");
  private status: SetupStatus | undefined;
  private timer: number | undefined;

  constructor(api: ApiClient, t: Translate, onDone: () => void) {
    this.api = api;
    this.t = t;
    this.onDone = onDone;
    this.dialog.addEventListener("cancel", (e) => e.preventDefault());   // Esc schließt nicht
    this.lmBox.addEventListener("change", () => this.renderInfo());
    this.xl.addEventListener("change", () => this.renderInfo());
    this.stems.addEventListener("change", () => this.renderInfo());
    byId("setupStart").addEventListener("click", () => void this.start());
    byId("setupCancel").addEventListener("click", () => void this.api.cancelSetup().then((s) => this.show(s)));
  }

  /** Beim Laden der Seite: Einrichtung nötig oder schon im Gange? Dann zeigen. Liefert, ob es die fertige App ist. */
  async check(): Promise<boolean> {
    try {
      const s = await this.api.setup();
      if (s.needed || this.busy(s)) this.show(s);
      return s.packaged;
    } catch {
      return false;   // Server (noch) nicht erreichbar: dann ohne Einrichtung
    }
  }

  /** Fertige App, Einstellungen › Klangmodell: XL nachladen; zeigt den Fortschritt wie bei der Einrichtung. */
  async addXl(): Promise<void> {
    try {
      this.show(await this.api.addXl());
    } catch (e) {
      void errorDialog(this.t, e);
    }
  }

  /** Fertige App, Einstellungen › Spuren-Modell: Base-Modell nachladen; Fortschritt wie bei der Einrichtung. */
  async addStems(): Promise<void> {
    try {
      this.show(await this.api.addStems());
    } catch (e) {
      void errorDialog(this.t, e);
    }
  }

  /** Fertige App, Einstellungen › Spuren-Modell: XL-Base nachladen; Fortschritt wie bei der Einrichtung. */
  async addXlStems(): Promise<void> {
    try {
      this.show(await this.api.addXlStems());
    } catch (e) {
      void errorDialog(this.t, e);
    }
  }

  /** Texte neu setzen (nach Sprachwechsel). */
  refreshTexts(): void {
    if (this.status && this.dialog.open) this.show(this.status);
  }

  private busy(s: SetupStatus): boolean {
    return s.phase === "verifying" || s.phase === "downloading" || s.phase === "testing" || s.phase === "starting";
  }

  private get chosenLm(): LmSize {
    return (this.lmBox.querySelector<HTMLInputElement>("input:checked")?.value as LmSize | undefined) ?? this.status?.recommended_lm ?? "1.7B";
  }

  private show(s: SetupStatus): void {
    const first = !this.status;
    this.status = s;
    if (!this.dialog.open) this.dialog.showModal();
    if (s.phase === "done" && !s.needed) return this.finish();
    const busy = this.busy(s);
    byId("setupChoose").hidden = busy;
    byId("setupProgress").hidden = !busy;
    const error = byId("setupError");
    error.hidden = s.phase !== "error";
    error.textContent = s.phase === "error" ? this.errorText(s.error) : "";
    if (busy) this.renderProgress(s);
    else this.renderChoice(s, first);
    clearTimeout(this.timer);
    if (busy) this.timer = window.setTimeout(() => void this.poll(), POLL_MS);
  }

  private renderChoice(s: SetupStatus, first: boolean): void {
    const { t } = this;
    const selected = first ? initialLm(s) : this.chosenLm;
    this.lmBox.replaceChildren(...s.lm_options.map((o) => {
      const label = document.createElement("label");
      label.className = "setup-option";
      label.innerHTML = `<input type="radio" name="setupLm"><span><b></b><span class="rec"></span><br><span class="small muted"></span></span><span class="size"></span>`;
      const input = label.querySelector("input")!;
      input.value = o.size;
      input.checked = o.size === selected;
      label.querySelector("b")!.textContent = o.size;
      label.querySelector(".rec")!.textContent = o.size === s.recommended_lm ? t("setup_recommended") : "";
      label.querySelector(".muted")!.textContent = t(LM_HINT[o.size]);
      label.querySelector(".size")!.textContent = o.present ? t("setup_present") : `${gb(o.mb)} GB`;
      return label;
    }));
    this.xl.checked = this.xl.checked || s.xl.present;
    this.xl.disabled = s.xl.present;
    byId("setupXlText").textContent = t("setup_xl", gb(s.xl.mb));
    this.stems.checked = this.stems.checked || s.stems.present;
    this.stems.disabled = s.stems.present;
    byId("setupStemsText").textContent = t("setup_stems", gb(s.stems.mb));
    this.renderInfo();
  }

  /** Download-Größe der aktuellen Auswahl und Daten des Macs. */
  private renderInfo(): void {
    const s = this.status;
    if (!s) return;
    const lm = s.lm_options.find((o) => o.size === this.chosenLm);
    const mb = s.base_mb + (lm && !lm.present ? lm.mb : 0) + (this.xl.checked && !s.xl.present ? s.xl.mb : 0)
      + (this.stems.checked && !s.stems.present ? s.stems.mb : 0);
    byId("setupInfo").textContent = this.t("setup_info", gb(mb), s.ram_gb, s.free_gb);
  }

  private renderProgress(s: SetupStatus): void {
    const { t } = this;
    const bar = byId("setupBarFill");
    // Prüfen und Laden zeigen echten Fortschritt, Test und Start nur einen laufenden Balken
    const downloading = s.phase === "downloading" || s.phase === "verifying";
    bar.parentElement!.classList.toggle("busy", !downloading);
    bar.style.width = downloading && s.total_mb ? `${Math.min(100, (s.done_mb / s.total_mb) * 100)}%` : "";
    const phase = { verifying: "setup_verifying", downloading: "setup_downloading", testing: "setup_testing" } as const;
    byId("setupPhase").textContent = t(phase[s.phase as keyof typeof phase] ?? "setup_starting");
    byId("setupDetail").textContent = downloading ? `${s.file} · ${gb(s.done_mb)} / ${gb(s.total_mb)} GB` : "";
    byId<HTMLButtonElement>("setupCancel").hidden = !downloading;
  }

  private errorText(error: string): string {
    if (error.startsWith("checksum:")) return this.t("setup_err_checksum", error.slice("checksum:".length));
    return `${this.t("setup_err")} ${error}`;
  }

  private async start(): Promise<void> {
    try {
      this.show(await this.api.startSetup({ lm: this.chosenLm, xl: this.xl.checked && !this.xl.disabled, stems: this.stems.checked && !this.stems.disabled }));
    } catch (e) {
      const error = byId("setupError");
      error.hidden = false;
      error.textContent = (e as Error).message;
    }
  }

  private async poll(): Promise<void> {
    try {
      this.show(await this.api.setup());
    } catch {
      this.timer = window.setTimeout(() => void this.poll(), POLL_MS * 3);   // Server kurz weg: weiter versuchen
    }
  }

  private finish(): void {
    clearTimeout(this.timer);
    this.dialog.close();
    this.onDone();
  }
}
