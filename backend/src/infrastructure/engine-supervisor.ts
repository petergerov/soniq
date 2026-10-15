// Startet und stoppt den Modellserver (acestep.cpp) für die fertige App. Bei Installationen aus dem
// Projektordner machen das die Skripte start/stop, dort wird diese Klasse nicht benutzt.
// Modus "split": zusätzlich ein Sprachmodell-Server auf der CPU (für Grafikchips, auf denen es falsch rechnet).
import { spawn, type ChildProcess } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { EngineConf, EngineMode } from "./engine-conf.ts";

export interface EngineSupervisorDeps {
  bin: string;
  modelsDir: string;
  dataDir: string;
  synthPort: number;
  lmPort: number;
  engineConf: EngineConf;
  log: (message: string) => void;
}

const START_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 5_000;

async function healthy(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

function tail(path: string, lines = 8): string {
  try {
    return readFileSync(path, "utf8").trim().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

export class EngineSupervisor {
  private readonly deps: EngineSupervisorDeps;
  private children: ChildProcess[] = [];

  constructor(deps: EngineSupervisorDeps) {
    this.deps = deps;
    // Letzte Sicherung: beim Beenden des Servers keine Modellserver zurücklassen
    process.once("exit", () => this.children.forEach((c) => c.kill()));
  }

  /** Startet die Server für den Modus (laufende eigene werden vorher beendet) und wartet, bis sie antworten. */
  async start(mode: EngineMode): Promise<void> {
    await this.stop();
    const { synthPort, lmPort } = this.deps;
    await this.launch(synthPort, "ace-server.log", {}, true);
    if (mode === "split") await this.launch(lmPort, "ace-lm.log", { GGML_BACKEND: "CPU" }, false);
  }

  async stop(): Promise<void> {
    const children = this.children;
    this.children = [];
    await Promise.all(children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      if (await Promise.race([exited.then(() => true), sleep(STOP_TIMEOUT_MS).then(() => false)])) return;
      child.kill("SIGKILL");
      await exited;
    }));
  }

  private async launch(port: number, logName: string, env: Record<string, string>, synth: boolean): Promise<void> {
    if (await healthy(port)) {
      // z. B. von einem abgestürzten Vorgänger übrig: weiterverwenden statt am belegten Port zu scheitern
      this.deps.log(`Model server on port ${port} is already running, using it`);
      return;
    }
    const logPath = join(this.deps.dataDir, logName);
    const out = openSync(logPath, "a");
    // Synth: --keep-loaded auf macOS (unified memory), damit Stem Separation Modelle nicht jedes Mal neu lädt
    const args = ["--host", "127.0.0.1", "--port", String(port), "--models", this.deps.modelsDir, "--max-batch", "1"];
    if (synth) {
      const conf = this.deps.engineConf.get();
      if (conf.keepLoaded ?? process.platform === "darwin") args.push("--keep-loaded");
      if (conf.vaeChunk) args.push("--vae-chunk", conf.vaeChunk);
    }
    const child = spawn(this.deps.bin, args, {
      stdio: ["ignore", out, out], env: { ...process.env, ...env },
    });
    this.children.push(child);
    let failure: Error | undefined;
    child.once("error", (e) => { failure = e; });
    child.once("exit", (code) => { failure ??= new Error(`model server exited (${code ?? "signal"})`); });
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (failure) throw new Error(`${failure.message}\n${tail(logPath)}`);
      if (await healthy(port)) return;
      await sleep(500);
    }
    throw new Error(`model server on port ${port} did not start in time\n${tail(logPath)}`);
  }
}
