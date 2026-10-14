// data/engine.conf: Betriebsart des Modellservers und gewähltes Sprachmodell. Schreiben Installer und
// Einrichtung (fertige App); gelesen wird bei jedem Zugriff, damit eine neue Einrichtung sofort gilt.
import { writeFileSync } from "node:fs";
import { readKeyValueFile } from "../config/app-config.ts";

/** "single" = ein Modellserver für alles, "split" = Sprachmodell auf eigenem CPU-Server */
export type EngineMode = "single" | "split";

export interface EngineValues {
  mode: EngineMode | undefined;
  lmFile: string;
  /** acestep.cpp-Version, mit der der Grafik-Selbsttest lief */
  testedRev: string;
}

export class EngineConf {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  get(): EngineValues {
    const conf = readKeyValueFile(this.path);
    const mode = conf.MODE === "single" || conf.MODE === "split" ? conf.MODE : undefined;
    return { mode, lmFile: conf.LM_FILE ?? "", testedRev: conf.TESTED_REV ?? "" };
  }

  /** Setzt die drei Werte; weitere Zeilen (z. B. VAE_CHUNK unter Linux) bleiben erhalten. */
  save(values: { mode: EngineMode; lmFile: string; testedRev: string }): void {
    const rest = Object.entries(readKeyValueFile(this.path)).filter(([k]) => !["MODE", "LM_FILE", "TESTED_REV"].includes(k));
    const lines = [`MODE=${values.mode}`, `LM_FILE=${values.lmFile}`, `TESTED_REV=${values.testedRev}`, ...rest.map(([k, v]) => `${k}=${v}`)];
    writeFileSync(this.path, lines.join("\n") + "\n");
  }
}
