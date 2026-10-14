// Einstieg und Composition Root: hier (und nur hier) werden alle Bausteine erzeugt und verbunden.
import { spawn } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, type AppConfig } from "./config/app-config.ts";
import type { MusicEngineFactory } from "./domain/music-engine.ts";
import { HttpServer } from "./http/http-server.ts";
import { registerFolderRoutes } from "./http/routes/folder-routes.ts";
import { registerPresetRoutes } from "./http/routes/preset-routes.ts";
import { registerSongRoutes } from "./http/routes/song-routes.ts";
import { registerSystemRoutes } from "./http/routes/system-routes.ts";
import { Router } from "./http/router.ts";
import { StaticFiles } from "./http/static-files.ts";
import { AceStepEngine } from "./infrastructure/ace-step-engine.ts";
import { Database } from "./infrastructure/database.ts";
import { FolderRepository } from "./infrastructure/folder-repository.ts";
import { PresetRepository } from "./infrastructure/preset-repository.ts";
import { Git } from "./infrastructure/git.ts";
import { createKeepAwake } from "./infrastructure/keep-awake.ts";
import { createProcessLauncher } from "./infrastructure/process-launcher.ts";
import { SettingsRepository } from "./infrastructure/settings-repository.ts";
import { SongRepository } from "./infrastructure/song-repository.ts";
import { SongStorage } from "./infrastructure/song-storage.ts";
import { AnalysisService } from "./services/analysis-service.ts";
import { FolderService } from "./services/folder-service.ts";
import { PresetService } from "./services/preset-service.ts";
import { GenerationService } from "./services/generation-service.ts";
import { GenerationWorker } from "./services/generation-worker.ts";
import { LibraryService } from "./services/library-service.ts";
import { SettingsService } from "./services/settings-service.ts";
import { SystemService } from "./services/system-service.ts";
import { UpdateService } from "./services/update-service.ts";

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

/** Reste abgebrochener Downloads der Python-Version (mg-*.zip) entfernen. */
async function removeLeftovers(dataDir: string): Promise<void> {
  const names = await readdir(dataDir).catch(() => [] as string[]);
  await Promise.all(names.filter((n) => /^mg-.*\.zip$/.test(n)).map((n) => rm(join(dataDir, n), { force: true })));
}

/** macOS: Symbole der Start-Dateien erneuern (Git/ZIP setzen sie zurück). */
function refreshMacIcons(config: AppConfig): void {
  if (config.platform !== "darwin") return;
  spawn("bash", [join(config.root, "scripts", "symbole.sh")], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

async function main(): Promise<void> {
  const config = loadConfig();

  // Infrastruktur
  const db = new Database(config.dbPath);
  db.migrate();
  const songs = new SongRepository(db);
  const folders = new FolderRepository(db);
  const presets = new PresetService(new PresetRepository(db));
  const settings = new SettingsRepository(db, config);
  const storage = new SongStorage(config.defaultSongsDir, () => settings.get().songs_dir);
  const engineFactory: MusicEngineFactory = (s) => new AceStepEngine(s);
  const launcher = createProcessLauncher(config.platform);

  // Services
  const worker = new GenerationWorker({ songs, settings, storage, engineFactory, keepAwake: createKeepAwake(config.platform), log });
  const generation = new GenerationService({ songs, folders, storage, jobs: worker });
  const library = new LibraryService({ songs, folders, storage });
  const folderService = new FolderService(folders, songs);
  const settingsService = new SettingsService({ settings, songs, storage, modelsDir: config.modelsDir });
  const analysis = new AnalysisService(settings, engineFactory);
  const system = new SystemService({ root: config.root, platform: config.platform, settings, engineFactory, launcher });
  const updates = new UpdateService({
    root: config.root, platform: config.platform, git: new Git(config.root), songs, launcher, port: config.port,
    serverCommand: [process.execPath, ...process.execArgv, config.entryFile, "--port", String(config.port)],
  });

  // HTTP
  const router = new Router();
  registerSongRoutes(router, generation, library);
  registerFolderRoutes(router, folderService, library);
  registerPresetRoutes(router, presets);
  registerSystemRoutes(router, { settings: settingsService, analysis, system, updates });
  const server = new HttpServer(router, new StaticFiles(config.frontendDir), log);

  // Start
  songs.requeueInterrupted();
  await removeLeftovers(config.dataDir);
  refreshMacIcons(config);
  await server.listen(config.port, config.host);
  log(`Music Generator läuft auf http://localhost:${config.port}`);
  const working = worker.run();
  worker.wake();

  const shutdown = async () => {
    worker.stop();
    await server.close();
    await working.catch(() => {});
    db.close();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
