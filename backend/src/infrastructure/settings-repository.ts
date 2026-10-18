// Einstellungen als Schlüssel/JSON-Wert. Vorgaben werden nicht gespeichert, damit spätere
// Installer-Werte (engine.conf) greifen.
import type { Settings } from "../../../shared/api.ts";
import { DEFAULT_OUTPUT_FORMAT } from "../domain/output-format.ts";
import type { AppConfig } from "../config/app-config.ts";
import type { Database } from "./database.ts";
import type { EngineConf, EngineValues } from "./engine-conf.ts";

type Ports = Pick<AppConfig, "synthPort" | "lmPort">;

export function defaultSettings(engine: EngineValues, ports: Ports): Settings {
  return {
    server_url: `http://127.0.0.1:${ports.synthPort}`,   // Synthese (DiT + VAE, Metal/CUDA)
    // Sprachmodell: eigener CPU-Server (Modus split) oder leer = gleicher Server wie Synthese (single)
    lm_url: engine.mode === "single" ? "" : `http://127.0.0.1:${ports.lmPort}`,
    lm_model: engine.lmFile,                // leer = erstes Sprachmodell im Modellordner
    poll_interval: 1.5,
    timeout_minutes: 30,
    dit: "standard",                        // Klangmodell: "standard" (2B) oder "xl" (4B, braucht die XL-Datei)
    stem_model: "standard",                 // Spuren-Modell: "standard" (Base 2B) oder "xl" (XL-Base 4B); Standard klang im Hörtest sauberer
    output_format: DEFAULT_OUTPUT_FORMAT,   // Dateiformat der Songs (siehe domain/output-format.ts)
    songs_dir: "",                          // leer = data/songs im Programmordner, sonst absoluter Pfad
    demucs_device: "gpu",                   // Demucs als Core ML (macOS): GPU schneller, CPU genauer (macos/demucs-coreml.swift)
  };
}

export class SettingsRepository {
  private readonly db: Database;
  private readonly engine: EngineConf;
  private readonly ports: Ports;

  constructor(db: Database, engine: EngineConf, ports: Ports) {
    this.db = db;
    this.engine = engine;
    this.ports = ports;
  }

  /** Vorgaben; hängen von engine.conf ab, die die Einrichtung zur Laufzeit neu schreiben kann */
  private get defaults(): Settings {
    return defaultSettings(this.engine.get(), this.ports);
  }

  get(): Settings {
    const engine = this.engine.get();
    const s: Settings = defaultSettings(engine, this.ports);
    for (const r of this.db.all<{ key: string; value: string }>("SELECT key, value FROM settings")) {
      if (r.key in s) {
        try {
          (s as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value);
        } catch {
          // kaputter Wert: Vorgabe behalten
        }
      }
    }
    // Früher gespeicherte Standardadresse des CPU-Servers: im Ein-Server-Modus läuft dort nichts
    if (engine.mode === "single" && s.lm_url.replace(/\/+$/, "") === `http://127.0.0.1:${this.ports.lmPort}`) s.lm_url = "";
    return s;
  }

  save(values: Partial<Settings>): Settings {
    for (const [key, value] of Object.entries(values) as [keyof Settings, unknown][]) {
      if (!(key in this.defaults)) continue;
      if (value === this.defaults[key]) {
        this.db.run("DELETE FROM settings WHERE key=?", key);
      } else {
        this.db.run(
          "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          key, JSON.stringify(value),
        );
      }
    }
    return this.get();
  }
}
