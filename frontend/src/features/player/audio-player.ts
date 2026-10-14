// Player-Leiste am unteren Rand mit Wellenform (WaveSurfer). Wird erst beim ersten Abspielen aufgebaut.
import WaveSurfer from "wavesurfer.js";
import type { Song } from "../../../../shared/api.ts";
import { byId, closest } from "../../core/dom.ts";
import { formatDuration } from "../../core/format.ts";
import type { Translate } from "../../i18n/i18n.ts";
import type { PlaybackState } from "../library/song-list.ts";
import { VolumeControl } from "./volume-control.ts";

export class AudioPlayer implements PlaybackState {
  private readonly t: Translate;
  private readonly onStateChange: () => void;
  private readonly bar = byId("player");
  private readonly playButton = byId<HTMLButtonElement>("playBtn");
  private readonly title = byId("pTitle");
  private readonly time = byId("pTime");
  private ws: WaveSurfer | undefined;
  private volume: VolumeControl | undefined;
  private current: string | null = null;
  /** Jede Wiedergabe-Anfrage bekommt eine Nummer: nach dem Laden zählt nur die neueste */
  private requestSeq = 0;

  /** @param onStateChange nach Start, Pause und Ende (die Bibliothek zeigt den Zustand an) */
  constructor(t: Translate, onStateChange: () => void) {
    this.t = t;
    this.onStateChange = onStateChange;
  }

  get currentId(): string | null {
    return this.current;
  }

  isPlaying(): boolean {
    return this.ws?.isPlaying() ?? false;
  }

  /** Texte neu setzen (nach Sprachwechsel). */
  refreshTexts(): void {
    this.volume?.update();
  }

  async play(song: Song): Promise<void> {
    const ws = this.ensureWaveSurfer();
    if (this.current === song.id) {
      await ws.playPause();
      return;
    }
    const seq = ++this.requestSeq;
    if (ws.isPlaying()) ws.pause();   // der bisherige Song verstummt sofort, nicht erst nach dem Laden des neuen
    this.current = song.id;
    this.bar.hidden = false;
    this.title.textContent = song.title || song.caption;
    this.title.title = `Seed ${song.seed}` + (song.result_meta?.keyscale ? ` · ${song.result_meta.keyscale}` : "");
    this.onStateChange();
    try {
      await ws.load(song.url!);
    } catch (err) {
      if (seq === this.requestSeq) throw err;
      return;   // abgebrochen, weil inzwischen ein anderer Song gewählt wurde
    }
    if (seq !== this.requestSeq) return;
    await ws.play();
    this.onStateChange();
  }

  private ensureWaveSurfer(): WaveSurfer {
    if (this.ws) return this.ws;
    const css = getComputedStyle(document.documentElement);
    const ws = WaveSurfer.create({
      container: "#waveform", height: 44, barWidth: 2, barGap: 1, barRadius: 2, cursorWidth: 0,
      waveColor: css.getPropertyValue("--border").trim() || "#2a2e38",
      progressColor: css.getPropertyValue("--accent2").trim() || "#d1a75c",
    });
    const showTime = () => { this.time.textContent = `${formatDuration(ws.getCurrentTime())} / ${formatDuration(ws.getDuration())}`; };
    ws.on("timeupdate", showTime);
    ws.on("ready", showTime);
    const setButton = (playing: boolean) => {
      this.playButton.textContent = playing ? "❚❚" : "▶";
      this.onStateChange();
    };
    ws.on("play", () => setButton(true));
    ws.on("pause", () => setButton(false));
    ws.on("finish", () => setButton(false));
    this.playButton.onclick = () => void ws.playPause();
    this.ws = ws;
    this.volume = new VolumeControl(this.t, (v) => ws.setVolume(v));
    this.bindSpaceKey();
    this.watchHeight();
    return ws;
  }

  /** Leertaste = Abspielen/Pause, außer beim Tippen oder auf Bedienelementen. */
  private bindSpaceKey(): void {
    document.addEventListener("keydown", (e) => {
      if (e.code !== "Space" || !this.current || closest(e.target, 'input, textarea, select, button, [role="button"]')) return;
      e.preventDefault();
      void this.ws?.playPause();
    });
  }

  /** Die Seite hält unten Platz für den Player frei; seine Höhe ändert sich, sobald die Wellenform geladen ist. */
  private watchHeight(): void {
    new ResizeObserver(() => document.documentElement.style.setProperty("--player-h", `${this.bar.offsetHeight}px`)).observe(this.bar);
  }
}
