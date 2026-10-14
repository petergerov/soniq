// Datenzugriff für Songs. Kennt SQL, aber keine Fachregeln darüber hinaus.
import type { SongStatus } from "../../../shared/api.ts";
import type { FolderFilter, SongRecord } from "../domain/song.ts";
import type { Database, SqlParam } from "./database.ts";

export interface NewSong {
  id: string;
  group_id: string;
  created_at: string;
  title: string | null;
  caption: string;
  lyrics: string;
  seed: number;
  params: string;
  folder_id: string | null;
}

export interface SongQuery {
  search?: string;
  favoritesOnly?: boolean;
  /** false = ausgeblendete Songs weglassen; nicht angegeben = alle */
  showHidden?: boolean;
  groupId?: string;
  folder?: FolderFilter;
  limit?: number;
}

export interface FinishedSong {
  file: string;
  engine: string;
  resultMeta: string;
  finishedAt: string;
}

function folderClause(folder: FolderFilter | undefined): { sql: string; params: SqlParam[] } {
  if (folder === "none") return { sql: " AND folder_id IS NULL", params: [] };
  if (folder) return { sql: " AND folder_id=?", params: [folder] };
  return { sql: "", params: [] };
}

export class SongRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Nach einem Absturz hängengebliebene Jobs wieder einreihen. */
  requeueInterrupted(): void {
    this.db.run("UPDATE songs SET status='queued', message=NULL WHERE status='running'");
  }

  insert(s: NewSong): void {
    this.db.run(
      "INSERT INTO songs(id, group_id, created_at, status, title, caption, lyrics, seed, params, folder_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
      s.id, s.group_id, s.created_at, "queued", s.title, s.caption, s.lyrics, s.seed, s.params, s.folder_id,
    );
  }

  find(id: string): SongRecord | undefined {
    return this.db.get<SongRecord>("SELECT * FROM songs WHERE id=?", id);
  }

  list(q: SongQuery): SongRecord[] {
    let sql = "SELECT * FROM songs WHERE 1=1";
    const params: SqlParam[] = [];
    if (q.search) {
      sql += " AND (caption LIKE ? OR lyrics LIKE ? OR title LIKE ?)";
      const like = `%${q.search}%`;
      params.push(like, like, like);
    }
    if (q.favoritesOnly) sql += " AND favorite=1";
    if (q.showHidden === false) sql += " AND hidden=0";
    if (q.groupId) {
      sql += " AND group_id=?";
      params.push(q.groupId);
    }
    const f = folderClause(q.folder);
    sql += `${f.sql} ORDER BY created_at DESC, rowid DESC LIMIT ?`;
    return this.db.all<SongRecord>(sql, ...params, ...f.params, q.limit ?? 500);
  }

  /** Alle Songs (nur ID und Gruppe) in Entstehungsreihenfolge, für die Buchstaben A, B, C … */
  groupsInCreationOrder(): { id: string; group_id: string }[] {
    return this.db.all("SELECT id, group_id FROM songs ORDER BY created_at, rowid");
  }

  finishedInFolder(folder: FolderFilter): SongRecord[] {
    const f = folderClause(folder);
    return this.db.all<SongRecord>(
      `SELECT * FROM songs WHERE status='done' AND file IS NOT NULL${f.sql} ORDER BY created_at, rowid`, ...f.params,
    );
  }

  nextQueued(): SongRecord | undefined {
    return this.db.get<SongRecord>("SELECT * FROM songs WHERE status='queued' ORDER BY created_at, rowid LIMIT 1");
  }

  active(): Pick<SongRecord, "id" | "status" | "message" | "caption">[] {
    return this.db.all("SELECT id, status, message, caption FROM songs WHERE status IN ('queued','running') ORDER BY created_at, rowid");
  }

  countActive(): number {
    return this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM songs WHERE status IN ('queued','running')")?.n ?? 0;
  }

  allFiles(): string[] {
    return this.db.all<{ file: string }>("SELECT file FROM songs WHERE file IS NOT NULL").map((r) => r.file);
  }

  countByFolder(): Map<string | null, number> {
    const rows = this.db.all<{ folder_id: string | null; n: number }>("SELECT folder_id, COUNT(*) AS n FROM songs GROUP BY folder_id");
    return new Map(rows.map((r) => [r.folder_id, r.n]));
  }

  markRunning(id: string): void {
    this.db.run("UPDATE songs SET status='running', message='0:00' WHERE id=?", id);
  }

  setProgress(id: string, message: string): void {
    this.db.run("UPDATE songs SET message=? WHERE id=? AND status='running'", message, id);
  }

  /** Nur wenn der Song noch läuft (nicht zwischendurch abgebrochen wurde). */
  markDone(id: string, r: FinishedSong): boolean {
    return this.db.run(
      "UPDATE songs SET status='done', message=NULL, file=?, engine=?, result_meta=?, finished_at=? WHERE id=? AND status='running'",
      r.file, r.engine, r.resultMeta, r.finishedAt, id,
    ) > 0;
  }

  markError(id: string, message: string, finishedAt: string): void {
    this.db.run("UPDATE songs SET status='error', message=?, finished_at=? WHERE id=?", message, finishedAt, id);
  }

  markCancelled(id: string, finishedAt: string | null): void {
    if (finishedAt) this.db.run("UPDATE songs SET status='cancelled', message=NULL, finished_at=? WHERE id=?", finishedAt, id);
    else this.db.run("UPDATE songs SET status='cancelled' WHERE id=?", id);
  }

  requeue(id: string): void {
    this.db.run("UPDATE songs SET status='queued', message=NULL WHERE id=? AND status IN ('error','cancelled')", id);
  }

  setFavorite(id: string, favorite: boolean): void {
    this.db.run("UPDATE songs SET favorite=? WHERE id=?", favorite ? 1 : 0, id);
  }

  setHidden(id: string, hidden: boolean): void {
    this.db.run("UPDATE songs SET hidden=? WHERE id=?", hidden ? 1 : 0, id);
  }

  setTitle(id: string, title: string | null): void {
    this.db.run("UPDATE songs SET title=? WHERE id=?", title, id);
  }

  setFolder(id: string, folderId: string | null): void {
    this.db.run("UPDATE songs SET folder_id=? WHERE id=?", folderId, id);
  }

  clearFolder(folderId: string): void {
    this.db.run("UPDATE songs SET folder_id=NULL WHERE folder_id=?", folderId);
  }

  delete(id: string): void {
    this.db.run("DELETE FROM songs WHERE id=?", id);
  }

  status(id: string): SongStatus | undefined {
    return this.db.get<{ status: SongStatus }>("SELECT status FROM songs WHERE id=?", id)?.status;
  }
}
