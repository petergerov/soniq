// Eine Audio-Engine für Player und Mixer (Web Audio). Sie spielt immer genau eine "Szene": einen Song (eine Ebene)
// oder die Spuren im Mixer (mehrere Ebenen, sample-genau gemeinsam gestartet). Ein Szenenwechsel während der
// Wiedergabe blendet an derselben Stelle über, ohne Pause: Wer wechselt, lädt die neuen Ebenen zuerst, die alte
// Szene spielt so lange weiter.

/** Überblendung beim Szenenwechsel und Vorlauf für den gemeinsamen Start */
const CROSSFADE_S = 0.12;
const LEAD_S = 0.03;
/** Zeitkonstante für Lautstärke-Änderungen (gegen Knackser) */
const GAIN_TAU_S = 0.015;
/** Dekodierte Dateien, die ohne Szene im Speicher bleiben (Float32: ein Song von 3 Min. ≈ 70 MB) */
const CACHE_LIMIT_BYTES = 700 * 1024 * 1024;

export interface LayerSpec {
  id: string;
  buffer: AudioBuffer;
  gain: number;
}

export interface ShowOptions {
  /** Startstelle; "continue" = Stelle der bisherigen Szene im Moment des Wechsels */
  at: number | "continue";
  /** Abspielen; "continue" = so wie die bisherige Szene */
  play: boolean | "continue";
}

interface Layer {
  id: string;
  buffer: AudioBuffer;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

interface Scene {
  key: string;
  songId: string;
  bus: GainNode;
  layers: Map<string, Layer>;
}

interface CacheEntry {
  buffer: Promise<AudioBuffer>;
  bytes: number;
  used: number;
}

type Listener = () => void;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private volume = 1;
  private scene: Scene | null = null;
  private playingNow = false;
  /** Bei Wiedergabe: Kontextzeit, zu der `offset` erklang */
  private startedAt = 0;
  private offset = 0;
  private endTimer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly stateListeners = new Set<Listener>();
  private readonly tickListeners = new Set<Listener>();

  constructor() {
    // Browser starten Audio erst nach einer Geste: beim ersten Klick bzw. Tastendruck freischalten
    const unlock = () => { void this.context().resume(); };
    document.addEventListener("pointerdown", unlock, { capture: true });
    document.addEventListener("keydown", unlock, { capture: true });
  }

  // ——— Zustand ———

  get sceneKey(): string | null {
    return this.scene?.key ?? null;
  }

  get songId(): string | null {
    return this.scene?.songId ?? null;
  }

  get playing(): boolean {
    return this.playingNow;
  }

  get position(): number {
    if (!this.playingNow || !this.ctx) return this.offset;
    return Math.min(this.duration, this.offset + Math.max(0, this.ctx.currentTime - this.startedAt));
  }

  get duration(): number {
    let d = 0;
    this.scene?.layers.forEach((l) => { d = Math.max(d, l.buffer.duration); });
    return d;
  }

  /** Start, Pause, Ende, Szenenwechsel */
  onState(listener: Listener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Jeder Bildaufbau während der Wiedergabe, außerdem nach Sprüngen */
  onTick(listener: Listener): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  // ——— Laden ———

  /** Datei laden und dekodieren; bleibt im Speicher, solange Platz ist. */
  load(url: string): Promise<AudioBuffer> {
    const hit = this.cache.get(url);
    if (hit) {
      hit.used = performance.now();
      return hit.buffer;
    }
    const entry = { bytes: 0, used: performance.now() } as CacheEntry;
    entry.buffer = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await this.context().decodeAudioData(await res.arrayBuffer());
      entry.bytes = buffer.length * buffer.numberOfChannels * 4;
      this.trimCache();
      return buffer;
    })();
    entry.buffer.catch(() => { if (this.cache.get(url) === entry) this.cache.delete(url); });
    this.cache.set(url, entry);
    return entry.buffer;
  }

  /** Älteste Einträge verwerfen; was eine Szene gerade spielt, behält sie ohnehin (der Speicher hängt an ihr). */
  private trimCache(): void {
    let total = [...this.cache.values()].reduce((sum, e) => sum + e.bytes, 0);
    const oldest = [...this.cache.entries()].filter(([, e]) => e.bytes > 0).sort((a, b) => a[1].used - b[1].used);
    for (const [url, e] of oldest) {
      if (total <= CACHE_LIMIT_BYTES) break;
      this.cache.delete(url);
      total -= e.bytes;
    }
  }

  // ——— Szenen ———

  /** Neue Szene zeigen. Läuft die alte weiter, blendet die neue an derselben Stelle über. */
  show(key: string, songId: string, layers: LayerSpec[], options: ShowOptions): void {
    const ctx = this.context();
    const old = this.scene;
    const wasPlaying = this.playingNow;
    const at = options.at === "continue" ? this.position : options.at;
    const play = options.play === "continue" ? wasPlaying : options.play;
    const bus = ctx.createGain();
    bus.connect(this.out!);
    const scene: Scene = { key, songId, bus, layers: new Map() };
    for (const spec of layers) scene.layers.set(spec.id, this.createLayer(scene, spec));
    this.scene = scene;
    this.clearEndTimer();

    if (old && wasPlaying && play) {
      // Überblenden: neue Ebenen starten gemeinsam kurz nach jetzt, an der Stelle, die die alte Szene dann erreicht
      const when = ctx.currentTime + LEAD_S;
      const pos = options.at === "continue" ? this.offset + (when - this.startedAt) : at;
      this.offset = Math.min(pos, Math.max(0, this.duration - 0.05));
      this.startedAt = when;
      bus.gain.setValueAtTime(0, when);
      bus.gain.linearRampToValueAtTime(1, when + CROSSFADE_S);
      old.bus.gain.setValueAtTime(1, when);
      old.bus.gain.linearRampToValueAtTime(0, when + CROSSFADE_S);
      old.layers.forEach((l) => l.source?.stop(when + CROSSFADE_S + 0.01));
      setTimeout(() => old.bus.disconnect(), (LEAD_S + CROSSFADE_S) * 1000 + 100);
      scene.layers.forEach((l) => this.startLayer(l, when, this.offset));
      this.armEndTimer();
    } else {
      if (old) this.stopScene(old);
      this.playingNow = false;
      this.offset = Math.min(Math.max(0, at), this.duration);
      if (play && this.offset >= this.duration - 0.05) this.offset = 0;   // am Ende: von vorn
      if (play) this.start();
    }
    this.emitState();
    this.emitTick();
  }

  /** Szene beenden (Stille). */
  clear(): void {
    if (this.scene) this.stopScene(this.scene);
    this.scene = null;
    this.playingNow = false;
    this.offset = 0;
    this.clearEndTimer();
    this.emitState();
  }

  /** Ebene nachträglich dazu (später fertige Version): steigt an der aktuellen Stelle ein. */
  addLayer(key: string, spec: LayerSpec): void {
    const scene = this.scene;
    if (scene?.key !== key || scene.layers.has(spec.id)) return;
    const layer = this.createLayer(scene, spec);
    scene.layers.set(spec.id, layer);
    if (this.playingNow) {
      const when = this.context().currentTime + LEAD_S;
      this.startLayer(layer, when, this.offset + (when - this.startedAt));
      this.armEndTimer();
    }
    this.emitTick();
  }

  removeLayer(key: string, id: string): void {
    const layer = this.scene?.key === key ? this.scene.layers.get(id) : undefined;
    if (!layer) return;
    this.stopLayer(layer);
    layer.gain.disconnect();
    this.scene!.layers.delete(id);
  }

  setGain(key: string, id: string, gain: number): void {
    const layer = this.scene?.key === key ? this.scene.layers.get(id) : undefined;
    if (layer) layer.gain.gain.setTargetAtTime(gain, this.context().currentTime, GAIN_TAU_S);
  }

  /** Gesamtlautstärke (Player-Regler), gilt auch im Mixer */
  setVolume(volume: number): void {
    this.volume = volume;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(volume, this.ctx.currentTime, GAIN_TAU_S);
  }

  // ——— Transport ———

  play(): void {
    if (!this.scene || this.playingNow) return;
    if (this.offset >= this.duration - 0.05) this.offset = 0;   // am Ende: von vorn
    this.start();
    this.emitState();
  }

  pause(): void {
    if (!this.scene || !this.playingNow) return;
    this.offset = this.position;
    this.playingNow = false;
    this.scene.layers.forEach((l) => this.stopLayer(l));
    this.clearEndTimer();
    this.emitState();
    this.emitTick();
  }

  toggle(): void {
    if (this.playingNow) this.pause();
    else this.play();
  }

  seek(time: number): void {
    if (!this.scene) return;
    const t = Math.min(Math.max(0, time), this.duration);
    if (!this.playingNow) {
      this.offset = t;
      this.emitTick();
      return;
    }
    this.scene.layers.forEach((l) => this.stopLayer(l));
    this.offset = t;
    this.start();
    this.emitTick();
  }

  // ——— intern ———

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "playback" });
      this.out = this.ctx.createGain();
      this.out.gain.value = this.volume;
      this.out.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private createLayer(scene: Scene, spec: LayerSpec): Layer {
    const gain = this.context().createGain();
    gain.gain.value = spec.gain;
    gain.connect(scene.bus);
    return { id: spec.id, buffer: spec.buffer, gain, source: null };
  }

  private start(): void {
    const ctx = this.context();
    void ctx.resume();
    const when = ctx.currentTime + LEAD_S;
    this.startedAt = when;
    this.playingNow = true;
    this.scene?.layers.forEach((l) => this.startLayer(l, when, this.offset));
    this.armEndTimer();
    this.loop();
  }

  private startLayer(layer: Layer, when: number, offset: number): void {
    this.stopLayer(layer);
    if (offset >= layer.buffer.duration) return;
    const source = this.context().createBufferSource();
    source.buffer = layer.buffer;
    source.connect(layer.gain);
    source.start(when, Math.max(0, offset));
    layer.source = source;
  }

  private stopLayer(layer: Layer): void {
    if (!layer.source) return;
    try { layer.source.stop(); } catch { /* noch nicht gestartet */ }
    layer.source.disconnect();
    layer.source = null;
  }

  private stopScene(scene: Scene): void {
    scene.layers.forEach((l) => this.stopLayer(l));
    scene.bus.disconnect();
  }

  /** Ende der längsten Ebene: anhalten und am Ende stehen bleiben */
  private armEndTimer(): void {
    this.clearEndTimer();
    const remaining = this.duration - this.position;
    this.endTimer = setTimeout(() => {
      if (!this.playingNow) return;
      if (this.position < this.duration - 0.02) { this.armEndTimer(); return; }
      this.scene?.layers.forEach((l) => this.stopLayer(l));
      this.playingNow = false;
      this.offset = this.duration;
      this.emitState();
      this.emitTick();
    }, Math.max(0, remaining * 1000 + LEAD_S * 1000));
  }

  private clearEndTimer(): void {
    clearTimeout(this.endTimer);
    this.endTimer = undefined;
  }

  private loop(): void {
    cancelAnimationFrame(this.frame);
    const step = () => {
      this.emitTick();
      if (this.playingNow) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private emitState(): void {
    this.stateListeners.forEach((l) => l());
  }

  private emitTick(): void {
    this.tickListeners.forEach((l) => l());
  }
}
