// Bibliothek lesen und pflegen: Liste, Details, Favoriten/Titel/Ordner, Audiodateien, ZIP-Export.
import { extname } from "node:path";
import type { QueueInfo, Song, SongPatch } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { learnRate, estimateQueue } from "../domain/queue-estimate.ts";
import { assignLetters, cleanFileName, downloadName, nowIso, toSongDto, type FolderFilter } from "../domain/song.ts";
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
  /** Fertige und wartende Einzelspuren je Song */
  stemCounts: () => Map<string, { done: number; pending: number }>;
  /** Spur-Aufträge auf fertigen Songs: Herauslösen und neue Versionen (für Warteschlange und ETA) */
  pendingStemJobs: () => { song_id: string; units: number; duration: number; created_at: string }[];
}

export class LibraryService {
  private readonly deps: LibraryServiceDeps;

  constructor(deps: LibraryServiceDeps) {
    this.deps = deps;
  }

  list(query: SongQuery): Song[] {
    const letters = this.letters();
    const stems = this.deps.stemCounts();
    return this.deps.songs.list(query).map((r) => {
      const c = stems.get(r.id);
      return toSongDto(r, letters, c?.done ?? 0, c?.pending ?? 0);
    });
  }

  get(id: string): Song {
    const r = this.deps.songs.find(id);
    if (!r) throw new AppError("not_found");
    const c = this.deps.stemCounts().get(id);
    return toSongDto(r, undefined, c?.done ?? 0, c?.pending ?? 0);
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
    const archiveName = cleanFileName(named?.name ?? "SONIQ") || "SONIQ";
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
    const extracts = this.deps.pendingStemJobs();
    const runs = this.deps.songs.runRecords();
    const rate = learnRate(runs.finished);
    const extractRuns = extracts.map((e) => ({
      id: e.song_id, status: "queued" as const, created_at: e.created_at, started_at: null, finished_at: null,
      duration: e.duration, units: e.units,
    }));
    return {
      running: active.filter((r) => r.status === "running"),
      queued: active.filter((r) => r.status === "queued").length,
      library: await this.deps.storage.usage(),
      estimates: rate ? estimateQueue([...runs.active, ...extractRuns], rate, nowIso()) : {},
      stem_jobs: extracts.length,
    };
  }

  private letters(): Map<string, string> {
    return assignLetters(this.deps.songs.groupsInCreationOrder());
  }
}
