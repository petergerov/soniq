// Einstieg und Composition Root: hier (und nur hier) werden alle Bausteine erzeugt und verbunden.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, type AppConfig } from "./config/app-config.ts";
import { STEM_MODEL, type MusicEngineFactory } from "./domain/music-engine.ts";
import { HttpServer } from "./http/http-server.ts";
import { registerFolderRoutes } from "./http/routes/folder-routes.ts";
import { registerPresetRoutes } from "./http/routes/preset-routes.ts";
import { registerSetupRoutes } from "./http/routes/setup-routes.ts";
import { registerStemRoutes } from "./http/routes/stem-routes.ts";
import { registerSongRoutes } from "./http/routes/song-routes.ts";
import { registerSystemRoutes } from "./http/routes/system-routes.ts";
import { Router } from "./http/router.ts";
import { StaticFiles } from "./http/static-files.ts";
import { AceStepEngine } from "./infrastructure/ace-step-engine.ts";
import { Database } from "./infrastructure/database.ts";
import { EngineConf } from "./infrastructure/engine-conf.ts";
import { EngineSupervisor } from "./infrastructure/engine-supervisor.ts";
import { loadCatalog } from "./infrastructure/model-catalog.ts";
import { buildFrontendIfStale } from "./infrastructure/frontend-build.ts";
import { FolderRepository } from "./infrastructure/folder-repository.ts";
import { PresetRepository } from "./infrastructure/preset-repository.ts";
import { Git } from "./infrastructure/git.ts";
import { createKeepAwake } from "./infrastructure/keep-awake.ts";
import { createProcessLauncher } from "./infrastructure/process-launcher.ts";
import { SettingsRepository } from "./infrastructure/settings-repository.ts";
import { SongRepository } from "./infrastructure/song-repository.ts";
import { SongStorage } from "./infrastructure/song-storage.ts";
import { StemRepository } from "./infrastructure/stem-repository.ts";
import { AnalysisService } from "./services/analysis-service.ts";
import { FolderService } from "./services/folder-service.ts";
import { PresetService } from "./services/preset-service.ts";
import { SetupService } from "./services/setup-service.ts";
import { TrackByTrack } from "./services/track-by-track.ts";
import { StemService } from "./services/stem-service.ts";
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

/** Windows: Verknüpfungen "Music Generator ON/OFF" aus der Zeit vor der Umbenennung durch "SONIQ Start/Stop" ersetzen. */
function migrateWindowsShortcuts(config: AppConfig): void {
  if (config.platform !== "win32" || !existsSync(join(config.root, "Music Generator ON.lnk"))) return;
  spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(config.root, "scripts", "shortcuts.ps1")], { stdio: "ignore", detached: true })
    .on("error", () => {}).unref();
}

async function main(): Promise<void> {
  const config = loadConfig();

  // Infrastruktur
  const db = new Database(config.dbPath);
  db.migrate();
  const songs = new SongRepository(db);
  const folders = new FolderRepository(db);
  const presets = new PresetService(new PresetRepository(db));
  const engineConf = new EngineConf(config.engineConfPath);
  const settings = new SettingsRepository(db, engineConf, config);
  const storage = new SongStorage(config.defaultSongsDir, () => settings.get().songs_dir);
  const engineFactory: MusicEngineFactory = (s) => new AceStepEngine(s);
  const launcher = createProcessLauncher(config.platform);

  // Services
  const stems = new StemRepository(db);
  const stemService = new StemService({ stems, songs, storage });
  const trackByTrack = new TrackByTrack({ stems, storage, removeStems: (id) => stemService.removeForSong(id) });
  const worker = new GenerationWorker({ songs, settings, storage, engineFactory, keepAwake: createKeepAwake(config.platform), trackByTrack, log });
  const generation = new GenerationService({
    songs, folders, storage, jobs: worker, removeStems: (id) => stemService.removeForSong(id),
    stemsAvailable: () => existsSync(join(config.modelsDir, STEM_MODEL)),
  });
  const library = new LibraryService({ songs, folders, storage, stemCounts: () => stems.doneCounts() });
  const folderService = new FolderService(folders, songs);
  const settingsService = new SettingsService({ settings, songs, storage, modelsDir: config.modelsDir, packaged: config.packaged });
  const analysis = new AnalysisService(settings, engineFactory);
  const system = new SystemService({ root: config.root, platform: config.platform, packaged: config.packaged, settings, engineFactory, launcher });
  // Fertige App: Modellserver startet das Backend selbst, die Einrichtung lädt Modelle und testet den Grafikchip
  const engine = new EngineSupervisor({ bin: config.engineBin, modelsDir: config.modelsDir, dataDir: config.dataDir, synthPort: config.synthPort, lmPort: config.lmPort, log });
  const setup = new SetupService({
    packaged: config.packaged, catalog: loadCatalog(config.root), modelsDir: config.modelsDir, engineConf, engine, synthPort: config.synthPort, log,
  });
  const updates = new UpdateService({
    root: config.root, platform: config.platform, packaged: config.packaged, appVersion: config.appVersion, git: new Git(config.root), songs, launcher, port: config.port,
    serverCommand: [process.execPath, ...process.execArgv, config.entryFile, "--port", String(config.port)],
  });

  // HTTP
  const router = new Router();
  registerSongRoutes(router, generation, library);
  registerFolderRoutes(router, folderService, library);
  registerPresetRoutes(router, presets);
  registerSetupRoutes(router, setup);
  registerStemRoutes(router, stemService);
  registerSystemRoutes(router, { settings: settingsService, analysis, system, updates });
  const server = new HttpServer(router, new StaticFiles(config.frontendDir), log);

  // Start
  songs.requeueInterrupted();
  await removeLeftovers(config.dataDir);
  if (!config.packaged) {
    refreshMacIcons(config);
    migrateWindowsShortcuts(config);
  }
  await server.listen(config.port, config.host);
  log(`SONIQ läuft auf http://localhost:${config.port}`);
  // Die fertige App bringt Oberfläche, Symbole und Verknüpfungen selbst mit
  if (!config.packaged) buildFrontendIfStale(config.root, config.dataDir, log);
  if (config.packaged) void setup.startEngineIfReady();
  const working = worker.run();
  worker.wake();

  const shutdown = async () => {
    worker.stop();
    await server.close();
    await engine.stop();
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
