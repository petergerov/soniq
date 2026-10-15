// Ersetzen / Begleiten (newfeatures.md C): Datei hochladen, Keeper herauslösen, neue Spuren mit lego.
// Die Datei wird lokal gelesen. Tempo und Tonart kommen nur auf Knopfdruck vom Sprachmodell.
import { STEM_TRACKS, type AnalyzeResult, type StemIntent, type StemTrack } from "../../../../shared/api.ts";
import { pieceStyle } from "../../../../shared/piece-style.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { byId } from "../../core/dom.ts";
import { setPackagedApp, stemsMissingText } from "../../core/stems-hint.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { UnsupportedAudioError, wavWithDuration } from "../analyze/audio-converter.ts";

const DEFAULT_KEEP: readonly StemTrack[] = ["drums", "bass", "guitar", "keyboard", "vocals"];
const DEFAULT_REPLACE: readonly StemTrack[] = ["guitar"];
const DEFAULT_ADD: readonly StemTrack[] = ["drums", "bass", "keyboard"];
const TIME_LABEL: Record<string, string> = { "2": "2/4", "3": "3/4", "4": "4/4", "6": "6/8" };
const VOCAL: readonly StemTrack[] = ["vocals", "backing_vocals"];

function hasLyrics(lyrics: string | undefined): boolean {
  return /[^\s[\]]/.test((lyrics || "").replace(/\[[^\]]*\]/g, ""));
}

interface Detected {
  bpm: number;
  keyscale: string;
  timesignature: string;
  lyrics: string;
  vocalLanguage: string;
}

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
  private readonly detectBtn = byId<HTMLButtonElement>("replaceDetect");
  private readonly meta = byId("replaceMeta");
  private readonly go = byId<HTMLButtonElement>("replaceGo");
  private readonly hint = byId("replaceHint");
  private intent: StemIntent = "replace";
  private file: File | null = null;
  private fileName = "";
  private duration = 0;
  private detected: Detected | null = null;
  private detecting = false;
  private takeGeneration = 0;
  private available = true;
  private readonly keep = new Set<StemTrack>(DEFAULT_KEEP.filter((t) => !DEFAULT_REPLACE.includes(t)));
  private readonly next = new Set<StemTrack>(DEFAULT_REPLACE);

  constructor(deps: ReplaceViewDeps) {
    this.deps = deps;
    this.bind();
    void deps.api.settings().then((s) => {
      setPackagedApp(s.packaged);
      this.setAvailable(s.stems_available);
    }, () => {});
    this.render();
  }

  setAvailable(available: boolean): void {
    this.available = available;
    this.render();
  }

  refreshTexts(): void {
    this.render();
    if (this.file && !this.detecting) this.status.textContent = this.readyText();
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
    this.detectBtn.addEventListener("click", () => void this.detect());
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
    const generation = ++this.takeGeneration;
    this.fileInput.value = "";
    this.file = null;
    this.detected = null;
    this.detecting = false;
    this.style.value = "";
    this.fileName = file.name;
    this.status.textContent = this.deps.t("replace_reading", file.name);
    this.zone.className = "dropzone busy";
    this.render();
    try {
      const wav = await wavWithDuration(file);
      if (generation !== this.takeGeneration) return;
      this.file = wav.file;
      this.duration = Math.max(1, Math.round(wav.duration));
      this.zone.className = "dropzone ok";
      this.status.textContent = this.readyText();
    } catch (err) {
      if (generation !== this.takeGeneration) return;
      this.file = null;
      this.duration = 0;
      this.zone.className = "dropzone err";
      const message = err instanceof UnsupportedAudioError ? this.deps.t("decode_failed", file.name) : (err as Error).message;
      this.status.textContent = `${this.deps.t("error")}: ${message}`;
    }
    this.render();
  }

  private async detect(): Promise<void> {
    const file = this.file;
    if (!file || this.detecting) return;
    const generation = this.takeGeneration;
    this.detecting = true;
    this.status.textContent = this.deps.t("replace_detecting");
    this.render();
    try {
      const result = await this.deps.api.analyze(file);
      if (generation !== this.takeGeneration) return;
      this.applyDetected(result);
      this.zone.className = "dropzone ok";
      this.status.textContent = this.readyText();
    } catch (err) {
      if (generation !== this.takeGeneration) return;
      this.status.textContent = `${this.deps.t("error")}: ${(err as Error).message}`;
    }
    this.detecting = false;
    this.render();
  }

  private applyDetected(result: AnalyzeResult): void {
    this.detected = {
      bpm: result.bpm || 0,
      keyscale: result.keyscale || "",
      timesignature: result.timesignature || "",
      lyrics: result.lyrics || "",
      vocalLanguage: result.vocal_language || "",
    };
    const style = pieceStyle(result.caption || "");
    if (style) this.style.value = style;
    if (!hasLyrics(result.lyrics)) this.keep.delete("vocals");
  }

  private async submit(): Promise<void> {
    if (!this.file || this.go.disabled) return;
    this.go.disabled = true;
    const detected = this.detected;
    const vocals = this.vocalChosen();
    try {
      await this.deps.api.uploadStems(this.file, {
        intent: this.intent,
        tracks: STEM_TRACKS.filter((t) => this.next.has(t)),
        keepers: this.intent === "replace" ? STEM_TRACKS.filter((t) => this.keep.has(t)) : undefined,
        caption: this.style.value.trim() || "instrumental",
        lyrics: vocals ? detected?.lyrics || "" : "",
        duration: this.duration,
        bpm: detected?.bpm || 0,
        keyscale: detected?.keyscale || "",
        timesignature: detected?.timesignature || "",
        vocal_language: vocals ? detected?.vocalLanguage || "" : "",
        folder_id: this.deps.targetFolder(),
      });
      this.deps.onQueued();
    } catch (err) {
      alert(`${this.deps.t("error")}: ${(err as Error).message}`);
    }
    setTimeout(() => { this.go.disabled = false; this.render(); }, 600);
  }

  private vocalChosen(): boolean {
    return VOCAL.some((t) => this.next.has(t) || (this.intent === "replace" && this.keep.has(t)));
  }

  private readyText(): string {
    const clock = `${Math.floor(this.duration / 60)}:${String(this.duration % 60).padStart(2, "0")}`;
    return this.deps.t("replace_ready", this.fileName, clock);
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
    this.detectBtn.disabled = !this.file || this.detecting;
    this.detectBtn.textContent = this.detecting ? t("replace_detecting") : t("replace_detect");
    const detected = this.detected;
    const metaParts = [
      detected?.bpm ? `${detected.bpm} BPM` : "",
      detected?.keyscale || "",
      detected?.timesignature ? TIME_LABEL[detected.timesignature] ?? detected.timesignature : "",
    ].filter(Boolean);
    this.meta.textContent = metaParts.join(" · ");
    const nKeep = STEM_TRACKS.filter((x) => this.keep.has(x)).length;
    const nNew = STEM_TRACKS.filter((x) => this.next.has(x)).length;
    this.go.textContent = replace ? t("replace_go") : t("replace_go_accompany");
    this.go.disabled = !this.available || !this.file || this.detecting || !nNew || (replace && !nKeep);
    this.go.title = this.available ? "" : stemsMissingText(t);
    this.hint.className = `small ${this.available ? "" : "err-t"}`.trim();
    this.hint.textContent = !this.available ? stemsMissingText(t)
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
