// Stem Separation mit Demucs (demucs.cpp, MIT): ein eigenes Trennmodell statt ACE-Step extract.
// demucs.cpp rechnet nur auf der CPU (auf dem Mac mit Accelerate), liefert alle Spuren eines Modells in einem Durchgang.
// Auf dem Mac rechnet htdemucs_6s als Core ML (soniq-demucs, macos/demucs-coreml.swift), wenn Programm und Modell da
// sind: auf der GPU etwa neunmal so schnell, auf der CPU fünfmal (Einstellung demucs_device). Scheitert es, übernimmt
// demucs.cpp. Beide lesen nur 44,1 kHz: hin- und zurückgerechnet wird hier, die Spuren haben danach die Song-Rate.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism, totalmem } from "node:os";
import { join } from "node:path";
import type { DemucsDevice, DemucsModel, StemTrack } from "../../../shared/api.ts";
import { EngineError } from "../domain/music-engine.ts";
import { encodeWav, parseWav, resample, type Pcm } from "./wav.ts";

const DEMUCS_RATE = 44100;
/** Unterordner im Modellordner (htdemucs_ft sucht seine vier Dateien in einem Ordner) */
export const DEMUCS_MODEL_DIR = "demucs";

interface ModelSpec {
  bin: string;
  files: readonly string[];
  /** Ausgaben von demucs.cpp (target_<i>_<name>.wav) und ihre Spur in SONIQ */
  outputs: readonly [string, StemTrack][];
}

const FOUR: readonly [string, StemTrack][] = [["drums", "drums"], ["bass", "bass"], ["other", "other"], ["vocals", "vocals"]];
/** Core-ML-Programm neben den Programmen von demucs.cpp, und die Modelle, die es rechnen kann (STFT im Modell) */
const COREML_BIN = "soniq-demucs";
const COREML_PACKAGES: Partial<Record<DemucsModel, string>> = { demucs_6s: "demucs_6s_f32.mlpackage" };

const SPECS: Record<DemucsModel, ModelSpec> = {
  demucs_ft: {
    bin: "demucs_ft_mt.cpp.main",
    files: ["drums", "bass", "other", "vocals"].map((t) => `ggml-model-htdemucs_ft_${t}-4s-f16.bin`),
    outputs: FOUR,
  },
  demucs_6s: {
    bin: "demucs_mt.cpp.main",
    files: ["ggml-model-htdemucs-6s-f16.bin"],
    outputs: [...FOUR, ["guitar", "guitar"], ["piano", "keyboard"]],
  },
};

/**
 * Threads nach Arbeitsspeicher: je Thread etwa 1,7 GB (gemessen: 4 Threads 6,7 GB bei htdemucs_6s, 7,4 GB bei
 * htdemucs_ft), daneben hält der Modellserver seine Modelle. 4 Threads waren auf einem Mac mit 32 GB gut doppelt so
 * schnell wie einer.
 */
export function demucsThreads(ramBytes = totalmem(), cores = availableParallelism()): number {
  const gb = ramBytes / 2 ** 30;
  const byRam = gb >= 24 ? 4 : gb >= 12 ? 2 : 1;
  return Math.max(1, Math.min(byRam, cores));
}

/**
 * Debian-Paket (amd64): die Programme liegen zweimal bei, für jede x86-64-CPU und im Unterordner avx2/ für CPUs mit
 * AVX2 und FMA (seit 2013/2017, etwa doppelt so schnell). Hier den passenden Ordner wählen.
 */
function pickBinDir(binDir: string): string {
  const fast = join(binDir, "avx2");
  if (process.platform !== "linux" || !existsSync(fast)) return binDir;
  try {
    const flags = /^flags\s*:(.*)$/m.exec(readFileSync("/proc/cpuinfo", "utf8"))?.[1]?.split(/\s+/) ?? [];
    return flags.includes("avx2") && flags.includes("fma") ? fast : binDir;
  } catch {
    return binDir;
  }
}

export interface DemucsDeps {
  binDir: string;
  modelsDir: string;
  /** Ordner für Zwischendateien (wird je Lauf angelegt und wieder gelöscht) */
  tmpDir: string;
  log: (message: string) => void;
  /** Core ML auf GPU oder CPU (Einstellungen) */
  device: () => DemucsDevice;
  platform?: NodeJS.Platform;
}

export class DemucsSeparator {
  private readonly deps: DemucsDeps;

  constructor(deps: DemucsDeps) {
    this.deps = { ...deps, binDir: pickBinDir(deps.binDir) };
  }

  /** Beide Programme da (dann lassen sich die Modelle laden)? */
  supported(): boolean {
    return Object.values(SPECS).every((spec) => existsSync(join(this.deps.binDir, spec.bin)));
  }

  /** Core-ML-Programm da (macOS)? Dann lässt sich auch das Core-ML-Modell laden. */
  coremlSupported(): boolean {
    return (this.deps.platform ?? process.platform) === "darwin" && existsSync(join(this.deps.binDir, COREML_BIN));
  }

  /** Rechnet dieses Modell als Core ML (Programm und entpacktes Modell da)? */
  coremlAvailable(model: DemucsModel): boolean {
    const pkg = COREML_PACKAGES[model];
    return !!pkg && this.coremlSupported() && existsSync(join(this.deps.modelsDir, DEMUCS_MODEL_DIR, pkg, "Manifest.json"));
  }

  coremlAvailability(): Record<DemucsModel, boolean> {
    return { demucs_ft: this.coremlAvailable("demucs_ft"), demucs_6s: this.coremlAvailable("demucs_6s") };
  }

  /** demucs.cpp: Programm und alle Modelldateien da? */
  private cppAvailable(model: DemucsModel): boolean {
    const spec = SPECS[model];
    return existsSync(join(this.deps.binDir, spec.bin))
      && spec.files.every((f) => existsSync(join(this.deps.modelsDir, DEMUCS_MODEL_DIR, f)));
  }

  /** Lässt sich das Modell rechnen (Core ML oder demucs.cpp)? */
  available(model: DemucsModel): boolean {
    return this.coremlAvailable(model) || this.cppAvailable(model);
  }

  availability(): Record<DemucsModel, boolean> {
    return { demucs_ft: this.available("demucs_ft"), demucs_6s: this.available("demucs_6s") };
  }

  /** Trennt den Song; Ergebnis je Spur mit der Rate des Songs. `signal` beendet den Prozess. */
  async separate(model: DemucsModel, song: Pcm, signal: AbortSignal): Promise<Map<StemTrack, Pcm>> {
    const spec = SPECS[model];
    await mkdir(this.deps.tmpDir, { recursive: true });
    const dir = await mkdtemp(join(this.deps.tmpDir, "demucs-"));
    try {
      const input = join(dir, "song.wav");
      await writeFile(input, encodeWav(resample(song, DEMUCS_RATE), 32));
      const out = join(dir, "out");
      if (!(await this.coreml(model, input, out, signal))) {
        const modelArg = model === "demucs_ft"
          ? join(this.deps.modelsDir, DEMUCS_MODEL_DIR)
          : join(this.deps.modelsDir, DEMUCS_MODEL_DIR, spec.files[0]!);
        const threads = demucsThreads();
        this.deps.log(`Demucs ${model}: demucs.cpp, ${threads} threads`);
        await this.run(join(this.deps.binDir, spec.bin), [modelArg, input, out, String(threads)], signal);
      }
      const stems = new Map<StemTrack, Pcm>();
      for (const [i, [name, track]] of spec.outputs.entries()) {
        const file = join(out, `target_${i}_${name}.wav`);
        if (!existsSync(file)) throw new EngineError(`Demucs: ${name} fehlt in der Ausgabe`);
        stems.set(track, resample(parseWav(await readFile(file)), song.sampleRate));
      }
      return stems;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Core ML versuchen. true = Spuren liegen in `out`; false = nicht möglich oder gescheitert (dann demucs.cpp, sofern
   * dessen Dateien da sind; sonst geht der Fehler weiter).
   */
  private async coreml(model: DemucsModel, input: string, out: string, signal: AbortSignal): Promise<boolean> {
    if (!this.coremlAvailable(model)) return false;
    const device = this.deps.device();
    const start = performance.now();
    try {
      await this.run(join(this.deps.binDir, COREML_BIN), [join(this.deps.modelsDir, DEMUCS_MODEL_DIR, COREML_PACKAGES[model]!), input, out, device], signal);
      this.deps.log(`Demucs ${model}: Core ML (${device}), ${Math.round((performance.now() - start) / 1000)} s`);
      return true;
    } catch (e) {
      if (signal.aborted || !this.cppAvailable(model)) throw e;
      this.deps.log(`Demucs ${model}: Core ML failed (${(e as Error).message}), using demucs.cpp`);
      await rm(out, { recursive: true, force: true });
      return false;
    }
  }

  private run(bin: string, args: string[], signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
      const abort = () => child.kill("SIGTERM");
      signal.addEventListener("abort", abort, { once: true });
      child.on("error", (e) => {
        signal.removeEventListener("abort", abort);
        reject(new EngineError(`Demucs konnte nicht starten: ${e.message}`));
      });
      child.on("close", (code) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) return reject(signal.reason);
        if (code === 0) return resolve();
        const last = stderr.trim().split("\n").filter(Boolean).pop() ?? `exit ${code}`;
        reject(new EngineError(`Demucs: ${last}`));
      });
    });
  }
}
