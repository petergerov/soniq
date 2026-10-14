// Hochgeladenen Song vom Modell beschreiben lassen (Stil, Tempo, Tonart, Lyrics) als Vorschlag fürs Formular.
import type { AnalyzeResult } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { EngineError, type MusicEngineFactory } from "../domain/music-engine.ts";
import type { SettingsRepository } from "../infrastructure/settings-repository.ts";

export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const AUDIO_EXTENSIONS = [".wav", ".mp3", ".flac", ".m4a", ".ogg"];

export class AnalysisService {
  private readonly settings: SettingsRepository;
  private readonly engineFactory: MusicEngineFactory;

  constructor(settings: SettingsRepository, engineFactory: MusicEngineFactory) {
    this.settings = settings;
    this.engineFactory = engineFactory;
  }

  async analyze(file: File): Promise<AnalyzeResult> {
    const name = file.name || "upload";
    if (!file.type.startsWith("audio/") && !AUDIO_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))) {
      throw new AppError("unsupported_media", "audio_only");
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new AppError("too_large", "too_big");
    try {
      const r = await this.engineFactory(this.settings.get()).analyze(file, name);
      return {
        caption: r.caption ?? "",
        lyrics: r.lyrics ?? "",
        bpm: r.bpm || 0,
        keyscale: r.keyscale || "",
        timesignature: r.timesignature ? String(r.timesignature) : "",
        vocal_language: r.vocal_language || "",
        duration: r.duration || 0,
      };
    } catch (e) {
      if (e instanceof EngineError) throw AppError.raw("upstream", e.message || "Analyse fehlgeschlagen");
      throw e;
    }
  }
}
