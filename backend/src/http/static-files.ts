// Liefert die gebaute Oberfläche (frontend/dist) aus.
import { join, normalize, sep } from "node:path";
import { isFile } from "../infrastructure/files.ts";
import { FileResponse, HtmlResponse, type HttpResponse } from "./responses.ts";

/** Solange die Oberfläche noch gebaut wird (erster Start, nach einem Update): Seite, die sich selbst neu lädt. */
const BUILDING_PAGE = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>SONIQ</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#08080b;color:#c4c4cc;font:15px system-ui,sans-serif">
<p>SONIQ is getting ready … this page reloads by itself.</p></body>`;

export class StaticFiles {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Datei zum Pfad, oder undefined. "/" = index.html (fehlt sie noch: Warteseite). Pfade außerhalb des Ordners werden abgelehnt. */
  async resolve(pathname: string): Promise<HttpResponse | undefined> {
    let relative: string;
    try {
      relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
    } catch {
      return undefined;   // kaputte %-Kodierung
    }
    const path = normalize(join(this.dir, relative));
    if (!path.startsWith(this.dir + sep)) return undefined;
    if (!(await isFile(path))) return relative === "index.html" ? new HtmlResponse(BUILDING_PAGE) : undefined;
    // Dateien unter assets/ tragen einen Hash im Namen und ändern sich nie; alles andere immer frisch laden
    const immutable = relative.startsWith("assets/");
    return new FileResponse(path, { cacheControl: immutable ? "public, max-age=31536000, immutable" : "no-cache" });
  }
}
