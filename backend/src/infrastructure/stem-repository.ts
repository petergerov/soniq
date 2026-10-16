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
  /** nur für kind "version": Nummer, nicht aktiv bis fertig, Wünsche als JSON */
  version?: number;
  recipe?: string;
}

export class StemRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  forSong(songId: string): StemRecord[] {
    return this.db.all<StemRecord>("SELECT * FROM stems WHERE song_id=? ORDER BY position, version, created_at", songId);
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

  /** Nächster fertiger Song mit wartenden Spur-Aufträgen (Herauslösen, neue Versionen); der Song selbst bleibt "done". */
  nextStemJobSongId(): string | undefined {
    return this.db.get<{ song_id: string }>(
      `SELECT st.song_id FROM stems st JOIN songs s ON s.id=st.song_id
       WHERE st.kind IN ('extracted','version') AND st.status='queued' AND s.status NOT IN ('queued','running')
       ORDER BY st.created_at, st.rowid LIMIT 1`,
    )?.song_id;
  }

  /** Spur-Aufträge auf fertigen Songs, für Warteschlange und Zeitschätzung. */
  pendingStemJobs(): { song_id: string; units: number; duration: number; created_at: string }[] {
    return this.db.all(
      `SELECT st.song_id, COUNT(*) AS units, MIN(st.created_at) AS created_at,
              COALESCE(json_extract(s.result_meta,'$.duration'), json_extract(s.params,'$.duration'), 0) AS duration
       FROM stems st JOIN songs s ON s.id=st.song_id
       WHERE st.kind IN ('extracted','version') AND st.status IN ('queued','running') AND s.status NOT IN ('queued','running')
       GROUP BY st.song_id ORDER BY MIN(st.created_at)`,
    );
  }

  /** Höchste Versionsnummer einer Spur (0, wenn es sie nicht gibt). */
  maxVersion(songId: string, track: string): number {
    return this.db.get<{ v: number | null }>("SELECT MAX(version) AS v FROM stems WHERE song_id=? AND track=?", songId, track)?.v ?? 0;
  }

  insert(s: NewStem): void {
    this.db.run("INSERT INTO stems(id, song_id, track, kind, status, position, created_at, version, active, recipe) VALUES(?,?,?,?,'queued',?,?,?,?,?)",
      s.id, s.songId, s.track, s.kind, s.position, s.createdAt, s.version ?? 1, s.kind === "version" ? 0 : 1, s.recipe ?? null);
  }

  /** Diese Version der Spur hörbar machen, alle anderen Versionen derselben Spur nicht. */
  setActive(id: string): void {
    const stem = this.find(id);
    if (!stem) return;
    this.db.run("UPDATE stems SET active=(id=?) WHERE song_id=? AND track=?", id, stem.song_id, stem.track);
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
