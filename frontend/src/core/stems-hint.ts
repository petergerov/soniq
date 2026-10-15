// Hinweis, wenn das Spuren-Modell (Base) fehlt: in der fertigen App über Einstellungen › Spuren-Modell nachladen,
// bei Installationen aus dem Projektordner über den Installer (install --stems).
import type { Translate } from "../i18n/i18n.ts";

let packagedApp = false;

/** Aus den Einstellungen (SettingsView.packaged): läuft SONIQ als fertige App? */
export function setPackagedApp(value: boolean): void {
  packagedApp = value;
}

export function stemsMissingText(t: Translate): string {
  return t(packagedApp ? "stems_missing_app" : "stems_missing_install");
}
