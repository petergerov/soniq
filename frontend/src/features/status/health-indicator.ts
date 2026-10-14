// Zustand des Modellservers oben rechts. Bei "alles ok" bleibt die Anzeige leer.
import type { ApiClient } from "../../core/api-client.ts";
import { byId } from "../../core/dom.ts";
import type { Translate } from "../../i18n/i18n.ts";

const INTERVAL_MS = 15_000;

export class HealthIndicator {
  private readonly api: ApiClient;
  private readonly t: Translate;
  private readonly el = byId("status");

  constructor(api: ApiClient, t: Translate) {
    this.api = api;
    this.t = t;
  }

  start(): void {
    void this.check();
    setInterval(() => void this.check(), INTERVAL_MS);
  }

  async check(): Promise<void> {
    const { el, t } = this;
    try {
      const h = await this.api.health();
      el.className = "box small " + (h.ok ? "" : "err");
      el.textContent = h.ok ? "" : t("offline");
      el.title = h.error || (h.props ? `${t("models")}: ${Object.values(h.props.models ?? {}).flat().join(", ")}` : t("model_server"));
    } catch {
      el.className = "box small err";
      el.textContent = t("backend_offline");
    }
  }
}
