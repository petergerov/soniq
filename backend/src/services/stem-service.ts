// Einzelspuren eines Songs: auflisten, Datei holen, alle als ZIP, mit dem Song löschen (siehe newfeatures.md).
import type { Stem } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { cleanFileName } from "../domain/song.ts";
import { toStemDto } from "../domain/stem.ts";
import { isFile } from "../infrastructure/files.ts";
import type { SongRepository } from "../infrastructure/song-repository.ts";
import type { SongStorage } from "../infrastructure/song-storage.ts";
import type { StemRepository } from "../infrastructure/stem-repository.ts";
import type { ZipEntry } from "../infrastructure/zip-writer.ts";

export interface StemServiceDeps {
  stems: StemRepository;
  songs: SongRepository;
  storage: SongStorage;
}

/** Lesbare Namen der Spuren in Downloads */
const TRACK_LABEL: Record<string, string> = { backing_vocals: "backing vocals", fx: "FX" };
const KIND_SUFFIX: Record<string, string> = { generated: "", extracted: " (extracted)", replacement: " (replacement)", accompaniment: " (accompaniment)" };

export class StemService {
  private readonly deps: StemServiceDeps;

  constructor(deps: StemServiceDeps) {
    this.deps = deps;
  }

  list(songId: string): Stem[] {
    if (!this.deps.songs.find(songId)) throw new AppError("not_found");
    return this.deps.stems.forSong(songId).map(toStemDto);
  }

  async audio(stemId: string, forDownload: boolean): Promise<{ path: string; downloadName: string | undefined }> {
    const stem = this.deps.stems.find(stemId);
    const song = stem && this.deps.songs.find(stem.song_id);
    if (!stem?.file || !song) throw new AppError("not_found");
    const path = await this.deps.storage.pathOf(stem.file);
    if (!(await isFile(path))) throw new AppError("not_found");
    return { path, downloadName: forDownload ? `${this.baseName(song)} - ${this.label(stem)}.wav` : undefined };
  }

  /** Alle fertigen Spuren eines Songs für ein ZIP ("<Titel>/<Spur>.wav"). */
  async zipEntries(songId: string): Promise<{ archiveName: string; entries: ZipEntry[] }> {
    const song = this.deps.songs.find(songId);
    if (!song) throw new AppError("not_found");
    const archiveName = `${this.baseName(song)} - tracks`;
    const entries: ZipEntry[] = [];
    for (const stem of this.deps.stems.forSong(songId)) {
      if (stem.status !== "done" || !stem.file) continue;
      const path = await this.deps.storage.pathOf(stem.file);
      if (await isFile(path)) entries.push({ name: `${archiveName}/${String(stem.position + 1).padStart(2, "0")} ${this.label(stem)}.wav`, path });
    }
    if (!entries.length) throw new AppError("not_found");
    return { archiveName, entries };
  }

  /** Beim Löschen eines Songs: Spuren samt Dateien entfernen. */
  async removeForSong(songId: string): Promise<void> {
    for (const stem of this.deps.stems.forSong(songId)) if (stem.file) await this.deps.storage.remove(stem.file);
    this.deps.stems.deleteForSong(songId);
  }

  private baseName(song: { title: string | null; caption: string }): string {
    return cleanFileName(song.title || song.caption.slice(0, 40)) || "Song";
  }

  private label(stem: { track: string; kind: string }): string {
    return `${TRACK_LABEL[stem.track] ?? stem.track.replaceAll("_", " ")}${KIND_SUFFIX[stem.kind] ?? ""}`;
  }
}
