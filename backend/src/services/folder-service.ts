// Ordner der Bibliothek. Sie existieren nur in der App; die Dateien bleiben, wo sie sind.
import type { FolderOverview } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { newId } from "../domain/ids.ts";
import { nowIso } from "../domain/song.ts";
import type { FolderRecord, FolderRepository } from "../infrastructure/folder-repository.ts";
import type { SongRepository } from "../infrastructure/song-repository.ts";

const MAX_NAME_LENGTH = 60;

function validName(name: string): string {
  const clean = name.trim().slice(0, MAX_NAME_LENGTH);
  if (!clean) throw new AppError("invalid", "no_name");
  return clean;
}

export class FolderService {
  private readonly folders: FolderRepository;
  private readonly songs: SongRepository;

  constructor(folders: FolderRepository, songs: SongRepository) {
    this.folders = folders;
    this.songs = songs;
  }

  overview(): FolderOverview {
    const counts = this.songs.countByFolder();
    const folders = this.folders.list();
    const known = new Set(folders.map((f) => f.id));
    let all = 0, none = 0;
    for (const [folderId, n] of counts) {
      all += n;
      if (folderId === null || !known.has(folderId)) none += n;   // Songs, deren Ordner es nicht mehr gibt, zählen als unsortiert
    }
    return { folders: folders.map((f) => ({ ...f, count: counts.get(f.id) ?? 0 })), all, none };
  }

  create(name: string): FolderRecord {
    const folder = { id: newId(), name: validName(name) };
    this.folders.insert(folder.id, folder.name, nowIso());
    return folder;
  }

  rename(id: string, name: string): FolderRecord {
    const folder = { id, name: validName(name) };
    this.folders.rename(id, folder.name);
    return folder;
  }

  /** Löscht nur den Ordner; seine Songs werden wieder unsortiert. */
  delete(id: string): void {
    this.songs.clearFolder(id);
    this.folders.delete(id);
  }
}
