// ZIP-Archiv ohne Kompression (WAV lässt sich kaum packen -> nur bündeln), direkt in einen Stream.
// Mit ZIP64, sobald Dateien oder das Archiv größer als 4 GB werden. Die Gesamtgröße steht vorher fest.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32 } from "node:zlib";

export interface ZipEntry {
  /** Pfad innerhalb des Archivs */
  name: string;
  /** Datei auf der Platte */
  path: string;
}

interface PreparedEntry {
  path: string;
  name: Buffer;
  size: number;
  crc: number;
  dosTime: number;
  dosDate: number;
  offset: number;
  local: Buffer;
}

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const FLAG_UTF8 = 0x0800;

function dosDateTime(d: Date): { dosTime: number; dosDate: number } {
  return {
    dosTime: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    dosDate: (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

async function fileCrc32(path: string): Promise<number> {
  let crc = 0;
  for await (const chunk of createReadStream(path)) crc = crc32(chunk as Buffer, crc);
  return crc;
}

function zip64Extra(values: number[]): Buffer {
  if (!values.length) return Buffer.alloc(0);
  const b = Buffer.alloc(4 + 8 * values.length);
  b.writeUInt16LE(0x0001, 0);
  b.writeUInt16LE(8 * values.length, 2);
  values.forEach((v, i) => b.writeBigUInt64LE(BigInt(v), 4 + 8 * i));
  return b;
}

function localHeader(e: Omit<PreparedEntry, "local">): Buffer {
  const big = e.size >= MAX32;
  const extra = big ? zip64Extra([e.size, e.size]) : Buffer.alloc(0);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(big ? 45 : 20, 4);
  h.writeUInt16LE(FLAG_UTF8, 6);
  h.writeUInt16LE(0, 8);                       // gespeichert, nicht komprimiert
  h.writeUInt16LE(e.dosTime, 10);
  h.writeUInt16LE(e.dosDate, 12);
  h.writeUInt32LE(e.crc >>> 0, 14);
  h.writeUInt32LE(big ? MAX32 : e.size, 18);
  h.writeUInt32LE(big ? MAX32 : e.size, 22);
  h.writeUInt16LE(e.name.length, 26);
  h.writeUInt16LE(extra.length, 28);
  return Buffer.concat([h, e.name, extra]);
}

function centralHeader(e: PreparedEntry): Buffer {
  const big = e.size >= MAX32, farOffset = e.offset >= MAX32;
  const extra = zip64Extra([...(big ? [e.size, e.size] : []), ...(farOffset ? [e.offset] : [])]);
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(45, 4);
  h.writeUInt16LE(big || farOffset ? 45 : 20, 6);
  h.writeUInt16LE(FLAG_UTF8, 8);
  h.writeUInt16LE(0, 10);
  h.writeUInt16LE(e.dosTime, 12);
  h.writeUInt16LE(e.dosDate, 14);
  h.writeUInt32LE(e.crc >>> 0, 16);
  h.writeUInt32LE(big ? MAX32 : e.size, 20);
  h.writeUInt32LE(big ? MAX32 : e.size, 24);
  h.writeUInt16LE(e.name.length, 28);
  h.writeUInt16LE(extra.length, 30);
  // Kommentar, Diskette, Attribute bleiben 0
  h.writeUInt32LE(farOffset ? MAX32 : e.offset, 42);
  return Buffer.concat([h, e.name, extra]);
}

function endRecords(count: number, cdOffset: number, cdSize: number): Buffer {
  const needs64 = count >= MAX16 || cdOffset >= MAX32 || cdSize >= MAX32;
  const parts: Buffer[] = [];
  if (needs64) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0);
    z.writeBigUInt64LE(44n, 4);
    z.writeUInt16LE(45, 12);
    z.writeUInt16LE(45, 14);
    z.writeBigUInt64LE(BigInt(count), 24);
    z.writeBigUInt64LE(BigInt(count), 32);
    z.writeBigUInt64LE(BigInt(cdSize), 40);
    z.writeBigUInt64LE(BigInt(cdOffset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);
    loc.writeUInt32LE(1, 16);
    parts.push(z, loc);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(needs64 ? MAX16 : count, 8);
  eocd.writeUInt16LE(needs64 ? MAX16 : count, 10);
  eocd.writeUInt32LE(needs64 ? MAX32 : cdSize, 12);
  eocd.writeUInt32LE(needs64 ? MAX32 : cdOffset, 16);
  parts.push(eocd);
  return Buffer.concat(parts);
}

/** Bereitet ein Archiv vor (Prüfsummen, Größen) und kann es danach in einen Stream schreiben. */
export class StoredZip {
  readonly size: number;
  private readonly entries: PreparedEntry[];
  private readonly trailer: Buffer;

  private constructor(entries: PreparedEntry[], trailer: Buffer, size: number) {
    this.entries = entries;
    this.trailer = trailer;
    this.size = size;
  }

  static async prepare(files: ZipEntry[]): Promise<StoredZip> {
    const entries: PreparedEntry[] = [];
    let offset = 0;
    for (const f of files) {
      const st = await stat(f.path);
      const base = { path: f.path, name: Buffer.from(f.name, "utf8"), size: st.size, crc: await fileCrc32(f.path), ...dosDateTime(st.mtime), offset };
      const local = localHeader(base);
      entries.push({ ...base, local });
      offset += local.length + st.size;
    }
    const central = Buffer.concat(entries.map(centralHeader));
    const trailer = Buffer.concat([central, endRecords(entries.length, offset, central.length)]);
    return new StoredZip(entries, trailer, offset + trailer.length);
  }

  async writeTo(out: Writable): Promise<void> {
    for (const e of this.entries) {
      if (!out.write(e.local)) await new Promise((r) => out.once("drain", r));
      await pipeline(createReadStream(e.path), out, { end: false });
    }
    out.end(this.trailer);
  }
}
