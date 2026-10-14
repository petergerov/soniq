// Baut die Oberfläche beim Start, wenn sie fehlt oder älter als ihre Quellen ist (frontend/dist liegt nicht im
// Repository, z. B. direkt nach einem Update). Läuft im Hintergrund; bis dahin zeigt die App eine Warteseite.
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { join } from "node:path";

export function buildFrontendIfStale(root: string, dataDir: string, log: (message: string) => void): void {
  const out = openSync(join(dataDir, "frontend-build.log"), "w");
  spawn(process.execPath, [join(root, "scripts", "build-frontend.mjs"), "--if-stale"], { cwd: root, stdio: ["ignore", out, out] })
    .on("error", (e) => log(`Building the interface failed: ${e.message}`))
    .on("exit", (code) => { if (code) log("Building the interface failed, see data/frontend-build.log"); });
}
