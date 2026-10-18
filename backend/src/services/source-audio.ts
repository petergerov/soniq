// Audio als Vorlage (Cover) oder Klang-Referenz: ein Song der Bibliothek oder eine hochgeladene Datei.
// Hochgeladene Dateien liegen einmal im Song-Ordner (Name aus dem Inhalt), so teilen sich alle Versionen eines
// Auftrags eine Kopie. Gelöscht wird sie mit dem letzten Song, der sie nutzt.
import { createHash } from "node:crypto";
import type { AudioRef, SongParams, SongResultMeta } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { EngineError, type AudioFile } from "../domain/music-engine.ts";
import type { SongRepository } from "../infrastructure/song-repository.ts";
import type { SongStorage } from "../infrastructure/song-storage.ts";
import { wavSeconds } from "../infrastructure/wav.ts";
import { MAX_UPLOAD_BYTES } from "./analysis-service.ts";

/** Mit Punkt im Namen: zählt in der Belegung des Song-Ordners nicht als Song */
const UPLOAD_PREFIX = "upload.";
const UPLOAD_NAME = /^upload\.[0-9a-f]{16}\.(wav|mp3)$/;
/** Nicht genutzte Uploads (hochgeladen, aber nie erzeugt) räumt der Start nach einem Tag weg */
const UNUSED_UPLOAD_MS = 24 * 3600 * 1000;
/** Der Modellserver liest nur WAV und MP3; andere Formate wandelt der Browser vorher in WAV */
const READABLE = /\.(wav|mp3)$/i;

export interface SourceAudioDeps {
  songs: SongRepository;
  storage: SongStorage;
}

/** Hochgeladene Vorlagen in params */
function uploadsOf(params: SongParams): string[] {
  return [params.cover?.source.upload, params.reference?.upload].filter((u): u is string => !!u);
}

export class SourceAudio {
  private readonly deps: SourceAudioDeps;

  constructor(deps: SourceAudioDeps) {
    this.deps = deps;
  }

  /** Datei ablegen; die Antwort geht unverändert als Vorlage in den Auftrag. */
  async upload(file: File): Promise<AudioRef> {
    const name = file.name || "upload.wav";
    if (!READABLE.test(name)) throw new AppError("unsupported_media", "audio_only");
    if (file.size > MAX_UPLOAD_BYTES) throw new AppError("too_large", "too_big");
    const data = new Uint8Array(await file.arrayBuffer());
    const ext = name.toLowerCase().endsWith(".mp3") ? "mp3" : "wav";
    const upload = `${UPLOAD_PREFIX}${createHash("sha256").update(data).digest("hex").slice(0, 16)}.${ext}`;
    if (!(await this.deps.storage.exists(upload))) await this.deps.storage.save(upload, data);
    return { upload, name: name.replace(/\.[^.]+$/, ""), duration: Math.round(wavSeconds(data) * 10) / 10 };
  }

  /**
   * Vorlage für einen Auftrag prüfen: Song fertig und mit Datei, Upload vorhanden. Name und Länge eines Songs
   * kommen aus der Bibliothek, die eines Uploads vom Browser (bei MP3 kennt nur er die Länge).
   */
  async check(ref: AudioRef): Promise<{ ref: AudioRef; meta: SongResultMeta }> {
    if (ref.song_id) {
      const song = this.deps.songs.find(ref.song_id);
      if (!song) throw new AppError("not_found");
      if (song.status !== "done" || !song.file) throw new AppError("bad_request", "source_done_only");
      const meta = (song.result_meta ? JSON.parse(song.result_meta) : {}) as SongResultMeta;
      const duration = meta.duration || (JSON.parse(song.params) as SongParams).duration || 0;
      return { ref: { song_id: song.id, name: song.title || song.caption.slice(0, 40), duration }, meta };
    }
    if (!ref.upload || !UPLOAD_NAME.test(ref.upload) || !(await this.deps.storage.exists(ref.upload))) {
      throw new AppError("bad_request", "source_missing");
    }
    return { ref: { upload: ref.upload, name: ref.name.slice(0, 120), duration: ref.duration }, meta: {} };
  }

  /** Datei für den Modellserver, erst beim Rechnen gelesen. Text wird in der Oberfläche erkannt (shortError). */
  async read(ref: AudioRef): Promise<AudioFile> {
    const file = ref.song_id ? this.deps.songs.find(ref.song_id)?.file : ref.upload;
    if (!file || !(await this.deps.storage.exists(file))) throw new EngineError("Vorlage gelöscht");
    return { data: await this.deps.storage.read(file), name: file };
  }

  /** Nach dem Löschen eines Songs: seine Uploads entfernen, wenn kein anderer Song sie nutzt. */
  async release(params: SongParams): Promise<void> {
    for (const upload of uploadsOf(params)) {
      if (!this.deps.songs.uploadInUse(upload)) await this.deps.storage.remove(upload);
    }
  }

  /** Beim Start: Uploads ohne Song, älter als ein Tag. */
  async removeUnused(now = Date.now()): Promise<void> {
    for (const { file, modified } of await this.deps.storage.list(UPLOAD_PREFIX)) {
      if (UPLOAD_NAME.test(file) && now - modified > UNUSED_UPLOAD_MS && !this.deps.songs.uploadInUse(file)) {
        await this.deps.storage.remove(file);
      }
    }
  }
}
