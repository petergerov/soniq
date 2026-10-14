// Updates von GitHub: suchen, Änderungen zeigen, einspielen und auf den Neustart warten.
import type { ApiClient } from "../../core/api-client.ts";
import { byId } from "../../core/dom.ts";
import type { Translate } from "../../i18n/i18n.ts";

const RESTART_WAIT_SECONDS = 60;

export class UpdatePanel {
  private readonly api: ApiClient;
  private readonly t: Translate;
  private readonly info = byId("updInfo");
  private readonly list = byId<HTMLUListElement>("updList");
  private readonly applyButton = byId<HTMLButtonElement>("updApply");

  constructor(api: ApiClient, t: Translate) {
    this.api = api;
    this.t = t;
    byId("updCheck").addEventListener("click", () => void this.check());
    this.applyButton.addEventListener("click", () => void this.apply());
  }

  reset(): void {
    this.setInfo("");
    this.list.hidden = true;
    this.applyButton.hidden = true;
    this.applyButton.disabled = false;
  }

  private setInfo(text: string, isError = false): void {
    this.info.className = isError ? "small err-t" : "small";
    this.info.textContent = text;
  }

  private async check(): Promise<void> {
    const { t } = this;
    this.reset();
    this.setInfo(t("upd_search"));
    const r = await this.api.checkUpdate().catch((e: Error) => ({ ok: false as const, error: e.message }));
    if (!r.ok) return this.setInfo(r.error, true);
    if (!r.behind) return this.setInfo(t("upd_current", r.current));
    this.setInfo(t("upd_new", r.behind, r.current, r.latest));
    this.list.replaceChildren(...r.changes.map((c) => Object.assign(document.createElement("li"), { textContent: c })));
    this.list.hidden = false;
    if (r.dirty) return this.setInfo(this.info.textContent + t("upd_dirty"), true);
    if (r.needs_install) this.info.textContent += t("upd_install");
    this.applyButton.hidden = false;
  }

  private async apply(): Promise<void> {
    const { t } = this;
    this.applyButton.disabled = true;
    this.setInfo(t("upd_loading"));
    let needsInstall: boolean;
    try {
      needsInstall = (await this.api.applyUpdate()).needs_install;
    } catch (e) {
      this.setInfo((e as Error).message, true);
      this.applyButton.disabled = false;
      return;
    }
    this.setInfo(t("upd_restart"));
    // Warten, bis der neue Server antwortet (die ersten Sekunden antwortet noch der alte)
    for (let i = 0; i < RESTART_WAIT_SECONDS; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (i > 1 && (await this.api.isReachable())) {
        if (needsInstall) return this.setInfo(t("upd_restart_install"));
        return location.reload();
      }
    }
    this.setInfo(t("upd_slow"), true);
  }
}
