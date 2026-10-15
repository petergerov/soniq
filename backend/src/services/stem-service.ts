// Einzelspuren eines Songs: auflisten, Datei holen, alle als ZIP, Mix nach Reglerstellung, mit dem Song löschen
// (siehe newfeatures.md). Dazu die hochgeladene Vorlage von Ersetzen/Begleiten.
import { extname } from "node:path";
import { SOURCE_CHANNEL, type SongParams, type Stem } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import { cleanFileName } from "../domain/song.ts";
import { toStemDto } from "../domain/stem.ts";
import { isFile } from "../infrastructure/files.ts";
import type { SongRepository } from "../infrastructure/song-repository.ts";
import type { SongStorage } from "../infrastructure/song-storage.ts";
import type { StemRepository } from "../infrastructure/stem-repository.ts";
import { addScaled, encodeWav, limitPeak, parseWav, resample, type Pcm, type WavDepth } from "../infrastructure/wav.ts";
import type { ZipEntry } from "../infrastructure/zip-writer.ts";

export interface StemServiceDeps {
  stems: StemRepository;
  songs: SongRepository;
  storage: SongStorage;
}

/** Lesbare Namen der Spuren in Downloads */
const TRACK_LABEL: Record<string, string> = { backing_vocals: "backing vocals", fx: "FX" };
const KIND_SUFFIX: Record<string, string> = { generated: "", extracted: " (extracted)", replacement: " (replacement)", accompaniment: " (accompaniment)" };

export class StemService {
  private readonly deps: StemServiceDeps;

  constructor(deps: StemServiceDeps) {
    this.deps = deps;
  }

  list(songId: string): Stem[] {
    if (!this.deps.songs.find(songId)) throw new AppError("not_found");
    return this.deps.stems.forSong(songId).map(toStemDto);
  }

  async audio(stemId: string, forDownload: boolean): Promise<{ path: string; downloadName: string | undefined }> {
    const stem = this.deps.stems.find(stemId);
    const song = stem && this.deps.songs.find(stem.song_id);
    if (!stem?.file || !song) throw new AppError("not_found");
    const path = await this.deps.storage.pathOf(stem.file);
    if (!(await isFile(path))) throw new AppError("not_found");
    return { path, downloadName: forDownload ? `${this.baseName(song)} - ${this.label(stem)}.wav` : undefined };
  }

  /** Hochgeladene Vorlage von Ersetzen/Begleiten. */
  async source(songId: string, forDownload: boolean): Promise<{ path: string; downloadName: string | undefined }> {
    const song = this.deps.songs.find(songId);
    const file = song && sourceFile(song);
    if (!file) throw new AppError("not_found");
    const path = await this.deps.storage.pathOf(file);
    if (!(await isFile(path))) throw new AppError("not_found");
    return { path, downloadName: forDownload ? `${this.baseName(song)} - original${extname(file)}` : undefined };
  }

  /** Alle fertigen Spuren eines Songs für ein ZIP ("<Titel>/<Spur>.wav"), vorneweg die Vorlage ("00 original.wav"). */
  async zipEntries(songId: string): Promise<{ archiveName: string; entries: ZipEntry[] }> {
    const song = this.deps.songs.find(songId);
    if (!song) throw new AppError("not_found");
    const archiveName = `${this.baseName(song)} - tracks`;
    const entries: ZipEntry[] = [];
    const source = sourceFile(song);
    if (source && (await this.deps.storage.exists(source))) {
      entries.push({ name: `${archiveName}/00 original${extname(source)}`, path: await this.deps.storage.pathOf(source) });
    }
    for (const stem of this.deps.stems.forSong(songId)) {
      if (stem.status !== "done" || !stem.file) continue;
      const path = await this.deps.storage.pathOf(stem.file);
      if (await isFile(path)) entries.push({ name: `${archiveName}/${String(stem.position + 1).padStart(2, "0")} ${this.label(stem)}.wav`, path });
    }
    if (!entries.length) throw new AppError("not_found");
    return { archiveName, entries };
  }

  /**
   * Mix so, wie der Mixer klingt: `gains` ordnet Spur-IDs (und SOURCE_CHANNEL für die Vorlage) eine Lautstärke 0…1 zu,
   * Mute und Solo sind darin schon verrechnet; fehlende Kanäle sind stumm. Die Spuren werden nacheinander gelesen und
   * aufaddiert, damit nicht alle zugleich im Speicher liegen. Spitzen über 0,95 werden wie beim Song-Mix abgesenkt.
   */
  async mixdown(songId: string, gains: ReadonlyMap<string, number>): Promise<{ data: Uint8Array; downloadName: string }> {
    const song = this.deps.songs.find(songId);
    if (!song) throw new AppError("not_found");
    const inputs = this.deps.stems.forSong(songId)
      .filter((stem) => stem.status === "done" && stem.file && (gains.get(stem.id) ?? 0) > 0)
      .map((stem) => ({ file: stem.file!, gain: gains.get(stem.id)! }));
    // Vorlage zuletzt: die Spuren geben die Abtastrate vor, die Vorlage wird bei Bedarf umgerechnet
    const source = sourceFile(song);
    const sourceGain = gains.get(SOURCE_CHANNEL) ?? 0;
    if (source && sourceGain > 0) inputs.push({ file: source, gain: sourceGain });

    let sum: Pcm | undefined;
    let depth: WavDepth = 16;
    for (const { file, gain } of inputs) {
      if (!(await this.deps.storage.exists(file))) continue;
      const wav = parseWav(await this.deps.storage.read(file));
      depth = Math.max(depth, wav.depth) as WavDepth;
      sum = addScaled(sum, sum ? resample(wav, sum.sampleRate) : wav, gain);
    }
    if (!sum) throw new AppError("invalid", "nothing_to_mix");
    return { data: encodeWav(limitPeak(sum), depth), downloadName: `${this.baseName(song)} - mix.wav` };
  }

  /** Eine fertige oder fehlgeschlagene Spur löschen (nicht während queued/running). */
  async remove(stemId: string): Promise<Stem[]> {
    const stem = this.deps.stems.find(stemId);
    if (!stem) throw new AppError("not_found");
    if (stem.status === "queued" || stem.status === "running") throw new AppError("bad_request", "stem_busy");
    if (stem.file) await this.deps.storage.remove(stem.file);
    this.deps.stems.delete(stemId);
    return this.list(stem.song_id);
  }

  /** Alle Spuren eines Songs löschen (Dateien + DB). Aufrufer bricht laufendes Extract vorher ab. */
  async removeAll(songId: string): Promise<Stem[]> {
    if (!this.deps.songs.find(songId)) throw new AppError("not_found");
    await this.removeForSong(songId);
    return this.list(songId);
  }

  /** Beim Löschen eines Songs: Spuren samt Dateien entfernen (die Vorlage löscht der Aufrufer). */
  async removeForSong(songId: string): Promise<void> {
    for (const stem of this.deps.stems.forSong(songId)) if (stem.file) await this.deps.storage.remove(stem.file);
    this.deps.stems.deleteForSong(songId);
  }

  private baseName(song: { title: string | null; caption: string }): string {
    return cleanFileName(song.title || song.caption.slice(0, 40)) || "Song";
  }

  private label(stem: { track: string; kind: string }): string {
    return `${TRACK_LABEL[stem.track] ?? stem.track.replaceAll("_", " ")}${KIND_SUFFIX[stem.kind] ?? ""}`;
  }
}

/** Dateiname der hochgeladenen Vorlage (nur bei Ersetzen/Begleiten). */
function sourceFile(song: { params: string }): string | undefined {
  return (JSON.parse(song.params) as SongParams).source || undefined;
}
