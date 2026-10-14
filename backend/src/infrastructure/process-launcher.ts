// Startet Hintergrund-Skripte, die diesen Server überleben müssen (Stoppen, Neustart nach Update).
import { spawn } from "node:child_process";
import { openSync } from "node:fs";

export interface ProcessLauncher {
  /** PowerShell-Befehl (Windows) bzw. sh-Befehl (sonst) abgekoppelt ausführen. */
  launchDetached(command: string, options: { cwd: string; logFile?: string }): void;
}

/** Text als PowerShell-Literal in einfachen Anführungszeichen. */
export function psQuote(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}

/**
 * Unter Windows hängt Node seine Kindprozesse an ein Job-Objekt, das sie beim Beenden mitnimmt; und mit
 * DETACHED_PROCESS (Node: detached) führt PowerShell 5.1 Befehle gar nicht aus. Deshalb startet ein
 * kurzlebiges PowerShell per Start-Process den eigentlichen Befehl: dieser Enkelprozess ist frei.
 */
export class WindowsProcessLauncher implements ProcessLauncher {
  launchDetached(command: string, options: { cwd: string; logFile?: string }): void {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command].map(psQuote).join(",");
    const redirect = options.logFile
      ? ` -RedirectStandardOutput ${psQuote(options.logFile)} -RedirectStandardError ${psQuote(options.logFile.replace(/\.log$/, ".err.log"))}`
      : "";
    const outer = `Start-Process -FilePath powershell -WindowStyle Hidden -WorkingDirectory ${psQuote(options.cwd)} -ArgumentList ${args}${redirect}`;
    spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", outer], {
      cwd: options.cwd, stdio: "ignore", windowsHide: true,
    });
  }
}

export class PosixProcessLauncher implements ProcessLauncher {
  launchDetached(command: string, options: { cwd: string; logFile?: string }): void {
    const out = options.logFile ? openSync(options.logFile, "a") : "ignore";
    const child = spawn("/bin/sh", ["-c", command], { cwd: options.cwd, stdio: ["ignore", out, out], detached: true });
    child.unref();
  }
}

export function createProcessLauncher(platform: NodeJS.Platform): ProcessLauncher {
  return platform === "win32" ? new WindowsProcessLauncher() : new PosixProcessLauncher();
}
