// Git-Aufrufe im Programmordner (für Updates).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export class GitError extends Error {
  override name = "GitError";
  readonly timedOut: boolean;

  constructor(message: string, timedOut = false) {
    super(message);
    this.timedOut = timedOut;
  }
}

export class Git {
  private readonly cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  hasRepository(): boolean {
    return existsSync(join(this.cwd, ".git"));
  }

  run(args: string[], timeoutSeconds = 60): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("git", args, {
        cwd: this.cwd,
        timeout: timeoutSeconds * 1000,
        encoding: "utf8",                              // Commit-Texte sind UTF-8 (auch unter Windows)
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },   // nie nach Passwort fragen
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (!error) return resolve(stdout.trim());
        const timedOut = (error as { killed?: boolean }).killed === true;
        reject(new GitError((stderr || stdout).trim() || `git ${args[0]} fehlgeschlagen`, timedOut));
      });
    });
  }

  async lines(args: string[], timeoutSeconds?: number): Promise<string[]> {
    const out = await this.run(args, timeoutSeconds);
    return out ? out.split(/\r?\n/) : [];
  }
}
