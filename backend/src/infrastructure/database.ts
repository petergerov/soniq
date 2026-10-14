// SQLite-Zugang (eingebautes node:sqlite, keine nativen Zusatzpakete) und Schema-Migration.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export type SqlParam = SQLInputValue;
export type Row = Record<string, unknown>;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS songs (
    id          TEXT PRIMARY KEY,
    group_id    TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL,          -- queued | running | done | error | cancelled
    message     TEXT,
    title       TEXT,
    caption     TEXT NOT NULL,
    lyrics      TEXT,
    seed        INTEGER NOT NULL,
    params      TEXT NOT NULL,          -- JSON: vollständige Anfrage
    result_meta TEXT,                   -- JSON: vom Modell ergänzte Werte (bpm, key, lyrics …)
    engine      TEXT,
    file        TEXT,
    favorite    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_songs_status ON songs(status);
  CREATE INDEX IF NOT EXISTS idx_songs_group ON songs(group_id);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
  -- Einzelspuren eines Songs (siehe newfeatures.md): erzeugt, herausgelöst, Ersatz oder Begleitung
  CREATE TABLE IF NOT EXISTS stems (
    id          TEXT PRIMARY KEY,
    song_id     TEXT NOT NULL,
    track       TEXT NOT NULL,          -- vocals | drums | bass | …
    kind        TEXT NOT NULL,          -- generated | extracted | replacement | accompaniment
    status      TEXT NOT NULL,          -- queued | running | done | error
    position    INTEGER NOT NULL,       -- Reihenfolge (Rhythmus zuerst)
    file        TEXT,
    message     TEXT,
    created_at  TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_stems_song ON stems(song_id);
`;

/** Dünne Hülle um die Datenbank: nur Abfragen, keine Fachlogik (die liegt in den Repositories). */
export class Database {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
  }

  migrate(): void {
    this.db.exec(SCHEMA);
    // Ordner der Bibliothek (nur in der App; die Dateien bleiben, wo sie sind). NULL = unsortiert
    const columns = this.all<{ name: string }>("PRAGMA table_info(songs)").map((c) => c.name);
    if (!columns.includes("folder_id")) this.db.exec("ALTER TABLE songs ADD COLUMN folder_id TEXT");
    // Ausgeblendet: Fehlversuche aus der Liste nehmen, ohne sie zu löschen
    if (!columns.includes("hidden")) this.db.exec("ALTER TABLE songs ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
    // Beginn der Rechenzeit (für die Schätzung der Warteschlange)
    if (!columns.includes("started_at")) this.db.exec("ALTER TABLE songs ADD COLUMN started_at TEXT");
  }

  run(sql: string, ...params: SqlParam[]): number {
    return Number(this.db.prepare(sql).run(...params).changes);
  }

  all<T = Row>(sql: string, ...params: SqlParam[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  get<T = Row>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  close(): void {
    this.db.close();
  }
}
