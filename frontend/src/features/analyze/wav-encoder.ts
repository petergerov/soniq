// Kodiert Samples als WAV (PCM, 16 Bit, Little Endian). Reine Funktion ohne Browser-Abhängigkeit.

const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

export function wavSize(frames: number, channels: number): number {
  return HEADER_BYTES + frames * channels * BYTES_PER_SAMPLE;
}

/** @param channels je Kanal ein Float32Array (-1…1), alle gleich lang */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const frames = channels[0]?.length ?? 0;
  const count = channels.length;
  const buffer = new ArrayBuffer(wavSize(frames, count));
  const view = new DataView(buffer);
  const text = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  const dataBytes = frames * count * BYTES_PER_SAMPLE;

  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);                                   // Größe des fmt-Blocks
  view.setUint16(20, 1, true);                                    // PCM
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * BYTES_PER_SAMPLE, true); // Bytes pro Sekunde
  view.setUint16(32, count * BYTES_PER_SAMPLE, true);             // Bytes pro Frame
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true);                 // Bits pro Sample
  text(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = HEADER_BYTES;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      const s = Math.max(-1, Math.min(1, channel[i]!));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return buffer;
}
