// Wellenform als Balken (Canvas), mit Fortschritt und Klick zum Springen. Zeigt nur an; abgespielt wird über die AudioEngine.

/** Feine Spitzenwerte je Datei, einmal berechnet; daraus entstehen die Balken in jeder Breite */
const PEAK_BINS = 4096;
const peakCache = new WeakMap<AudioBuffer, Float32Array>();

function peaksOf(buffer: AudioBuffer): Float32Array {
  const hit = peakCache.get(buffer);
  if (hit) return hit;
  const peaks = new Float32Array(PEAK_BINS);
  const size = buffer.length / PEAK_BINS;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let b = 0; b < PEAK_BINS; b++) {
      let max = peaks[b]!;
      const end = Math.min(data.length, Math.floor((b + 1) * size));
      for (let i = Math.floor(b * size); i < end; i++) {
        const v = data[i]! < 0 ? -data[i]! : data[i]!;
        if (v > max) max = v;
      }
      peaks[b] = max;
    }
  }
  peakCache.set(buffer, peaks);
  return peaks;
}

export interface WaveformOptions {
  height: number;
  /** Strich an der aktuellen Stelle */
  cursor?: boolean;
  /** Klick auf die Wellenform: Anteil 0…1 */
  onSeek?: (fraction: number) => void;
}

const BAR = 2;
const GAP = 1;

export class Waveform {
  private readonly root: HTMLElement;
  private readonly base: HTMLCanvasElement;
  private readonly progressBox: HTMLElement;
  private readonly progress: HTMLCanvasElement;
  private readonly cursor: HTMLElement | null;
  private readonly observer: ResizeObserver;
  private readonly options: WaveformOptions;
  private buffer: AudioBuffer | null = null;
  private width = 0;

  constructor(container: HTMLElement, options: WaveformOptions) {
    this.options = options;
    this.root = document.createElement("div");
    this.root.className = "wave";
    this.root.style.height = `${options.height}px`;
    this.base = document.createElement("canvas");
    this.progressBox = document.createElement("div");
    this.progressBox.className = "wave-progress";
    this.progress = document.createElement("canvas");
    this.progressBox.appendChild(this.progress);
    this.root.append(this.base, this.progressBox);
    this.cursor = options.cursor ? this.root.appendChild(Object.assign(document.createElement("div"), { className: "wave-cursor" })) : null;
    container.replaceChildren(this.root);
    if (options.onSeek) {
      this.root.classList.add("seekable");
      this.root.addEventListener("click", (e) => {
        const rect = this.root.getBoundingClientRect();
        if (rect.width > 0) options.onSeek!(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
      });
    }
    // Neu zeichnen, wenn sich die Breite ändert (auch beim Aufklappen versteckter Versionen)
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(this.root);
  }

  setBuffer(buffer: AudioBuffer | null): void {
    this.buffer = buffer;
    this.width = 0;
    this.draw();
  }

  /** Anteil 0…1 bis zur aktuellen Stelle */
  setProgress(fraction: number): void {
    const pct = `${Math.min(1, Math.max(0, fraction)) * 100}%`;
    this.progressBox.style.width = pct;
    if (this.cursor) this.cursor.style.left = pct;
  }

  /** Farben neu lesen (Theme) */
  redraw(): void {
    this.width = 0;
    this.draw();
  }

  destroy(): void {
    this.observer.disconnect();
    this.root.remove();
  }

  private draw(): void {
    const width = this.root.clientWidth;
    if (!width || width === this.width) return;
    this.width = width;
    const css = getComputedStyle(document.documentElement);
    this.paint(this.base, width, css.getPropertyValue("--wave").trim() || "#3a3450");
    this.paint(this.progress, width, css.getPropertyValue("--wave-progress").trim() || "#a78bfa");
  }

  /** Balken spiegelbildlich um die Mitte, wie sie lauter werden */
  private paint(canvas: HTMLCanvasElement, width: number, color: string): void {
    const dpr = window.devicePixelRatio || 1;
    const height = this.options.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    if (!this.buffer) return;
    const peaks = peaksOf(this.buffer);
    const bars = Math.max(1, Math.floor(width / (BAR + GAP)));
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < bars; i++) {
      const from = Math.floor((i / bars) * PEAK_BINS);
      const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * PEAK_BINS));
      let max = 0;
      for (let b = from; b < to; b++) if (peaks[b]! > max) max = peaks[b]!;
      const h = Math.max(1, Math.round(Math.min(1, max) * height));
      g.roundRect(i * (BAR + GAP), (height - h) / 2, BAR, h, 1);
    }
    g.fill();
  }
}
