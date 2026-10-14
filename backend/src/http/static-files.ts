// Liefert die gebaute Oberfläche (frontend/dist) aus.
import { join, normalize, sep } from "node:path";
import { isFile } from "../infrastructure/files.ts";
import { FileResponse } from "./responses.ts";

export class StaticFiles {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Datei zum Pfad, oder undefined. "/" = index.html. Pfade außerhalb des Ordners werden abgelehnt. */
  async resolve(pathname: string): Promise<FileResponse | undefined> {
    let relative: string;
    try {
      relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
    } catch {
      return undefined;   // kaputte %-Kodierung
    }
    const path = normalize(join(this.dir, relative));
    if (!path.startsWith(this.dir + sep) || !(await isFile(path))) return undefined;
    // Dateien unter assets/ tragen einen Hash im Namen und ändern sich nie; alles andere immer frisch laden
    const immutable = relative.startsWith("assets/");
    return new FileResponse(path, { cacheControl: immutable ? "public, max-age=31536000, immutable" : "no-cache" });
  }
}
