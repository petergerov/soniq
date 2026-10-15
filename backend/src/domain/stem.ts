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

/**
 * Wörter im Stil-Text, die eine *andere* Spur meinen. Bleiben sie in der Lego-Caption,
 * erzeugt die Engine oft einen Mini-Mix (z. B. Drums + Gesang + Bass) — besonders auf Stille.
 */
const TRACK_STYLE_NOISE: Record<StemTrack, RegExp> = {
  drums: /\b(?:drums?|drum\s*kit|drumkit)\b/gi,
  percussion: /\b(?:percussion|shakers?|hand\s*drums?)\b/gi,
  bass: /\b(?:upright\s+bass|double\s+bass|bass\s*line|bass)\b/gi,
  guitar: /\b(?:acoustic\s+)?guitars?\b/gi,
  keyboard: /\b(?:keyboards?|pianos?|keys)\b/gi,
  synth: /\b(?:synths?|synthesizers?)\b/gi,
  strings: /\b(?:string\s+section|strings|violins?|cellos?)\b/gi,
  brass: /\b(?:brass(?:\s+section)?|horns?|trumpets?|trombones?)\b/gi,
  woodwinds: /\b(?:woodwinds?|flutes?|clarinets?|sax(?:ophone)?s?)\b/gi,
  fx: /\b(?:sound\s+effects?|sfx|\bfx\b)\b/gi,
  // Gesang erkennt styleForTrack über VOCAL_TAG (auch "singer-songwriter"); diese beiden Einträge nutzt es nicht
  vocals: /\b(?:(?:female|male|lead|backing)\s+)?vocals?\b|\bsingers?(?!-songwriter)\b|\bsinging\b|\bchoir\b/gi,
  backing_vocals: /\b(?:backing\s+vocals?|harmonies|choir|ad[- ]?libs?)\b/gi,
};

/** Gesang, auch Stimmlagen und Gesangs-Genres ("singer-songwriter" = Sänger mit Gitarre; nicht "alto sax") */
const VOCAL_TAG = /\b(?:vocals?|voices?|singers?|singing|sung|choir|a\s?cappella|falsetto|(?:soprano|alto|tenor|baritone)(?!\s+sax)|rap(?:ping)?|harmon(?:y|ies)|ad[- ]?libs?|lyrics)\b/i;
/** Klang-Wörter (Stil-Regler akustisch ↔ elektronisch): beschreiben die Besetzung des ganzen Songs */
const SOUND_TAG = /^(?:fully acoustic|acoustic|organic|electronic|synthetic)$/i;
/** Instrument-Spuren und ihr Erkennungsmuster (ohne g-Flag: test() soll keinen Zustand behalten) */
const INSTRUMENT_TAGS = STEM_TRACKS.filter((t) => !VOCAL_TRACKS.includes(t))
  .map((t) => [t, new RegExp(TRACK_STYLE_NOISE[t].source, "i")] as const);

/**
 * Teile des Stils (durch Komma getrennt), die zur Spur passen: Stimmung, Genre und Szene bleiben, Gesang nur bei
 * Gesangsspuren, Instrumente nur die eigenen ("upright bass" bleibt beim Bass). Klang-Wörter wie "acoustic" fallen
 * weg, weil sie Instrumente nach sich ziehen. Gemessen (Vorlage "Acoustic Male", Schlagzeug auf Stille, 3 Seeds):
 * tonaler Anteil 200–3000 Hz im Mittel 0,064 statt 0,140 mit dem ganzen Stil (newfeatures.md, Variante G).
 */
export function styleForTrack(track: StemTrack, styleCaption: string): string {
  const vocalTrack = VOCAL_TRACKS.includes(track);
  return styleCaption.split(",").map((p) => p.trim()).filter(Boolean).filter((part) => {
    if (VOCAL_TAG.test(part)) return vocalTrack;
    if (SOUND_TAG.test(part)) return false;
    if (/^instrumental$/i.test(part)) return !vocalTrack;   // hängt legoCaption bei Instrumentenspuren ohnehin an
    const owner = INSTRUMENT_TAGS.find(([, re]) => re.test(part))?.[0];
    return !owner || owner === track;
  }).join(", ");
}

/**
 * Caption für `lego`: Spur zuerst, dann die passenden Stil-Teile; Instrumentenspuren enden mit "instrumental"
 * (das Schlagwort, auf das ACE-Step trainiert ist; "no vocals" wirkt schwächer, weil "vocals" darin vorkommt).
 */
export function legoCaption(track: StemTrack, styleCaption: string): string {
  const parts = [TRACK_PROMPTS[track], styleForTrack(track, styleCaption)];
  if (!VOCAL_TRACKS.includes(track)) parts.push("instrumental");
  return [...new Set(parts.join(", ").split(", ").filter(Boolean))].join(", ");
}

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

/** Hochgeladene Vorlage für Ersetzen/Begleiten, neben den Spuren. */
export function sourceFileName(songId: string, ext = "wav"): string {
  const clean = ext.replace(/^\./, "").toLowerCase() || "wav";
  return `${songId}.source.${clean}`;
}

export function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function toStemDto(r: StemRecord): Stem {
  return {
    id: r.id, song_id: r.song_id, track: r.track as StemTrack, kind: r.kind as StemKind, status: r.status as StemStatus,
    position: r.position, message: r.message, url: r.status === "done" && r.file ? `/api/stems/${r.id}/audio` : null,
  };
}
