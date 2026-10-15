// "Spur für Spur" (newfeatures.md, Feature B): ein Song als einzelne Spuren, jede mit lego passend zur Summe der
// vorherigen (die erste auf Stille). Der Mix ist exakt die Summe der Spuren und wird die normale Song-Datei.
//   1. Sprachmodell plant Tempo, Tonart, Takt, Länge und (wenn leer) Lyrics, damit alle Spuren dazu passen
//   2. Spuren nacheinander, jede sofort gespeichert (erscheint in der Spurenliste)
//   3. Mix speichern
import type { SongParams, SongResultMeta, StemTrack } from "../../../shared/api.ts";
import type { MusicEngine, ProgressReporter } from "../domain/music-engine.ts";
import { newId } from "../domain/ids.ts";
import { INSTRUMENTAL, nowIso } from "../domain/song.ts";
import { legoCaption, orderTracks, stemFileName, VOCAL_TRACKS } from "../domain/stem.ts";
import type { SongStorage } from "../infrastructure/song-storage.ts";
import type { StemRepository } from "../infrastructure/stem-repository.ts";
import { encodeWav, limitPeak, mix, parseWav, silence, type Pcm, type WavDepth } from "../infrastructure/wav.ts";

export interface TrackByTrackDeps {
  stems: StemRepository;
  storage: SongStorage;
  /** Spuren und Song-Datei des Songs löschen (für einen Neuversuch) */
  removeStems: (songId: string) => Promise<void>;
}

export interface TrackByTrackResult {
  file: string;
  meta: SongResultMeta;
}

/** Ohne Längenangabe und Plan: so lang wird der Song */
const DEFAULT_DURATION = 90;

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export class TrackByTrack {
  private readonly deps: TrackByTrackDeps;

  constructor(deps: TrackByTrackDeps) {
    this.deps = deps;
  }

  /**
   * @param depth Bittiefe der Dateien (aus den Einstellungen; bei MP3 16 Bit, denn gemischt wird als WAV)
   */
  async run(songId: string, params: SongParams, engine: MusicEngine, depth: WavDepth, progress: ProgressReporter, signal: AbortSignal): Promise<TrackByTrackResult> {
    const { stems, storage } = this.deps;
    const tracks = orderTracks(params.tracks ?? []);
    const start = performance.now();
    const elapsed = () => formatElapsed(Math.floor((performance.now() - start) / 1000));

    // Neuversuch: alte Spuren weg, dann alle Spuren als "wartet" anlegen (Reihenfolge = Position)
    await this.deps.removeStems(songId);
    const ids = tracks.map((track, position) => {
      const id = newId();
      stems.insert({ id, songId, track, kind: "generated", position, createdAt: nowIso() });
      return { id, track };
    });

    try {
      // 1) Plan: eigene Angaben haben Vorrang, der Rest kommt vom Sprachmodell
      const wantsVocals = tracks.some((t) => VOCAL_TRACKS.includes(t));
      // Gesangsspur ohne eigene Lyrics: "vocals" in die Beschreibung, sonst plant das Modell womöglich instrumental
      const planCaption = wantsVocals && !params.lyrics && !/vocal/i.test(params.caption) ? `${params.caption}, vocals` : params.caption;
      const plan = await engine.plan({ ...params, caption: planCaption }, wantsVocals && !params.lyrics, (m) => progress(`Plan · ${m}`), signal);
      const meta: SongResultMeta = {
        bpm: params.bpm || plan.bpm || null,
        keyscale: params.keyscale || plan.keyscale || null,
        timesignature: params.timesignature || plan.timesignature || null,
        duration: params.duration || plan.duration || DEFAULT_DURATION,
        vocal_language: params.vocal_language || plan.vocal_language || null,
        lyrics: params.lyrics || (wantsVocals ? plan.lyrics : INSTRUMENTAL) || INSTRUMENTAL,
        caption: params.caption,
      };

      // 2) Spuren nacheinander, jede auf der Summe der vorherigen
      let sum: Pcm = silence(meta.duration!);
      for (const [i, { id, track }] of ids.entries()) {
        signal.throwIfAborted();
        stems.markRunning(id);
        const label = `${i + 1}/${ids.length} ${track}`;
        const wav = await engine.stem({
          task: "lego", track, source: encodeWav(limitPeak(sum), 32), caption: legoCaption(track, params.caption),
          lyrics: VOCAL_TRACKS.includes(track) ? meta.lyrics ?? INSTRUMENTAL : INSTRUMENTAL,
          bpm: meta.bpm, keyscale: meta.keyscale, timesignature: meta.timesignature, duration: meta.duration,
          seed: params.seed >= 0 ? params.seed + i : undefined,
        }, () => progress(`${label} · ${elapsed()}`), signal);
        const pcm = parseWav(wav);
        const file = stemFileName(songId, track, "generated");
        await storage.save(file, encodeWav(pcm, depth));
        stems.markDone(id, file, nowIso());
        sum = i === 0 ? pcm : mix([sum, pcm]);
      }

      // 3) Mix = Summe aller Spuren (Spitzen begrenzt)
      const file = `${songId}.wav`;
      await storage.save(file, encodeWav(limitPeak(sum), depth));
      return { file, meta };
    } catch (e) {
      // Fertige Spuren bleiben; die übrigen als nicht erzeugt markieren
      const message = signal.aborted ? "cancelled" : e instanceof Error ? e.message || e.name : String(e);
      for (const { id } of ids) if (stems.find(id)?.status !== "done") stems.markError(id, message, nowIso());
      throw e;
    }
  }
}

export function hasTracks(params: SongParams): params is SongParams & { mode: "tracks"; tracks: StemTrack[] } {
  return params.mode === "tracks" && !!params.tracks?.length;
}
