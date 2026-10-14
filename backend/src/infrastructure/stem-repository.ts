// Datenzugriff für Einzelspuren.
import type { StemKind, StemTrack } from "../../../shared/api.ts";
import type { StemRecord } from "../domain/stem.ts";
import type { Database } from "./database.ts";

export interface NewStem {
  id: string;
  songId: string;
  track: StemTrack;
  kind: StemKind;
  position: number;
  createdAt: string;
}

export class StemRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  forSong(songId: string): StemRecord[] {
    return this.db.all<StemRecord>("SELECT * FROM stems WHERE song_id=? ORDER BY position, created_at", songId);
  }

  find(id: string): StemRecord | undefined {
    return this.db.get<StemRecord>("SELECT * FROM stems WHERE id=?", id);
  }

  /** Anzahl fertiger Spuren je Song (für die Bibliothek) */
  doneCounts(): Map<string, number> {
    const rows = this.db.all<{ song_id: string; n: number }>("SELECT song_id, COUNT(*) AS n FROM stems WHERE status='done' GROUP BY song_id");
    return new Map(rows.map((r) => [r.song_id, r.n]));
  }

  insert(s: NewStem): void {
    this.db.run("INSERT INTO stems(id, song_id, track, kind, status, position, created_at) VALUES(?,?,?,?,'queued',?,?)",
      s.id, s.songId, s.track, s.kind, s.position, s.createdAt);
  }

  markRunning(id: string): void {
    this.db.run("UPDATE stems SET status='running', message=NULL WHERE id=?", id);
  }

  markDone(id: string, file: string, finishedAt: string): void {
    this.db.run("UPDATE stems SET status='done', file=?, message=NULL, finished_at=? WHERE id=?", file, finishedAt, id);
  }

  markError(id: string, message: string, finishedAt: string): void {
    this.db.run("UPDATE stems SET status='error', message=?, finished_at=? WHERE id=?", message, finishedAt, id);
  }

  deleteForSong(songId: string): void {
    this.db.run("DELETE FROM stems WHERE song_id=?", songId);
  }

  delete(id: string): void {
    this.db.run("DELETE FROM stems WHERE id=?", id);
  }
}
