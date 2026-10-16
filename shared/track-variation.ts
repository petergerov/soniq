// Neue Version einer Spur (Mixer): Regler und Schnellwahl-Knöpfe werden zu englischen Stichworten für die Caption.
// Dieselben Tabellen nutzen der Server (Caption für `lego`) und die Oberfläche (Vorschau, Knöpfe).
import { VARIATION_AXES, type StemTrack, type VariationAxis, type VersionRecipe } from "./api.ts";

/** Regler laufen von −AXIS_MAX bis +AXIS_MAX, 0 = wie bisher (keine Stichworte) */
export const AXIS_MAX = 2;
export const MAX_VERSION_TEXT = 300;
export const MAX_VERSION_COUNT = 3;

/** Stichworte je Stufe: −2, −1, +1, +2 */
type Steps = readonly [string, string, string, string];

const AXIS_WORDS: Record<VariationAxis, Steps> = {
  intensity: ["very soft, gentle, quiet", "soft, gentle", "energetic, driving", "powerful, intense, hard-hitting"],
  body: ["thin, light", "light, airy", "warm, full-bodied", "deep, fat, full-bodied, heavy low end"],
  character: ["acoustic, organic, natural, live recording", "acoustic, natural", "processed, modern", "electronic, synthetic, programmed"],
  density: ["minimal, very simple, sparse", "simple, sparse", "busy, lively", "complex, intricate, virtuosic"],
  room: ["very dry, close-miked", "dry", "roomy, light reverb", "spacious, big reverb"],
};

/** Genauere Wörter für einzelne Spuren ("acoustic" allein zieht bei Drums sonst eine Gitarre nach) */
const TRACK_AXIS_WORDS: Partial<Record<StemTrack, Partial<Record<VariationAxis, Steps>>>> = {
  drums: {
    intensity: ["very soft drums, light touch, quiet", "soft drums, light touch", "energetic drums, driving", "powerful, hard-hitting drums"],
    body: ["thin, light drums", "light drums", "warm, punchy kick, full snare", "deep kick, fat snare, heavy low end"],
    character: ["acoustic drum kit, live drums, natural room", "acoustic drums, live drums", "processed, tight modern drums", "drum machine, electronic drums, programmed beat"],
    density: ["minimal beat, no fills", "simple beat, few fills", "more fills, busy groove", "complex drumming, many fills"],
  },
  percussion: {
    character: ["acoustic hand percussion, organic", "acoustic percussion", "processed percussion", "electronic percussion, programmed"],
  },
  bass: {
    body: ["thin, light bass", "light bass", "warm, round bass, full low end", "deep sub bass, heavy low end"],
    character: ["upright bass, acoustic double bass", "acoustic bass", "electric bass, modern", "synth bass, electronic"],
  },
  guitar: {
    character: ["acoustic guitar, natural", "acoustic guitar", "electric guitar, effects", "heavily processed electric guitar, effects"],
  },
  keyboard: {
    character: ["acoustic piano, natural", "acoustic piano", "electric piano", "synthesized keys, electronic"],
  },
  vocals: {
    intensity: ["whispered, very soft vocals", "soft, intimate vocals", "strong, confident vocals", "powerful, belting vocals"],
    character: ["natural, unprocessed vocals", "natural vocals", "processed vocals", "auto-tuned, heavily processed vocals"],
    density: ["very simple melody", "simple melody", "melodic runs", "virtuosic, melismatic runs"],
  },
};

/** Schnellwahl: setzt Regler (sichtbar) und/oder hängt Stichworte an. Gleiche `group` schließt sich gegenseitig aus. */
export interface VariationChip {
  id: string;
  axes?: Partial<Record<VariationAxis, number>>;
  tags?: readonly string[];
  group?: string;
}

const CHIPS: Record<string, VariationChip> = {
  softer: { id: "softer", axes: { intensity: -1 } },
  stronger: { id: "stronger", axes: { intensity: 1 } },
  body: { id: "body", axes: { body: 1 } },
  acoustic: { id: "acoustic", axes: { character: -2 } },
  electronic: { id: "electronic", axes: { character: 2 } },
  simpler: { id: "simpler", axes: { density: -1 } },
  busier: { id: "busier", axes: { density: 1 } },
  drier: { id: "drier", axes: { room: -1 } },
  roomier: { id: "roomier", axes: { room: 1 } },
  brushes: { id: "brushes", axes: { intensity: -1 }, tags: ["brushes", "jazz brushes on snare"] },
  tight: { id: "tight", tags: ["tight", "precise"] },
  halftime: { id: "halftime", tags: ["half-time feel"] },
  cajon: { id: "cajon", tags: ["cajon"], group: "perc" },
  shaker: { id: "shaker", tags: ["shakers"], group: "perc" },
  congas: { id: "congas", tags: ["congas", "bongos"], group: "perc" },
  tambourine: { id: "tambourine", tags: ["tambourine"], group: "perc" },
  upright: { id: "upright", axes: { character: -2 }, tags: ["upright bass"], group: "bass" },
  synth_bass: { id: "synth_bass", axes: { character: 2 }, tags: ["synth bass"], group: "bass" },
  walking: { id: "walking", tags: ["walking bass line"] },
  funky: { id: "funky", tags: ["funky slap bass"] },
  acoustic_guitar: { id: "acoustic_guitar", axes: { character: -2 }, tags: ["steel-string acoustic guitar"], group: "guitar" },
  nylon: { id: "nylon", axes: { character: -2 }, tags: ["nylon-string guitar"], group: "guitar" },
  clean: { id: "clean", tags: ["clean electric guitar"], group: "guitar" },
  crunchy: { id: "crunchy", axes: { intensity: 1 }, tags: ["overdriven, crunchy electric guitar"], group: "guitar" },
  fingerstyle: { id: "fingerstyle", tags: ["fingerstyle"] },
  grand: { id: "grand", tags: ["grand piano"], group: "keys" },
  rhodes: { id: "rhodes", tags: ["rhodes electric piano"], group: "keys" },
  organ: { id: "organ", tags: ["hammond organ"], group: "keys" },
  breathy: { id: "breathy", tags: ["breathy", "intimate"] },
  female: { id: "female", tags: ["female vocals"], group: "voice" },
  male: { id: "male", tags: ["male vocals"], group: "voice" },
  choir: { id: "choir", tags: ["choir"] },
  harmonies: { id: "harmonies", tags: ["harmonies"] },
};

const TRACK_CHIPS: Partial<Record<StemTrack, readonly string[]>> = {
  drums: ["softer", "body", "acoustic", "brushes", "tight", "busier", "halftime", "electronic", "drier"],
  percussion: ["softer", "cajon", "shaker", "congas", "tambourine", "acoustic", "busier", "electronic"],
  bass: ["softer", "body", "upright", "synth_bass", "walking", "funky", "simpler"],
  guitar: ["softer", "acoustic_guitar", "nylon", "clean", "crunchy", "fingerstyle", "simpler", "roomier"],
  keyboard: ["softer", "grand", "rhodes", "organ", "body", "simpler", "roomier"],
  vocals: ["softer", "stronger", "breathy", "female", "male", "drier", "roomier"],
  backing_vocals: ["softer", "choir", "harmonies", "simpler", "roomier"],
};
const DEFAULT_CHIPS = ["softer", "stronger", "body", "acoustic", "electronic", "simpler", "roomier"] as const;

export function chipsFor(track: StemTrack): VariationChip[] {
  return (TRACK_CHIPS[track] ?? DEFAULT_CHIPS).map((id) => CHIPS[id]!);
}

/** Wörter einer Reglerstellung, z. B. ("drums", "body", 1) → "warm, punchy kick, full snare"; 0 → "" */
export function axisWords(track: StemTrack, axis: VariationAxis, value: number): string {
  const step = Math.max(-AXIS_MAX, Math.min(AXIS_MAX, Math.round(value)));
  if (!step) return "";
  const words = TRACK_AXIS_WORDS[track]?.[axis] ?? AXIS_WORDS[axis];
  return words[step < 0 ? step + 2 : step + 1]!;
}

/** Stichworte der Wünsche (ohne Freitext): erst die Knöpfe, dann die Regler, ohne Doppelte. Unbekannte Knöpfe fallen weg. */
export function variationTags(track: StemTrack, recipe: Pick<VersionRecipe, "axes" | "chips">): string[] {
  const known = new Set(chipsFor(track).map((c) => c.id));
  const parts = [
    ...recipe.chips.filter((id) => known.has(id)).flatMap((id) => CHIPS[id]!.tags ?? []),
    ...VARIATION_AXES.map((axis) => axisWords(track, axis, recipe.axes[axis] ?? 0)),
  ];
  const seen = new Set<string>();
  return parts.flatMap((p) => p.split(",")).map((p) => p.trim()).filter((p) => {
    const key = p.toLowerCase();
    if (!p || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
