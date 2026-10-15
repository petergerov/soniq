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

  /** Fertige und noch nicht fertige Spuren je Song (für die Bibliothek) */
  counts(): Map<string, { done: number; pending: number }> {
    const rows = this.db.all<{ song_id: string; done: number; pending: number }>(
      "SELECT song_id, SUM(status='done') AS done, SUM(status IN ('queued','running')) AS pending FROM stems GROUP BY song_id",
    );
    return new Map(rows.map((r) => [r.song_id, { done: r.done, pending: r.pending }]));
  }

  /** Nächster fertiger Song mit wartenden Extract-Spuren (der Song selbst bleibt "done"). */
  nextExtractSongId(): string | undefined {
    return this.db.get<{ song_id: string }>(
      `SELECT st.song_id FROM stems st JOIN songs s ON s.id=st.song_id
       WHERE st.kind='extracted' AND st.status='queued' AND s.status NOT IN ('queued','running')
       ORDER BY st.created_at, st.rowid LIMIT 1`,
    )?.song_id;
  }

  /** Extract-Aufträge auf fertigen Songs, für Warteschlange und Zeitschätzung. */
  pendingExtractJobs(): { song_id: string; units: number; duration: number; created_at: string }[] {
    return this.db.all(
      `SELECT st.song_id, COUNT(*) AS units, MIN(st.created_at) AS created_at,
              COALESCE(json_extract(s.result_meta,'$.duration'), json_extract(s.params,'$.duration'), 0) AS duration
       FROM stems st JOIN songs s ON s.id=st.song_id
       WHERE st.kind='extracted' AND st.status IN ('queued','running') AND s.status NOT IN ('queued','running')
       GROUP BY st.song_id ORDER BY MIN(st.created_at)`,
    );
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
