// Einstellungen prüfen und speichern; ein neuer Song-Ordner nimmt die vorhandenen Songs mit.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DitModel, Settings, SettingsView } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { DIT_MODELS } from "../domain/music-engine.ts";
import { isOutputFormat } from "../domain/output-format.ts";
import type { SettingsRepository } from "../infrastructure/settings-repository.ts";
import type { SongRepository } from "../infrastructure/song-repository.ts";
import { SongStorage } from "../infrastructure/song-storage.ts";

export interface SettingsServiceDeps {
  settings: SettingsRepository;
  songs: SongRepository;
  storage: SongStorage;
  modelsDir: string;
  packaged: boolean;
}

const POSITIVE_NUMBERS = ["timeout_minutes", "poll_interval"] as const;

export class SettingsService {
  private readonly deps: SettingsServiceDeps;

  constructor(deps: SettingsServiceDeps) {
    this.deps = deps;
  }

  view(): SettingsView {
    return { ...this.deps.settings.get(), songs_dir_default: this.deps.storage.defaultDirectory, dit_xl_available: this.xlAvailable(), packaged: this.deps.packaged };
  }

  async update(input: Record<string, unknown>): Promise<Settings> {
    const values: Record<string, unknown> = { ...input };
    // Zahlen prüfen: ein Textwert würde später jede Erzeugung abbrechen
    for (const field of POSITIVE_NUMBERS) {
      if (!(field in values)) continue;
      const n = typeof values[field] === "number" || typeof values[field] === "string" ? Number(values[field]) : NaN;
      if (!(n > 0) || !Number.isFinite(n)) throw new AppError("invalid", "bad_number", { field });
      values[field] = n;
    }
    if ("dit" in values) values.dit = this.validDit(values.dit);
    if ("output_format" in values && !isOutputFormat(values.output_format)) throw new AppError("invalid", "bad_format");
    if ("songs_dir" in values) values.songs_dir = await this.changeSongsDir(String(values.songs_dir ?? "").trim());
    return this.deps.settings.save(values as Partial<Settings>);
  }

  private xlAvailable(): boolean {
    return existsSync(join(this.deps.modelsDir, DIT_MODELS.xl));
  }

  private validDit(value: unknown): DitModel {
    const dit: DitModel = value === "xl" ? "xl" : "standard";
    if (dit === "xl" && !this.xlAvailable()) throw new AppError("bad_request", "xl_missing");
    return dit;
  }

  /** Prüft und legt den Ordner an, verschiebt vorhandene Songs. Gibt den zu speichernden Wert zurück. */
  private async changeSongsDir(requested: string): Promise<string> {
    const { storage, songs } = this.deps;
    const defaultDir = SongStorage.resolveDirectory(storage.defaultDirectory).dir;
    const target = requested ? SongStorage.resolveDirectory(requested) : { dir: defaultDir, absolute: true };
    if (!target.absolute) throw new AppError("bad_request", "path_abs");
    try {
      await SongStorage.ensureWritable(target.dir);
    } catch (e) {
      throw new AppError("bad_request", "folder_unusable", { e: (e as Error).message });
    }
    const current = SongStorage.resolveDirectory(await storage.directory()).dir;
    if (target.dir !== current) {
      if (songs.countActive()) throw new AppError("conflict", "busy");
      for (const file of songs.allFiles()) {
        const from = join(current, file), to = join(target.dir, file);
        if (!existsSync(from) || existsSync(to)) continue;
        try {
          await SongStorage.move(from, to);
        } catch (e) {
          throw new AppError("bad_request", "move_failed", { f: file, e: (e as Error).message });
        }
      }
    }
    return target.dir === defaultDir ? "" : target.dir;
  }
}
