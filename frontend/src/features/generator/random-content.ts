// Inhalte für die Würfel, die Variation und die Stil-Karten. Reine Funktionen, der Zufall ist austauschbar (Tests).

export type Random = () => number;

/** Stil-Karten, nach Art gruppiert; der Würfel mischt daraus einen Stil. */
export const STYLE_GROUPS = {
  genre: ["trip hop", "downtempo", "dub", "deep house", "techno", "drum and bass", "post-rock", "neo-soul", "dark ambient", "boom bap", "orchestral",
    "pop", "rock", "hip hop", "electronic", "lo-fi", "jazz", "ambient", "synthwave", "acoustic", "cinematic"],
  vocals: ["female vocals", "male vocals"],
  instr: ["piano", "guitar", "808 bass"],
  mood: ["upbeat", "melancholic", "dreamy"],
} as const;

export const STYLE_TAGS: readonly string[] = [...STYLE_GROUPS.genre, ...STYLE_GROUPS.vocals, ...STYLE_GROUPS.instr, ...STYLE_GROUPS.mood];

export const SECTIONS = ["[intro]", "[verse]", "[pre-chorus]", "[chorus]", "[bridge]", "[outro]", "[instrumental]"] as const;

const PROMPT = {
  mood: ["dark", "dreamy", "melancholic", "hypnotic", "warm", "tense", "nostalgic", "euphoric", "lonely", "mysterious", "hopeful", "gritty", "serene", "haunting"],
  scene: ["a late night drive through a neon city", "a rainy afternoon in an empty café", "walking through fog at dawn", "an abandoned space station",
    "a quiet forest after snowfall", "a crowded market at sunset", "floating above the clouds", "a smoky club after midnight", "a desert road at sunrise",
    "an old arcade at closing time", "a lighthouse during a storm", "the last train home", "a rooftop above a sleeping city", "an underwater research lab"],
  detail: ["slow and spacious", "building gradually", "with a steady pulse", "sparse and minimal", "with swelling strings", "slightly dusty and worn",
    "with a soft melodic hook", "with a hypnotic repeating motif", "with deep warm bass", "with distant echoing textures"],
};

const TITLE = {
  adj: ["Midnight", "Velvet", "Neon", "Silent", "Golden", "Hollow", "Electric", "Faded", "Distant", "Crimson", "Slow", "Lunar", "Paper", "Glass", "Amber"],
  noun: ["Static", "Horizon", "Rain", "Echoes", "Signal", "Drift", "Skyline", "Mirror", "Ember", "Tide", "Orbit", "Harbor", "Afterglow", "Motel", "Garden"],
};

export function pick<T>(items: readonly T[], random: Random = Math.random): T {
  return items[Math.floor(random() * items.length)]!;
}

/** Stimmung, Szene, Detail; der Stil bleibt die Wahl des Nutzers. */
export function randomPrompt(random: Random = Math.random): string {
  return `${pick(PROMPT.mood, random)}, ${pick(PROMPT.scene, random)}, ${pick(PROMPT.detail, random)}`;
}

export function randomTitle(random: Random = Math.random): string {
  return `${pick(TITLE.adj, random)} ${pick(TITLE.noun, random)}`;
}

/** Ein bis zwei Genres, ein Instrument, eine Stimmung; Gesang nur, wenn der Song nicht instrumental ist. */
export function randomStyle(withVocals: boolean, random: Random = Math.random): string {
  const parts: string[] = [pick(STYLE_GROUPS.genre, random)];
  if (random() < 0.6) {
    let second: string;
    do second = pick(STYLE_GROUPS.genre, random); while (second === parts[0]);
    parts.push(second);
  }
  parts.push(pick(STYLE_GROUPS.instr, random), pick(STYLE_GROUPS.mood, random));
  if (withVocals) parts.push(pick(STYLE_GROUPS.vocals, random));
  return parts.join(", ");
}

/** Anderer Eintrag derselben Liste als `current` (die Listen haben alle mehr als einen Eintrag). */
function pickOther<T>(items: readonly T[], current: T, random: Random): T {
  let next: T;
  do next = pick(items, random); while (next === current);
  return next;
}

function splitParts(text: string): string[] {
  return text.split(",").map((x) => x.trim()).filter(Boolean);
}

/** Leicht abgewandelter Prompt: ein bekannter Baustein (Stimmung, Szene, Detail) wird getauscht.
 *  Eigener Text bleibt stehen; kennt der Würfel keinen Baustein, hängt er ein Detail an. */
export function varyPrompt(prompt: string, random: Random = Math.random): string {
  const parts = splitParts(prompt);
  if (!parts.length) return randomPrompt(random);
  const known = parts.flatMap((part, i) => {
    const list = Object.values(PROMPT).find((l) => (l as readonly string[]).includes(part));
    return list ? [{ i, list }] : [];
  });
  if (!known.length) return [...parts, pick(PROMPT.detail, random)].join(", ");
  const { i, list } = pick(known, random);
  parts[i] = pickOther(list, parts[i]!, random);
  return parts.join(", ");
}

/** Leicht abgewandelter Stil: meist wird ein bekannter Tag gegen einen derselben Art getauscht,
 *  manchmal kommt ein Instrument oder eine Stimmung dazu. Gesang nur, wenn der Song nicht instrumental ist. */
export function varyStyle(style: string, withVocals: boolean, random: Random = Math.random): string {
  const parts = splitParts(style);
  if (!parts.length) return randomStyle(withVocals, random);
  const has = new Set(parts.map((p) => p.toLowerCase()));
  const groups = (withVocals ? Object.values(STYLE_GROUPS) : [STYLE_GROUPS.genre, STYLE_GROUPS.instr, STYLE_GROUPS.mood]) as readonly (readonly string[])[];
  const known = parts.flatMap((part, i) => {
    const list = groups.find((l) => l.includes(part.toLowerCase()));
    // Nur tauschen, wenn die Gruppe noch einen unbenutzten Eintrag hat
    return list && list.some((t) => !has.has(t)) ? [{ i, list }] : [];
  });
  if (known.length && (parts.length >= 5 || random() < 0.7)) {
    const { i, list } = pick(known, random);
    let next: string;
    do next = pick(list, random); while (has.has(next));
    parts[i] = next;
  } else {
    const free = [...STYLE_GROUPS.instr, ...STYLE_GROUPS.mood].filter((t) => !has.has(t));
    if (free.length) parts.push(pick(free, random));
  }
  return parts.join(", ");
}
