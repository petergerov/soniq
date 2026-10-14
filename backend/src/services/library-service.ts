// Bibliothek lesen und pflegen: Liste, Details, Favoriten/Titel/Ordner, Audiodateien, ZIP-Export.
import { extname } from "node:path";
import type { QueueInfo, Song, SongPatch } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { assignLetters, cleanFileName, downloadName, toSongDto, type FolderFilter } from "../domain/song.ts";
import type { FolderRepository } from "../infrastructure/folder-repository.ts";
import type { SongQuery, SongRepository } from "../infrastructure/song-repository.ts";
import { isFile } from "../infrastructure/files.ts";
import type { SongStorage } from "../infrastructure/song-storage.ts";
import type { ZipEntry } from "../infrastructure/zip-writer.ts";

export interface AudioFile {
  path: string;
  /** Dateiname zum Herunterladen, sonst undefined (Abspielen im Browser) */
  downloadName: string | undefined;
}

export interface LibraryServiceDeps {
  songs: SongRepository;
  folders: FolderRepository;
  storage: SongStorage;
}

export class LibraryService {
  private readonly deps: LibraryServiceDeps;

  constructor(deps: LibraryServiceDeps) {
    this.deps = deps;
  }

  list(query: SongQuery): Song[] {
    const letters = this.letters();
    return this.deps.songs.list(query).map((r) => toSongDto(r, letters));
  }

  get(id: string): Song {
    const r = this.deps.songs.find(id);
    if (!r) throw new AppError("not_found");
    return toSongDto(r);
  }

  update(id: string, patch: SongPatch): Song {
    const { songs } = this.deps;
    if (patch.favorite !== undefined) songs.setFavorite(id, patch.favorite);
    if (patch.hidden !== undefined) songs.setHidden(id, patch.hidden);
    if (patch.title !== undefined) songs.setTitle(id, patch.title.trim() || null);
    if (patch.folder_id !== undefined) songs.setFolder(id, patch.folder_id || null);
    return this.get(id);
  }

  async audio(id: string, forDownload: boolean): Promise<AudioFile> {
    const r = this.deps.songs.find(id);
    if (!r?.file) throw new AppError("not_found");
    const path = await this.deps.storage.pathOf(r.file);
    if (!(await isFile(path))) throw new AppError("not_found");
    return { path, downloadName: forDownload ? downloadName(r, extname(r.file)) : undefined };
  }

  /** Alle fertigen Songs einer Ansicht (alle / unsortiert / ein Ordner) mit lesbaren Dateinamen. */
  async exportEntries(folder: FolderFilter): Promise<{ archiveName: string; entries: ZipEntry[] }> {
    const rows = [];
    for (const r of this.deps.songs.finishedInFolder(folder)) {
      const path = await this.deps.storage.pathOf(r.file!);
      if (await isFile(path)) rows.push({ r, path });
    }
    if (!rows.length) throw new AppError("not_found", "no_done_songs");
    const named = folder && folder !== "none" ? this.deps.folders.find(folder) : undefined;
    const archiveName = cleanFileName(named?.name ?? "Music Generator") || "Music Generator";
    const letters = this.letters();
    const used = new Set<string>();
    const entries = rows.map(({ r, path }) => {
      const ext = extname(r.file!);
      const base = [cleanFileName(r.title || r.caption.slice(0, 40)) || "Song", letters.get(r.id) ?? ""].filter(Boolean).join(" ");
      let name = `${base}${ext}`;
      if (used.has(name.toLowerCase())) name = `${base} ${r.seed}${ext}`;
      used.add(name.toLowerCase());
      return { name: `${archiveName}/${name}`, path };
    });
    return { archiveName, entries };
  }

  async queue(): Promise<QueueInfo> {
    const active = this.deps.songs.active();
    return {
      running: active.filter((r) => r.status === "running"),
      queued: active.filter((r) => r.status === "queued").length,
      library: await this.deps.storage.usage(),
    };
  }

  private letters(): Map<string, string> {
    return assignLetters(this.deps.songs.groupsInCreationOrder());
  }
}
