// Pfade, Ports und vom Installer geschriebene Werte (data/engine.conf). Eine Quelle für die ganze App.
// Als Mac-App (MG_PACKAGED=1) liegen Daten und Modelle außerhalb des Programmordners (MG_DATA_DIR, MG_MODELS_DIR).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  /** Vom Installer bzw. der Einrichtung geschrieben: MODE, LM_FILE, TESTED_REV (siehe EngineConf) */
  engineConfPath: string;
  /** Ports der Modellserver: Synthese und (Modus "split") Sprachmodell auf der CPU */
  synthPort: number;
  lmPort: number;
  /** Modellserver acestep.cpp; die fertige App startet ihn selbst */
  engineBin: string;
  platform: NodeJS.Platform;
  /** Versionsnummer: von der App (MG_APP_VERSION, aus Info.plist) oder aus package.json */
  appVersion: string;
  /** Läuft als fertige App (z. B. SONIQ.app): Oberfläche liegt gebaut bei, keine Git-Updates, Start/Stopp macht die App */
  packaged: boolean;
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

/** "version" aus package.json des Programmordners ("" wenn nicht lesbar). */
function packageVersion(root: string): string {
  try {
    return String((JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown }).version ?? "");
  } catch {
    return "";
  }
}

function parsePort(value: string | undefined, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): AppConfig {
  const srcDir = dirname(fileURLToPath(import.meta.url));      // backend/src/config
  const root = resolve(srcDir, "..", "..", "..");
  const dataDir = env.MG_DATA_DIR ? resolve(env.MG_DATA_DIR) : join(root, "data");   // MG_DATA_DIR: z. B. für Tests
  const modelsDir = env.MG_MODELS_DIR ? resolve(env.MG_MODELS_DIR) : join(root, "models");
  const portArg = argv.indexOf("--port");
  return {
    root,
    dataDir,
    defaultSongsDir: join(dataDir, "songs"),
    modelsDir,
    dbPath: join(dataDir, "music.db"),
    frontendDir: join(root, "frontend", "dist"),
    entryFile: join(root, "backend", "src", "main.ts"),
    host: "127.0.0.1",
    port: parsePort(portArg >= 0 ? argv[portArg + 1] : env.PORT, 8765),
    engineConfPath: join(dataDir, "engine.conf"),
    synthPort: parsePort(env.MG_SYNTH_PORT, 8085),
    lmPort: parsePort(env.MG_LM_PORT, 8086),
    engineBin: env.MG_ENGINE_BIN ? resolve(env.MG_ENGINE_BIN) : join(root, "engine", "acestep.cpp", "build", "ace-server"),
    platform: process.platform,
    packaged: env.MG_PACKAGED === "1",
    appVersion: env.MG_APP_VERSION || packageVersion(root),
  };
}
