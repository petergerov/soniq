// Bereich „Song als Vorlage“: Song hineinziehen oder anklicken, dann wählen:
//   Tempo & Stil übernehmen = das Modell beschreibt die Datei, das Formular übernimmt es (neuer Song)
//   Covern                 = die Datei ist das Original eines Covers (Erzeugung: Cover)
import type { AnalyzeResult } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { byId } from "../../core/dom.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { toServerReadableAudio, UnsupportedAudioError } from "./audio-converter.ts";

type State = "" | "busy" | "ok" | "err";
const OK_VISIBLE_MS = 4000;

export interface DropzoneDeps {
  api: ApiClient;
  t: Translate;
  /** Analyse fürs Formular übernehmen */
  onAnalysis: (result: AnalyzeResult) => void;
  /**
   * Datei als Original eines Covers; die Analyse liefert Lyrics, Tempo und Tonart dazu (null, wenn sie scheiterte).
   * false = Hochladen fehlgeschlagen (die Meldung steht dann am Cover).
   */
  onCover: (file: File, analysis: AnalyzeResult | null) => Promise<boolean>;
}

export class Dropzone {
  private readonly deps: DropzoneDeps;
  private readonly zone = byId("dropzone");
  private readonly status = byId("dzStatus");
  private readonly fileInput = byId<HTMLInputElement>("fileInput");
  private readonly actions = byId("srcActions");
  private readonly takeButton = byId<HTMLButtonElement>("srcTakeBtn");
  private readonly coverButton = byId<HTMLButtonElement>("srcCoverBtn");
  /** Abgelegte Datei, schon in einer Fassung, die der Modellserver liest (WAV oder MP3) */
  private file: File | null = null;
  private hideTimer: number | undefined;

  constructor(deps: DropzoneDeps) {
    this.deps = deps;
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
    fileInput.addEventListener("change", () => {
      void this.choose(fileInput.files?.[0]);
      fileInput.value = "";   // dieselbe Datei noch einmal wählen können
    });
    for (const type of ["dragenter", "dragover"]) zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add("drag"); });
    for (const type of ["dragleave", "dragend"]) zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.remove("drag"); });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag");
      void this.choose(e.dataTransfer?.files[0]);
    });
    this.takeButton.addEventListener("click", () => void this.take());
    this.coverButton.addEventListener("click", () => void this.cover());
  }

  /** Datei merken und fragen, was damit passieren soll. */
  private async choose(file: File | undefined): Promise<void> {
    if (!file) return;
    const { t } = this.deps;
    try {
      this.file = await toServerReadableAudio(file);
      this.actions.hidden = false;
      this.show("", t("src_chosen", file.name));
    } catch (err) {
      this.file = null;
      this.actions.hidden = true;
      const message = err instanceof UnsupportedAudioError ? t("decode_failed", file.name) : (err as Error).message;
      this.show("err", `${t("error")}: ${message}`);
    }
  }

  private async take(): Promise<void> {
    const file = this.file;
    if (!file) return;
    const { t } = this.deps;
    this.busy(t("analyzing", file.name));
    try {
      this.deps.onAnalysis(await this.deps.api.analyze(file));
      this.show("ok", t("analyzed", file.name));
    } catch (err) {
      this.show("err", `${t("error")}: ${(err as Error).message}`);
    } finally {
      this.busy("");
    }
  }

  private async cover(): Promise<void> {
    const file = this.file;
    if (!file) return;
    const { t } = this.deps;
    this.busy(t("analyzing", file.name));
    try {
      // Ohne Analyse geht das Cover trotzdem, nur ohne Lyrics und Tempo der Datei
      const analysis = await this.deps.api.analyze(file).catch(() => null);
      if (await this.deps.onCover(file, analysis)) this.show("ok", t("src_covered", file.name));
      else this.show("", t("src_chosen", file.name));
    } finally {
      this.busy("");
    }
  }

  /** Während der Analyse: Status zeigen, Knöpfe sperren ("" = fertig) */
  private busy(text: string): void {
    this.takeButton.disabled = this.coverButton.disabled = !!text;
    if (text) this.show("busy", text);
  }

  private show(state: State, text: string): void {
    clearTimeout(this.hideTimer);
    this.zone.className = "dropzone" + (state ? ` ${state}` : "");
    this.status.textContent = text;
    if (state === "ok") this.hideTimer = window.setTimeout(() => this.show("", ""), OK_VISIBLE_MS);
  }
}
