// Herauslösen (newfeatures.md, Feature A): aus einem fertigen Song einzelne Spuren mit `extract`.
// Der Song bleibt "done" und spielbar; Fortschritt steht in message und in der Spurenliste.
import type { SongParams, StemTrack } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import type { MusicEngine, ProgressReporter, StemRequest } from "../domain/music-engine.ts";
import { INSTRUMENTAL, nowIso } from "../domain/song.ts";
import { formatElapsed, stemFileName, VOCAL_TRACKS } from "../domain/stem.ts";
import type { SongRecord } from "../domain/song.ts";
import type { SongRepository } from "../infrastructure/song-repository.ts";
import type { SongStorage } from "../infrastructure/song-storage.ts";
import type { StemRepository } from "../infrastructure/stem-repository.ts";
import { encodeWav, parseWav, type WavDepth } from "../infrastructure/wav.ts";
import { newId } from "../domain/ids.ts";

export interface ExtractDeps {
  stems: StemRepository;
  songs: SongRepository;
  storage: SongStorage;
  stemsAvailable: () => boolean;
}

export class ExtractTracks {
  private readonly deps: ExtractDeps;

  constructor(deps: ExtractDeps) {
    this.deps = deps;
  }

  /** Spuren einreihen. Schon vorhandene (fertig/wartend/laufend) derselben Art werden übersprungen. */
  enqueue(songId: string, tracks: StemTrack[]): void {
    const { stems, songs } = this.deps;
    if (!this.deps.stemsAvailable()) throw new AppError("bad_request", "stems_model_missing");
    const song = songs.find(songId);
    if (!song) throw new AppError("not_found");
    if (!song.file || song.status !== "done") throw new AppError("bad_request", "song_not_ready");
    // Nur Stereo-Mix (voll erzeugter Song) — Spur-für-Spur / Replace haben schon Einzelspuren
    const mode = (JSON.parse(song.params) as SongParams).mode;
    if (mode && mode !== "full") throw new AppError("bad_request", "extract_mix_only");
    const taken = new Set(stems.forSong(songId).filter((s) => s.kind === "extracted" && s.status !== "error").map((s) => s.track));
    const fresh = tracks.filter((t) => !taken.has(t));
    if (!fresh.length) throw new AppError("bad_request", "no_new_tracks");
    const start = stems.forSong(songId).length;
    const at = nowIso();
    fresh.forEach((track, i) => stems.insert({ id: newId(), songId, track, kind: "extracted", position: start + i, createdAt: at }));
  }

  /** Wartende Extract-Spuren streichen; eine laufende bricht der Worker ab. */
  cancel(songId: string): void {
    const at = nowIso();
    for (const s of this.deps.stems.forSong(songId)) {
      if (s.kind === "extracted" && (s.status === "queued" || s.status === "running")) this.deps.stems.markError(s.id, "cancelled", at);
    }
    this.deps.songs.setProgress(songId, null);
  }

  async run(songId: string, engine: MusicEngine, depth: WavDepth, progress: ProgressReporter, signal: AbortSignal): Promise<void> {
    const { stems, songs, storage } = this.deps;
    const song = songs.find(songId);
    if (!song?.file) throw new AppError("not_found");
    const jobs = stems.forSong(songId).filter((s) => s.kind === "extracted" && s.status === "queued");
    if (!jobs.length) return;
    const source = await storage.read(song.file);
    const start = performance.now();
    const elapsed = () => formatElapsed(Math.floor((performance.now() - start) / 1000));
    const base = this.requestBase(song, source);
    try {
      for (const [i, job] of jobs.entries()) {
        signal.throwIfAborted();
        if (songs.find(songId)?.status !== "done") return;   // Song wurde gelöscht oder neu gestartet
        stems.markRunning(job.id);
        const label = `${i + 1}/${jobs.length} ${job.track}`;
        progress(`Extract ${label} · ${elapsed()}`);
        const wav = await engine.stem({
          ...base, task: "extract", track: job.track as StemTrack,
          lyrics: VOCAL_TRACKS.includes(job.track as StemTrack) ? (song.lyrics || INSTRUMENTAL) : INSTRUMENTAL,
        }, () => progress(`Extract ${label} · ${elapsed()}`), signal);
        const file = stemFileName(songId, job.track as StemTrack, "extracted");
        await storage.save(file, encodeWav(parseWav(wav), depth));
        stems.markDone(job.id, file, nowIso());
      }
    } catch (e) {
      const message = signal.aborted ? "cancelled" : e instanceof Error ? e.message || e.name : String(e);
      for (const job of jobs) if (stems.find(job.id)?.status !== "done") stems.markError(job.id, message, nowIso());
      throw e;
    } finally {
      if (songs.find(songId)?.status === "done") songs.setProgress(songId, null);
    }
  }

  private requestBase(song: SongRecord, source: Uint8Array): Omit<StemRequest, "task" | "track" | "lyrics"> {
    const params = JSON.parse(song.params) as { bpm?: number; keyscale?: string; timesignature?: string; duration?: number; caption?: string };
    const meta = song.result_meta ? JSON.parse(song.result_meta) as { bpm?: number; keyscale?: string; timesignature?: string; duration?: number } : {};
    return {
      source, sourceName: song.file ?? "source.wav", caption: song.caption || params.caption || "",
      bpm: meta.bpm || params.bpm || null, keyscale: meta.keyscale || params.keyscale || null,
      timesignature: meta.timesignature ? String(meta.timesignature) : params.timesignature || null,
      duration: meta.duration || params.duration || null,
    };
  }
}
