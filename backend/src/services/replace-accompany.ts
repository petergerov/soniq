// Ersetzen / Begleiten (newfeatures.md, Feature C):
//   replace    = Keeper mit `extract` herauslösen, dann Ersatzspuren mit `lego` auf deren Summe
//   accompany  = `lego` nacheinander auf der (schon isolierten) Aufnahme
import type { SongParams, SongResultMeta, StemKind, StemTrack } from "../../../shared/api.ts";
import type { MusicEngine, ProgressReporter } from "../domain/music-engine.ts";
import { newId } from "../domain/ids.ts";
import { INSTRUMENTAL, nowIso } from "../domain/song.ts";
import { formatElapsed, legoCaption, orderTracks, sourceFileName, stemFileName, VOCAL_TRACKS } from "../domain/stem.ts";
import type { SongStorage } from "../infrastructure/song-storage.ts";
import type { StemRepository } from "../infrastructure/stem-repository.ts";
import { encodeWav, limitPeak, mix, parseWav, type Pcm, type WavDepth } from "../infrastructure/wav.ts";

export interface ReplaceAccompanyDeps {
  stems: StemRepository;
  storage: SongStorage;
  removeStems: (songId: string) => Promise<void>;
}

export interface ReplaceAccompanyResult {
  file: string;
  meta: SongResultMeta;
}

export function hasReplace(params: SongParams): params is SongParams & { mode: "replace"; tracks: StemTrack[]; keepers: StemTrack[] } {
  return params.mode === "replace" && !!params.tracks?.length && !!params.keepers?.length;
}

export function hasAccompany(params: SongParams): params is SongParams & { mode: "accompany"; tracks: StemTrack[] } {
  return params.mode === "accompany" && !!params.tracks?.length;
}

export class ReplaceAccompany {
  private readonly deps: ReplaceAccompanyDeps;

  constructor(deps: ReplaceAccompanyDeps) {
    this.deps = deps;
  }

  async run(songId: string, params: SongParams, engine: MusicEngine, depth: WavDepth, progress: ProgressReporter, signal: AbortSignal): Promise<ReplaceAccompanyResult> {
    const sourceName = params.source || sourceFileName(songId);
    const source = await this.deps.storage.read(sourceName);
    const meta: SongResultMeta = {
      bpm: params.bpm || null, keyscale: params.keyscale || null, timesignature: params.timesignature || null,
      duration: params.duration || null, vocal_language: params.vocal_language || null,
      lyrics: params.lyrics || INSTRUMENTAL, caption: params.caption,
    };
    if (hasReplace(params)) return this.replace(songId, params, source, sourceName, meta, engine, depth, progress, signal);
    if (hasAccompany(params)) return this.accompany(songId, params, source, meta, engine, depth, progress, signal);
    throw new Error("replace/accompany: tracks missing");
  }

  private async replace(
    songId: string, params: SongParams & { tracks: StemTrack[]; keepers: StemTrack[] },
    source: Uint8Array, sourceName: string, meta: SongResultMeta,
    engine: MusicEngine, depth: WavDepth, progress: ProgressReporter, signal: AbortSignal,
  ): Promise<ReplaceAccompanyResult> {
    const keepers = orderTracks(params.keepers);
    const replacements = orderTracks(params.tracks);
    const start = performance.now();
    const elapsed = () => formatElapsed(Math.floor((performance.now() - start) / 1000));
    const total = keepers.length + replacements.length;
    await this.deps.removeStems(songId);

    const kept: Pcm[] = [];
    for (const [i, track] of keepers.entries()) {
      const pcm = await this.one(songId, {
        task: "extract", track, kind: "extracted", position: i, source, sourceName,
        caption: params.caption, lyrics: VOCAL_TRACKS.includes(track) ? meta.lyrics ?? INSTRUMENTAL : INSTRUMENTAL,
        meta, seed: params.seed >= 0 ? params.seed + i : undefined,
        label: `${i + 1}/${total} ${track}`, elapsed, depth, engine, progress, signal,
      });
      kept.push(pcm);
    }

    let backing = kept.length ? limitPeak(mix(kept)) : parseWav(source);
    const added: Pcm[] = [];
    for (const [i, track] of replacements.entries()) {
      const pcm = await this.one(songId, {
        task: "lego", track, kind: "replacement", position: keepers.length + i,
        source: encodeWav(backing, 32), sourceName: "backing.wav",
        caption: legoCaption(track, params.caption),
        lyrics: VOCAL_TRACKS.includes(track) ? meta.lyrics ?? INSTRUMENTAL : INSTRUMENTAL,
        meta, seed: params.seed >= 0 ? params.seed + keepers.length + i : undefined,
        label: `${keepers.length + i + 1}/${total} ${track}`, elapsed, depth, engine, progress, signal,
      });
      added.push(pcm);
      backing = limitPeak(mix([backing, pcm]));
    }

    const file = `${songId}.wav`;
    await this.deps.storage.save(file, encodeWav(limitPeak(mix([...kept, ...added])), depth));
    return { file, meta };
  }

  private async accompany(
    songId: string, params: SongParams & { tracks: StemTrack[] },
    source: Uint8Array, meta: SongResultMeta,
    engine: MusicEngine, depth: WavDepth, progress: ProgressReporter, signal: AbortSignal,
  ): Promise<ReplaceAccompanyResult> {
    const tracks = orderTracks(params.tracks);
    const start = performance.now();
    const elapsed = () => formatElapsed(Math.floor((performance.now() - start) / 1000));
    await this.deps.removeStems(songId);

    let backing: Pcm;
    try {
      backing = parseWav(source);
    } catch {
      throw new Error("Begleitung braucht WAV (die Oberfläche wandelt vor dem Upload um)");
    }

    const added: Pcm[] = [backing];
    for (const [i, track] of tracks.entries()) {
      const pcm = await this.one(songId, {
        task: "lego", track, kind: "accompaniment", position: i,
        source: encodeWav(limitPeak(i === 0 ? backing : mix(added)), 32), sourceName: "backing.wav",
        caption: legoCaption(track, params.caption),
        lyrics: VOCAL_TRACKS.includes(track) ? meta.lyrics ?? INSTRUMENTAL : INSTRUMENTAL,
        meta, seed: params.seed >= 0 ? params.seed + i : undefined,
        label: `${i + 1}/${tracks.length} ${track}`, elapsed, depth, engine, progress, signal,
      });
      added.push(pcm);
    }

    const file = `${songId}.wav`;
    await this.deps.storage.save(file, encodeWav(limitPeak(mix(added)), depth));
    return { file, meta };
  }

  private async one(songId: string, o: {
    task: "lego" | "extract"; track: StemTrack; kind: StemKind; position: number;
    source: Uint8Array; sourceName: string; caption: string; lyrics: string; meta: SongResultMeta;
    seed?: number; label: string; elapsed: () => string; depth: WavDepth;
    engine: MusicEngine; progress: ProgressReporter; signal: AbortSignal;
  }): Promise<Pcm> {
    const { stems, storage } = this.deps;
    const id = newId();
    stems.insert({ id, songId, track: o.track, kind: o.kind, position: o.position, createdAt: nowIso() });
    stems.markRunning(id);
    try {
      o.progress(`${o.label} · ${o.elapsed()}`);
      const wav = await o.engine.stem({
        task: o.task, track: o.track, source: o.source, sourceName: o.sourceName, caption: o.caption, lyrics: o.lyrics,
        bpm: o.meta.bpm, keyscale: o.meta.keyscale, timesignature: o.meta.timesignature, duration: o.meta.duration, seed: o.seed,
      }, () => o.progress(`${o.label} · ${o.elapsed()}`), o.signal);
      const pcm = parseWav(wav);
      const file = stemFileName(songId, o.track, o.kind);
      await storage.save(file, encodeWav(pcm, o.depth));
      stems.markDone(id, file, nowIso());
      return pcm;
    } catch (e) {
      stems.markError(id, o.signal.aborted ? "cancelled" : e instanceof Error ? e.message || e.name : String(e), nowIso());
      throw e;
    }
  }
}

export { sourceFileName };
