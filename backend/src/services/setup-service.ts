// Einrichtung der fertigen App (MG_PACKAGED): Modelle laden, Grafikchip testen, Modellserver starten.
// Macht dasselbe wie der Installer (install.command), nur aus der Oberfläche heraus und im Hintergrund.
import { execFile } from "node:child_process";
import { mkdirSync, statfsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { totalmem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { LmSize, SetupRequest, SetupStatus } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { baseFile, fixedFiles, lmFile, lmFileName, LM_SIZES, recommendedLm, requiredFiles, xlBaseFile, xlFile } from "../domain/model-plan.ts";
import type { EngineConf, EngineMode } from "../infrastructure/engine-conf.ts";
import type { EngineSupervisor } from "../infrastructure/engine-supervisor.ts";
import { isFileSync } from "../infrastructure/files.ts";
import { DEMUCS_MODEL_DIR } from "../infrastructure/demucs-separator.ts";
import { languageModelWorks } from "../infrastructure/lm-selftest.ts";
import type { ModelCatalog, ModelFile } from "../infrastructure/model-catalog.ts";
import { ChecksumError, downloadModel, verifyModel } from "../infrastructure/model-downloader.ts";

export interface SetupServiceDeps {
  packaged: boolean;
  catalog: ModelCatalog;
  modelsDir: string;
  engineConf: EngineConf;
  engine: EngineSupervisor;
  synthPort: number;
  /** Programme von demucs.cpp liegen bei (sonst lassen sich die Demucs-Modelle nicht laden) */
  demucsSupported: () => boolean;
  /** Core-ML-Programm liegt bei (macOS): dann gehört das Core-ML-Modell zu Demucs dazu */
  demucsCoremlSupported: () => boolean;
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

  /** Ordner der Demucs-Gewichte (htdemucs_ft sucht seine vier Dateien in einem Ordner) */
  private get demucsDir(): string {
    return join(this.deps.modelsDir, DEMUCS_MODEL_DIR);
  }

  private missingDemucs(): ModelFile[] {
    return this.deps.catalog.demucs.files.filter((f) => !isFileSync(join(this.demucsDir, f.name)));
  }

  /** Core-ML-Modelle (gezippt geladen, entpackt als <name>.mlpackage) nur mit Core-ML-Programm */
  private missingDemucsCoreml(): ModelFile[] {
    if (!this.deps.demucsCoremlSupported()) return [];
    return this.deps.catalog.demucsCoreml.files.filter((f) => !isFileSync(join(this.demucsDir, f.name.replace(/\.zip$/, ""), "Manifest.json")));
  }

  private get busy(): boolean {
    return this.phase === "verifying" || this.phase === "downloading" || this.phase === "testing" || this.phase === "starting";
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
    const stems = baseFile(catalog);
    const xlStems = xlBaseFile(catalog);
    return {
      packaged: this.deps.packaged,
      needed: this.needed(),
      phase: this.phase,
      ram_gb: ramGb,
      free_gb: Math.floor(this.freeMb() / 1000),
      recommended_lm: recommendedLm(ramGb),
      lm_options: LM_SIZES.map((size) => ({ size, mb: lmFile(catalog, size)?.mb ?? 0, present: this.has(lmFileName(size)) })),
      xl: { mb: xl?.mb ?? 0, present: !!xl && this.has(xl.name) },
      stems: { mb: stems?.mb ?? 0, present: !!stems && this.has(stems.name) },
      stems_xl: { mb: xlStems?.mb ?? 0, present: !!xlStems && this.has(xlStems.name) },
      demucs: {
        mb: [...catalog.demucs.files, ...(this.deps.demucsCoremlSupported() ? catalog.demucsCoreml.files : [])].reduce((sum, f) => sum + f.mb, 0),
        present: catalog.demucs.files.length > 0 && !this.missingDemucs().length && !this.missingDemucsCoreml().length,
        supported: this.deps.demucsSupported(),
      },
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
    const required = requiredFiles(this.deps.catalog, request.lm, request.xl, request.stems === true, request.stems_xl === true);
    const missing = required.filter((f) => !this.has(f.name));
    // Neue Einrichtung: schon vorhandene Dateien (z. B. hineinkopiert) einmal per Prüfsumme kontrollieren.
    // Beim späteren Nachladen von XL sind sie schon geprüft.
    const verify = this.deps.engineConf.get().mode ? [] : required.filter((f) => this.has(f.name));
    this.checkDisk(missing);
    this.error = "";
    this.abort = new AbortController();
    void this.run(request.lm, verify, missing, this.abort.signal);
    return this.status();
  }

  /**
   * Demucs-Modelle nachladen (Einstellungen › Demucs). Sie laufen in eigenen Programmen, nicht im Modellserver:
   * kein Neustart nötig, die Stem Separation bietet Demucs gleich danach an.
   */
  addDemucs(): SetupStatus {
    if (!this.deps.packaged || !this.deps.demucsSupported()) throw new AppError("bad_request", "setup_unavailable");
    if (this.busy) throw new AppError("conflict", "setup_busy");
    const missing = this.missingDemucs();
    const coreml = this.missingDemucsCoreml();
    // Entpackt braucht das Core-ML-Modell etwa anderthalbmal so viel wie die ZIP-Datei, die bis dahin liegen bleibt
    this.checkDisk([...missing, ...coreml.map((f) => ({ ...f, mb: Math.ceil(f.mb * 2.5) }))]);
    mkdirSync(this.demucsDir, { recursive: true });
    this.error = "";
    this.abort = new AbortController();
    const signal = this.abort.signal;
    void this.guard(signal, async () => {
      await this.download(this.deps.catalog.demucs.baseUrl, this.demucsDir, missing, signal);
      await this.download(this.deps.catalog.demucsCoreml.baseUrl, this.demucsDir, coreml, signal);
      for (const f of coreml) await this.unzip(f.name);
      this.phase = "done";
    });
    return this.status();
  }

  /** Geladene ZIP-Datei im Demucs-Ordner entpacken und löschen (ditto gehört zu macOS) */
  private async unzip(name: string): Promise<void> {
    const zip = join(this.demucsDir, name);
    await rm(join(this.demucsDir, name.replace(/\.zip$/, "")), { recursive: true, force: true });
    await promisify(execFile)("ditto", ["-x", "-k", zip, this.demucsDir]);
    await rm(join(this.demucsDir, "__MACOSX"), { recursive: true, force: true });
    await rm(zip, { force: true });
    this.deps.log(`Model ${name} unpacked`);
  }

  private checkDisk(missing: ModelFile[]): void {
    const needMb = missing.reduce((sum, f) => sum + f.mb, 0);
    const freeMb = this.freeMb();
    if (needMb && freeMb < needMb + RESERVE_MB) {
      throw new AppError("bad_request", "setup_disk", { need: Math.ceil((needMb + RESERVE_MB) / 1000), free: Math.floor(freeMb / 1000) });
    }
  }

  /** XL-Klangmodell nachladen (Einstellungen › Klangmodell); das Sprachmodell bleibt das eingerichtete. */
  addXl(): SetupStatus {
    return this.start({ lm: this.currentLm(), xl: true });
  }

  /** Spuren-Modell nachladen (Einstellungen › Spuren-Modell); danach startet der Modellserver neu und kennt es. */
  addStems(): SetupStatus {
    return this.start({ lm: this.currentLm(), xl: false, stems: true });
  }

  /** XL-Spuren-Modell nachladen (Einstellungen › Spuren-Modell); danach startet der Modellserver neu und kennt es. */
  addXlStems(): SetupStatus {
    return this.start({ lm: this.currentLm(), xl: false, stems_xl: true });
  }

  /** Eingerichtetes Sprachmodell (für das Nachladen einzelner Modelle) */
  private currentLm(): LmSize {
    const size = LM_SIZES.find((s) => lmFileName(s) === this.deps.engineConf.get().lmFile);
    if (!this.deps.packaged || !size) throw new AppError("bad_request", "setup_unavailable");
    return size;
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

  private async run(size: LmSize, verify: ModelFile[], missing: ModelFile[], signal: AbortSignal): Promise<void> {
    const { catalog, modelsDir, engineConf, engine, log } = this.deps;
    await this.guard(signal, async () => {
      if (verify.length) {
        this.phase = "verifying";
        this.totalBytes = verify.reduce((sum, f) => sum + f.mb * MB, 0);
        this.doneBytes = 0;
        for (const f of verify) {
          this.file = f.name;
          const before = this.doneBytes;
          const path = join(modelsDir, f.name);
          if (!(await verifyModel(path, f.sha256, (bytes) => { this.doneBytes = before + bytes; }, signal))) {
            log(`Model ${f.name} is damaged, downloading it again`);
            await rm(path, { force: true });
            missing = [...missing, f];
          }
          this.doneBytes = before + f.mb * MB;
        }
        signal.throwIfAborted();
      }
      await this.download(catalog.baseUrl, modelsDir, missing, signal);

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
    });
  }

  /** Fehlende Dateien nacheinander laden (Fortschritt über status()). */
  private async download(baseUrl: string, dir: string, files: ModelFile[], signal: AbortSignal): Promise<void> {
    this.phase = "downloading";
    this.totalBytes = files.reduce((sum, f) => sum + f.mb * MB, 0);
    this.doneBytes = 0;
    for (const f of files) {
      this.file = f.name;
      const before = this.doneBytes;
      await downloadModel(`${baseUrl}/${f.name}`, dir, f.name, f.sha256, (bytes) => { this.doneBytes = before + bytes; }, signal);
      signal.throwIfAborted();
      this.doneBytes = before + f.mb * MB;
      this.deps.log(`Model ${f.name} downloaded`);
    }
    this.file = "";
    signal.throwIfAborted();
  }

  /** Abbruch zurück auf "idle", Fehler als phase "error" mit Meldung */
  private async guard(signal: AbortSignal, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (e) {
      this.file = "";
      if (signal.aborted) {
        this.phase = "idle";
        return;
      }
      this.phase = "error";
      this.error = e instanceof ChecksumError ? `checksum:${e.message}` : (e as Error).message;
      this.deps.log(`Setup failed: ${this.error}`);
    }
  }
}
