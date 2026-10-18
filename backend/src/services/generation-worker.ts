// Arbeitet die Warteschlange strikt nacheinander ab (eine GPU, ein Job).
import type { SongParams } from "../../../shared/api.ts";
import { EngineError, type MusicEngineFactory } from "../domain/music-engine.ts";
import { nowIso } from "../domain/song.ts";
import type { KeepAwake } from "../infrastructure/keep-awake.ts";
import type { SettingsRepository } from "../infrastructure/settings-repository.ts";
import type { SongRepository } from "../infrastructure/song-repository.ts";
import type { SongStorage } from "../infrastructure/song-storage.ts";
import { wavDepthFor } from "../infrastructure/wav.ts";
import type { ExtractTracks } from "./extract.ts";
import type { StemVersions } from "./stem-versions.ts";
import { hasAccompany, hasReplace, type ReplaceAccompany } from "./replace-accompany.ts";
import { hasRepaint, runRepaint } from "./repaint.ts";
import { hasTracks, type TrackByTrack } from "./track-by-track.ts";

/** Was andere Services vom Worker brauchen: anstoßen und einen laufenden Auftrag abbrechen. */
export interface JobRunner {
  wake(): void;
  cancel(songId: string): void;
}

export interface GenerationWorkerDeps {
  songs: SongRepository;
  settings: SettingsRepository;
  storage: SongStorage;
  engineFactory: MusicEngineFactory;
  keepAwake: KeepAwake;
  /** "Spur für Spur" (Songs mit params.mode "tracks") */
  trackByTrack: TrackByTrack;
  extract: ExtractTracks;
  replaceAccompany: ReplaceAccompany;
  versions: StemVersions;
  nextStemJobSongId: () => string | undefined;
  log?: (message: string) => void;
}

export class GenerationWorker implements JobRunner {
  private readonly deps: GenerationWorkerDeps;
  private wakeUp: (() => void) | undefined;
  private pendingWake = false;
  private running: { songId: string; abort: AbortController } | undefined;
  private stopped = false;

  constructor(deps: GenerationWorkerDeps) {
    this.deps = deps;
  }

  wake(): void {
    this.pendingWake = true;
    this.wakeUp?.();
  }

  cancel(songId: string): void {
    if (this.running?.songId === songId) this.running.abort.abort();
  }

  stop(): void {
    this.stopped = true;
    this.running?.abort.abort();
    this.wake();
  }

  /** Läuft, bis stop() aufgerufen wird. */
  async run(): Promise<void> {
    while (!this.stopped) {
      const job = this.deps.songs.nextQueued();
      const stemJobId = job ? undefined : this.deps.nextStemJobSongId();
      if (!job && !stemJobId) {
        this.deps.keepAwake.disable();
        await this.sleepUntilWoken();
        continue;
      }
      this.deps.keepAwake.enable();
      if (job) await this.process(job.id, JSON.parse(job.params) as SongParams);
      else await this.processStemJobs(stemJobId!);
    }
    this.deps.keepAwake.disable();
  }

  private sleepUntilWoken(): Promise<void> {
    if (this.pendingWake) {
      this.pendingWake = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.wakeUp = () => {
        this.wakeUp = undefined;
        this.pendingWake = false;
        resolve();
      };
    });
  }

  private async process(songId: string, params: SongParams): Promise<void> {
    const { songs, storage } = this.deps;
    songs.markRunning(songId, nowIso());
    const settings = this.deps.settings.get();
    const engine = this.deps.engineFactory(settings);
    const abort = new AbortController();
    this.running = { songId, abort };
    try {
      const report = (msg: string) => songs.setProgress(songId, msg);
      const depth = wavDepthFor(settings.output_format);
      if (hasTracks(params)) {
        const result = await this.deps.trackByTrack.run(songId, params, engine, depth, report, abort.signal);
        if (songs.status(songId) !== "running") return;
        songs.markDone(songId, { file: result.file, engine: `${engine.name}+tracks`, resultMeta: JSON.stringify(result.meta), finishedAt: nowIso() });
        return;
      }
      if (hasReplace(params) || hasAccompany(params)) {
        const result = await this.deps.replaceAccompany.run(songId, params, engine, depth, report, abort.signal);
        if (songs.status(songId) !== "running") return;
        songs.markDone(songId, { file: result.file, engine: `${engine.name}+${params.mode}`, resultMeta: JSON.stringify(result.meta), finishedAt: nowIso() });
        return;
      }
      const result = hasRepaint(params)
        ? await runRepaint(this.deps, params, engine, report, abort.signal)
        : await engine.generate({ ...params }, report, abort.signal);
      const file = `${songId}.${result.extension}`;
      if (songs.status(songId) !== "running") return;   // inzwischen abgebrochen
      await storage.save(file, result.audio);
      songs.markDone(songId, { file, engine: hasRepaint(params) ? `${engine.name}+repaint` : engine.name, resultMeta: JSON.stringify(result.meta), finishedAt: nowIso() });
    } catch (e) {
      if (abort.signal.aborted) return;                   // vom Nutzer abgebrochen: Status steht schon auf "cancelled"
      songs.markError(songId, e instanceof Error ? e.message || e.name : String(e), nowIso());
      if (!(e instanceof EngineError)) this.deps.log?.(`Song ${songId}: ${(e as Error).stack ?? String(e)}`);
    } finally {
      this.running = undefined;
    }
  }

  /** Herauslösen und neue Versionen auf einem fertigen Song: Status bleibt "done", nur die Spuren laufen. */
  private async processStemJobs(songId: string): Promise<void> {
    const settings = this.deps.settings.get();
    const engine = this.deps.engineFactory(settings);
    const abort = new AbortController();
    this.running = { songId, abort };
    try {
      const report = (msg: string) => this.deps.songs.setProgress(songId, msg);
      const depth = wavDepthFor(settings.output_format);
      await this.deps.extract.run(songId, engine, depth, report, abort.signal);
      await this.deps.versions.run(songId, engine, depth, report, abort.signal);
    } catch (e) {
      if (abort.signal.aborted) return;
      if (!(e instanceof EngineError)) this.deps.log?.(`Spuren ${songId}: ${(e as Error).stack ?? String(e)}`);
    } finally {
      this.running = undefined;
    }
  }
}
