// Fachliche Regeln rund um Songs, unabhängig von Datenbank und HTTP.
import type { Song, SongParams, SongResultMeta, SongStatus } from "../../../shared/api.ts";

/** Ein Song, wie er in der Datenbank steht (JSON-Felder noch als Text). */
export interface SongRecord {
  id: string;
  group_id: string;
  created_at: string;
  finished_at: string | null;
  status: SongStatus;
  message: string | null;
  title: string | null;
  caption: string;
  lyrics: string | null;
  seed: number;
  params: string;
  result_meta: string | null;
  engine: string | null;
  file: string | null;
  favorite: number;
  folder_id: string | null;
  hidden: number;
}

export const ACTIVE_STATUSES: readonly SongStatus[] = ["queued", "running"];
export const RETRYABLE_STATUSES: readonly SongStatus[] = ["error", "cancelled"];

export const INSTRUMENTAL = "[Instrumental]";

/** Ansicht der Bibliothek: "" = alle, "none" = unsortiert, sonst eine Ordner-ID. */
export type FolderFilter = "" | "none" | (string & {});

/** Versionen desselben Prompts heißen in Entstehungsreihenfolge A, B, C … (über alle Ordner hinweg). */
export function assignLetters(songsInCreationOrder: readonly { id: string; group_id: string }[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const s of songsInCreationOrder) {
    const ids = groups.get(s.group_id) ?? [];
    ids.push(s.id);
    groups.set(s.group_id, ids);
  }
  const letters = new Map<string, string>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    ids.slice(0, 26).forEach((id, i) => letters.set(id, String.fromCharCode(65 + i)));
  }
  return letters;
}

export function toSongDto(r: SongRecord, letters?: Map<string, string>): Song {
  return {
    ...r,
    letter: letters?.get(r.id) ?? "",
    params: JSON.parse(r.params) as SongParams,
    result_meta: r.result_meta ? (JSON.parse(r.result_meta) as SongResultMeta) : null,
    favorite: Boolean(r.favorite),
    hidden: Boolean(r.hidden),
    url: r.file ? `/api/songs/${r.id}/audio` : null,
  };
}

/** Teil eines Dateinamens: nur Buchstaben, Ziffern, _ - und Leerzeichen. */
export function cleanFileName(text: string): string {
  return text.replace(/[^\p{L}\p{N}_\- ]+/gu, "").trim();
}

/** Lesbarer Name zum Herunterladen eines einzelnen Songs. */
export function downloadName(song: Pick<SongRecord, "title" | "caption" | "seed">, extension: string): string {
  const base = cleanFileName(song.title || song.caption.slice(0, 40)).replaceAll(" ", "_") || "song";
  return `${base}_${song.seed}${extension}`;
}

export function nowIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
