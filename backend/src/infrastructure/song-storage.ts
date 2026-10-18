// Ablage der fertigen Audiodateien im Song-Ordner (Einstellung oder data/songs).
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isFile } from "./files.ts";

export function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") || path.startsWith("~\\") ? join(homedir(), path.slice(1)) : path;
}

export class SongStorage {
  private readonly defaultDir: string;
  private readonly configuredDir: () => string;

  /** @param configuredDir liefert den eingestellten Ordner ("" = Vorgabe) */
  constructor(defaultDir: string, configuredDir: () => string) {
    this.defaultDir = defaultDir;
    this.configuredDir = configuredDir;
  }

  get defaultDirectory(): string {
    return this.defaultDir;
  }

  async directory(): Promise<string> {
    const custom = this.configuredDir();
    const dir = custom ? expandHome(custom) : this.defaultDir;
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async pathOf(file: string): Promise<string> {
    return join(await this.directory(), file);
  }

  async save(file: string, data: Uint8Array): Promise<void> {
    await writeFile(await this.pathOf(file), data);
  }

  async read(file: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(await this.pathOf(file)));
  }

  async remove(file: string): Promise<void> {
    await rm(await this.pathOf(file), { force: true });
  }

  async exists(file: string): Promise<boolean> {
    return isFile(await this.pathOf(file));
  }

  /** Dateien, deren Name mit prefix beginnt, samt Änderungszeit (ms) */
  async list(prefix: string): Promise<{ file: string; modified: number }[]> {
    const dir = await this.directory();
    const names = (await readdir(dir)).filter((n) => n.startsWith(prefix));
    return Promise.all(names.map(async (file) => ({ file, modified: (await stat(join(dir, file))).mtimeMs })));
  }

  async usage(): Promise<{ count: number; bytes: number }> {
    const dir = await this.directory();
    let count = 0, bytes = 0;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      // Songs heißen <id>.wav/.mp3; Einzelspuren (<id>.<spur>.wav) belegen Platz, zählen aber nicht als Song
      if (/^[^.]+\.(wav|mp3)$/i.test(entry.name)) count++;
      bytes += (await stat(join(dir, entry.name))).size;
    }
    return { count, bytes };
  }

  /** Prüft, ob der Ordner angelegt und beschrieben werden kann. Wirft den Systemfehler. */
  static async ensureWritable(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    const probe = join(dir, ".schreibtest");
    await writeFile(probe, "ok");
    await unlink(probe);
  }

  /** Verschiebt eine Datei, auch über Laufwerksgrenzen hinweg. */
  static async move(from: string, to: string): Promise<void> {
    try {
      await rename(from, to);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
      await copyFile(from, to);
      await unlink(from);
    }
  }

  static resolveDirectory(path: string): { dir: string; absolute: boolean } {
    const expanded = expandHome(path);
    return { dir: resolve(expanded), absolute: isAbsolute(expanded) };
  }
}
