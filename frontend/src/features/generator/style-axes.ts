// Stil-Regler: ruhig ↔ energisch, akustisch ↔ elektronisch, dunkel ↔ hell.
// Jede Stufe steht für einen Begriff im Stil-Feld; die Mitte (0) schreibt nichts. Begriffe sind Englisch (gehen ans Modell).

/** Stufen -2 … 2, Index 2 ist die neutrale Mitte. */
export const STYLE_AXES = {
  energy: ["very calm", "calm", "", "energetic", "high energy"],
  sound: ["fully acoustic", "organic", "", "electronic", "synthetic"],
  tone: ["very dark", "dark", "", "bright", "sunny"],
} as const;

export type StyleAxis = keyof typeof STYLE_AXES;
export const AXIS_IDS = Object.keys(STYLE_AXES) as StyleAxis[];

/** Begriffe des Stil-Felds (durch Komma getrennt). */
export function styleParts(style: string): string[] {
  return style.split(",").map((x) => x.trim()).filter(Boolean);
}

function stepOf(axis: StyleAxis, part: string): number {
  const i = (STYLE_AXES[axis] as readonly string[]).indexOf(part.toLowerCase());
  return i < 0 || i === 2 ? NaN : i - 2;
}

/** Stufe, die der Stil-Text für einen Regler enthält (0 = keine). */
export function axisValue(style: string, axis: StyleAxis): number {
  for (const p of styleParts(style)) {
    const step = stepOf(axis, p);
    if (!Number.isNaN(step)) return step;
  }
  return 0;
}

/** Begriff des Reglers im Stil setzen: alte Stufe raus, neue (außer 0) hinten anhängen. */
export function setAxis(style: string, axis: StyleAxis, step: number): string {
  const rest = styleParts(style).filter((p) => Number.isNaN(stepOf(axis, p)));
  const word = STYLE_AXES[axis][Math.max(-2, Math.min(2, Math.round(step))) + 2];
  return (word ? [...rest, word] : rest).join(", ");
}
