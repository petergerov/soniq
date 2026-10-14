// Einzelspuren eines Songs (siehe newfeatures.md). Dateien liegen neben dem Song: <song-id>.<spur>.wav
import { STEM_TRACKS, type Stem, type StemKind, type StemStatus, type StemTrack } from "../../../shared/api.ts";

export interface StemRecord {
  id: string;
  song_id: string;
  track: string;
  kind: string;
  status: string;
  position: number;
  file: string | null;
  message: string | null;
  created_at: string;
  finished_at: string | null;
}

/** Beschreibung je Spur, vor den Stil gesetzt (die Spur allein soll klar benannt sein) */
export const TRACK_PROMPTS: Record<StemTrack, string> = {
  drums: "drums, drum kit, steady groove", percussion: "percussion, shakers and hand drums", bass: "bass, bass line",
  guitar: "guitar", keyboard: "keyboard, piano", synth: "synthesizer", strings: "string section", brass: "brass section",
  woodwinds: "woodwinds", fx: "sound effects, fx", vocals: "lead vocals", backing_vocals: "backing vocals, harmonies",
};

/** Spuren mit Gesang: bekommen die Lyrics, alle anderen "[Instrumental]" */
export const VOCAL_TRACKS: readonly StemTrack[] = ["vocals", "backing_vocals"];

export function isStemTrack(value: unknown): value is StemTrack {
  return STEM_TRACKS.includes(value as StemTrack);
}

/** Spuren in der Reihenfolge "Rhythmus zuerst", ohne Doppelte. */
export function orderTracks(tracks: readonly StemTrack[]): StemTrack[] {
  return STEM_TRACKS.filter((t) => tracks.includes(t));
}

/** Dateiname einer Spur; `kind` unterscheidet z. B. herausgelösten und Ersatz-Bass desselben Songs. */
export function stemFileName(songId: string, track: StemTrack, kind: StemKind): string {
  return kind === "generated" ? `${songId}.${track}.wav` : `${songId}.${kind}.${track}.wav`;
}

export function toStemDto(r: StemRecord): Stem {
  return {
    id: r.id, song_id: r.song_id, track: r.track as StemTrack, kind: r.kind as StemKind, status: r.status as StemStatus,
    position: r.position, message: r.message, url: r.status === "done" && r.file ? `/api/stems/${r.id}/audio` : null,
  };
}
