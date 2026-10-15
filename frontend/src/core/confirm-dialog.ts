// Bestätigungsdialog (natives <dialog>), Ersatz für window.confirm.
import { escapeHtml } from "./dom.ts";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Roter Bestätigen-Knopf (Löschen) */
  danger?: boolean;
}

/** Zeigt einen modalen Bestätigungsdialog. true = bestätigt. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "confirm-dlg";
    dlg.innerHTML = `<form method="dialog" class="confirm-form">
      <h2 class="col-title">${escapeHtml(opts.title)}</h2>
      <p class="confirm-msg">${escapeHtml(opts.message)}</p>
      <div class="submit">
        <button value="cancel" class="sek"${opts.danger ? " autofocus" : ""}>${escapeHtml(opts.cancelLabel)}</button>
        <button value="ok" class="aktion${opts.danger ? " danger" : ""}"${opts.danger ? "" : " autofocus"}>${escapeHtml(opts.confirmLabel)}</button>
      </div>
    </form>`;
    document.body.appendChild(dlg);

    const finish = (ok: boolean) => {
      dlg.removeEventListener("close", onClose);
      dlg.remove();
      resolve(ok);
    };
    const onClose = () => finish(dlg.returnValue === "ok");
    dlg.addEventListener("close", onClose);
    dlg.addEventListener("cancel", () => {
      // Esc: returnValue bleibt leer → finish(false) über close
    });
    dlg.showModal();
  });
}
