// Kurzer Stil aus einem Analyse-Absatz: Stimmung und Genre, ohne die Beschreibung einzelner Instrumente.
// Dieselbe Liste nutzt die Lego-Caption (backend/src/domain/stem.ts).

/** Stimmung des ganzen Stücks. Klang-Wörter (acoustic, electronic, …) bewusst nicht: die ziehen fremde Instrumente nach. */
export const PIECE_MOOD = /\b(?:very calm|high energy|very dark|calm|energetic|bright|sunny|dark|warm|intimate|mellow|upbeat|groovy|melancholic|gentle|relaxed|sparse|soulful|driving|fiery|lively|playful|dreamy|nostalgic)\b/gi;

export const GENRE = /\b(?:flamenco|jazz|blues|rock|pop|folk|country|hip[-\s]?hop|reggae|funk|soul|r\s*&\s*b|disco|house|techno|trance|ambient|classical|latin|salsa|samba|bossa(?:\s+nova)?|metal|punk|indie|lo[-\s]?fi|cinematic|orchestral|bluegrass|swing|gospel|afrobeat|k[-\s]?pop|j[-\s]?pop|waltz|cajun|zydeco|bebop|fusion)\b/gi;

interface TextSpan { start: number; end: number; text: string }

function findSpans(re: RegExp, text: string): TextSpan[] {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  return [...text.matchAll(new RegExp(re.source, flags))].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    text: m[0].replace(/\s+/g, " ").trim(),
  }));
}

/** "energetic, fiery, flamenco" aus einem Analyse-Absatz. Leer, wenn nichts davon vorkommt. */
export function pieceStyle(text: string): string {
  const phrases = [...findSpans(PIECE_MOOD, text), ...findSpans(GENRE, text)]
    .sort((a, b) => a.start - b.start)
    .map((s) => s.text);
  const seen = new Set<string>();
  return phrases.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(", ");
}
