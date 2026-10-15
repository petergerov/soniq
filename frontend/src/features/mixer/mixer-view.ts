// Mixer: alle fertigen Spuren eines Songs mit Waveform, Lautstärke, Mute und Solo, dazu die hochgeladene Vorlage
// (Ersetzen/Begleiten). Wiedergabe synchron über mehrere WaveSurfer-Instanzen; Solo dämpft alle anderen.
// Herunterladen: jede Spur einzeln, alle als ZIP, und der Mix so, wie er gerade klingt.
import WaveSurfer from "wavesurfer.js";
import { SOURCE_CHANNEL, type Song, type Stem } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { byId, closest, saveBlob } from "../../core/dom.ts";
import { formatDuration } from "../../core/format.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { displayTitle } from "../library/song-row.ts";

const SPEAKER_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 9v6h4l5 4V5L8 9H4z"/><path class="w1" d="M16 9a3.5 3.5 0 0 1 0 6"/><path class="w2" d="M18.5 6.5a7 7 0 0 1 0 11"/><path class="mx" d="M17 9l5 6M22 9l-5 6"/>
</svg>`;

export interface MixerViewDeps {
  api: ApiClient;
  t: Translate;
  /** Song aus dem Speicher; fehlt er, lädt die View ihn nach */
  findSong: (id: string) => Song | undefined;
  /** Zurück zur Bibliothek */
  back: () => void;
  /** Haupt-Player pausieren, solange der Mixer läuft */
  pauseMainPlayer: () => void;
}

interface Channel {
  /** Spur-ID oder SOURCE_CHANNEL (Vorlage) */
  id: string;
  /** Übersetzungsschlüssel des Namens */
  label: string;
  ws: WaveSurfer;
  volume: number;
  muted: boolean;
  solo: boolean;
}

export class MixerView {
  private readonly deps: MixerViewDeps;
  private readonly root = byId("mixer");
  private readonly title = byId("mixerTitle");
  private readonly tracksEl = byId("mixerTracks");
  private readonly playBtn = byId<HTMLButtonElement>("mixerPlay");
  private readonly timeEl = byId("mixerTime");
  private readonly scrub = byId<HTMLInputElement>("mixerScrub");
  private readonly mixButton = byId<HTMLButtonElement>("mixerMixDl");
  private readonly zipLink = byId<HTMLAnchorElement>("mixerZip");
  private channels: Channel[] = [];
  private songId: string | null = null;
  private syncing = false;
  private ready = 0;
  /** Mix wird gerade auf dem Server gemischt und geladen */
  private mixing = false;

  constructor(deps: MixerViewDeps) {
    this.deps = deps;
    byId("mixerBack").addEventListener("click", () => deps.back());
    this.playBtn.addEventListener("click", () => void this.togglePlay());
    this.mixButton.addEventListener("click", () => void this.downloadMix());
    this.scrub.addEventListener("input", () => {
      const master = this.channels[0]?.ws;
      if (!master) return;
      const t = (Number(this.scrub.value) / 1000) * (master.getDuration() || 0);
      this.seekAll(t);
    });
    this.tracksEl.addEventListener("click", (e) => this.onTrackClick(e));
    this.tracksEl.addEventListener("input", (e) => this.onTrackInput(e));
    document.addEventListener("pointerdown", (e) => {
      if (!this.channels.length) return;
      if (closest(e.target, ".mixer-vol.is-open")) return;
      this.closeVolPopovers();
    });
  }

  /** Mixer öffnen bzw. Song wechseln. */
  async open(songId: string): Promise<void> {
    if (this.songId === songId && this.channels.length) return;
    this.deps.pauseMainPlayer();
    this.destroy();
    this.songId = songId;
    this.root.classList.add("loading");
    this.playBtn.disabled = true;
    this.timeEl.textContent = "…";
    this.scrub.value = "0";
    this.zipLink.hidden = true;
    this.updateMixButton();

    let song = this.deps.findSong(songId);
    if (!song) {
      try { song = await this.deps.api.song(songId); }
      catch { this.showEmpty(this.deps.t("mixer_missing")); return; }
    }
    this.title.textContent = displayTitle(song);

    let stems: Stem[];
    try { stems = await this.deps.api.stems(songId); }
    catch { this.showEmpty(this.deps.t("mixer_missing")); return; }

    // Vorlage zuletzt: beim Ersetzen stumm (darin stecken die ersetzten Instrumente, zum Vergleichen per Solo),
    // beim Begleiten hörbar (die Aufnahme gehört zum Song, die Spuren begleiten sie nur)
    const sources = stems.filter((s) => s.status === "done" && s.url)
      .map((s) => ({ id: s.id, label: `track_${s.track}`, url: s.url!, muted: false }));
    if (song.source_url) sources.push({ id: SOURCE_CHANNEL, label: "source_track", url: song.source_url, muted: song.params.mode !== "accompany" });
    if (!sources.length) {
      this.showEmpty(this.deps.t("mixer_no_stems"));
      return;
    }

    const css = getComputedStyle(document.documentElement);
    const wave = css.getPropertyValue("--wave").trim() || "#2b2b36";
    const progress = css.getPropertyValue("--wave-progress").trim() || "#a78bfa";
    this.tracksEl.innerHTML = "";
    this.ready = 0;
    this.channels = sources.map((source) => this.createChannel(source, wave, progress));
    this.zipLink.href = `/api/songs/${songId}/stems.zip`;
    this.zipLink.hidden = false;
    this.applyGains();
    this.root.classList.remove("loading");
  }

  /** Mixer verlassen: Player und Speicher freigeben. */
  close(): void {
    this.destroy();
    this.songId = null;
  }

  refreshTexts(): void {
    if (!this.songId) return;
    // Labels an den Kanälen neu setzen
    this.channels.forEach((ch) => {
      const name = this.tracksEl.querySelector<HTMLElement>(`[data-stem="${ch.id}"] .mixer-name`);
      if (name) name.textContent = this.deps.t(ch.label);
    });
    this.updateMixButton();
  }

  private createChannel(source: { id: string; label: string; url: string; muted: boolean }, wave: string, progress: string): Channel {
    const { t } = this.deps;
    const row = document.createElement("div");
    row.className = `mixer-track${source.muted ? " is-muted" : ""}`;
    row.dataset.stem = source.id;
    row.innerHTML = `
      <div class="mixer-label">
        <span class="mixer-name">${t(source.label)}</span>
        <div class="mixer-btns">
          <button type="button" class="sek icon mixer-mute" data-a="mute" aria-pressed="${source.muted}" title="${t("mixer_mute")}">M</button>
          <button type="button" class="sek icon mixer-solo" data-a="solo" aria-pressed="false" title="${t("mixer_solo")}">S</button>
          <a class="sek icon mixer-dl" href="${source.url}?download=1" download title="${t("download")}" aria-label="${t("download")}">↓</a>
        </div>
      </div>
      <div class="mixer-wave"></div>
      <div class="mixer-vol" data-level="high" style="--v:1">
        <button type="button" class="sek icon mixer-vol-btn" data-a="vol-toggle" title="${t("mixer_volume")}" aria-label="${t("mixer_volume")}" aria-expanded="false">${SPEAKER_SVG}</button>
        <input type="range" min="0" max="100" value="100" data-a="vol" aria-label="${t("mixer_volume")}">
      </div>`;
    this.tracksEl.appendChild(row);

    const ws = WaveSurfer.create({
      container: row.querySelector<HTMLElement>(".mixer-wave")!,
      height: 48, barWidth: 2, barGap: 1, barRadius: 2, cursorWidth: 1,
      waveColor: wave, progressColor: progress, interact: true,
      url: source.url,
    });
    const ch: Channel = { id: source.id, label: source.label, ws, volume: 1, muted: source.muted, solo: false };
    ws.on("ready", () => {
      this.ready++;
      if (this.ready === this.channels.length) this.onAllReady();
    });
    ws.on("timeupdate", () => {
      if (this.channels[0]?.ws === ws) this.updateTransport();
    });
    ws.on("seeking", (time) => {
      if (this.syncing) return;
      this.seekAll(time);
    });
    ws.on("finish", () => {
      if (this.channels[0]?.ws === ws) this.setPlaying(false);
    });
    ws.on("play", () => {
      if (this.channels[0]?.ws === ws) this.setPlaying(true);
    });
    ws.on("pause", () => {
      if (this.channels[0]?.ws === ws && !this.syncing) this.setPlaying(false);
    });
    return ch;
  }

  private onAllReady(): void {
    this.playBtn.disabled = false;
    this.applyGains();
    this.updateTransport();
  }

  private async togglePlay(): Promise<void> {
    const master = this.channels[0]?.ws;
    if (!master) return;
    this.deps.pauseMainPlayer();
    if (master.isPlaying()) {
      this.pauseAll();
      return;
    }
    // Alle Spuren auf denselben Zeitpunkt bringen, dann starten
    const t = master.getCurrentTime();
    this.syncing = true;
    try {
      await Promise.all(this.channels.map(async (ch) => {
        ch.ws.setTime(t);
        await ch.ws.play();
      }));
    } finally {
      this.syncing = false;
    }
    this.setPlaying(true);
  }

  private pauseAll(): void {
    this.syncing = true;
    this.channels.forEach((ch) => { if (ch.ws.isPlaying()) ch.ws.pause(); });
    this.syncing = false;
    this.setPlaying(false);
  }

  private seekAll(time: number): void {
    this.syncing = true;
    this.channels.forEach((ch) => ch.ws.setTime(time));
    this.syncing = false;
    this.updateTransport();
  }

  private setPlaying(playing: boolean): void {
    this.playBtn.textContent = playing ? "❚❚" : "▶";
    this.playBtn.setAttribute("aria-label", this.deps.t(playing ? "pause" : "play"));
  }

  private updateTransport(): void {
    const master = this.channels[0]?.ws;
    if (!master) return;
    const cur = master.getCurrentTime();
    const dur = master.getDuration() || 0;
    this.timeEl.textContent = `${formatDuration(cur)} / ${formatDuration(dur)}`;
    if (document.activeElement !== this.scrub) {
      this.scrub.value = String(dur > 0 ? Math.round((cur / dur) * 1000) : 0);
    }
  }

  private onTrackClick(e: Event): void {
    const btn = closest<HTMLElement>(e.target, "[data-a]");
    const row = closest<HTMLElement>(e.target, "[data-stem]");
    if (!btn || !row) return;
    const ch = this.channels.find((c) => c.id === row.dataset.stem);
    if (!ch) return;
    if (btn.dataset.a === "vol-toggle") {
      const box = closest<HTMLElement>(btn, ".mixer-vol");
      const open = !box?.classList.contains("is-open");
      this.closeVolPopovers();
      if (open && box) {
        box.classList.add("is-open");
        btn.setAttribute("aria-expanded", "true");
        box.querySelector<HTMLInputElement>("input[data-a=vol]")?.focus();
      }
      return;
    }
    if (btn.dataset.a === "mute") {
      ch.muted = !ch.muted;
      btn.setAttribute("aria-pressed", String(ch.muted));
      row.classList.toggle("is-muted", ch.muted);
    } else if (btn.dataset.a === "solo") {
      ch.solo = !ch.solo;
      btn.setAttribute("aria-pressed", String(ch.solo));
      row.classList.toggle("is-solo", ch.solo);
    } else return;
    this.applyGains();
  }

  private onTrackInput(e: Event): void {
    const input = closest<HTMLInputElement>(e.target, "input[data-a=vol]");
    const row = closest<HTMLElement>(e.target, "[data-stem]");
    if (!input || !row) return;
    const ch = this.channels.find((c) => c.id === row.dataset.stem);
    if (!ch) return;
    ch.volume = Number(input.value) / 100;
    this.syncVolUi(row, ch.volume);
    this.applyGains();
  }

  private closeVolPopovers(): void {
    this.tracksEl.querySelectorAll<HTMLElement>(".mixer-vol.is-open").forEach((box) => {
      box.classList.remove("is-open");
      box.querySelector(".mixer-vol-btn")?.setAttribute("aria-expanded", "false");
    });
  }

  private syncVolUi(row: HTMLElement, volume: number): void {
    const box = row.querySelector<HTMLElement>(".mixer-vol");
    if (!box) return;
    box.dataset.level = volume === 0 ? "off" : volume < 0.5 ? "low" : "high";
    box.style.setProperty("--v", String(volume));
  }

  /** Lautstärke je Kanal, wie sie zu hören ist: Solo → nur Solo-Spuren, sonst Mute; Regler immer multipliziert. */
  private gains(): Map<string, number> {
    const anySolo = this.channels.some((c) => c.solo);
    return new Map(this.channels.map((ch) => [ch.id, (anySolo ? ch.solo : !ch.muted) ? ch.volume : 0]));
  }

  private applyGains(): void {
    const gains = this.gains();
    this.channels.forEach((ch) => {
      ch.ws.setVolume(gains.get(ch.id)!);
      // getWrapper() steckt im Shadow-DOM — closest() erreicht die Spur-Zeile nicht
      this.tracksEl.querySelector(`[data-stem="${ch.id}"]`)?.classList.toggle("is-silent", !gains.get(ch.id));
    });
    this.updateMixButton();
  }

  /** „Mix ↓“: nur wenn etwas zu hören ist; während des Mischens „…“. */
  private updateMixButton(): void {
    const { t } = this.deps;
    const audible = [...this.gains().values()].some((g) => g > 0);
    this.mixButton.disabled = this.mixing || !audible;
    this.mixButton.textContent = this.mixing ? "…" : t("mix_dl");
    this.mixButton.title = audible ? t("mix_dl_tip") : t("mix_dl_silent");
  }

  /** Der Server mischt die gespeicherten Spuren mit den aktuellen Reglern; die WAV-Datei kommt als Download. */
  private async downloadMix(): Promise<void> {
    const songId = this.songId;
    if (!songId || this.mixing) return;
    this.mixing = true;
    this.updateMixButton();
    try {
      const { blob, filename } = await this.deps.api.mixdown(songId, this.gains());
      saveBlob(blob, filename);
    } catch (e) {
      alert(`${this.deps.t("error")}: ${(e as Error).message}`);
    } finally {
      this.mixing = false;
      this.updateMixButton();
    }
  }

  private showEmpty(message: string): void {
    this.root.classList.remove("loading");
    this.tracksEl.innerHTML = `<div class="empty">${message}</div>`;
    this.playBtn.disabled = true;
    this.timeEl.textContent = "";
    this.updateMixButton();
  }

  private destroy(): void {
    if (this.channels.length) this.pauseAll();
    this.channels.forEach((ch) => ch.ws.destroy());
    this.channels = [];
    this.tracksEl.innerHTML = "";
    this.ready = 0;
  }
}
