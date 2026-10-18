// Original eines Covers: ein Song der Bibliothek (⋮ › Cover …) oder eine Datei aus „Song als Vorlage“.
// Uploads legt der Server einmal ab (POST /api/uploads).
import { DEFAULT_COVER_CLOSENESS, type AudioRef, type CoverSettings, type GenerationMode, type SongParams } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { byId, escapeHtml as esc } from "../../core/dom.ts";
import { formatDuration } from "../../core/format.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { audioDuration } from "../analyze/audio-converter.ts";
import { BubbleSlider } from "./bubble-slider.ts";

export interface CoverSourceDeps {
  api: ApiClient;
  t: Translate;
}

export class CoverSource {
  private readonly deps: CoverSourceDeps;
  private readonly box = byId("coverBox");
  private readonly chip = byId("coverSrc");
  private readonly hint = byId("coverHint");
  private readonly closeness: BubbleSlider;
  private mode: GenerationMode = "full";
  private ref: AudioRef | null = null;
  private busy = "";
  private error = "";

  constructor(deps: CoverSourceDeps) {
    this.deps = deps;
    this.closeness = new BubbleSlider(this.box.querySelector<HTMLElement>(".slider")!);
    this.chip.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-clear]")) this.set(null);
    });
    this.render();
  }

  get source(): AudioRef | null {
    return this.ref;
  }

  set(ref: AudioRef | null, closeness?: number): void {
    if (closeness) this.closeness.value = closeness;
    this.ref = ref;
    this.error = "";
    this.render();
  }

  /** Datei hochladen und als Original nehmen; bei MP3 kennt nur der Browser die Länge. */
  async upload(file: File): Promise<AudioRef | null> {
    const { t } = this.deps;
    this.busy = t("src_uploading", file.name);
    this.error = "";
    this.render();
    try {
      const ref = await this.deps.api.uploadAudio(file);
      if (!ref.duration) ref.duration = Math.round(await audioDuration(file).catch(() => 0));
      this.busy = "";
      this.set(ref);
      return ref;
    } catch (err) {
      this.busy = "";
      this.error = `${t("error")}: ${(err as Error).message}`;
      this.render();
      return null;
    }
  }

  /** Erzeugung gewechselt: der Bereich gehört zu Cover */
  setMode(mode: GenerationMode): void {
    this.mode = mode;
    this.render();
  }

  /** Für den Auftrag */
  request(): { cover?: CoverSettings } {
    return this.mode === "cover" && this.ref ? { cover: { source: this.ref, closeness: this.closeness.value } } : {};
  }

  /** "Wiederverwenden": Original eines Covers übernehmen */
  apply(params: SongParams): void {
    this.set(params.mode === "cover" ? params.cover?.source ?? null : null, params.cover?.closeness ?? DEFAULT_COVER_CLOSENESS);
  }

  refreshTexts(): void {
    this.closeness.update();
    this.render();
  }

  private render(): void {
    const { t } = this.deps;
    const { ref } = this;
    this.box.hidden = this.mode !== "cover";
    this.chip.hidden = !ref;
    this.chip.innerHTML = ref
      ? `<span class="src-name">♫ ${esc(ref.name)}</span>${ref.duration ? ` <span class="src-dur">${formatDuration(ref.duration)}</span>` : ""}`
        + `<button type="button" class="src-x" data-clear title="${esc(t("src_remove"))}" aria-label="${esc(t("src_remove"))}">✕</button>`
      : "";
    this.hint.textContent = this.busy || this.error || (ref ? t("cover_hint_set") : t("cover_hint"));
    this.hint.classList.toggle("err-t", !!this.error && !this.busy);
  }
}
