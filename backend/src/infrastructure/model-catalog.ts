// Modell-Liste aus scripts/common.sh (eine Quelle für Installer und App): Download-Adresse, Dateien mit
// Größe und SHA-256 sowie die acestep.cpp-Version, mit der der Grafik-Selbsttest gilt.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ModelFile {
  name: string;
  mb: number;
  sha256: string;
}

export interface ModelCatalog {
  /** Basis-URL der Dateien (feste Revision des Hugging-Face-Repos) */
  baseUrl: string;
  files: ModelFile[];
  acestepRev: string;
  /** Demucs-Gewichte für demucs.cpp (eigenes Repo, eigene Revision) */
  demucs: { baseUrl: string; files: ModelFile[] };
  /** Demucs als Core ML (nur macOS): gezippte .mlpackage, nach dem Laden entpackt */
  demucsCoreml: { baseUrl: string; files: ModelFile[] };
}

/** Wert einer Zuweisung NAME="…" (auch mehrzeilig). */
function shellValue(text: string, name: string): string {
  return new RegExp(`^${name}="([^"]*)"`, "m").exec(text)?.[1] ?? "";
}

/** Dateiliste "name:MB:SHA-256", eine Datei je Zeile */
function fileList(text: string, name: string): ModelFile[] {
  return shellValue(text, name).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const [file = "", mb = "0", sha256 = ""] = line.split(":");
    return { name: file, mb: Number(mb), sha256 };
  });
}

export function parseCatalog(commonSh: string): ModelCatalog {
  return {
    baseUrl: shellValue(commonSh, "HF_BASE"), files: fileList(commonSh, "MODEL_FILES"), acestepRev: shellValue(commonSh, "ACESTEP_REV"),
    demucs: { baseUrl: shellValue(commonSh, "DEMUCS_HF"), files: fileList(commonSh, "DEMUCS_FILES") },
    demucsCoreml: { baseUrl: shellValue(commonSh, "DEMUCS_COREML_BASE"), files: fileList(commonSh, "DEMUCS_COREML_FILES") },
  };
}

/** Katalog des Programmordners. MG_HF_BASE ersetzt die Download-Adresse (z. B. für Tests mit einem lokalen Server). */
export function loadCatalog(root: string, env: NodeJS.ProcessEnv = process.env): ModelCatalog {
  const catalog = parseCatalog(readFileSync(join(root, "scripts", "common.sh"), "utf8"));
  return env.MG_HF_BASE ? { ...catalog, baseUrl: env.MG_HF_BASE } : catalog;
}
