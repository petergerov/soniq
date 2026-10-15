// WAV lesen, mischen und schreiben, für Einzelspuren (siehe newfeatures.md). Intern arbeitet alles mit
// Float32 und verschachtelten Kanälen; gelesen werden PCM 16/24 Bit und Float 32 (auch WAVE_FORMAT_EXTENSIBLE),
// so wie ace-server sie schreibt.

export interface Pcm {
  sampleRate: number;
  channels: number;
  /** Verschachtelte Samples (L, R, L, R …), -1 … 1 */
  samples: Float32Array;
}

export type WavDepth = 16 | 24 | 32;

/** Bittiefe der Spuren-WAVs: bei MP3-Ausgabe 16 Bit (gemischt wird trotzdem als WAV). */
export function wavDepthFor(outputFormat: string): WavDepth {
  return outputFormat === "wav24" ? 24 : outputFormat === "wav32" ? 32 : 16;
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

export function parseWav(data: Uint8Array): Pcm {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const text = (pos: number) => String.fromCharCode(data[pos]!, data[pos + 1]!, data[pos + 2]!, data[pos + 3]!);
  if (data.byteLength < 12 || text(0) !== "RIFF" || text(8) !== "WAVE") throw new Error("not a WAV file");
  let format = 0, channels = 0, sampleRate = 0, bits = 0;
  for (let pos = 12; pos + 8 <= data.byteLength;) {
    const id = text(pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === FORMAT_EXTENSIBLE && size >= 40) format = view.getUint16(body + 24, true);
    } else if (id === "data") {
      const end = Math.min(body + size, data.byteLength);
      const bytes = bits / 8;
      const count = Math.floor((end - body) / bytes);
      const samples = new Float32Array(count);
      if (format === FORMAT_PCM && bits === 16) {
        for (let i = 0; i < count; i++) samples[i] = view.getInt16(body + i * 2, true) / 32768;
      } else if (format === FORMAT_PCM && bits === 24) {
        for (let i = 0, p = body; i < count; i++, p += 3) {
          const v = data[p]! | (data[p + 1]! << 8) | (data[p + 2]! << 16);
          samples[i] = ((v << 8) >> 8) / 8388608;
        }
      } else if (format === FORMAT_FLOAT && bits === 32) {
        for (let i = 0; i < count; i++) samples[i] = view.getFloat32(body + i * 4, true);
      } else {
        throw new Error(`unsupported WAV format ${format}/${bits} bit`);
      }
      if (!channels || !sampleRate) throw new Error("WAV without fmt chunk");
      return { sampleRate, channels, samples };
    }
    pos = body + size + (size % 2);   // Chunks sind auf gerade Längen aufgefüllt
  }
  throw new Error("WAV without data chunk");
}

export function encodeWav(pcm: Pcm, depth: WavDepth = 16): Uint8Array {
  const { samples, channels, sampleRate } = pcm;
  const bytes = depth / 8;
  const out = new Uint8Array(44 + samples.length * bytes);
  const view = new DataView(out.buffer);
  const write = (pos: number, s: string) => { for (let i = 0; i < 4; i++) out[pos + i] = s.charCodeAt(i); };
  write(0, "RIFF");
  view.setUint32(4, out.length - 8, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, depth === 32 ? FORMAT_FLOAT : FORMAT_PCM, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytes, true);
  view.setUint16(32, channels * bytes, true);
  view.setUint16(34, depth, true);
  write(36, "data");
  view.setUint32(40, samples.length * bytes, true);
  for (let i = 0, p = 44; i < samples.length; i++, p += bytes) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    if (depth === 32) view.setFloat32(p, s, true);
    else if (depth === 16) view.setInt16(p, Math.round(s * 32767), true);
    else {
      const v = Math.round(s * 8388607);
      out[p] = v & 0xff; out[p + 1] = (v >> 8) & 0xff; out[p + 2] = (v >> 16) & 0xff;
    }
  }
  return out;
}

/** Stille in der Länge eines Songs (Start für "Spur für Spur"). */
export function silence(seconds: number, sampleRate = 48000, channels = 2): Pcm {
  return { sampleRate, channels, samples: new Float32Array(Math.round(seconds * sampleRate) * channels) };
}

/** Summe der Spuren; Länge der längsten, gleiche Rate und Kanäle vorausgesetzt. */
export function mix(tracks: readonly Pcm[]): Pcm {
  const first = tracks[0];
  if (!first) throw new Error("nothing to mix");
  for (const t of tracks) {
    if (t.sampleRate !== first.sampleRate || t.channels !== first.channels) throw new Error("tracks differ in sample rate or channels");
  }
  const samples = new Float32Array(Math.max(...tracks.map((t) => t.samples.length)));
  for (const t of tracks) for (let i = 0; i < t.samples.length; i++) samples[i]! += t.samples[i]!;
  return { sampleRate: first.sampleRate, channels: first.channels, samples };
}

/** Leiser machen, falls die Spitze über `ceiling` liegt (Summen übersteuern sonst). */
export function limitPeak(pcm: Pcm, ceiling = 0.95): Pcm {
  let peak = 0;
  for (const s of pcm.samples) peak = Math.max(peak, Math.abs(s));
  if (peak <= ceiling) return pcm;
  const gain = ceiling / peak;
  return { ...pcm, samples: pcm.samples.map((s) => s * gain) };
}
