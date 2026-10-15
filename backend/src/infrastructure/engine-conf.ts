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
  /** Latent-Frames pro VAE-Kachel (--vae-chunk); leer = Server-Vorgabe */
  vaeChunk: string;
  /**
   * Modelle zwischen Requests im VRAM halten (--keep-loaded).
   * undefined = automatisch (auf macOS an, sonst aus), damit Stem Separation nicht jedes Mal neu lädt.
   */
  keepLoaded: boolean | undefined;
}

export class EngineConf {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  get(): EngineValues {
    const conf = readKeyValueFile(this.path);
    const mode = conf.MODE === "single" || conf.MODE === "split" ? conf.MODE : undefined;
    const kl = (conf.KEEP_LOADED ?? "").toLowerCase();
    const keepLoaded = kl === "1" || kl === "true" ? true : kl === "0" || kl === "false" ? false : undefined;
    return {
      mode,
      lmFile: conf.LM_FILE ?? "",
      testedRev: conf.TESTED_REV ?? "",
      vaeChunk: conf.VAE_CHUNK ?? "",
      keepLoaded,
    };
  }

  /** Setzt die drei Werte; weitere Zeilen (z. B. VAE_CHUNK unter Linux) bleiben erhalten. */
  save(values: { mode: EngineMode; lmFile: string; testedRev: string }): void {
    const rest = Object.entries(readKeyValueFile(this.path)).filter(([k]) => !["MODE", "LM_FILE", "TESTED_REV"].includes(k));
    const lines = [`MODE=${values.mode}`, `LM_FILE=${values.lmFile}`, `TESTED_REV=${values.testedRev}`, ...rest.map(([k, v]) => `${k}=${v}`)];
    writeFileSync(this.path, lines.join("\n") + "\n");
  }
}
