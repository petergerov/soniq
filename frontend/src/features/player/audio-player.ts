// Player-Leiste am unteren Rand mit Wellenform. Spielt über die gemeinsame AudioEngine, die auch der Mixer nutzt:
// Beim Wechsel zwischen Bibliothek und Mixer geht die Wiedergabe ohne Pause weiter.
import type { Song } from "../../../../shared/api.ts";
import { byId, closest } from "../../core/dom.ts";
import { formatDuration } from "../../core/format.ts";
import type { Translate } from "../../i18n/i18n.ts";
import type { PlaybackState } from "../library/song-list.ts";
import type { AudioEngine } from "./audio-engine.ts";
import { VolumeControl } from "./volume-control.ts";
import { Waveform } from "./waveform.ts";

export interface AudioPlayerDeps {
  t: Translate;
  engine: AudioEngine;
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
  /** Ab dieser Stelle (Sekunden) spielen, auch wenn der Song schon läuft (Repaint: Abschnitt vorhören) */
  at?: number;
}

/** Szene der Engine für einen Song im Player */
const sceneKey = (songId: string) => `song:${songId}`;

export class AudioPlayer implements PlaybackState {
  private readonly t: Translate;
  private readonly engine: AudioEngine;
  private readonly deps: AudioPlayerDeps;
  private readonly bar = byId("player");
  private readonly playButton = byId<HTMLButtonElement>("playBtn");
  private readonly title = byId("pTitle");
  private readonly time = byId("pTime");
  private readonly versions = byId("pVersions");
  private wave: Waveform | undefined;
  private volume: VolumeControl | undefined;
  private current: string | null = null;
  private currentSong: Song | null = null;
  /** Stelle des eigenen Songs, solange die Engine etwas anderes spielt (Mixer eines anderen Songs) */
  private parkedAt = 0;
  /** Jede Wiedergabe-Anfrage bekommt eine Nummer: nach dem Laden zählt nur die neueste */
  private requestSeq = 0;

  constructor(deps: AudioPlayerDeps) {
    this.deps = deps;
    this.t = deps.t;
    this.engine = deps.engine;
    this.versions.addEventListener("click", (e) => {
      const id = closest<HTMLElement>(e.target, "[data-version]")?.dataset.version;
      const song = this.currentSong && this.deps.versionsOf(this.currentSong).find((s) => s.id === id);
      if (song && song.id !== this.current) this.deps.onVersionPick(song);
    });
    this.bindSpaceKey();
    this.engine.onState(() => {
      this.updateButton();
      this.deps.onStateChange();
    });
    this.engine.onTick(() => {
      if (!this.follows()) return;
      this.parkedAt = this.engine.position;
      this.showTime(this.engine.position, this.engine.duration);
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
    return this.follows() && this.engine.playing;
  }

  /** Texte neu setzen (nach Sprachwechsel). */
  refreshTexts(): void {
    this.volume?.update();
    this.renderVersions();
  }

  async play(song: Song, options: PlayOptions = {}): Promise<void> {
    this.ensureUi();
    if (this.current === song.id && this.follows()) {
      if (options.at === undefined) return this.engine.toggle();
      this.engine.seek(options.at);
      this.engine.play();
      return;
    }
    const seq = ++this.requestSeq;
    const keep = options.keepPosition === true && this.follows();
    // Derselbe Song (nach dem Mixer eines anderen) macht an seiner Stelle weiter, ein anderer beginnt vorn
    const resumeAt = options.at ?? (this.current === song.id ? this.parkedAt : 0);
    // Ein anderer Song verstummt sofort; beim A/B-Vergleich läuft der bisherige, bis der neue geladen ist
    if (!keep) this.engine.pause();
    this.setSong(song);
    const buffer = await this.load(song, seq);
    if (!buffer) return;
    this.engine.show(sceneKey(song.id), song.id, [{ id: "song", buffer, gain: 1 }],
      keep ? { at: "continue", play: "continue" } : { at: resumeAt, play: true });
  }

  /**
   * Was die Engine gerade für diesen Song spielt (Mixer), im Player an derselben Stelle weiterführen:
   * die Spuren laufen, bis der Song geladen ist, dann blendet die Engine über.
   */
  async takeOver(song: Song): Promise<void> {
    if (!song.url) return;
    this.ensureUi();
    const seq = ++this.requestSeq;
    this.setSong(song);
    const buffer = await this.load(song, seq);
    if (!buffer || this.engine.songId !== song.id) return;
    this.engine.show(sceneKey(song.id), song.id, [{ id: "song", buffer, gain: 1 }], { at: "continue", play: "continue" });
  }

  /** Den eigenen Song wieder bereitstellen (angehalten an seiner Stelle), nachdem die Engine anderes spielte. */
  async restore(): Promise<void> {
    const song = this.currentSong;
    if (!song?.url || this.follows()) return;
    const seq = ++this.requestSeq;
    const buffer = await this.load(song, seq);
    if (!buffer || this.engine.playing) return;
    this.engine.show(sceneKey(song.id), song.id, [{ id: "song", buffer, gain: 1 }], { at: this.parkedAt, play: false });
  }

  /** Spielt die Engine gerade den Song dieses Players (selbst oder als Spuren im Mixer)? */
  private follows(): boolean {
    return this.current !== null && this.engine.songId === this.current;
  }

  private setSong(song: Song): void {
    this.current = song.id;
    this.currentSong = song;
    this.parkedAt = 0;
    this.renderVersions();
    this.bar.hidden = false;
    this.title.textContent = song.title || song.caption;
    this.title.title = `Seed ${song.seed}` + (song.result_meta?.keyscale ? ` · ${song.result_meta.keyscale}` : "");
    this.time.textContent = "…";
    this.wave!.setBuffer(null);
    this.wave!.setProgress(0);
    this.updateButton();
    this.deps.onStateChange();
  }

  private updateButton(): void {
    this.playButton.textContent = this.isPlaying() ? "❚❚" : "▶";
  }

  /** Datei laden; null, wenn inzwischen ein anderer Song gewählt wurde. */
  private async load(song: Song, seq: number): Promise<AudioBuffer | null> {
    try {
      const buffer = await this.engine.load(song.url!);
      if (seq !== this.requestSeq) return null;
      this.wave!.setBuffer(buffer);
      this.showTime(this.follows() ? this.engine.position : this.parkedAt, buffer.duration);
      return buffer;
    } catch (err) {
      if (seq === this.requestSeq) throw err;
      return null;   // abgebrochen, weil inzwischen ein anderer Song gewählt wurde
    }
  }

  private showTime(position: number, duration: number): void {
    this.time.textContent = `${formatDuration(position)} / ${formatDuration(duration)}`;
    this.wave?.setProgress(duration > 0 ? position / duration : 0);
  }

  private ensureUi(): void {
    if (this.wave) return;
    this.wave = new Waveform(byId("waveform"), {
      height: 44,
      onSeek: (f) => { if (this.follows()) this.engine.seek(f * this.engine.duration); },
    });
    this.playButton.onclick = () => {
      if (this.follows()) this.engine.toggle();
      else if (this.currentSong) void this.play(this.currentSong);
    };
    this.volume = new VolumeControl(this.t, (v) => this.engine.setVolume(v));
    this.watchHeight();
  }

  /** Leertaste = Abspielen/Pause (auch im Mixer: dieselbe Wiedergabe), außer beim Tippen oder auf Bedienelementen. */
  private bindSpaceKey(): void {
    document.addEventListener("keydown", (e) => {
      if (e.code !== "Space" || !this.engine.sceneKey || closest(e.target, 'input, textarea, select, button, [role="button"]')) return;
      e.preventDefault();
      this.engine.toggle();
    });
  }

  /** Die Seite hält unten Platz für den Player frei; seine Höhe ändert sich, sobald die Wellenform geladen ist. */
  private watchHeight(): void {
    new ResizeObserver(() => document.documentElement.style.setProperty("--player-h", `${this.bar.offsetHeight}px`)).observe(this.bar);
  }
}
