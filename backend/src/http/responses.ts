// Antworttypen. Ein Handler gibt entweder JSON-Daten zurück oder eine HttpResponse, die sich selbst schreibt.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname } from "node:path";
import { pipeline } from "node:stream/promises";
import type { StoredZip } from "../infrastructure/zip-writer.ts";

export interface HttpResponse {
  send(res: ServerResponse, rangeHeader: string | undefined): Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

export function mimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** Content-Disposition mit Umlauten (RFC 6266/5987). */
export function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

/** Kleine HTML-Seite aus dem Speicher, nie zwischengespeichert. */
export class HtmlResponse implements HttpResponse {
  private readonly html: string;

  constructor(html: string) {
    this.html = html;
  }

  async send(res: ServerResponse): Promise<void> {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(this.html) });
    res.end(this.html);
  }
}

/** Datei mit Unterstützung für Range-Anfragen (Safari spielt Audio sonst nicht ab). */
export class FileResponse implements HttpResponse {
  private readonly path: string;
  private readonly options: { downloadName?: string; cacheControl?: string };

  constructor(path: string, options: { downloadName?: string; cacheControl?: string } = {}) {
    this.path = path;
    this.options = options;
  }

  async send(res: ServerResponse, rangeHeader: string | undefined): Promise<void> {
    const { size } = await stat(this.path);
    const headers: Record<string, string | number> = { "content-type": mimeType(this.path), "accept-ranges": "bytes" };
    if (this.options.downloadName) headers["content-disposition"] = attachment(this.options.downloadName);
    if (this.options.cacheControl) headers["cache-control"] = this.options.cacheControl;

    const range = parseRange(rangeHeader, size);
    if (range === "invalid") {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      res.end();
      return;
    }
    if (range) {
      res.writeHead(206, { ...headers, "content-range": `bytes ${range.start}-${range.end}/${size}`, "content-length": range.end - range.start + 1 });
      await pipeline(createReadStream(this.path, range), res);
      return;
    }
    res.writeHead(200, { ...headers, "content-length": size });
    await pipeline(createReadStream(this.path), res);
  }
}

export class ZipResponse implements HttpResponse {
  private readonly zip: StoredZip;
  private readonly filename: string;

  constructor(zip: StoredZip, filename: string) {
    this.zip = zip;
    this.filename = filename;
  }

  async send(res: ServerResponse): Promise<void> {
    res.writeHead(200, { "content-type": "application/zip", "content-length": this.zip.size, "content-disposition": attachment(this.filename) });
    await this.zip.writeTo(res);
  }
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | "invalid" | undefined {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return undefined;   // fehlt oder mehrere Bereiche: ganze Datei
  let start: number, end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (!suffix) return "invalid";
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : "invalid";
}

export function isHttpResponse(value: unknown): value is HttpResponse {
  return typeof (value as HttpResponse | undefined)?.send === "function";
}
