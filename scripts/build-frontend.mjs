// Baut die Oberfläche (frontend/dist) auf diesem Rechner; dist/ liegt nicht im Repository.
// 1. npm ci, wenn die Pakete fehlen oder package-lock.json neuer ist als die installierten Pakete
// 2. vite build
// Läuft mit der Node-Laufzeit, mit der es gestartet wird (auch der portablen in runtime/node), und braucht weder
// npm noch node im PATH. Aufruf von Installer und App:  node scripts/build-frontend.mjs [--if-stale]
// --if-stale: nur bauen, wenn der Build fehlt oder Quellen neuer sind (beim Start der App).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = join(ROOT, "frontend");
const BUILT = join(FRONTEND, "dist", "index.html");
const LOCK = join(ROOT, "package-lock.json");
const INSTALLED = join(ROOT, "node_modules", ".package-lock.json");   // schreibt npm nach jeder Installation
const SOURCES = ["src", "public", "index.html", "vite.config.ts", "tsconfig.json", "package.json"].map((p) => join(FRONTEND, p))
  .concat(join(ROOT, "shared"), LOCK);

/** Jüngste Änderungszeit einer Datei oder eines Ordners samt Inhalt (0 = fehlt). */
function newest(path) {
  if (!existsSync(path)) return 0;
  const info = statSync(path);
  if (!info.isDirectory()) return info.mtimeMs;
  return Math.max(info.mtimeMs, ...readdirSync(path).map((name) => newest(join(path, name))));
}

// Kindprozesse (npm-Skripte der Pakete, z. B. esbuild) finden "node" auch ohne Eintrag im PATH
const env = { ...process.env, PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter) };

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: command.endsWith(".cmd") });
  if (result.status !== 0) {
    console.error(`Building the interface failed: ${[command, ...args].join(" ")}`);
    process.exit(1);
  }
}

/** npm von derselben Node-Installation (Mac/Linux: lib/node_modules, Windows: node_modules neben node.exe). */
function npm(args) {
  const dir = dirname(process.execPath);
  const cli = [join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"), join(dir, "node_modules", "npm", "bin", "npm-cli.js")]
    .find(existsSync);
  if (cli) run(process.execPath, [cli, ...args], ROOT);
  else run(process.platform === "win32" ? "npm.cmd" : "npm", args, ROOT);
}

if (process.argv.includes("--if-stale") && existsSync(BUILT) && newest(BUILT) >= Math.max(...SOURCES.map(newest))) process.exit(0);

if (!existsSync(INSTALLED) || newest(LOCK) > newest(INSTALLED)) {
  console.log("Installing packages for the interface (npm ci) ...");
  npm(["ci", "--include=dev", "--no-audit", "--no-fund", "--loglevel=error"]);
}

console.log("Building the interface ...");
const vite = join(dirname(createRequire(join(FRONTEND, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
run(process.execPath, [vite, "build", "--logLevel", "warn"], FRONTEND);
console.log("Interface built.");
