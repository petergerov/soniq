// Repaint (ideas.md 19): auf der Wellenform einen Abschnitt wählen, der neu erzeugt wird; der Rest des Songs bleibt.
// Das Ergebnis ist eine neue Version in der Gruppe des Songs, der A/B-Vergleich spielt sie an derselben Stelle.
import { MIN_REPAINT_SECONDS, type Song } from "../../../../shared/api.ts";
import { MAX_VERSION_COUNT } from "../../../../shared/track-variation.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { closest, escapeHtml as esc } from "../../core/dom.ts";
import { formatDuration } from "../../core/format.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { displayTitle, generatedLyrics } from "../library/song-row.ts";
import type { AudioEngine } from "../player/audio-engine.ts";
import { Waveform } from "../player/waveform.ts";

export interface RepaintDialogDeps {
  api: ApiClient;
  t: Translate;
  engine: AudioEngine;
  /** Song im Player ab Sekunde `at` spielen */
  playFrom: (song: Song, at: number) => void;
  onQueued: () => void;
}

/** Vorauswahl: so lang, ab der aktuellen Stelle (sonst ab 40 % des Songs) */
const DEFAULT_SECONDS = 15;
/** Ränder der Auswahl lassen sich in diesem Abstand (px) greifen */
const EDGE_PX = 8;
/** Weniger Bewegung gilt als Klick (springt dorthin) */
const CLICK_PX = 3;

const round = (s: number) => Math.round(s * 10) / 10;

export class RepaintDialog {
  private readonly deps: RepaintDialogDeps;

  constructor(deps: RepaintDialogDeps) {
    this.deps = deps;
  }

  open(song: Song): void {
    if (!song.url) return;
    new RepaintSession(this.deps, song);
  }
}

/** Ein geöffneter Dialog: Auswahl, Vorhören, Felder, Absenden. */
class RepaintSession {
  private readonly deps: RepaintDialogDeps;
  private readonly song: Song;
  private readonly dlg = document.createElement("dialog");
  private readonly wave: Waveform;
  private readonly waveBox: HTMLElement;
  private readonly selection: HTMLElement;
  private readonly fromInput: HTMLInputElement;
  private readonly toInput: HTMLInputElement;
  private readonly lengthLabel: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly submit: HTMLButtonElement;
  private readonly errorLine: HTMLElement;
  private readonly unsubscribe: (() => void)[] = [];
  private duration: number;
  private start = 0;
  private end = 0;
  private count = 1;
  /** Vorhören des Abschnitts: hier anhalten */
  private stopAt: number | null = null;

  constructor(deps: RepaintDialogDeps, song: Song) {
    this.deps = deps;
    this.song = song;
    const { t } = deps;
    this.duration = song.result_meta?.duration || song.params.duration || 0;
    const lyrics = generatedLyrics(song) || (song.lyrics && song.lyrics !== "[Instrumental]" ? song.lyrics : "");
    const counts = Array.from({ length: MAX_VERSION_COUNT }, (_, i) => i + 1)
      .map((n) => `<button type="button" class="chip${n === 1 ? " on" : ""}" data-count="${n}" aria-pressed="${n === 1}">${n}</button>`).join("");
    this.dlg.className = "repaint-dlg";
    this.dlg.innerHTML = `<form method="dialog" class="repaint-form">
        <h2 class="col-title">${esc(t("repaint_title"))} <span class="repaint-song">${esc(displayTitle(song))}</span></h2>
        <p class="small repaint-help">${esc(t("repaint_help"))}</p>
        <div class="repaint-wave" title="${esc(t("repaint_wave_tip"))}"><div class="repaint-sel"></div></div>
        <div class="repaint-times">
          <button type="button" class="sek icon repaint-play" title="${esc(t("repaint_play"))}" aria-label="${esc(t("repaint_play"))}">▶</button>
          <label>${esc(t("repaint_from"))} <input type="number" name="from" min="0" step="0.1" inputmode="decimal"></label>
          <label>${esc(t("repaint_to"))} <input type="number" name="to" min="0" step="0.1" inputmode="decimal"></label>
          <span class="small repaint-len"></span>
        </div>
        <label class="field"><span class="lbl" title="${esc(t("repaint_caption_tip"))}">${esc(t("repaint_caption"))}</span>
          <textarea name="caption" rows="2">${esc(song.result_meta?.caption || song.caption)}</textarea></label>
        ${lyrics ? `<label class="field"><span class="lbl">${esc(t("repaint_lyrics"))}</span>
          <textarea name="lyrics" rows="6">${esc(lyrics)}</textarea><span class="small">${esc(t("repaint_lyrics_tip"))}</span></label>` : ""}
        <div class="repaint-bar">
          <span class="lbl">${esc(t("repaint_count"))}</span><div class="repaint-counts">${counts}</div>
        </div>
        <p class="small err repaint-err" hidden></p>
        <div class="submit">
          <button value="cancel" class="sek" formnovalidate>${esc(t("cancel"))}</button>
          <button type="button" class="aktion repaint-go">${esc(t("repaint_go", 1))}</button>
        </div>
      </form>`;
    const q = <T extends HTMLElement>(sel: string) => this.dlg.querySelector<T>(sel)!;
    this.waveBox = q(".repaint-wave");
    this.selection = q(".repaint-sel");
    this.fromInput = q("input[name=from]");
    this.toInput = q("input[name=to]");
    this.lengthLabel = q(".repaint-len");
    this.playButton = q(".repaint-play");
    this.submit = q(".repaint-go");
    this.errorLine = q(".repaint-err");
    // Waveform ersetzt den Inhalt ihres Containers: eigener Container, die Auswahl liegt darüber
    const waveHost = document.createElement("div");
    this.waveBox.prepend(waveHost);
    this.wave = new Waveform(waveHost, { height: 72, cursor: true });

    document.body.appendChild(this.dlg);
    this.dlg.addEventListener("close", () => this.dispose(), { once: true });
    this.dlg.showModal();
    this.bind();
    this.preselect();
    void this.loadWave();
  }

  private async loadWave(): Promise<void> {
    try {
      const buffer = await this.deps.engine.load(this.song.url!);
      this.wave.setBuffer(buffer);
      if (Math.abs(buffer.duration - this.duration) > 0.5) {
        this.duration = buffer.duration;
        this.setRegion(this.start, this.end);
      }
      this.showPosition();
    } catch (e) {
      this.showError(e);
    }
  }

  /** Läuft der Song gerade, beginnt die Auswahl an der aktuellen Stelle. */
  private preselect(): void {
    const { engine } = this.deps;
    const here = engine.songId === this.song.id ? engine.position : this.duration * 0.4;
    const start = Math.min(here, Math.max(0, this.duration - DEFAULT_SECONDS));
    this.setRegion(start, start + DEFAULT_SECONDS);
  }

  /** Bis vor den Anfang getippt (end < start) bleibt so stehen: zu kurz, Absenden gesperrt. */
  private setRegion(start: number, end: number): void {
    const max = this.duration || Math.max(start, end);
    const clamp = (s: number) => round(Math.min(Math.max(0, s), max));
    this.start = clamp(start);
    this.end = clamp(end);
    const pct = (s: number) => (max > 0 ? (s / max) * 100 : 0);
    this.selection.style.left = `${pct(this.start)}%`;
    this.selection.style.width = `${Math.max(0, pct(this.end) - pct(this.start))}%`;
    if (document.activeElement !== this.fromInput) this.fromInput.value = String(this.start);
    if (document.activeElement !== this.toInput) this.toInput.value = String(this.end);
    this.fromInput.max = this.toInput.max = String(round(max));
    const length = this.end - this.start;
    const tooShort = length < MIN_REPAINT_SECONDS;
    this.lengthLabel.textContent = tooShort
      ? this.deps.t("repaint_too_short", MIN_REPAINT_SECONDS)
      : `${formatDuration(this.start)}–${formatDuration(this.end)} · ${this.deps.t("repaint_len", length.toFixed(1))}`;
    this.lengthLabel.classList.toggle("err", tooShort);
    this.submit.disabled = tooShort;
  }

  private timeAt(clientX: number): number {
    const rect = this.waveBox.getBoundingClientRect();
    return rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * this.duration : 0;
  }

  private xOf(seconds: number): number {
    const rect = this.waveBox.getBoundingClientRect();
    return rect.left + (this.duration > 0 ? (seconds / this.duration) * rect.width : 0);
  }

  private bind(): void {
    const { engine, t } = this.deps;
    // Ziehen wählt einen neuen Abschnitt, an den Rändern verschiebt es nur diesen Rand; ein Klick springt dorthin
    this.waveBox.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.duration) return;
      e.preventDefault();
      this.waveBox.setPointerCapture(e.pointerId);
      const downX = e.clientX;
      const edge = Math.abs(downX - this.xOf(this.start)) <= EDGE_PX ? "start" : Math.abs(downX - this.xOf(this.end)) <= EDGE_PX ? "end" : null;
      const anchor = edge === "start" ? this.end : edge === "end" ? this.start : this.timeAt(downX);
      const before = [this.start, this.end] as const;
      let moved = false;
      const move = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - downX) < CLICK_PX) return;
        moved = true;
        const at = this.timeAt(ev.clientX);
        this.setRegion(Math.min(anchor, at), Math.max(anchor, at));
      };
      const up = (ev: PointerEvent) => {
        this.waveBox.removeEventListener("pointermove", move);
        this.waveBox.removeEventListener("pointerup", up);
        this.waveBox.removeEventListener("pointercancel", up);
        if (moved || ev.type === "pointercancel") return;
        this.setRegion(...before);
        this.stopAt = null;
        this.deps.playFrom(this.song, this.timeAt(downX));
      };
      this.waveBox.addEventListener("pointermove", move);
      this.waveBox.addEventListener("pointerup", up);
      this.waveBox.addEventListener("pointercancel", up);
    });
    // Ein Anfang hinter dem Ende verschiebt den Abschnitt (gleiche Länge), statt die Werte zu tauschen
    this.fromInput.addEventListener("input", () => {
      const from = this.fromInput.valueAsNumber;
      if (!Number.isFinite(from)) return;
      this.setRegion(from, from < this.end ? this.end : from + Math.max(MIN_REPAINT_SECONDS, this.end - this.start));
    });
    this.toInput.addEventListener("input", () => {
      const to = this.toInput.valueAsNumber;
      if (Number.isFinite(to)) this.setRegion(this.start, to);
    });
    // Enter in einem Zahlenfeld schickte sonst das Formular ab (erster Knopf = Abbrechen)
    for (const input of [this.fromInput, this.toInput]) {
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
    }
    this.fromInput.addEventListener("change", () => this.setRegion(this.start, this.end));
    this.toInput.addEventListener("change", () => this.setRegion(this.start, this.end));

    // ▶ spielt den Abschnitt (mit einer Sekunde Anlauf) und hält an seinem Ende an
    this.playButton.addEventListener("click", () => {
      if (this.isPlaying()) {
        engine.pause();
        return;
      }
      // playFrom hält einen anderen Song sofort an (onState): stopAt erst danach setzen
      this.deps.playFrom(this.song, Math.max(0, this.start - 1));
      this.stopAt = this.end;
    });
    this.unsubscribe.push(engine.onTick(() => {
      this.showPosition();
      if (this.stopAt !== null && this.isPlaying() && engine.position >= this.stopAt) {
        this.stopAt = null;
        engine.pause();
      }
    }));
    this.unsubscribe.push(engine.onState(() => {
      this.playButton.textContent = this.isPlaying() ? "❚❚" : "▶";
      if (!engine.playing) this.stopAt = null;
    }));

    this.dlg.querySelector(".repaint-counts")!.addEventListener("click", (e) => {
      const chip = closest<HTMLButtonElement>(e.target, "[data-count]");
      if (!chip) return;
      this.count = Number(chip.dataset.count);
      this.dlg.querySelectorAll<HTMLButtonElement>("[data-count]").forEach((b) => {
        const on = b === chip;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
      });
      this.submit.textContent = t("repaint_go", this.count);
    });
    this.submit.addEventListener("click", () => void this.send());
  }

  private isPlaying(): boolean {
    return this.deps.engine.songId === this.song.id && this.deps.engine.playing;
  }

  private showPosition(): void {
    const { engine } = this.deps;
    const here = engine.songId === this.song.id && this.duration > 0 ? engine.position / this.duration : 0;
    this.wave.setProgress(here);
  }

  private async send(): Promise<void> {
    const field = (name: string) => this.dlg.querySelector<HTMLTextAreaElement>(`textarea[name=${name}]`)?.value.trim();
    this.submit.disabled = true;
    this.errorLine.hidden = true;
    try {
      await this.deps.api.repaint(this.song.id, {
        start: this.start, end: this.end, caption: field("caption"), lyrics: field("lyrics"), count: this.count,
      });
      this.deps.onQueued();
      this.dlg.close();
    } catch (e) {
      this.showError(e);
      this.submit.disabled = false;
    }
  }

  private showError(e: unknown): void {
    this.errorLine.textContent = e instanceof Error ? e.message : String(e);
    this.errorLine.hidden = false;
  }

  private dispose(): void {
    if (this.stopAt !== null && this.isPlaying()) this.deps.engine.pause();
    this.unsubscribe.forEach((fn) => fn());
    this.wave.destroy();
    this.dlg.remove();
  }
}
