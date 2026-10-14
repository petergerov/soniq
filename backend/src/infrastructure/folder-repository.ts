// Datenzugriff für die Ordner der Bibliothek.
import type { Database } from "./database.ts";

export interface FolderRecord {
  id: string;
  name: string;
}

export class FolderRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  list(): FolderRecord[] {
    return this.db.all<FolderRecord>("SELECT id, name FROM folders ORDER BY name COLLATE NOCASE");
  }

  find(id: string): FolderRecord | undefined {
    return this.db.get<FolderRecord>("SELECT id, name FROM folders WHERE id=?", id);
  }

  insert(id: string, name: string, createdAt: string): void {
    this.db.run("INSERT INTO folders(id, name, created_at) VALUES(?,?,?)", id, name, createdAt);
  }

  rename(id: string, name: string): void {
    this.db.run("UPDATE folders SET name=? WHERE id=?", name, id);
  }

  delete(id: string): void {
    this.db.run("DELETE FROM folders WHERE id=?", id);
  }
}
