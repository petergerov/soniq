// Stem Separation mit Demucs (demucs.cpp, MIT): ein eigenes Trennmodell statt ACE-Step extract.
// Rechnet nur auf der CPU (auf dem Mac mit Accelerate), liefert alle Spuren eines Modells in einem Durchgang.
// demucs.cpp liest nur 44,1 kHz: hin- und zurückgerechnet wird hier, die Spuren haben danach wieder die Song-Rate.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism, totalmem } from "node:os";
import { join } from "node:path";
import type { DemucsModel, StemTrack } from "../../../shared/api.ts";
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

export interface DemucsDeps {
  binDir: string;
  modelsDir: string;
  /** Ordner für Zwischendateien (wird je Lauf angelegt und wieder gelöscht) */
  tmpDir: string;
  log: (message: string) => void;
}

export class DemucsSeparator {
  private readonly deps: DemucsDeps;

  constructor(deps: DemucsDeps) {
    this.deps = deps;
  }

  /** Programm und alle Modelldateien da? */
  available(model: DemucsModel): boolean {
    const spec = SPECS[model];
    return existsSync(join(this.deps.binDir, spec.bin))
      && spec.files.every((f) => existsSync(join(this.deps.modelsDir, DEMUCS_MODEL_DIR, f)));
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
      const modelArg = model === "demucs_ft"
        ? join(this.deps.modelsDir, DEMUCS_MODEL_DIR)
        : join(this.deps.modelsDir, DEMUCS_MODEL_DIR, spec.files[0]!);
      const out = join(dir, "out");
      const threads = demucsThreads();
      this.deps.log(`Demucs ${model}: ${threads} threads`);
      await this.run(join(this.deps.binDir, spec.bin), [modelArg, input, out, String(threads)], signal);
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
