// Vorlagen fürs Erzeugen: das Original eines Covers und die Klang-Referenz ("Klingt wie").
// Beide sind ein Song der Bibliothek oder eine hochgeladene Datei; Uploads legt der Server einmal ab (POST /api/uploads).
import { DEFAULT_COVER_CLOSENESS, type AudioRef, type CoverSettings, type GenerationMode, type SongParams } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { byId, escapeHtml as esc } from "../../core/dom.ts";
import { formatDuration } from "../../core/format.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { audioDuration, toServerReadableAudio, UnsupportedAudioError } from "../analyze/audio-converter.ts";
import { BubbleSlider } from "./bubble-slider.ts";

export interface AudioSourcesDeps {
  api: ApiClient;
  t: Translate;
}

/** Datei hochladen; bei MP3 kennt nur der Browser die Länge. */
export async function uploadAudio(api: ApiClient, file: File): Promise<AudioRef> {
  const ref = await api.uploadAudio(await toServerReadableAudio(file));
  if (!ref.duration) ref.duration = Math.round(await audioDuration(file).catch(() => 0));
  return ref;
}

/** Eine Vorlage: Anzeige mit ✕, Knopf „Datei wählen“, Hinweis bzw. Fehler darunter. */
class SourceSlot {
  ref: AudioRef | null = null;
  private readonly chip: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly deps: AudioSourcesDeps;
  private readonly onChange: () => void;
  private busy = "";
  private error = "";

  constructor(prefix: "cover" | "ref", deps: AudioSourcesDeps, onChange: () => void) {
    this.deps = deps;
    this.onChange = onChange;
    this.chip = byId(`${prefix}Src`);
    this.hint = byId(`${prefix}Hint`);
    const input = byId<HTMLInputElement>(`${prefix}File`);
    byId(`${prefix}Pick`).addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.value = "";
      if (file) void this.upload(file);
    });
    this.chip.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-clear]")) this.set(null);
    });
  }

  set(ref: AudioRef | null): void {
    this.ref = ref;
    this.error = "";
    this.render();
    this.onChange();
  }

  async upload(file: File): Promise<AudioRef | null> {
    const { t } = this.deps;
    this.busy = t("src_uploading", file.name);
    this.error = "";
    this.render();
    try {
      const ref = await uploadAudio(this.deps.api, file);
      this.busy = "";
      this.set(ref);
      return ref;
    } catch (err) {
      this.busy = "";
      this.error = `${t("error")}: ${err instanceof UnsupportedAudioError ? t("decode_failed", file.name) : (err as Error).message}`;
      this.render();
      return null;
    }
  }

  /** Hinweis unter der Vorlage; Upload und Fehler gehen vor */
  render(hint = this.hint.dataset.hint ?? ""): void {
    this.hint.dataset.hint = hint;
    const { ref } = this;
    this.chip.hidden = !ref;
    this.chip.innerHTML = ref
      ? `<span class="src-name">♫ ${esc(ref.name)}</span>${ref.duration ? ` <span class="src-dur">${formatDuration(ref.duration)}</span>` : ""}`
        + `<button type="button" class="src-x" data-clear title="${esc(this.deps.t("src_remove"))}" aria-label="${esc(this.deps.t("src_remove"))}">✕</button>`
      : "";
    const text = this.busy || this.error || hint;
    this.hint.hidden = !text;
    this.hint.textContent = text;
    this.hint.classList.toggle("err-t", !!this.error && !this.busy);
  }
}

export class AudioSources {
  private readonly deps: AudioSourcesDeps;
  private readonly coverSlot: SourceSlot;
  private readonly refSlot: SourceSlot;
  private readonly coverBox = byId("coverBox");
  private readonly refBox = byId("refBox");
  private readonly closeness: BubbleSlider;
  private mode: GenerationMode = "full";

  constructor(deps: AudioSourcesDeps) {
    this.deps = deps;
    this.coverSlot = new SourceSlot("cover", deps, () => this.render());
    this.refSlot = new SourceSlot("ref", deps, () => this.render());
    this.closeness = new BubbleSlider(this.coverBox.querySelector<HTMLElement>(".slider")!);
    this.render();
  }

  get cover(): AudioRef | null {
    return this.coverSlot.ref;
  }

  setCover(ref: AudioRef | null, closeness?: number): void {
    if (closeness) this.closeness.value = closeness;
    this.coverSlot.set(ref);
  }

  setReference(ref: AudioRef | null): void {
    this.refSlot.set(ref);
  }

  /** Datei als Original eines Covers hochladen (z. B. die gerade analysierte) */
  uploadCover(file: File): Promise<AudioRef | null> {
    return this.coverSlot.upload(file);
  }

  uploadReference(file: File): Promise<AudioRef | null> {
    return this.refSlot.upload(file);
  }

  /** Erzeugung gewechselt: Cover-Bereich zeigen, "Klingt wie" gibt es bei Spur für Spur nicht */
  setMode(mode: GenerationMode): void {
    this.mode = mode;
    this.render();
  }

  /** Für den Auftrag */
  request(): { cover?: CoverSettings; reference?: AudioRef } {
    const cover = this.mode === "cover" && this.cover ? { cover: { source: this.cover, closeness: this.closeness.value } } : {};
    const reference = this.mode !== "tracks" && this.refSlot.ref ? { reference: this.refSlot.ref } : {};
    return { ...cover, ...reference };
  }

  /** "Wiederverwenden": Original und Referenz eines Songs übernehmen */
  apply(params: SongParams): void {
    this.setCover(params.mode === "cover" ? params.cover?.source ?? null : null, params.cover?.closeness ?? DEFAULT_COVER_CLOSENESS);
    this.setReference(params.reference ?? null);
  }

  refreshTexts(): void {
    this.closeness.update();
    this.render();
  }

  private render(): void {
    const { t } = this.deps;
    this.coverBox.hidden = this.mode !== "cover";
    this.refBox.hidden = this.mode === "tracks";
    this.coverSlot.render(this.cover ? t("cover_hint_set") : t("cover_hint"));
    this.refSlot.render(this.refSlot.ref && this.mode === "cover" && this.cover ? t("ref_hint_cover") : "");
  }
}
