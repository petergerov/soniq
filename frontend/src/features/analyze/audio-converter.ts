// Der Modellserver liest beim Analysieren nur WAV und MP3. Andere Formate (M4A/AAC, FLAC, OGG …)
// dekodiert der Browser und lädt sie als WAV hoch. Ist die WAV-Datei zu groß, wird die Abtastrate gesenkt.
import { encodeWav, wavSize } from "./wav-encoder.ts";

/** Das Format kann dieser Browser nicht dekodieren. */
export class UnsupportedAudioError extends Error {
  override name = "UnsupportedAudioError";
}

/** Upload-Grenze des Servers (60 MB) mit etwas Abstand für die Multipart-Hülle */
const MAX_UPLOAD_BYTES = 58 * 1024 * 1024;
const CHANNELS = 2;
/** Absteigend; die erste passende Rate wird genommen (der Modellserver rechnet ohnehin auf 48 kHz um) */
const SAMPLE_RATES = [48000, 44100, 32000, 24000, 22050, 16000];

async function readsNatively(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const ascii = String.fromCharCode(...head);
  const isWav = ascii === "RIFF";
  // ID3-Tag oder MPEG-Frame (Layer-Bits ≠ 00; AAC-ADTS hat dieselbe Sync-Folge, aber Layer 00)
  const b1 = head[1] ?? 0;
  const isMp3 = ascii.startsWith("ID3") || (head[0] === 0xff && (b1 & 0xe0) === 0xe0 && (b1 & 0x06) !== 0);
  return isWav || isMp3;
}

function targetRate(duration: number, sourceRate: number): number {
  const fitting = SAMPLE_RATES.filter((r) => r <= sourceRate && wavSize(Math.ceil(duration * r), CHANNELS) <= MAX_UPLOAD_BYTES);
  return fitting[0] ?? SAMPLE_RATES[SAMPLE_RATES.length - 1]!;
}

async function decode(file: File): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new UnsupportedAudioError(file.name);
  } finally {
    void ctx.close();
  }
}

/** Stereo mit der gewünschten Abtastrate (Mono wird auf beide Kanäle verteilt). */
async function resample(source: AudioBuffer, rate: number): Promise<AudioBuffer> {
  const offline = new OfflineAudioContext(CHANNELS, Math.ceil(source.duration * rate), rate);
  const node = offline.createBufferSource();
  node.buffer = source;
  node.connect(offline.destination);
  node.start();
  return offline.startRendering();
}

/** Gibt die Datei unverändert zurück, wenn der Server sie lesen kann, sonst eine WAV-Fassung. */
export async function toServerReadableAudio(file: File): Promise<File> {
  if (await readsNatively(file)) return file;
  return toWavAudio(file);
}

/** Immer WAV (Ersetzen/Begleiten mischt die Aufnahme mit neuen Spuren). */
export async function toWavAudio(file: File): Promise<File> {
  return (await wavWithDuration(file)).file;
}

/** WAV plus Länge in Sekunden, gelesen beim Dekodieren — ohne Sprachmodell. */
export async function wavWithDuration(file: File): Promise<{ file: File; duration: number }> {
  const decoded = await decode(file);
  const audio = await resample(decoded, targetRate(decoded.duration, decoded.sampleRate));
  const channels = Array.from({ length: CHANNELS }, (_, i) => audio.getChannelData(i));
  const name = file.name.replace(/\.[^.]*$/, "") + ".wav";
  return { file: new File([encodeWav(channels, audio.sampleRate)], name, { type: "audio/wav" }), duration: decoded.duration };
}
