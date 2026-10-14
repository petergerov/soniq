// "Server stoppen" = Skript "stop" ausführen lassen (als fertige App: die App beendet sich).
import type { ApiClient } from "../../core/api-client.ts";
import { byId } from "../../core/dom.ts";
import type { Translate } from "../../i18n/i18n.ts";

export class ServerControl {
  private readonly api: ApiClient;
  private readonly t: Translate;
  private readonly beforeStop: () => void;
  private readonly onFailed: () => void;
  private readonly button = byId<HTMLButtonElement>("stopBtn");
  private readonly info = byId("stopInfo");

  /**
   * @param beforeStop z. B. Abfragen der Bibliothek einstellen
   * @param onFailed   Stoppen ging schief: Abfragen wieder aufnehmen
   */
  constructor(api: ApiClient, t: Translate, beforeStop: () => void, onFailed: () => void) {
    this.api = api;
    this.t = t;
    this.beforeStop = beforeStop;
    this.onFailed = onFailed;
    this.button.addEventListener("click", () => void this.stop());
  }

  private async stop(): Promise<void> {
    const queue = await this.api.queue().catch(() => null);
    const busy = !!queue && (queue.running.length > 0 || queue.queued > 0);
    if (!confirm(this.t(busy ? "stop_q_busy" : "stop_q"))) return;
    this.beforeStop();
    try {
      const { packaged } = await this.api.shutdown();
      this.button.disabled = true;
      this.info.textContent = this.t(packaged ? "stopped_app" : "stopped");
    } catch (e) {
      this.info.className = "small err-t";
      this.info.textContent = (e as Error).message;
      this.onFailed();
    }
  }
}
