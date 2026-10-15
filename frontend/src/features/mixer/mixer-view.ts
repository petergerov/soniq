// Mixer: alle fertigen Spuren eines Songs mit Waveform, Lautstärke, Mute und Solo.
// Wiedergabe synchron über mehrere WaveSurfer-Instanzen; Solo dämpft alle anderen.
import WaveSurfer from "wavesurfer.js";
import type { Song, Stem } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { byId, closest } from "../../core/dom.ts";
import { formatDuration } from "../../core/format.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { displayTitle } from "../library/song-row.ts";

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
  stem: Stem;
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
  private channels: Channel[] = [];
  private songId: string | null = null;
  private syncing = false;
  private ready = 0;

  constructor(deps: MixerViewDeps) {
    this.deps = deps;
    byId("mixerBack").addEventListener("click", () => deps.back());
    this.playBtn.addEventListener("click", () => void this.togglePlay());
    this.scrub.addEventListener("input", () => {
      const master = this.channels[0]?.ws;
      if (!master) return;
      const t = (Number(this.scrub.value) / 1000) * (master.getDuration() || 0);
      this.seekAll(t);
    });
    this.tracksEl.addEventListener("click", (e) => this.onTrackClick(e));
    this.tracksEl.addEventListener("input", (e) => this.onTrackInput(e));
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

    let song = this.deps.findSong(songId);
    if (!song) {
      try { song = await this.deps.api.song(songId); }
      catch { this.showEmpty(this.deps.t("mixer_missing")); return; }
    }
    this.title.textContent = displayTitle(song);

    let stems: Stem[];
    try { stems = await this.deps.api.stems(songId); }
    catch { this.showEmpty(this.deps.t("mixer_missing")); return; }

    const done = stems.filter((s) => s.status === "done" && s.url);
    if (!done.length) {
      this.showEmpty(this.deps.t("mixer_no_stems"));
      return;
    }

    const css = getComputedStyle(document.documentElement);
    const wave = css.getPropertyValue("--wave").trim() || "#2b2b36";
    const progress = css.getPropertyValue("--wave-progress").trim() || "#a78bfa";
    this.tracksEl.innerHTML = "";
    this.ready = 0;
    this.channels = done.map((stem) => this.createChannel(stem, wave, progress));
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
      const name = this.tracksEl.querySelector<HTMLElement>(`[data-stem="${ch.stem.id}"] .mixer-name`);
      if (name) name.textContent = this.deps.t(`track_${ch.stem.track}`);
    });
  }

  private createChannel(stem: Stem, wave: string, progress: string): Channel {
    const { t } = this.deps;
    const row = document.createElement("div");
    row.className = "mixer-track";
    row.dataset.stem = stem.id;
    row.innerHTML = `
      <div class="mixer-label">
        <span class="mixer-name">${t(`track_${stem.track}`)}</span>
        <div class="mixer-btns">
          <button type="button" class="sek icon mixer-mute" data-a="mute" aria-pressed="false" title="${t("mixer_mute")}">M</button>
          <button type="button" class="sek icon mixer-solo" data-a="solo" aria-pressed="false" title="${t("mixer_solo")}">S</button>
        </div>
      </div>
      <div class="mixer-wave"></div>
      <label class="mixer-vol"><span class="visually-hidden">${t("mixer_volume")}</span>
        <input type="range" min="0" max="100" value="100" data-a="vol" aria-label="${t("mixer_volume")}">
      </label>`;
    this.tracksEl.appendChild(row);

    const ws = WaveSurfer.create({
      container: row.querySelector<HTMLElement>(".mixer-wave")!,
      height: 48, barWidth: 2, barGap: 1, barRadius: 2, cursorWidth: 1,
      waveColor: wave, progressColor: progress, interact: true,
      url: stem.url!,
    });
    const ch: Channel = { stem, ws, volume: 1, muted: false, solo: false };
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
    const ch = this.channels.find((c) => c.stem.id === row.dataset.stem);
    if (!ch) return;
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
    const ch = this.channels.find((c) => c.stem.id === row.dataset.stem);
    if (!ch) return;
    ch.volume = Number(input.value) / 100;
    this.applyGains();
  }

  /** Solo: nur Solo-Spuren hörbar. Sonst Mute. Lautstärke immer multipliziert. */
  private applyGains(): void {
    const anySolo = this.channels.some((c) => c.solo);
    this.channels.forEach((ch) => {
      const audible = anySolo ? ch.solo : !ch.muted;
      ch.ws.setVolume(audible ? ch.volume : 0);
      // getWrapper() steckt im Shadow-DOM — closest() erreicht die Spur-Zeile nicht
      this.tracksEl.querySelector(`[data-stem="${ch.stem.id}"]`)?.classList.toggle("is-silent", !audible);
    });
  }

  private showEmpty(message: string): void {
    this.root.classList.remove("loading");
    this.tracksEl.innerHTML = `<div class="empty">${message}</div>`;
    this.playBtn.disabled = true;
    this.timeEl.textContent = "";
  }

  private destroy(): void {
    if (this.channels.length) this.pauseAll();
    this.channels.forEach((ch) => ch.ws.destroy());
    this.channels = [];
    this.tracksEl.innerHTML = "";
    this.ready = 0;
  }
}
