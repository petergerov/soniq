// Inhalte für die Würfel, die Variation, die Prompt-Bausteine und die Stil-Karten.
// Reine Funktionen, der Zufall ist austauschbar (Tests). Alle Texte sind Englisch, weil sie ans Modell gehen.

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

/** Bausteine eines gewürfelten Prompts, in dieser Reihenfolge: Stimmung, Szene, Detail. */
export const PROMPT_BLOCKS = ["mood", "scene", "detail"] as const;
export type PromptBlock = (typeof PROMPT_BLOCKS)[number];

type StyleKind = "genre" | "instr" | "mood";
interface Theme {
  style: Record<StyleKind, readonly string[]>;
  prompt: Record<PromptBlock, readonly string[]>;
}

const GENERAL: Theme = {
  style: { genre: STYLE_GROUPS.genre, instr: STYLE_GROUPS.instr, mood: STYLE_GROUPS.mood },
  prompt: {
    mood: ["dark", "dreamy", "melancholic", "hypnotic", "warm", "tense", "nostalgic", "euphoric", "lonely", "mysterious", "hopeful", "gritty", "serene", "haunting"],
    scene: ["a late night drive through a neon city", "a rainy afternoon in an empty café", "walking through fog at dawn", "an abandoned space station",
      "a quiet forest after snowfall", "a crowded market at sunset", "floating above the clouds", "a smoky club after midnight", "a desert road at sunrise",
      "an old arcade at closing time", "a lighthouse during a storm", "the last train home", "a rooftop above a sleeping city", "an underwater research lab"],
    detail: ["slow and spacious", "building gradually", "with a steady pulse", "sparse and minimal", "with swelling strings", "slightly dusty and worn",
      "with a soft melodic hook", "with a hypnotic repeating motif", "with deep warm bass", "with distant echoing textures"],
  },
};

/** Würfel-Themen: Der Zufall bleibt innerhalb einer passenden Welt. "all" = alles gemischt. */
export const THEMES = {
  all: GENERAL,
  film: {
    style: {
      genre: ["cinematic", "orchestral", "epic score", "neoclassical", "dark ambient"],
      instr: ["strings", "piano", "french horns", "choir", "timpani"],
      mood: ["epic", "tense", "emotional", "mysterious", "triumphant"],
    },
    prompt: {
      mood: ["epic", "tense", "heroic", "haunting", "bittersweet", "majestic"],
      scene: ["the final battle on a frozen plain", "a slow reveal of an ancient city", "a chase through narrow alleys", "the hero returns home",
        "a storm rolling over the sea", "the opening titles of a space saga"],
      detail: ["building to a huge climax", "with swelling strings", "with thundering percussion", "quiet and intimate at first", "with a soaring main theme"],
    },
  },
  club: {
    style: {
      genre: ["house", "techno", "deep house", "tech house", "trance", "drum and bass", "uk garage"],
      instr: ["808 bass", "synth bass", "analog synth", "claps", "rolling hi-hats"],
      mood: ["driving", "euphoric", "hypnotic", "dark", "groovy"],
    },
    prompt: {
      mood: ["euphoric", "hypnotic", "driving", "sweaty", "dark", "glittering"],
      scene: ["a packed warehouse at 3am", "a rooftop party at sunrise", "a strobe-lit basement club", "a festival main stage", "an afterhours in Berlin"],
      detail: ["with a big build-up and drop", "with a pumping four-on-the-floor kick", "with a rolling bassline", "with a hypnotic repeating motif", "with a vocal chop hook"],
    },
  },
  lofi: {
    style: {
      genre: ["lo-fi hip hop", "chillhop", "jazzhop", "downtempo"],
      instr: ["rhodes piano", "dusty drums", "vinyl crackle", "mellow guitar", "soft bass"],
      mood: ["chill", "relaxed", "cozy", "melancholic", "dreamy"],
    },
    prompt: {
      mood: ["cozy", "calm", "sleepy", "nostalgic", "warm", "rainy"],
      scene: ["studying late at night with a cup of tea", "a rainy window in a small apartment", "a quiet library in autumn", "a sunday morning in bed",
        "a slow walk through the park"],
      detail: ["slightly dusty and worn", "with soft vinyl crackle", "with a lazy swing", "with a soft melodic hook", "sparse and minimal"],
    },
  },
  eighties: {
    style: {
      genre: ["synthwave", "synth-pop", "new wave", "italo disco", "retrowave"],
      instr: ["analog synth", "gated reverb drums", "DX7 bass", "electric guitar", "saxophone"],
      mood: ["nostalgic", "upbeat", "neon", "romantic", "dramatic"],
    },
    prompt: {
      mood: ["nostalgic", "neon", "romantic", "electric", "dramatic"],
      scene: ["a late night drive through a neon city", "an old arcade at closing time", "a VHS montage of a summer romance",
        "a sunset over a palm-lined boulevard", "a shopping mall in 1986"],
      detail: ["with gated reverb drums", "with shimmering arpeggios", "with a big saxophone solo", "with a catchy synth hook", "with deep warm bass"],
    },
  },
  acoustic: {
    style: {
      genre: ["acoustic", "folk", "singer-songwriter", "indie folk", "bluegrass", "acoustic pop"],
      instr: ["acoustic guitar", "fingerpicked guitar", "upright bass", "violin", "harmonica", "cajon"],
      mood: ["warm", "intimate", "heartfelt", "nostalgic", "uplifting"],
    },
    prompt: {
      mood: ["warm", "intimate", "heartfelt", "wistful", "hopeful", "tender"],
      scene: ["a campfire under the stars", "a porch on a summer evening", "a small wooden cabin in the mountains", "a train window in the countryside",
        "a quiet kitchen on a sunday morning", "an open road through golden fields"],
      detail: ["with gentle fingerpicking", "stripped back and close", "with soft harmonies", "with a slow swaying rhythm", "recorded live in one take"],
    },
  },
  ambient: {
    style: {
      genre: ["ambient", "dark ambient", "drone", "new age", "post-rock"],
      instr: ["pads", "field recordings", "soft piano", "bowed strings", "granular textures"],
      mood: ["serene", "meditative", "ethereal", "dreamy", "vast"],
    },
    prompt: {
      mood: ["serene", "weightless", "meditative", "vast", "ethereal"],
      scene: ["floating above the clouds", "a quiet forest after snowfall", "an empty beach at dawn", "drifting through deep space", "a cathedral full of light"],
      detail: ["slow and spacious", "with distant echoing textures", "evolving very slowly", "without drums", "with long reverb tails"],
    },
  },
  hiphop: {
    style: {
      genre: ["boom bap", "trap", "hip hop", "g-funk", "drill"],
      instr: ["808 bass", "sampled soul chops", "hard drums", "piano loop", "scratches"],
      mood: ["gritty", "confident", "dark", "laid-back", "hard"],
    },
    prompt: {
      mood: ["gritty", "confident", "laid-back", "dark", "triumphant"],
      scene: ["a corner store at midnight", "a cypher in a parking lot", "a drive through the city in summer", "a smoky studio session",
        "the view from a project rooftop"],
      detail: ["with hard-hitting drums", "with a dusty sampled loop", "with deep 808s", "with a head-nodding groove", "with a sparse dark melody"],
    },
  },
} satisfies Record<string, Theme>;

export type ThemeId = keyof typeof THEMES;
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && Object.hasOwn(THEMES, value);
}

const ALL_THEMES: readonly Theme[] = Object.values(THEMES);

/** Alle bekannten Einträge eines Bausteins über alle Themen (zum Wiedererkennen im Text). */
function knownBlock(block: PromptBlock): Set<string> {
  return new Set(ALL_THEMES.flatMap((th) => th.prompt[block]));
}

function knownStyle(kind: StyleKind | "vocals"): Set<string> {
  if (kind === "vocals") return new Set(STYLE_GROUPS.vocals);
  return new Set(ALL_THEMES.flatMap((th) => th.style[kind]).map((t) => t.toLowerCase()));
}

const TITLE = {
  adj: ["Midnight", "Velvet", "Neon", "Silent", "Golden", "Hollow", "Electric", "Faded", "Distant", "Crimson", "Slow", "Lunar", "Paper", "Glass", "Amber"],
  noun: ["Static", "Horizon", "Rain", "Echoes", "Signal", "Drift", "Skyline", "Mirror", "Ember", "Tide", "Orbit", "Harbor", "Afterglow", "Motel", "Garden"],
};

export function pick<T>(items: readonly T[], random: Random = Math.random): T {
  return items[Math.floor(random() * items.length)]!;
}

function splitParts(text: string): string[] {
  return text.split(",").map((x) => x.trim()).filter(Boolean);
}

/** Stimmung, Szene, Detail; der Stil bleibt die Wahl des Nutzers. */
export function randomPrompt(theme: ThemeId = "all", random: Random = Math.random): string {
  const p = THEMES[theme].prompt;
  return PROMPT_BLOCKS.map((b) => pick(p[b], random)).join(", ");
}

export function randomTitle(random: Random = Math.random): string {
  return `${pick(TITLE.adj, random)} ${pick(TITLE.noun, random)}`;
}

/** Ein bis zwei Genres, ein Instrument, eine Stimmung; Gesang nur, wenn der Song nicht instrumental ist. */
export function randomStyle(withVocals: boolean, theme: ThemeId = "all", random: Random = Math.random): string {
  const s = THEMES[theme].style;
  const parts: string[] = [pick(s.genre, random)];
  if (random() < 0.6) {
    let second: string;
    do second = pick(s.genre, random); while (second === parts[0]);
    parts.push(second);
  }
  parts.push(pick(s.instr, random), pick(s.mood, random));
  if (withVocals) parts.push(pick(STYLE_GROUPS.vocals, random));
  return parts.join(", ");
}

/** Erkannter Wert eines Bausteins im Prompt ("" = keiner). */
export function promptBlock(prompt: string, block: PromptBlock): string {
  const known = knownBlock(block);
  return splitParts(prompt).find((p) => known.has(p)) ?? "";
}

/** Baustein im Prompt ersetzen, einfügen ("" = entfernen). Eigener Text bleibt stehen.
 *  Neue Bausteine landen an ihrer üblichen Stelle: Stimmung vorn, Detail hinten, Szene nach der Stimmung. */
export function setPromptBlock(prompt: string, block: PromptBlock, value: string): string {
  const parts = splitParts(prompt);
  const known = knownBlock(block);
  const i = parts.findIndex((p) => known.has(p));
  if (i >= 0) {
    if (value) parts[i] = value;
    else parts.splice(i, 1);
  } else if (value) {
    if (block === "mood") parts.unshift(value);
    else if (block === "detail") parts.push(value);
    else {
      const mood = parts.findIndex((p) => knownBlock("mood").has(p));
      parts.splice(mood + 1, 0, value);
    }
  }
  return parts.join(", ");
}

/** Auswahl für einen Baustein: die Einträge des Themas, ein schon gewählter fremder Wert bleibt vorn dabei. */
export function blockOptions(block: PromptBlock, theme: ThemeId, current = ""): string[] {
  const list = [...THEMES[theme].prompt[block]];
  return current && !list.includes(current) ? [current, ...list] : list;
}

/** Ein Baustein neu gewürfelt (anderer Wert als bisher, wenn möglich). */
export function rollPromptBlock(prompt: string, block: PromptBlock, theme: ThemeId = "all", random: Random = Math.random): string {
  const current = promptBlock(prompt, block);
  const list = THEMES[theme].prompt[block].filter((v) => v !== current);
  return setPromptBlock(prompt, block, pick(list, random));
}

/** Leicht abgewandelter Prompt: ein bekannter Baustein (Stimmung, Szene, Detail) wird getauscht.
 *  Eigener Text bleibt stehen; kennt der Würfel keinen Baustein, hängt er ein Detail an. */
export function varyPrompt(prompt: string, theme: ThemeId = "all", random: Random = Math.random): string {
  if (!splitParts(prompt).length) return randomPrompt(theme, random);
  const present = PROMPT_BLOCKS.filter((b) => promptBlock(prompt, b));
  if (!present.length) return setPromptBlock(prompt, "detail", pick(THEMES[theme].prompt.detail, random));
  return rollPromptBlock(prompt, pick(present, random), theme, random);
}

/** Leicht abgewandelter Stil: meist wird ein bekannter Tag gegen einen derselben Art getauscht,
 *  manchmal kommt ein Instrument oder eine Stimmung dazu. Gesang nur, wenn der Song nicht instrumental ist. */
export function varyStyle(style: string, withVocals: boolean, theme: ThemeId = "all", random: Random = Math.random): string {
  const parts = splitParts(style);
  if (!parts.length) return randomStyle(withVocals, theme, random);
  const has = new Set(parts.map((p) => p.toLowerCase()));
  const pools: Record<StyleKind | "vocals", readonly string[]> = { ...THEMES[theme].style, vocals: STYLE_GROUPS.vocals };
  const kinds = (withVocals ? ["genre", "instr", "mood", "vocals"] : ["genre", "instr", "mood"]) as (StyleKind | "vocals")[];
  const known = parts.flatMap((part, i) => {
    const kind = kinds.find((k) => knownStyle(k).has(part.toLowerCase()));
    // Nur tauschen, wenn das Thema für diese Art noch einen unbenutzten Eintrag hat
    const free = kind ? pools[kind].filter((t) => !has.has(t.toLowerCase())) : [];
    return free.length ? [{ i, free }] : [];
  });
  if (known.length && (parts.length >= 5 || random() < 0.7)) {
    const { i, free } = pick(known, random);
    parts[i] = pick(free, random);
  } else {
    const free = [...pools.instr, ...pools.mood].filter((t) => !has.has(t.toLowerCase()));
    if (free.length) parts.push(pick(free, random));
  }
  return parts.join(", ");
}
