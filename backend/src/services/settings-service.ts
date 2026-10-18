// Einstellungen prüfen und speichern; ein neuer Song-Ordner nimmt die vorhandenen Songs mit.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DemucsModel, DitModel, Settings, SettingsView, StemModel } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { DIT_MODELS, effectiveStemModel, STEM_MODELS } from "../domain/music-engine.ts";
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
  /** Demucs-Modelle samt Programm installiert (Stem Separation) */
  demucsAvailable: () => Record<DemucsModel, boolean>;
  /** Programme von demucs.cpp vorhanden */
  demucsSupported: () => boolean;
}

const POSITIVE_NUMBERS = ["timeout_minutes", "poll_interval"] as const;

export class SettingsService {
  private readonly deps: SettingsServiceDeps;

  constructor(deps: SettingsServiceDeps) {
    this.deps = deps;
  }

  view(): SettingsView {
    const s = this.deps.settings.get();
    return {
      ...s,
      stem_model: effectiveStemModel(s.stem_model, (f) => this.has(f)),   // das Modell, mit dem die Spuren tatsächlich rechnen
      songs_dir_default: this.deps.storage.defaultDirectory,
      dit_xl_available: this.has(DIT_MODELS.xl),
      stems_available: Object.values(STEM_MODELS).some((f) => this.has(f)),
      stems_xl_available: this.has(STEM_MODELS.xl),
      demucs: this.deps.demucsAvailable(),
      demucs_supported: this.deps.demucsSupported(),
      packaged: this.deps.packaged,
    };
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
    if ("stem_model" in values) values.stem_model = this.validStemModel(values.stem_model);
    if ("output_format" in values && !isOutputFormat(values.output_format)) throw new AppError("invalid", "bad_format");
    if ("songs_dir" in values) values.songs_dir = await this.changeSongsDir(String(values.songs_dir ?? "").trim());
    return this.deps.settings.save(values as Partial<Settings>);
  }

  private has(file: string): boolean {
    return existsSync(join(this.deps.modelsDir, file));
  }

  private validDit(value: unknown): DitModel {
    const dit: DitModel = value === "xl" ? "xl" : "standard";
    if (dit === "xl" && !this.has(DIT_MODELS.xl)) throw new AppError("bad_request", "xl_missing");
    return dit;
  }

  private validStemModel(value: unknown): StemModel {
    const model: StemModel = value === "xl" ? "xl" : "standard";
    if (model === "xl" && !this.has(STEM_MODELS.xl)) throw new AppError("bad_request", "stems_xl_missing");
    return model;
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
