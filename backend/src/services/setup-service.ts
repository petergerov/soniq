// Einrichtung der fertigen App (MG_PACKAGED): Modelle laden, Grafikchip testen, Modellserver starten.
// Macht dasselbe wie der Installer (install.command), nur aus der Oberfläche heraus und im Hintergrund.
import { mkdirSync, statfsSync } from "node:fs";
import { totalmem } from "node:os";
import { join } from "node:path";
import type { LmSize, SetupRequest, SetupStatus } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { fixedFiles, lmFile, lmFileName, LM_SIZES, recommendedLm, requiredFiles, xlFile } from "../domain/model-plan.ts";
import type { EngineConf, EngineMode } from "../infrastructure/engine-conf.ts";
import type { EngineSupervisor } from "../infrastructure/engine-supervisor.ts";
import { isFileSync } from "../infrastructure/files.ts";
import { languageModelWorks } from "../infrastructure/lm-selftest.ts";
import type { ModelCatalog } from "../infrastructure/model-catalog.ts";
import { ChecksumError, downloadModel } from "../infrastructure/model-downloader.ts";

export interface SetupServiceDeps {
  packaged: boolean;
  catalog: ModelCatalog;
  modelsDir: string;
  engineConf: EngineConf;
  engine: EngineSupervisor;
  synthPort: number;
  log: (message: string) => void;
}

const MB = 1_000_000;
/** Platz, der nach den Modellen frei bleiben soll (Songs, Updates) */
const RESERVE_MB = 3000;

export class SetupService {
  private readonly deps: SetupServiceDeps;
  private phase: SetupStatus["phase"] = "idle";
  private file = "";
  private doneBytes = 0;
  private totalBytes = 0;
  private error = "";
  private abort: AbortController | undefined;

  constructor(deps: SetupServiceDeps) {
    this.deps = deps;
    mkdirSync(deps.modelsDir, { recursive: true });
  }

  private has(name: string): boolean {
    return isFileSync(join(this.deps.modelsDir, name));
  }

  private get busy(): boolean {
    return this.phase === "downloading" || this.phase === "testing" || this.phase === "starting";
  }

  /** Fertige App ohne getestete Einrichtung, oder es fehlen Modelldateien bzw. die acestep.cpp-Version ist neu. */
  needed(): boolean {
    if (!this.deps.packaged) return false;
    const conf = this.deps.engineConf.get();
    const size = LM_SIZES.find((s) => lmFileName(s) === conf.lmFile);
    if (!conf.mode || !size || conf.testedRev !== this.deps.catalog.acestepRev) return true;
    return requiredFiles(this.deps.catalog, size, false).some((f) => !this.has(f.name));
  }

  status(): SetupStatus {
    const { catalog } = this.deps;
    const ramGb = Math.round(totalmem() / 2 ** 30);
    const xl = xlFile(catalog);
    return {
      needed: this.needed(),
      phase: this.phase,
      ram_gb: ramGb,
      free_gb: Math.floor(this.freeMb() / 1000),
      recommended_lm: recommendedLm(ramGb),
      lm_options: LM_SIZES.map((size) => ({ size, mb: lmFile(catalog, size)?.mb ?? 0, present: this.has(lmFileName(size)) })),
      xl: { mb: xl?.mb ?? 0, present: !!xl && this.has(xl.name) },
      base_mb: fixedFiles(catalog).filter((f) => !this.has(f.name)).reduce((sum, f) => sum + f.mb, 0),
      file: this.file,
      done_mb: Math.round(this.doneBytes / MB),
      total_mb: Math.round(this.totalBytes / MB),
      error: this.error,
    };
  }

  /** Startet die Einrichtung im Hintergrund; den Fortschritt liefert status(). */
  start(request: SetupRequest): SetupStatus {
    if (!this.deps.packaged) throw new AppError("bad_request", "setup_unavailable");
    if (this.busy) throw new AppError("conflict", "setup_busy");
    const missing = requiredFiles(this.deps.catalog, request.lm, request.xl).filter((f) => !this.has(f.name));
    const needMb = missing.reduce((sum, f) => sum + f.mb, 0);
    const freeMb = this.freeMb();
    if (needMb && freeMb < needMb + RESERVE_MB) {
      throw new AppError("bad_request", "setup_disk", { need: Math.ceil((needMb + RESERVE_MB) / 1000), free: Math.floor(freeMb / 1000) });
    }
    this.error = "";
    this.abort = new AbortController();
    void this.run(request.lm, missing, this.abort.signal);
    return this.status();
  }

  cancel(): SetupStatus {
    this.abort?.abort();
    return this.status();
  }

  /** Beim Start der App: ist alles eingerichtet, gleich den Modellserver starten. */
  async startEngineIfReady(): Promise<void> {
    const { mode } = this.deps.engineConf.get();
    if (!this.deps.packaged || this.needed() || !mode) return;
    try {
      await this.deps.engine.start(mode);
    } catch (e) {
      this.deps.log(`Model server could not be started: ${(e as Error).message}`);
    }
  }

  private freeMb(): number {
    try {
      const s = statfsSync(this.deps.modelsDir);
      return (s.bavail * s.bsize) / MB;
    } catch {
      return 0;
    }
  }

  private async run(size: LmSize, missing: ReturnType<typeof requiredFiles>, signal: AbortSignal): Promise<void> {
    const { catalog, modelsDir, engineConf, engine, log } = this.deps;
    try {
      this.phase = "downloading";
      this.totalBytes = missing.reduce((sum, f) => sum + f.mb * MB, 0);
      this.doneBytes = 0;
      for (const f of missing) {
        this.file = f.name;
        const before = this.doneBytes;
        await downloadModel(`${catalog.baseUrl}/${f.name}`, modelsDir, f.name, f.sha256, (bytes) => { this.doneBytes = before + bytes; }, signal);
        signal.throwIfAborted();
        this.doneBytes = before + f.mb * MB;
        log(`Model ${f.name} downloaded`);
      }
      this.file = "";
      signal.throwIfAborted();

      // Grafik-Selbsttest wie im Installer: rechnet das Sprachmodell auf dem Grafikchip richtig? Sonst auf die CPU.
      const lm = lmFileName(size);
      const conf = engineConf.get();
      let mode: EngineMode;
      if (conf.mode && conf.lmFile === lm && conf.testedRev === catalog.acestepRev) {
        mode = conf.mode;
      } else {
        this.phase = "testing";
        await engine.start("single");
        const result = await languageModelWorks(`http://127.0.0.1:${this.deps.synthPort}`, lm);
        log(`Self-test: ${result.summary}`);
        mode = result.ok ? "single" : "split";
      }
      engineConf.save({ mode, lmFile: lm, testedRev: catalog.acestepRev });

      this.phase = "starting";
      await engine.start(mode);   // startet neu: der Server liest die Modellliste nur beim Start
      this.phase = "done";
    } catch (e) {
      this.file = "";
      if (signal.aborted) {
        this.phase = "idle";
        return;
      }
      this.phase = "error";
      this.error = e instanceof ChecksumError ? `checksum:${e.message}` : (e as Error).message;
      log(`Setup failed: ${this.error}`);
    }
  }
}
