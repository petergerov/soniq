// Vorlagen des Formulars, als ein JSON-Wert in der Tabelle settings (Schlüssel "presets").
import type { Preset } from "../../../shared/api.ts";
import type { Database } from "./database.ts";

const KEY = "presets";

export class PresetRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  list(): Preset[] {
    const row = this.db.get<{ value: string }>("SELECT value FROM settings WHERE key=?", KEY);
    try {
      const parsed: unknown = row ? JSON.parse(row.value) : [];
      return Array.isArray(parsed) ? (parsed as Preset[]) : [];
    } catch {
      return [];
    }
  }

  replaceAll(presets: Preset[]): void {
    this.db.run("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", KEY, JSON.stringify(presets));
  }
}
