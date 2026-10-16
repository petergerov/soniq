// Neue Version einer Spur (Mixer › Neue Version): `lego` auf der Summe der übrigen Spuren (in ihrer aktiven Version,
// beim Begleiten dazu die Aufnahme), mit den Wünschen in der Caption. Die alte Version bleibt erhalten; die neue wird
// hörbar, sobald sie fertig ist. Läuft wie das Herauslösen in der Warteschlange, der Song bleibt "done".
import { activeTakes, type SongParams, type SongResultMeta, type StemTrack, type VersionRecipe } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { newId } from "../domain/ids.ts";
import type { MusicEngine, ProgressReporter } from "../domain/music-engine.ts";
import { INSTRUMENTAL, nowIso } from "../domain/song.ts";
import { formatElapsed, stemFileName, versionCaption, VOCAL_TRACKS, type StemRecord } from "../domain/stem.ts";
import type { SongRepository } from "../infrastructure/song-repository.ts";
import type { SongStorage } from "../infrastructure/song-storage.ts";
import type { StemRepository } from "../infrastructure/stem-repository.ts";
import { addScaled, encodeWav, limitPeak, parseWav, resample, silence, type Pcm, type WavDepth } from "../infrastructure/wav.ts";

export interface StemVersionsDeps {
  stems: StemRepository;
  songs: SongRepository;
  storage: SongStorage;
  stemsAvailable: () => boolean;
}

export class StemVersions {
  private readonly deps: StemVersionsDeps;

  constructor(deps: StemVersionsDeps) {
    this.deps = deps;
  }

  /** `count` neue Versionen der Spur einreihen (verschiedene Seeds); die Caption steht ab jetzt fest. */
  enqueue(stemId: string, recipe: VersionRecipe, count: number): void {
    const { stems, songs } = this.deps;
    if (!this.deps.stemsAvailable()) throw new AppError("bad_request", "stems_model_missing");
    const stem = stems.find(stemId);
    const song = stem && songs.find(stem.song_id);
    if (!stem || !song) throw new AppError("not_found");
    if (song.status !== "done" || stem.status !== "done") throw new AppError("bad_request", "version_not_ready");
    const track = stem.track as StemTrack;
    const params = JSON.parse(song.params) as SongParams;
    const caption = versionCaption(track, recipe, song.caption || params.caption || "");
    const json = JSON.stringify({ ...recipe, caption });
    const first = stems.maxVersion(song.id, track) + 1;
    const at = nowIso();
    for (let i = 0; i < count; i++) {
      stems.insert({ id: newId(), songId: song.id, track, kind: "version", position: stem.position, createdAt: at, version: first + i, recipe: json });
    }
  }

  /** Wartende Versionen streichen; eine laufende bricht der Worker ab. */
  cancel(songId: string): void {
    const at = nowIso();
    for (const s of this.deps.stems.forSong(songId)) {
      if (s.kind === "version" && (s.status === "queued" || s.status === "running")) this.deps.stems.markError(s.id, "cancelled", at);
    }
    this.deps.songs.setProgress(songId, null);
  }

  async run(songId: string, engine: MusicEngine, depth: WavDepth, progress: ProgressReporter, signal: AbortSignal): Promise<void> {
    const { stems, songs, storage } = this.deps;
    const jobs = stems.forSong(songId).filter((s) => s.kind === "version" && s.status === "queued");
    if (!jobs.length) return;
    const start = performance.now();
    const elapsed = () => formatElapsed(Math.floor((performance.now() - start) / 1000));
    try {
      for (const [i, job] of jobs.entries()) {
        signal.throwIfAborted();
        const song = songs.find(songId);
        if (song?.status !== "done") {
          stems.markError(job.id, "song_not_ready", nowIso());
          continue;
        }
        if (stems.find(job.id)?.status !== "queued") continue;   // inzwischen abgebrochen oder gelöscht
        stems.markRunning(job.id);
        const track = job.track as StemTrack;
        const label = `${i + 1}/${jobs.length} ${track} v${job.version}`;
        progress(`${label} · ${elapsed()}`);
        try {
          const params = JSON.parse(song.params) as SongParams;
          const meta = song.result_meta ? JSON.parse(song.result_meta) as SongResultMeta : null;
          const backing = await this.backing(songId, track, params, meta?.duration || params.duration || 0);
          const caption = (JSON.parse(job.recipe ?? "{}") as { caption?: string }).caption || track;
          const wav = await engine.stem({
            task: "lego", track, source: encodeWav(backing, 32), sourceName: "backing.wav", caption,
            lyrics: VOCAL_TRACKS.includes(track) ? meta?.lyrics || song.lyrics || INSTRUMENTAL : INSTRUMENTAL,
            bpm: meta?.bpm || params.bpm || null, keyscale: meta?.keyscale || params.keyscale || null,
            timesignature: meta?.timesignature ? String(meta.timesignature) : params.timesignature || null,
            duration: meta?.duration || params.duration || null,
          }, () => progress(`${label} · ${elapsed()}`), signal);
          const file = stemFileName(songId, track, "version", job.version);
          await storage.save(file, encodeWav(parseWav(wav), depth));
          if (!stems.find(job.id)) {   // während der Rechnung gelöscht
            await storage.remove(file);
            continue;
          }
          stems.markDone(job.id, file, nowIso());
          stems.setActive(job.id);
        } catch (e) {
          if (signal.aborted) throw e;
          stems.markError(job.id, e instanceof Error ? e.message || e.name : String(e), nowIso());
        }
      }
    } catch (e) {
      for (const job of jobs) {
        const status = stems.find(job.id)?.status;
        if (status === "queued" || status === "running") stems.markError(job.id, "cancelled", nowIso());
      }
      throw e;
    } finally {
      if (songs.find(songId)?.status === "done") songs.setProgress(songId, null);
    }
  }

  /**
   * Playback für die neue Version: alle anderen Spuren in ihrer hörbaren Version, beim Begleiten dazu die Aufnahme
   * (sie gehört zum Song). Beim Ersetzen bleibt die Vorlage draußen, darin steckt die alte Besetzung. Ohne andere
   * Spuren: Stille in Songlänge, wie die erste Spur bei Spur für Spur.
   */
  private async backing(songId: string, track: StemTrack, params: SongParams, duration: number): Promise<Pcm> {
    const { stems, storage } = this.deps;
    const files = activeTakes<StemRecord>(stems.forSong(songId)).filter((s) => s.track !== track && s.file).map((s) => s.file!);
    if (params.mode === "accompany" && params.source) files.push(params.source);
    let sum: Pcm | undefined;
    for (const file of files) {
      if (!(await storage.exists(file))) continue;
      const wav = parseWav(await storage.read(file));
      sum = addScaled(sum, sum ? resample(wav, sum.sampleRate) : wav, 1);
    }
    return sum ? limitPeak(sum) : silence(duration || 30);
  }
}
