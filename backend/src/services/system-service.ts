// Zustand des Modellservers und "Server stoppen" (führt das Skript "stop" aus; als fertige App beendet sich der
// Server selbst, die App stoppt dann den Modellserver).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HealthInfo } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import type { MusicEngineFactory } from "../domain/music-engine.ts";
import { psQuote, type ProcessLauncher } from "../infrastructure/process-launcher.ts";
import type { SettingsRepository } from "../infrastructure/settings-repository.ts";
import { readSynthCompute } from "../infrastructure/synth-compute.ts";

export interface SystemServiceDeps {
  root: string;
  dataDir: string;
  platform: NodeJS.Platform;
  packaged: boolean;
  settings: SettingsRepository;
  engineFactory: MusicEngineFactory;
  launcher: ProcessLauncher;
}

export class SystemService {
  private readonly deps: SystemServiceDeps;

  constructor(deps: SystemServiceDeps) {
    this.deps = deps;
  }

  /** Fertige App: Starten und Stoppen übernimmt die App */
  get packaged(): boolean {
    return this.deps.packaged;
  }

  async health(): Promise<HealthInfo> {
    const synth_compute = readSynthCompute(this.deps.dataDir);
    try {
      const info = await this.deps.engineFactory(this.deps.settings.get()).health();
      return { ...info, synth_compute };
    } catch (e) {
      return { ok: false, error: (e as Error).message || (e as Error).name, synth_compute };
    }
  }

  /** Abgekoppelt und leicht verzögert, damit die HTTP-Antwort noch ankommt, bevor die App beendet wird. */
  shutdown(): void {
    if (this.deps.packaged) {
      setTimeout(() => process.kill(process.pid, "SIGTERM"), 500);
      return;
    }
    const name = this.stopScriptName();
    const script = join(this.deps.root, name);
    if (!existsSync(script)) throw new AppError("not_found", "script_missing", { name });
    const command = this.deps.platform === "win32"
      ? `Start-Sleep -Milliseconds 500; & ${psQuote(script)}`
      : `sleep 0.5; exec bash '${script.replaceAll("'", "'\\''")}'`;
    this.deps.launcher.launchDetached(command, { cwd: this.deps.root });
  }

  private stopScriptName(): string {
    if (this.deps.platform === "win32") return "stop.ps1";
    if (this.deps.platform !== "darwin" && existsSync(join(this.deps.root, "stop.sh"))) return "stop.sh";
    return "stop.command";
  }
}
