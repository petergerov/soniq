// Welche Modelldateien eine Einrichtung braucht, und die Empfehlung fürs Sprachmodell (wie im Installer).
import type { LmSize } from "../../../shared/api.ts";
import type { ModelCatalog, ModelFile } from "../infrastructure/model-catalog.ts";

export const LM_SIZES: readonly LmSize[] = ["0.6B", "1.7B", "4B"];

const LM_PREFIX = "acestep-5Hz-lm-";
const XL_MARK = "xl-sft";
/** Optionales Spuren-Modell (lego, extract, complete); gehört nicht zur Grundausstattung */
const BASE_MARK = "v15-base";

export function isLmSize(value: unknown): value is LmSize {
  return LM_SIZES.includes(value as LmSize);
}

export function lmFileName(size: LmSize): string {
  return `${LM_PREFIX}${size}-Q8_0.gguf`;
}

export function lmSizeOf(fileName: string): LmSize | undefined {
  return LM_SIZES.find((s) => lmFileName(s) === fileName);
}

/** Bis 12 GB Arbeitsspeicher 0.6B, bis 24 GB 1.7B, darüber 4B. */
export function recommendedLm(ramGb: number): LmSize {
  return ramGb < 12 ? "0.6B" : ramGb < 24 ? "1.7B" : "4B";
}

export function lmFile(catalog: ModelCatalog, size: LmSize): ModelFile | undefined {
  return catalog.files.find((f) => f.name === lmFileName(size));
}

export function xlFile(catalog: ModelCatalog): ModelFile | undefined {
  return catalog.files.find((f) => f.name.includes(XL_MARK));
}

/** Spuren-Modell (Base) für Einzelspuren. */
export function baseFile(catalog: ModelCatalog): ModelFile | undefined {
  return catalog.files.find((f) => f.name.includes(BASE_MARK));
}

/** Dateien, die jede Einrichtung braucht: VAE, Text-Embedding, Klangmodell. */
export function fixedFiles(catalog: ModelCatalog): ModelFile[] {
  return catalog.files.filter((f) => !f.name.startsWith(LM_PREFIX) && !f.name.includes(XL_MARK) && !f.name.includes(BASE_MARK));
}

/** Die festen Dateien (VAE, Text-Embedding, Klangmodell), das gewählte Sprachmodell und auf Wunsch XL. */
export function requiredFiles(catalog: ModelCatalog, size: LmSize, withXl: boolean): ModelFile[] {
  const fixed = fixedFiles(catalog);
  const lm = lmFile(catalog, size);
  const xl = withXl ? xlFile(catalog) : undefined;
  return [...fixed, ...(lm ? [lm] : []), ...(xl ? [xl] : [])];
}
