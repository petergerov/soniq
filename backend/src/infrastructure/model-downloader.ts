// Lädt eine Modelldatei: setzt einen abgebrochenen Download fort (<name>.part), prüft danach die SHA-256
// und benennt erst dann um. Eine falsche Prüfsumme löscht die Teildatei.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export class ChecksumError extends Error {
  override name = "ChecksumError";
}

async function size(path: string): Promise<number> {
  return stat(path).then((s) => s.size, () => 0);
}

async function sha256(path: string, signal: AbortSignal, onProgress?: (bytes: number) => void): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path, { highWaterMark: 4 << 20 });
  if (onProgress) {
    let bytes = 0;
    stream.on("data", (chunk) => onProgress((bytes += chunk.length)));
  }
  await pipeline(stream, hash, { signal });
  return hash.digest("hex");
}

/** Prüft eine vorhandene Modelldatei per SHA-256 (z. B. vom Nutzer hineinkopiert). */
export async function verifyModel(path: string, expectedSha: string, onProgress: (bytes: number) => void, signal: AbortSignal): Promise<boolean> {
  return (await sha256(path, signal, onProgress)) === expectedSha;
}

/**
 * @param onProgress bereits vorhandene Bytes dieser Datei (inklusive fortgesetztem Teil)
 */
export async function downloadModel(
  url: string, dir: string, name: string, expectedSha: string,
  onProgress: (bytes: number) => void, signal: AbortSignal,
): Promise<void> {
  const part = join(dir, `${name}.part`);
  let have = await size(part);
  const res = await fetch(url, { headers: have ? { range: `bytes=${have}-` } : {}, signal });
  if (res.status === 416) {
    // Nichts mehr zu laden: Teildatei ist schon vollständig (z. B. beim Prüfen abgebrochen) oder passt nicht
    onProgress(have);
    if ((await sha256(part, signal)) === expectedSha) return rename(part, join(dir, name));
    await rm(part, { force: true });
    return downloadModel(url, dir, name, expectedSha, onProgress, signal);
  }
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${name}`);
  if (res.status !== 206) have = 0;   // Server kann nicht fortsetzen: von vorn
  let bytes = have;
  onProgress(bytes);
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      onProgress(bytes);
      controller.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as never), createWriteStream(part, { flags: have ? "a" : "w" }), { signal });
  if ((await sha256(part, signal)) !== expectedSha) {
    await rm(part, { force: true });
    throw new ChecksumError(name);
  }
  await rename(part, join(dir, name));
}
