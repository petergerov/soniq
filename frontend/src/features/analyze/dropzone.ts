// Geheime Dropzone: das Logo. Unauffällig, bis man draufzeigt, etwas darauf zieht oder es gerade arbeitet.
import type { AnalyzeResult } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { byId } from "../../core/dom.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { toServerReadableAudio, UnsupportedAudioError } from "./audio-converter.ts";

type State = "" | "busy" | "ok" | "err";
const OK_VISIBLE_MS = 4000;

export class Dropzone {
  private readonly api: ApiClient;
  private readonly t: Translate;
  private readonly onResult: (result: AnalyzeResult) => void;
  private readonly zone = byId("dropzone");
  private readonly bubble = byId("dzBubble");
  private readonly fileInput = byId<HTMLInputElement>("fileInput");
  private hideTimer: number | undefined;

  constructor(api: ApiClient, t: Translate, onResult: (result: AnalyzeResult) => void) {
    this.api = api;
    this.t = t;
    this.onResult = onResult;
    this.bindEvents();
  }

  private bindEvents(): void {
    const { zone, fileInput } = this;
    zone.addEventListener("click", () => fileInput.click());
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener("change", () => void this.analyze(fileInput.files?.[0]));
    for (const type of ["dragenter", "dragover"]) zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add("drag"); });
    for (const type of ["dragleave", "dragend"]) zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.remove("drag"); });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag");
      void this.analyze(e.dataTransfer?.files[0]);
    });
  }

  private async analyze(file: File | undefined): Promise<void> {
    if (!file) return;
    this.show("busy", this.t("analyzing", file.name));
    try {
      this.onResult(await this.api.analyze(await toServerReadableAudio(file)));
      this.show("ok", this.t("analyzed", file.name));
    } catch (err) {
      const message = err instanceof UnsupportedAudioError ? this.t("decode_failed", file.name) : (err as Error).message;
      this.show("err", `${this.t("error")}: ${message}`);
    }
  }

  private show(state: State, text: string): void {
    clearTimeout(this.hideTimer);
    this.zone.className = "logo-wrap" + (state ? ` ${state}` : "");
    this.bubble.textContent = text;
    this.bubble.classList.toggle("show", !!text);
    if (state === "ok") this.hideTimer = window.setTimeout(() => this.show("", ""), OK_VISIBLE_MS);
  }
}
