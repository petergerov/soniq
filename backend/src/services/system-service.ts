// Zustand des Modellservers und "Server stoppen" (führt das Skript "Music Generator OFF" aus).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HealthInfo } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import type { MusicEngineFactory } from "../domain/music-engine.ts";
import { psQuote, type ProcessLauncher } from "../infrastructure/process-launcher.ts";
import type { SettingsRepository } from "../infrastructure/settings-repository.ts";

export interface SystemServiceDeps {
  root: string;
  platform: NodeJS.Platform;
  settings: SettingsRepository;
  engineFactory: MusicEngineFactory;
  launcher: ProcessLauncher;
}

export class SystemService {
  private readonly deps: SystemServiceDeps;

  constructor(deps: SystemServiceDeps) {
    this.deps = deps;
  }

  async health(): Promise<HealthInfo> {
    try {
      return await this.deps.engineFactory(this.deps.settings.get()).health();
    } catch (e) {
      return { ok: false, error: (e as Error).message || (e as Error).name };
    }
  }

  /** Abgekoppelt und leicht verzögert, damit die HTTP-Antwort noch ankommt, bevor die App beendet wird. */
  shutdown(): void {
    const name = this.stopScriptName();
    const script = join(this.deps.root, name);
    if (!existsSync(script)) throw new AppError("not_found", "script_missing", { name });
    const command = this.deps.platform === "win32"
      ? `Start-Sleep -Milliseconds 500; & ${psQuote(script)}`
      : `sleep 0.5; exec bash '${script.replaceAll("'", "'\\''")}'`;
    this.deps.launcher.launchDetached(command, { cwd: this.deps.root });
  }

  private stopScriptName(): string {
    if (this.deps.platform === "win32") return "Music Generator OFF.ps1";
    if (this.deps.platform !== "darwin" && existsSync(join(this.deps.root, "Music Generator OFF.sh"))) return "Music Generator OFF.sh";
    return "Music Generator OFF.command";
  }
}
