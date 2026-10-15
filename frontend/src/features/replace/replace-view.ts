// Ersetzen / Begleiten (newfeatures.md C): Datei hochladen, Keeper herauslösen, neue Spuren mit lego.
import { STEM_TRACKS, type AnalyzeResult, type StemIntent, type StemTrack } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { byId } from "../../core/dom.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { toWavAudio, UnsupportedAudioError } from "../analyze/audio-converter.ts";

const DEFAULT_KEEP: readonly StemTrack[] = ["drums", "bass", "guitar", "keyboard", "vocals"];
const DEFAULT_REPLACE: readonly StemTrack[] = ["guitar"];
const DEFAULT_ADD: readonly StemTrack[] = ["drums", "bass", "keyboard"];

export interface ReplaceViewDeps {
  api: ApiClient;
  t: Translate;
  targetFolder: () => string | null;
  onQueued: () => void;
}

export class ReplaceView {
  private readonly deps: ReplaceViewDeps;
  private readonly zone = byId("replaceDrop");
  private readonly status = byId("replaceStatus");
  private readonly fileInput = byId<HTMLInputElement>("replaceFile");
  private readonly intentBtns = byId("replace").querySelectorAll<HTMLButtonElement>("[data-intent]");
  private readonly keepBox = byId("replaceKeep");
  private readonly newBox = byId("replaceNew");
  private readonly style = byId<HTMLTextAreaElement>("replaceStyle");
  private readonly go = byId<HTMLButtonElement>("replaceGo");
  private readonly hint = byId("replaceHint");
  private intent: StemIntent = "replace";
  private file: File | null = null;
  private analysis: AnalyzeResult | null = null;
  private available = true;
  private readonly keep = new Set<StemTrack>(DEFAULT_KEEP.filter((t) => !DEFAULT_REPLACE.includes(t)));
  private readonly next = new Set<StemTrack>(DEFAULT_REPLACE);

  constructor(deps: ReplaceViewDeps) {
    this.deps = deps;
    this.bind();
    void deps.api.settings().then((s) => this.setAvailable(s.stems_available), () => {});
    this.render();
  }

  setAvailable(available: boolean): void {
    this.available = available;
    this.render();
  }

  refreshTexts(): void {
    this.render();
  }

  private bind(): void {
    const { zone, fileInput } = this;
    zone.addEventListener("click", () => fileInput.click());
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
    });
    fileInput.addEventListener("change", () => void this.take(fileInput.files?.[0]));
    for (const type of ["dragenter", "dragover"]) zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add("drag"); });
    for (const type of ["dragleave", "dragend"]) zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.remove("drag"); });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag");
      void this.take(e.dataTransfer?.files[0]);
    });
    this.intentBtns.forEach((b) => b.addEventListener("click", () => {
      this.intent = b.dataset.intent === "accompany" ? "accompany" : "replace";
      if (this.intent === "accompany") {
        this.next.clear();
        DEFAULT_ADD.forEach((t) => this.next.add(t));
      }
      this.render();
    }));
    this.keepBox.addEventListener("click", (e) => this.toggle(e, this.keep, this.next));
    this.newBox.addEventListener("click", (e) => this.toggle(e, this.next, this.intent === "replace" ? this.keep : undefined));
    this.go.addEventListener("click", () => void this.submit());
  }

  private toggle(e: Event, target: Set<StemTrack>, other?: Set<StemTrack>): void {
    const track = (e.target as HTMLElement).closest<HTMLElement>("[data-track]")?.dataset.track as StemTrack | undefined;
    if (!track) return;
    if (!target.delete(track)) {
      target.add(track);
      other?.delete(track);
    }
    this.render();
  }

  private async take(file: File | undefined): Promise<void> {
    if (!file) return;
    this.status.textContent = this.deps.t("analyzing", file.name);
    this.zone.className = "dropzone busy";
    try {
      const wav = await toWavAudio(file);
      this.analysis = await this.deps.api.analyze(wav);
      this.file = wav;
      this.style.value = this.analysis.caption || "";
      const vocals = /[^\s[\]]/.test((this.analysis.lyrics || "").replace(/\[[^\]]*\]/g, ""));
      if (!vocals) this.keep.delete("vocals");
      this.zone.className = "dropzone ok";
      this.status.textContent = this.deps.t("analyzed", file.name);
    } catch (err) {
      this.file = null;
      this.analysis = null;
      this.zone.className = "dropzone err";
      const message = err instanceof UnsupportedAudioError ? this.deps.t("decode_failed", file.name) : (err as Error).message;
      this.status.textContent = `${this.deps.t("error")}: ${message}`;
    }
    this.render();
  }

  private async submit(): Promise<void> {
    if (!this.file || this.go.disabled) return;
    this.go.disabled = true;
    const a = this.analysis;
    try {
      await this.deps.api.uploadStems(this.file, {
        intent: this.intent,
        tracks: STEM_TRACKS.filter((t) => this.next.has(t)),
        keepers: this.intent === "replace" ? STEM_TRACKS.filter((t) => this.keep.has(t)) : undefined,
        caption: this.style.value.trim() || a?.caption || this.file.name,
        lyrics: a?.lyrics || "",
        duration: a?.duration || 0,
        bpm: a?.bpm || 0,
        keyscale: a?.keyscale || "",
        timesignature: a?.timesignature || "",
        vocal_language: a?.vocal_language || "",
        folder_id: this.deps.targetFolder(),
      });
      this.deps.onQueued();
    } catch (err) {
      alert(`${this.deps.t("error")}: ${(err as Error).message}`);
    }
    setTimeout(() => { this.go.disabled = false; this.render(); }, 600);
  }

  private render(): void {
    const { t } = this.deps;
    const replace = this.intent === "replace";
    this.intentBtns.forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.intent === this.intent));
      b.disabled = !this.available;
    });
    const keepWrap = this.keepBox.closest<HTMLElement>(".replace-keep");
    if (keepWrap) keepWrap.hidden = !replace;
    this.keepBox.innerHTML = replace ? this.chips(this.keep) : "";
    this.newBox.innerHTML = this.chips(this.next);
    byId("replaceNewLbl").textContent = replace ? t("replace_new") : t("replace_add");
    const nKeep = STEM_TRACKS.filter((x) => this.keep.has(x)).length;
    const nNew = STEM_TRACKS.filter((x) => this.next.has(x)).length;
    this.go.textContent = replace ? t("replace_go") : t("replace_go_accompany");
    this.go.disabled = !this.available || !this.file || !nNew || (replace && !nKeep);
    this.go.title = this.available ? "" : t("replace_missing");
    this.hint.className = `small ${this.available ? "" : "err-t"}`.trim();
    this.hint.textContent = !this.available ? t("replace_missing")
      : !this.file ? t("replace_need_file")
      : replace && !nKeep ? t("replace_need_keepers")
      : !nNew ? t("replace_need_tracks")
      : replace ? t("replace_hint", nKeep, nNew) : t("accompany_hint", nNew);
  }

  private chips(on: Set<StemTrack>): string {
    return STEM_TRACKS.map((track) =>
      `<button type="button" class="chip ${on.has(track) ? "on" : ""}" data-track="${track}" aria-pressed="${on.has(track)}">${this.deps.t(`track_${track}`)}</button>`).join("");
  }
}
