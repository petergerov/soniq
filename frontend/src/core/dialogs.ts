// Modale Dialoge (natives <dialog>) im Stil der App, Ersatz für window.confirm, window.prompt und window.alert.
import type { Translate } from "../i18n/i18n.ts";
import { escapeHtml } from "./dom.ts";

export interface ConfirmOptions {
  title: string;
  /** Erklärung unter dem Titel; fehlt = nur der Titel */
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Roter Bestätigen-Knopf (Löschen) */
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  /** Erklärung unter dem Titel */
  message?: string;
  /** Beschriftung des Eingabefelds */
  label: string;
  /** Vorbelegung (wird markiert) */
  value?: string;
  confirmLabel: string;
  cancelLabel: string;
  maxLength?: number;
}

/** Baut den Dialog, zeigt ihn modal und liefert beim Schließen den returnValue ("" bei Esc). */
function showDialog(body: string, onOpen?: (dlg: HTMLDialogElement) => void): Promise<{ value: string; dlg: HTMLDialogElement }> {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "confirm-dlg";
    dlg.innerHTML = `<form method="dialog" class="confirm-form">${body}</form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve({ value: dlg.returnValue, dlg });
    }, { once: true });
    dlg.showModal();
    onOpen?.(dlg);
  });
}

function message(text: string | undefined): string {
  return text ? `<p class="confirm-msg">${escapeHtml(text)}</p>` : "";
}

/** Zeigt einen modalen Bestätigungsdialog. true = bestätigt. */
export async function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const { value } = await showDialog(`
      <h2 class="col-title">${escapeHtml(opts.title)}</h2>${message(opts.message)}
      <div class="submit">
        <button value="cancel" class="sek"${opts.danger ? " autofocus" : ""}>${escapeHtml(opts.cancelLabel)}</button>
        <button value="ok" class="aktion${opts.danger ? " danger" : ""}"${opts.danger ? "" : " autofocus"}>${escapeHtml(opts.confirmLabel)}</button>
      </div>`);
  return value === "ok";
}

/** Fragt einen Text ab (z. B. Ordnername). Liefert den getrimmten Text, oder null bei Abbrechen/Esc. */
export async function promptDialog(opts: PromptOptions): Promise<string | null> {
  let text = "";
  const { value } = await showDialog(`
      <h2 class="col-title">${escapeHtml(opts.title)}</h2>${message(opts.message)}
      <label class="field"><span class="lbl">${escapeHtml(opts.label)}</span>
        <input type="text" name="value" value="${escapeHtml(opts.value ?? "")}"${opts.maxLength ? ` maxlength="${opts.maxLength}"` : ""} autocomplete="off"></label>
      <div class="submit">
        <button value="cancel" class="sek" formnovalidate>${escapeHtml(opts.cancelLabel)}</button>
        <button value="ok" class="aktion">${escapeHtml(opts.confirmLabel)}</button>
      </div>`, (dlg) => {
    const input = dlg.querySelector<HTMLInputElement>("input")!;
    const ok = dlg.querySelector<HTMLButtonElement>("button[value=ok]")!;
    const sync = () => {
      text = input.value.trim();
      ok.disabled = !text;
    };
    input.addEventListener("input", sync);
    // Enter = OK (sonst nähme das Formular den ersten Knopf, also Abbrechen)
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      if (!ok.disabled) dlg.close("ok");
    });
    sync();
    input.focus();
    input.select();
  });
  return value === "ok" && text ? text : null;
}

/** Zeigt eine Meldung mit einem OK-Knopf; wartet, bis sie geschlossen ist. */
export async function alertDialog(title: string, text: string, okLabel: string): Promise<void> {
  await showDialog(`
      <h2 class="col-title">${escapeHtml(title)}</h2>${message(text)}
      <div class="submit"><button value="ok" class="aktion" autofocus>${escapeHtml(okLabel)}</button></div>`);
}

/** Fehlermeldung im App-Dialog (Titel „Fehler“). */
export function errorDialog(t: Translate, error: unknown): Promise<void> {
  return alertDialog(t("error"), error instanceof Error ? error.message : String(error), t("ok"));
}
