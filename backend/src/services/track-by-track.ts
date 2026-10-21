// "Spur für Spur" (newfeatures.md, Feature B): ein Song als einzelne Spuren, jede mit lego passend zur Summe der
// vorherigen (die erste auf Stille). Der Mix ist exakt die Summe der Spuren und wird die normale Song-Datei.
//   1. Sprachmodell plant Tempo, Tonart, Takt, Länge und (wenn leer) Lyrics, damit alle Spuren dazu passen
//   2. Spuren nacheinander, jede sofort gespeichert (erscheint in der Spurenliste)
//   3. Mix speichern
// Ein Neuversuch (nach Fehler, Abbruch oder Neustart) macht bei der ersten nicht fertigen Spur weiter.
import type { SongParams, SongResultMeta, StemTrack } from "../../../shared/api.ts";
import { EngineError, type MusicEngine, type ProgressReporter } from "../domain/music-engine.ts";
import { newId } from "../domain/ids.ts";
import { INSTRUMENTAL, nowIso } from "../domain/song.ts";
import { pieceStyle } from "../../../shared/piece-style.ts";
import { isProseCaption, legoCaption, orderTracks, stemFileName, VOCAL_TRACKS, type StemRecord } from "../domain/stem.ts";
import type { SongRepository } from "../infrastructure/song-repository.ts";
import type { SongStorage } from "../infrastructure/song-storage.ts";
import type { StemRepository } from "../infrastructure/stem-repository.ts";
import { encodeWav, limitPeak, mix, parseWav, silence, type Pcm, type WavDepth } from "../infrastructure/wav.ts";

export interface TrackByTrackDeps {
  stems: StemRepository;
  songs: SongRepository;
  storage: SongStorage;
  /** Spuren und Song-Datei des Songs löschen (für einen Neuversuch) */
  removeStems: (songId: string) => Promise<void>;
}

/** Was ein Neuversuch weiterverwendet: den Plan und die fertigen Spuren vom Anfang an */
interface Resume {
  meta: SongResultMeta;
  done: (StemRecord & { file: string })[];
}

export interface TrackByTrackResult {
  file: string;
  meta: SongResultMeta;
}

/** Ohne Längenangabe und Plan: so lang wird der Song */
const DEFAULT_DURATION = 90;
/**
 * Weniger gesungene Zeilen gelten als "keine Lyrics": Das Sprachmodell liefert bei Gesangsspuren manchmal
 * "[Instrumental]" oder nur Abschnitts-Marken ("[Instrumental Section 1]" …), die Gesangsspuren werden dann wortlos.
 */
const MIN_SUNG_LINES = 4;
/** So oft fragt der Plan das Sprachmodell (je mit anderem Seed), bevor der Song mit einer Meldung abbricht */
const PLAN_ATTEMPTS = 3;   // je Versuch etwa 30 s, wenig gegen eine Spur (Minuten)

/** Zeilen, die gesungen werden: nicht leer und keine reine [Marke] */
export function sungLineCount(lyrics: string | null | undefined): number {
  return (lyrics ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !/^\[[^\]]*\]$/.test(l)).length;
}

/**
 * Caption für den Plan, wenn Gesang gewünscht ist und keine Lyrics vorgegeben sind: nur der Stil (Stichworte),
 * nicht die lange Beschreibung; ohne Stil bei Fließtext nur Stimmung und Genre daraus. "instrumental" fällt weg,
 * Gesang samt Text wird ausdrücklich verlangt. Die Spuren selbst bekommen weiter die Caption des Songs.
 *
 * Gemessen an "Crimson Echoes" (Stil "indie folk, singer-songwriter, harmonica, heartfelt, male vocals" plus eine
 * Analyse-Beschreibung "an energetic and virtuosic instrumental piece … guitar solos", 150 s, je 4 Versuche):
 * ganze Caption 0 von 2 mit Lyrics, ohne das Wort "instrumental" 1 von 4, nur der Stil 4 von 4 (12–27 Zeilen).
 */
export function lyricsPlanCaption(params: Pick<SongParams, "caption" | "style">): string {
  const caption = params.style?.trim() || (isProseCaption(params.caption) ? pieceStyle(params.caption) : "") || params.caption;
  return vocalPlanCaption(caption);
}

/** "instrumental" streichen, Gesang und gesungenen Text verlangen. */
export function vocalPlanCaption(caption: string): string {
  const cleaned = caption.replace(/\binstrumental\b\s*/gi, "").replace(/\s*,\s*(?=,|$)/g, "").replace(/\s{2,}/g, " ").trim().replace(/[.\s]+$/, "");
  return [cleaned, /vocal/i.test(cleaned) ? "" : "vocals", "sung lyrics"].filter(Boolean).join(", ");
}

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Eigene Angaben haben Vorrang, der Rest kommt aus dem Plan des Sprachmodells */
function songMeta(params: SongParams, plan: SongResultMeta, wantsVocals: boolean): SongResultMeta {
  return {
    bpm: params.bpm || plan.bpm || null,
    keyscale: params.keyscale || plan.keyscale || null,
    timesignature: params.timesignature || plan.timesignature || null,
    duration: params.duration || plan.duration || DEFAULT_DURATION,
    vocal_language: params.vocal_language || plan.vocal_language || null,
    lyrics: params.lyrics || (wantsVocals ? plan.lyrics : INSTRUMENTAL) || INSTRUMENTAL,
    caption: params.caption,
  };
}

/**
 * Plan nur aus den eigenen Angaben, wenn sie alles festlegen, was die Spuren bekommen; sonst undefined.
 * Für Neuversuche von Songs, deren Plan noch nicht gespeichert wurde (vor dem Fortsetzen erzeugt).
 */
function planFromParams(params: SongParams, wantsVocals: boolean): SongResultMeta | undefined {
  if (!params.bpm || !params.keyscale || !params.timesignature || !params.duration || (wantsVocals && !params.lyrics)) return undefined;
  return songMeta(params, {}, wantsVocals);
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
    const { stems, songs, storage } = this.deps;
    const tracks = orderTracks(params.tracks ?? []);
    const wantsVocals = tracks.some((t) => VOCAL_TRACKS.includes(t));
    const start = performance.now();
    const elapsed = () => formatElapsed(Math.floor((performance.now() - start) / 1000));

    // Neuversuch: fertige Spuren vom Anfang an bleiben, die übrigen samt Dateien weg; ohne Plan alles neu.
    // Dann die fehlenden Spuren als "wartet" anlegen (Reihenfolge = Position)
    const resume = await this.resumable(songId, params, tracks, wantsVocals);
    const kept = resume?.done ?? [];
    if (resume) {
      for (const stem of stems.forSong(songId).slice(kept.length)) {
        if (stem.file) await storage.remove(stem.file);
        stems.delete(stem.id);
      }
    } else {
      await this.deps.removeStems(songId);
    }
    const ids = tracks.map((track, position) => {
      if (position < kept.length) return { id: kept[position]!.id, track };
      const id = newId();
      stems.insert({ id, songId, track, kind: "generated", position, createdAt: nowIso() });
      return { id, track };
    });

    try {
      // 1) Plan: eigene Angaben haben Vorrang, der Rest kommt vom Sprachmodell. Gespeichert, damit ein Neuversuch
      //    die fertigen Spuren weiterverwenden kann (neu geplant passten Tempo, Tonart oder Lyrics nicht mehr dazu)
      const meta = resume?.meta
        ?? songMeta(params, await planSong(params, wantsVocals && !params.lyrics, engine, progress, signal), wantsVocals);
      songs.setResultMeta(songId, JSON.stringify(meta));

      // 2) Spuren nacheinander, jede auf der Summe der vorherigen; fertige aus einem früheren Versuch nur einlesen
      let sum: Pcm = silence(meta.duration!);
      for (const [i, { id, track }] of ids.entries()) {
        signal.throwIfAborted();
        if (i < kept.length) {
          const pcm = parseWav(await storage.read(kept[i]!.file));
          sum = i === 0 ? pcm : mix([sum, pcm]);
          continue;
        }
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

  /**
   * Weiterverwendbares aus einem früheren Versuch: dieselben Spuren, mindestens die erste fertig (mit Datei) und der
   * Plan bekannt. Nur fertige Spuren vom Anfang an zählen, jede spätere entstand auf der Summe der vorherigen.
   */
  private async resumable(songId: string, params: SongParams, tracks: StemTrack[], wantsVocals: boolean): Promise<Resume | undefined> {
    const { stems, songs, storage } = this.deps;
    const existing = stems.forSong(songId);
    if (existing.length !== tracks.length || existing.some((s, i) => s.kind !== "generated" || s.track !== tracks[i])) return undefined;
    const done: Resume["done"] = [];
    for (const stem of existing) {
      if (stem.status !== "done" || !stem.file || !(await storage.exists(stem.file))) break;
      done.push({ ...stem, file: stem.file });
    }
    if (!done.length) return undefined;
    const saved = songs.find(songId)?.result_meta;
    const meta = saved ? JSON.parse(saved) as SongResultMeta : planFromParams(params, wantsVocals);
    return meta ? { meta, done } : undefined;
  }
}

/**
 * Tempo, Tonart, Takt, Länge und, wenn writeLyrics, die Lyrics. Liefert das Sprachmodell dabei keinen singbaren
 * Text, fragt es mit anderem Seed erneut; nach PLAN_ATTEMPTS Versuchen bricht der Song ab, bevor Audio entsteht.
 * Auch für Cover mit Gesang ohne eigene Lyrics (das Klangmodell singt dort, was es bekommt).
 */
export async function planSong(
  params: SongParams, writeLyrics: boolean, engine: MusicEngine, progress: ProgressReporter, signal: AbortSignal,
): Promise<SongResultMeta> {
  const caption = writeLyrics ? lyricsPlanCaption(params) : params.caption;
  for (let attempt = 1; ; attempt++) {
    const seed = params.seed >= 0 ? params.seed + (attempt - 1) * 7919 : params.seed;
    const label = attempt > 1 ? `Plan ${attempt}/${PLAN_ATTEMPTS}` : "Plan";
    const plan = await engine.plan({ ...params, caption, seed }, writeLyrics, (m) => progress(`${label} · ${m}`), signal);
    if (!writeLyrics || sungLineCount(plan.lyrics) >= MIN_SUNG_LINES) return plan;
    if (attempt >= PLAN_ATTEMPTS) {
      throw new EngineError("Sprachmodell hat keine Lyrics geschrieben: bitte Lyrics eingeben oder den Prompt um Gesang ergänzen");
    }
  }
}

export function hasTracks(params: SongParams): params is SongParams & { mode: "tracks"; tracks: StemTrack[] } {
  return params.mode === "tracks" && !!params.tracks?.length;
}
