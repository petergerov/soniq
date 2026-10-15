// Player-Leiste am unteren Rand mit Wellenform (WaveSurfer). Wird erst beim ersten Abspielen aufgebaut.
import WaveSurfer from "wavesurfer.js";
import type { Song } from "../../../../shared/api.ts";
import { byId, closest } from "../../core/dom.ts";
import { formatDuration } from "../../core/format.ts";
import type { Translate } from "../../i18n/i18n.ts";
import type { PlaybackState } from "../library/song-list.ts";
import { VolumeControl } from "./volume-control.ts";

export interface AudioPlayerDeps {
  t: Translate;
  /** Nach Start, Pause und Ende (die Bibliothek zeigt den Zustand an) */
  onStateChange: () => void;
  /** Fertige Versionen desselben Prompts (A, B, C …), einschließlich des Songs selbst */
  versionsOf: (song: Song) => Song[];
  /** Eine andere Version wurde gewählt (Knopf oder Taste C) */
  onVersionPick: (song: Song) => void;
}

export interface PlayOptions {
  /** A/B-Vergleich: an derselben Stelle weiterspielen statt von vorn */
  keepPosition?: boolean;
}

export class AudioPlayer implements PlaybackState {
  private readonly t: Translate;
  private readonly onStateChange: () => void;
  private readonly deps: AudioPlayerDeps;
  private readonly bar = byId("player");
  private readonly playButton = byId<HTMLButtonElement>("playBtn");
  private readonly title = byId("pTitle");
  private readonly time = byId("pTime");
  private readonly versions = byId("pVersions");
  private ws: WaveSurfer | undefined;
  private volume: VolumeControl | undefined;
  private current: string | null = null;
  private currentSong: Song | null = null;
  /** Jede Wiedergabe-Anfrage bekommt eine Nummer: nach dem Laden zählt nur die neueste */
  private requestSeq = 0;

  constructor(deps: AudioPlayerDeps) {
    this.deps = deps;
    this.t = deps.t;
    this.onStateChange = deps.onStateChange;
    this.versions.addEventListener("click", (e) => {
      const id = closest<HTMLElement>(e.target, "[data-version]")?.dataset.version;
      const song = this.currentSong && this.deps.versionsOf(this.currentSong).find((s) => s.id === id);
      if (song && song.id !== this.current) this.deps.onVersionPick(song);
    });
  }

  /** Nächste Version desselben Prompts wählen (A → B → … → A). */
  nextVersion(): void {
    if (!this.currentSong) return;
    const list = this.deps.versionsOf(this.currentSong);
    if (list.length < 2) return;
    const i = list.findIndex((s) => s.id === this.current);
    this.deps.onVersionPick(list[(i + 1) % list.length]!);
  }

  /** Knöpfe A, B, C … neu zeichnen (auch wenn neue Versionen fertig werden). */
  renderVersions(): void {
    const list = this.currentSong ? this.deps.versionsOf(this.currentSong) : [];
    this.versions.hidden = list.length < 2;
    this.versions.innerHTML = list.length < 2 ? "" : list.map((s) =>
      `<button type="button" class="sek ver ${s.id === this.current ? "on" : ""}" data-version="${s.id}" aria-pressed="${s.id === this.current}">${s.letter}</button>`).join("");
    this.versions.title = this.t("compare_tip");
  }

  get currentId(): string | null {
    return this.current;
  }

  isPlaying(): boolean {
    return this.ws?.isPlaying() ?? false;
  }

  /** Für den Mixer: den Haupt-Player anhalten, damit nicht zwei Quellen gleichzeitig laufen. */
  pause(): void {
    if (this.ws?.isPlaying()) this.ws.pause();
  }

  /** Texte neu setzen (nach Sprachwechsel). */
  refreshTexts(): void {
    this.volume?.update();
    this.renderVersions();
  }

  async play(song: Song, options: PlayOptions = {}): Promise<void> {
    const ws = this.ensureWaveSurfer();
    if (this.current === song.id) {
      await ws.playPause();
      return;
    }
    const seq = ++this.requestSeq;
    const keep = options.keepPosition && this.current !== null;
    const position = keep ? ws.getCurrentTime() : 0;
    const resume = !keep || ws.isPlaying();
    if (ws.isPlaying()) ws.pause();   // der bisherige Song verstummt sofort, nicht erst nach dem Laden des neuen
    this.current = song.id;
    this.currentSong = song;
    this.renderVersions();
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
    if (position > 0) ws.setTime(Math.min(position, Math.max(0, ws.getDuration() - 0.1)));
    if (resume) await ws.play();
    this.onStateChange();
  }

  private ensureWaveSurfer(): WaveSurfer {
    if (this.ws) return this.ws;
    const css = getComputedStyle(document.documentElement);
    const ws = WaveSurfer.create({
      container: "#waveform", height: 44, barWidth: 2, barGap: 1, barRadius: 2, cursorWidth: 0,
      waveColor: css.getPropertyValue("--wave").trim() || "#2b2b36",
      progressColor: css.getPropertyValue("--wave-progress").trim() || "#a78bfa",
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
