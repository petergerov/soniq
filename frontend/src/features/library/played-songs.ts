// Merkt sich, welche Songs schon einmal abgespielt wurden: bis dahin zeigt die Bibliothek die Rechenzeit an.
import { storage } from "../../core/storage.ts";

const KEY = "played";

export class PlayedSongs {
  private readonly ids = new Set<string>(storage.getJson<string[]>(KEY, []));

  has(id: string): boolean {
    return this.ids.has(id);
  }

  /** true, wenn der Song bisher nicht abgespielt war. */
  mark(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    storage.setJson(KEY, [...this.ids]);
    return true;
  }
}
