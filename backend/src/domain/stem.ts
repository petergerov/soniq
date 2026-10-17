// Einzelspuren eines Songs (siehe newfeatures.md). Dateien liegen neben dem Song: <song-id>.<spur>.wav
import { STEM_TRACKS, type Stem, type StemKind, type StemRecipe, type StemStatus, type StemTrack, type VersionRecipe } from "../../../shared/api.ts";
import { GENRE, PIECE_MOOD } from "../../../shared/piece-style.ts";
import { variationTags } from "../../../shared/track-variation.ts";

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
  version: number;
  active: number;
  /** JSON: StemRecipe (nur kind "version") */
  recipe: string | null;
}

/** Beschreibung je Spur, vor den Stil gesetzt (die Spur allein soll klar benannt sein) */
export const TRACK_PROMPTS: Record<StemTrack, string> = {
  drums: "drums, drum kit, steady groove", percussion: "percussion, shakers and hand drums", bass: "bass, bass line",
  guitar: "guitar", keyboard: "keyboard, piano", synth: "synthesizer", strings: "string section", brass: "brass section",
  woodwinds: "woodwinds", fx: "sound effects, fx", vocals: "lead vocals", backing_vocals: "backing vocals, harmonies",
  other: "instruments",   // nur Demucs (Restspur); ACE-Step bekommt sie nie als Spur
};

/** Muster, das nie passt: für die Demucs-Restspur, die in keinem Stil-Text vorkommt */
const NEVER = /(?!)/g;

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
  other: NEVER,
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
 *
 * Analyse-Fließtext (Punkt oder ein Teilstück über 10 Wörter, z. B. `/understand`) wird nicht an den Kommas
 * zerschnitten: Sätze wie "rapid-fire melodic runs, percussive rasgueado …" haben keine Instrument-Marke und
 * landeten sonst in jeder Spur (Ersatz von "Cajun Moon": Schlagzeug fast durchgehend, bass gitarrenartig).
 * Stattdessen bleiben Genre, Stimmungswörter und die eigene Rolle ("supportive acoustic bassline", "cajón").
 */
export function styleForTrack(track: StemTrack, styleCaption: string): string {
  return isProseCaption(styleCaption) ? proseStyleForTrack(track, styleCaption) : tagStyleForTrack(track, styleCaption);
}

function tagStyleForTrack(track: StemTrack, styleCaption: string): string {
  const vocalTrack = VOCAL_TRACKS.includes(track);
  return styleCaption.split(",").map((p) => p.trim()).filter(Boolean).filter((part) => {
    if (VOCAL_TAG.test(part)) return vocalTrack;
    if (SOUND_TAG.test(part)) return false;
    if (/^instrumental$/i.test(part)) return !vocalTrack;   // hängt legoCaption bei Instrumentenspuren ohnehin an
    const owner = INSTRUMENT_TAGS.find(([, re]) => re.test(part))?.[0];
    return !owner || owner === track;
  }).join(", ");
}

/** true, wenn der Stil ein Absatz ist und kein Komma-Stichwortliste. Ein Punkt nur am Ende zählt nicht. */
export function isProseCaption(style: string): boolean {
  return style.split(",").some((raw) => {
    const part = raw.trim().replace(/[.!?]+$/, "");
    const words = part.split(/\s+/).filter(Boolean);
    return words.length > 10 || /[.!?]/.test(part);
  });
}

/** Kurze Rolle nur dieser Spur. Qualifier davor, damit "guitar chord" oder "the guitar work" nicht matchen. */
const TRACK_ROLE: Record<StemTrack, RegExp> = {
  drums: /\b(?:(?:steady|tight|punchy|live|soft|hard|programmed)\s+){0,2}(?:drum\s*kits?|drums)\b/gi,
  percussion: /\b(?:(?:lively|soft|rhythmic|hand)\s+){0,2}hand\s+percussion\b|\b(?:(?:lively|soft|rhythmic)\s+){0,2}percussion\b|\bcaj[oó]ns?\b|\bshakers?\b|\bcongas?\b|\bbongos?\b|\btambourines?\b/gi,
  bass: /\b(?:(?:warm|deep|supportive|walking|funky|soft|round|acoustic|electric|upright|double|synth|sub|pulsing)\s+){1,4}bass(?:(?:\s*-?\s*)?lines?)?\b(?!\s*drums?)|\bbass\s*-?\s*lines?\b/gi,
  guitar: /\b(?:(?:nylon-string|nylon|steel-string|acoustic|electric|lead|rhythm|classical|spanish|fingerstyle)\s+){1,4}guitars?\b/gi,
  keyboard: /\b(?:(?:electric|acoustic|grand|upright|rhodes|soft|honky[-\s]?tonk)\s+){0,3}(?:pianos?|keyboards?|organs?)\b|\brhodes\b/gi,
  synth: /\b(?:(?:warm|analog|analogue|digital|soft|lead|pad)\s+){0,2}(?:synths?|synthesizers?)\b/gi,
  strings: /\b(?:(?:lush|soft|orchestral|soaring)\s+){0,2}(?:string\s+section|strings|violins?|cellos?)\b/gi,
  brass: /\b(?:(?:bright|soft|muted)\s+){0,2}(?:brass(?:\s+section)?|horns?|trumpets?|trombones?|saxophones?)\b/gi,
  woodwinds: /\b(?:(?:soft|breathy)\s+){0,2}(?:woodwinds?|flutes?|clarinets?)\b/gi,
  fx: /\b(?:sound\s+effects?|sfx)\b/gi,
  vocals: /\b(?:(?:soft|powerful|breathy|raspy|soulful|female|male|lead|operatic|whispered|gentle)\s+){0,3}vocals?\b|\b(?:soprano|alto|tenor|baritone)\s+(?:vocals?|voice)\b|\bsinger-songwriters?\b/gi,
  backing_vocals: /\b(?:(?:soft|lush|tight)\s+){0,2}backing\s+vocals?\b|\bharmonies\b|\bchoir\b/gi,
  other: NEVER,
};

interface TextSpan { start: number; end: number; text: string }

function findSpans(re: RegExp, text: string): TextSpan[] {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  return [...text.matchAll(new RegExp(re.source, flags))].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    text: m[0].replace(/\s+/g, " ").trim(),
  }));
}

/** Überlappende Treffer: der längere bleibt ("lively hand percussion" statt "percussion" darin). */
function keepLongest<T extends TextSpan>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const kept: T[] = [];
  for (const span of sorted) {
    if (kept.some((k) => span.start < k.end && span.end > k.start)) continue;
    kept.push(span);
  }
  return kept.sort((a, b) => a.start - b.start);
}

function proseStyleForTrack(track: StemTrack, text: string): string {
  const roles = keepLongest(STEM_TRACKS.flatMap((t) => findSpans(TRACK_ROLE[t], text).map((s) => ({ ...s, track: t }))));
  const blocked = roles.map(({ start, end }) => ({ start, end, text: "" }));
  const own = roles.filter((s) => s.track === track);
  const moods = findSpans(PIECE_MOOD, text).filter((s) => !blocked.some((b) => s.start >= b.start && s.end <= b.end));
  const genres = findSpans(GENRE, text);
  const phrases = [...moods, ...genres, ...own].sort((a, b) => a.start - b.start).map((s) => s.text);
  const seen = new Set<string>();
  return phrases.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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

const ENERGY_WORD = /\b(?:very calm|high energy|calm|energetic|driving|fiery|lively|gentle|mellow|relaxed|upbeat|intense|powerful|soft)\b/i;

/**
 * Caption für eine neue Version (Mixer): Spur, dann die Wünsche (Knöpfe, Regler, Freitext), dann der bereinigte Stil
 * des Songs. Die Wünsche stehen vor dem Stil, damit "acoustic drum kit" nicht hinter einem langen Stil verschwindet;
 * Klang-Wörter wie "acoustic" sind hier ausdrücklich gewollt und laufen deshalb nicht durch styleForTrack.
 */
export function versionCaption(track: StemTrack, recipe: VersionRecipe, styleCaption: string): string {
  let style = styleForTrack(track, styleCaption);
  // Regler "Intensität" gesetzt: Energie-Wörter des Songs würden dagegenhalten ("soft" neben "energetic")
  if (recipe.axes.intensity) style = style.split(",").filter((p) => !ENERGY_WORD.test(p)).join(",");
  const parts = [TRACK_PROMPTS[track], ...variationTags(track, recipe), recipe.text.trim(), style];
  if (!VOCAL_TRACKS.includes(track)) parts.push("instrumental");
  const seen = new Set<string>();
  return parts.join(", ").split(",").map((p) => p.trim()).filter((p) => {
    const key = p.toLowerCase();
    if (!p || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(", ");
}

/** Spurname, den ACE-Step kennt (für lego, extract, complete; die Demucs-Restspur "other" gehört nicht dazu). */
export function isStemTrack(value: unknown): value is StemTrack {
  return (STEM_TRACKS as readonly string[]).includes(value as string);
}

/** Spuren in der Reihenfolge "Rhythmus zuerst", ohne Doppelte. */
export function orderTracks(tracks: readonly StemTrack[]): StemTrack[] {
  return STEM_TRACKS.filter((t) => tracks.includes(t));
}

/** Dateiname einer Spur; `kind` unterscheidet z. B. herausgelösten und Ersatz-Bass desselben Songs. */
export function stemFileName(songId: string, track: StemTrack, kind: StemKind, version = 1): string {
  if (kind === "version") return `${songId}.v${version}.${track}.wav`;
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
    // recipe: Wünsche einer neuen Version; bei herausgelösten Spuren steht dort intern das Trennverfahren
    version: r.version ?? 1, active: !!r.active, recipe: r.kind === "version" && r.recipe ? JSON.parse(r.recipe) as StemRecipe : null,
  };
}
