// Stimme: Geschlecht und Art des Gesangs als Begriffe im Stil-Feld (gehen ans Modell, daher Englisch).
// Wie die Stil-Regler: jede Auswahl ersetzt nur ihren eigenen Begriff, "" = Auto (schreibt nichts).
import { styleParts } from "./style-axes.ts";

export const VOICE_GENDERS = { female: "female vocals", male: "male vocals", duet: "male and female vocals" } as const;

/** Stimmlagen und Charakter; die Reihenfolge ist die der Auswahlliste. */
export const VOICE_RANGES = { soprano: "soprano", alto: "alto", tenor: "tenor", baritone: "baritone", bass: "bass voice" } as const;
export const VOICE_CHARACTERS = {
  soft: "soft vocals", powerful: "powerful vocals", breathy: "breathy vocals", raspy: "raspy vocals", soulful: "soulful vocals",
  falsetto: "falsetto", whispered: "whispered vocals", operatic: "operatic vocals", rap: "rap vocals", choir: "choir",
  autotune: "auto-tuned vocals",
} as const;

const TERMS = {
  gender: VOICE_GENDERS as Record<string, string>,
  type: { ...VOICE_RANGES, ...VOICE_CHARACTERS } as Record<string, string>,
};
export type VoiceKind = keyof typeof TERMS;

function idOf(kind: VoiceKind, part: string): string | undefined {
  const term = part.toLowerCase();
  return Object.keys(TERMS[kind]).find((id) => TERMS[kind][id] === term);
}

/** Auswahl, die der Stil-Text enthält ("" = Auto). */
export function voiceValue(style: string, kind: VoiceKind): string {
  for (const p of styleParts(style)) {
    const id = idOf(kind, p);
    if (id) return id;
  }
  return "";
}

/** Begriff setzen: alten raus, neuen (außer Auto) hinten anhängen. */
export function setVoice(style: string, kind: VoiceKind, id: string): string {
  const rest = styleParts(style).filter((p) => !idOf(kind, p));
  const word = TERMS[kind][id];
  return (word ? [...rest, word] : rest).join(", ");
}
