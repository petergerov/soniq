// Verhindert den Ruhezustand, solange Songs gerechnet werden (sonst bleibt die Berechnung
// nach 10-20 Minuten Inaktivität einfach stehen). Wachhalten ist Komfort: Fehler werden ignoriert.
import { spawn, type ChildProcess } from "node:child_process";

export interface KeepAwake {
  enable(): void;
  disable(): void;
}

/** Hält einen Hilfsprozess am Leben, solange wachgehalten werden soll. */
abstract class HelperProcessKeepAwake implements KeepAwake {
  private child: ChildProcess | undefined;

  protected abstract start(): ChildProcess;

  enable(): void {
    if (this.child) return;
    try {
      this.child = this.start();
      this.child.on("error", () => { this.child = undefined; });
      this.child.on("exit", () => { this.child = undefined; });
    } catch {
      this.child = undefined;
    }
  }

  disable(): void {
    this.child?.kill();
    this.child = undefined;
  }
}

/** macOS: caffeinate, endet spätestens mit diesem Server (-w). */
export class MacKeepAwake extends HelperProcessKeepAwake {
  protected start(): ChildProcess {
    return spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
  }
}

/** Windows: SetThreadExecutionState in einem PowerShell-Hilfsprozess (Node hat keinen direkten Zugriff). */
export class WindowsKeepAwake extends HelperProcessKeepAwake {
  protected start(): ChildProcess {
    const script =
      "Add-Type -Name P -Namespace W -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);';" +
      "[W.P]::SetThreadExecutionState(0x80000001) | Out-Null;" +   // ES_CONTINUOUS | ES_SYSTEM_REQUIRED
      `while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 10 }`;
    return spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { stdio: "ignore", windowsHide: true });
  }
}

/** Linux: systemd-inhibit, falls vorhanden. */
export class LinuxKeepAwake extends HelperProcessKeepAwake {
  protected start(): ChildProcess {
    return spawn("systemd-inhibit", ["--what=idle:sleep", "--who=SONIQ", "--why=Generating songs", "sleep", "infinity"], { stdio: "ignore" });
  }
}

export function createKeepAwake(platform: NodeJS.Platform): KeepAwake {
  if (platform === "darwin") return new MacKeepAwake();
  if (platform === "win32") return new WindowsKeepAwake();
  return new LinuxKeepAwake();
}
