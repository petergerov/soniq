// Pfade, Ports und vom Installer geschriebene Werte (data/engine.conf). Eine Quelle für die ganze App.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type EngineMode = "single" | "split";

export interface AppConfig {
  /** Programmordner (enthält backend/, frontend/, scripts/ …) */
  root: string;
  dataDir: string;
  defaultSongsDir: string;
  modelsDir: string;
  dbPath: string;
  /** Gebaute Oberfläche (frontend/dist) */
  frontendDir: string;
  /** Einstiegsdatei des Servers, für den Neustart nach einem Update */
  entryFile: string;
  host: string;
  port: number;
  /** Aus engine.conf: "single" = ein Modellserver, "split" = Sprachmodell auf eigenem CPU-Server */
  engineMode: EngineMode | undefined;
  lmFile: string;
  platform: NodeJS.Platform;
}

/** engine.conf als key=value lesen (nicht ausführen). Fehlt die Datei, ist das Ergebnis leer. */
export function readKeyValueFile(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return result;
  }
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq > 0) result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return result;
}

function parsePort(value: string | undefined, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): AppConfig {
  const srcDir = dirname(fileURLToPath(import.meta.url));      // backend/src/config
  const root = resolve(srcDir, "..", "..", "..");
  const dataDir = env.MG_DATA_DIR ? resolve(env.MG_DATA_DIR) : join(root, "data");   // MG_DATA_DIR: z. B. für Tests
  const conf = readKeyValueFile(join(dataDir, "engine.conf"));
  const portArg = argv.indexOf("--port");
  const mode = conf.MODE === "single" || conf.MODE === "split" ? conf.MODE : undefined;
  return {
    root,
    dataDir,
    defaultSongsDir: join(dataDir, "songs"),
    modelsDir: join(root, "engine", "acestep.cpp", "models"),
    dbPath: join(dataDir, "music.db"),
    frontendDir: join(root, "frontend", "dist"),
    entryFile: join(root, "backend", "src", "main.ts"),
    host: "127.0.0.1",
    port: parsePort(portArg >= 0 ? argv[portArg + 1] : env.PORT, 8765),
    engineMode: mode,
    lmFile: conf.LM_FILE ?? "",
    platform: process.platform,
  };
}
