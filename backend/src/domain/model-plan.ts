// Welche Modelldateien eine Einrichtung braucht, und die Empfehlung fürs Sprachmodell (wie im Installer).
import type { LmSize } from "../../../shared/api.ts";
import type { ModelCatalog, ModelFile } from "../infrastructure/model-catalog.ts";

export const LM_SIZES: readonly LmSize[] = ["0.6B", "1.7B", "4B"];

const LM_PREFIX = "acestep-5Hz-lm-";
const XL_MARK = "xl-sft";
/** Optionales Spuren-Modell (lego, extract, complete); gehört nicht zur Grundausstattung */
const BASE_MARK = "v15-base";
/** Optionales XL-Spuren-Modell (4 Mrd. Parameter), nur über Einstellungen › Spuren-Modell */
const XL_BASE_MARK = "xl-base";

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

/** XL-Spuren-Modell (XL-Base) für Einzelspuren. */
export function xlBaseFile(catalog: ModelCatalog): ModelFile | undefined {
  return catalog.files.find((f) => f.name.includes(XL_BASE_MARK));
}

/** Dateien, die jede Einrichtung braucht: VAE, Text-Embedding, Klangmodell. */
export function fixedFiles(catalog: ModelCatalog): ModelFile[] {
  const optional = [XL_MARK, BASE_MARK, XL_BASE_MARK];
  return catalog.files.filter((f) => !f.name.startsWith(LM_PREFIX) && !optional.some((mark) => f.name.includes(mark)));
}

/** Die festen Dateien (VAE, Text-Embedding, Klangmodell), das gewählte Sprachmodell und auf Wunsch XL und die Spuren-Modelle. */
export function requiredFiles(catalog: ModelCatalog, size: LmSize, withXl: boolean, withStems = false, withXlStems = false): ModelFile[] {
  const fixed = fixedFiles(catalog);
  const lm = lmFile(catalog, size);
  const xl = withXl ? xlFile(catalog) : undefined;
  const stems = withStems ? baseFile(catalog) : undefined;
  const xlStems = withXlStems ? xlBaseFile(catalog) : undefined;
  return [...fixed, ...[lm, xl, stems, xlStems].filter((f): f is ModelFile => !!f)];
}
