// Neue Version einer Spur (Mixer › Neue Version): `lego` auf der Summe der übrigen Spuren (in ihrer aktiven Version,
// beim Begleiten dazu die Aufnahme), mit den Wünschen in der Caption. Die alte Version bleibt erhalten; die neue wird
// hörbar, sobald sie fertig ist. Läuft wie das Herauslösen in der Warteschlange, der Song bleibt "done".
// Neue Spur (Mixer › + Spur, ideas.md Idee 26): eine Version 1 eines Instruments, das der Song noch nicht hat; sie
// hört alle Spuren in ihrer aktiven Version (Mute und Solo des Mixers kennt der Server nicht).
import { activeTakes, STEM_TRACKS, type SongParams, type SongResultMeta, type StemRecipe, type StemTrack, type VersionRecipe } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { newId, randomSeed } from "../domain/ids.ts";
import type { MusicEngine, ProgressReporter } from "../domain/music-engine.ts";
import { INSTRUMENTAL, nowIso } from "../domain/song.ts";
import { formatElapsed, stemFileName, versionCaption, VOCAL_TRACKS, type StemRecord } from "../domain/stem.ts";
import { sungLineCount } from "./track-by-track.ts";
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

  /**
   * `count` neue Versionen der Spur einreihen; Caption und Seed stehen ab jetzt fest und bleiben im Rezept, damit sich
   * eine Version nachbauen lässt. Ohne `seed` würfelt jede Version einen eigenen, sonst zählen die Seeds ab `seed` hoch.
   */
  enqueue(stemId: string, recipe: VersionRecipe, count: number, seed?: number): void {
    const { stems, songs } = this.deps;
    if (!this.deps.stemsAvailable()) throw new AppError("bad_request", "stems_model_missing");
    const stem = stems.find(stemId);
    const song = stem && songs.find(stem.song_id);
    if (!stem || !song) throw new AppError("not_found");
    if (song.status !== "done" || stem.status !== "done") throw new AppError("bad_request", "version_not_ready");
    this.insert(song.id, stem.track as StemTrack, stem.position, song.caption || (JSON.parse(song.params) as SongParams).caption || "", recipe, count, seed);
  }

  /**
   * Neue Spur für einen fertigen Song mit Spuren. Gesangsspuren nur, wenn der Song gesungene Lyrics hat: sonst hätte
   * die Stimme keinen Text (lego singt die Lyrics des Songs).
   */
  enqueueTrack(songId: string, track: StemTrack, recipe: VersionRecipe, count: number, seed?: number): void {
    const { stems, songs } = this.deps;
    if (!this.deps.stemsAvailable()) throw new AppError("bad_request", "stems_model_missing");
    const song = songs.find(songId);
    if (!song) throw new AppError("not_found");
    if (!(STEM_TRACKS as readonly string[]).includes(track)) throw new AppError("invalid", "add_track_unknown");
    const own = stems.forSong(songId);
    if (song.status !== "done" || !own.some((s) => s.status === "done")) throw new AppError("bad_request", "add_track_no_stems");
    if (own.some((s) => s.track === track && s.status !== "error")) throw new AppError("conflict", "add_track_exists");
    const meta = song.result_meta ? JSON.parse(song.result_meta) as SongResultMeta : null;
    if (VOCAL_TRACKS.includes(track) && !sungLineCount(meta?.lyrics || song.lyrics)) throw new AppError("bad_request", "add_track_no_lyrics");
    const position = Math.max(...own.map((s) => s.position)) + 1;
    this.insert(songId, track, position, song.caption || (JSON.parse(song.params) as SongParams).caption || "", recipe, count, seed);
  }

  /** Caption und Seed stehen ab jetzt fest; ohne `seed` würfelt jede Version einen eigenen, sonst zählen sie hoch. */
  private insert(songId: string, track: StemTrack, position: number, styleCaption: string, recipe: VersionRecipe, count: number, seed?: number): void {
    const { stems } = this.deps;
    const caption = versionCaption(track, recipe, styleCaption);
    const first = stems.maxVersion(songId, track) + 1;
    const at = nowIso();
    for (let i = 0; i < count; i++) {
      const recipeJson = JSON.stringify({ ...recipe, caption, seed: seed === undefined ? randomSeed() : (seed + i) % 2 ** 32 });
      stems.insert({ id: newId(), songId, track, kind: "version", position, createdAt: at, version: first + i, recipe: recipeJson });
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
          const recipe = JSON.parse(job.recipe ?? "{}") as Partial<StemRecipe>;
          const caption = recipe.caption || track;
          const wav = await engine.stem({
            task: "lego", track, source: encodeWav(backing, 32), sourceName: "backing.wav", caption,
            lyrics: VOCAL_TRACKS.includes(track) ? meta?.lyrics || song.lyrics || INSTRUMENTAL : INSTRUMENTAL,
            bpm: meta?.bpm || params.bpm || null, keyscale: meta?.keyscale || params.keyscale || null,
            timesignature: meta?.timesignature ? String(meta.timesignature) : params.timesignature || null,
            duration: meta?.duration || params.duration || null,
            seed: recipe.seed,   // fehlt nur bei alten Einträgen: dann würfelt der Server
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
