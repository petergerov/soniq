// Einstellungen als Schlüssel/JSON-Wert. Vorgaben werden nicht gespeichert, damit spätere
// Installer-Werte (engine.conf) greifen.
import type { Settings } from "../../../shared/api.ts";
import { DEFAULT_OUTPUT_FORMAT } from "../domain/output-format.ts";
import type { AppConfig } from "../config/app-config.ts";
import type { Database } from "./database.ts";

const SPLIT_LM_URL = "http://127.0.0.1:8086";

export function defaultSettings(config: Pick<AppConfig, "engineMode" | "lmFile">): Settings {
  return {
    server_url: "http://127.0.0.1:8085",   // Synthese (DiT + VAE, Metal/CUDA)
    // Sprachmodell: eigener CPU-Server (Modus split) oder leer = gleicher Server wie Synthese (single)
    lm_url: config.engineMode === "single" ? "" : SPLIT_LM_URL,
    lm_model: config.lmFile,                // leer = erstes Sprachmodell im Modellordner
    poll_interval: 1.5,
    timeout_minutes: 30,
    dit: "standard",                        // Klangmodell: "standard" (2B) oder "xl" (4B, braucht die XL-Datei)
    output_format: DEFAULT_OUTPUT_FORMAT,   // Dateiformat der Songs (siehe domain/output-format.ts)
    songs_dir: "",                          // leer = data/songs im Programmordner, sonst absoluter Pfad
  };
}

export class SettingsRepository {
  private readonly db: Database;
  private readonly config: Pick<AppConfig, "engineMode" | "lmFile">;
  private readonly defaults: Settings;

  constructor(db: Database, config: Pick<AppConfig, "engineMode" | "lmFile">) {
    this.db = db;
    this.config = config;
    this.defaults = defaultSettings(config);
  }

  get(): Settings {
    const s: Settings = { ...this.defaults };
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
    if (this.config.engineMode === "single" && s.lm_url.replace(/\/+$/, "") === SPLIT_LM_URL) s.lm_url = "";
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
