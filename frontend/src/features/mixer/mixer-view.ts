// Mixer: alle fertigen Spuren eines Songs mit Waveform, Lautstärke, Mute und Solo, dazu die hochgeladene Vorlage
// (Ersetzen/Begleiten). Alle Versionen laufen als Ebenen einer Szene in der gemeinsamen AudioEngine (sample-genau
// zusammen); läuft der Song schon im Player, geht es an derselben Stelle ohne Pause weiter. Solo dämpft alle anderen.
// Herunterladen: jede Spur einzeln, alle als ZIP, und der Mix so, wie er gerade klingt.
//
// Versionen: Jede Spur ist ein Kanal mit einer oder mehreren Versionen ("Takes"), die alle mitlaufen; zu hören ist
// nur die aktive. Mit mehreren Versionen lässt sich der Kanal aufklappen, um sie zu sehen und umzuschalten (sofort,
// auch während der Wiedergabe). ✦ öffnet das Feld für eine neue Version (Knöpfe, Regler, Freitext); die alte bleibt.
// „+ Spur“ (ideas.md, Idee 26): ein Instrument, das der Song noch nicht hat, als Entwurfskanal mit demselben Feld;
// es hört alle Spuren in ihrer gewählten Version. Eine so hinzugefügte Spur lässt sich ganz wieder löschen.
import { activeTakes, OTHER_TRACK, SOURCE_CHANNEL, STEM_TRACKS, VARIATION_AXES, type StemKind, type Song, type Stem, type StemRecipe, type StemStatus, type StemTrack, type VariationAxis } from "../../../../shared/api.ts";
import { AXIS_MAX, chipsFor, MAX_VERSION_COUNT, MAX_VERSION_TEXT, variationTags, type VariationChip } from "../../../../shared/track-variation.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { confirmDialog, errorDialog } from "../../core/dialogs.ts";
import { byId, closest, escapeHtml as esc, saveBlob } from "../../core/dom.ts";
import { formatDuration } from "../../core/format.ts";
import { stemsMissingText } from "../../core/stems-hint.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { displayTitle, generatedLyrics } from "../library/song-row.ts";
import type { AudioEngine } from "../player/audio-engine.ts";
import { Waveform } from "../player/waveform.ts";

const SPEAKER_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 9v6h4l5 4V5L8 9H4z"/><path class="w1" d="M16 9a3.5 3.5 0 0 1 0 6"/><path class="w2" d="M18.5 6.5a7 7 0 0 1 0 11"/><path class="mx" d="M17 9l5 6M22 9l-5 6"/>
</svg>`;
const SPARK_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/>
</svg>`;
/** Abfrage, solange eine Version wartet oder läuft */
const POLL_MS = 4000;
/** Grobe Dauer je Spur und Minute Musik (docs/stems.md) */
const SECONDS_PER_TRACK_MINUTE = 75;

export interface MixerViewDeps {
  api: ApiClient;
  t: Translate;
  /** Song aus dem Speicher; fehlt er, lädt die View ihn nach */
  findSong: (id: string) => Song | undefined;
  /** Zurück zur Bibliothek */
  back: () => void;
  /** Gemeinsame Wiedergabe mit dem Player */
  engine: AudioEngine;
  /** Spuren-Modell vorhanden (sonst keine neuen Versionen) */
  stemsAvailable: () => boolean;
}

/** Eine Version eines Kanals: Spur-ID (oder SOURCE_CHANNEL für die Vorlage), ihre Wellenform und, sobald geladen, ihr Audio */
interface Take {
  id: string;
  kind: StemKind | null;
  version: number;
  status: StemStatus;
  message: string | null;
  url: string | null;
  recipe: StemRecipe | null;
  wave: Waveform | null;
  buffer: AudioBuffer | null;
  /** Laden fehlgeschlagen */
  failed: boolean;
  lane: HTMLElement;
}

interface Channel {
  /** Spurname oder SOURCE_CHANNEL */
  key: string;
  track: StemTrack | null;
  /** Übersetzungsschlüssel des Namens */
  label: string;
  row: HTMLElement;
  takes: Take[];
  activeId: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  /** Nur neue Versionen, kein Original: im Mixer hinzugefügte Spur (ganz löschbar) */
  added: boolean;
  /** „+ Spur“ gewählt, aber noch nicht erzeugt: verschwindet mit Abbrechen */
  draft: boolean;
}

/** Wünsche im ✦-Feld, solange es offen ist */
interface Editor {
  key: string;
  axes: Record<VariationAxis, number>;
  chips: Set<string>;
  text: string;
  count: number;
  /** Seed der ersten Version; leer = zufällig */
  seed: string;
}

export class MixerView {
  private readonly deps: MixerViewDeps;
  private readonly root = byId("mixer");
  private readonly title = byId("mixerTitle");
  private readonly tracksEl = byId("mixerTracks");
  private readonly playBtn = byId<HTMLButtonElement>("mixerPlay");
  private readonly timeEl = byId("mixerTime");
  private readonly scrub = byId<HTMLInputElement>("mixerScrub");
  private readonly mixButton = byId<HTMLButtonElement>("mixerMixDl");
  private readonly zipLink = byId<HTMLAnchorElement>("mixerZip");
  private readonly addBar = byId("mixerAddBar");
  private readonly addButton = byId<HTMLButtonElement>("mixerAddTrack");
  private readonly addPick = byId("mixerAddPick");
  private song: Song | null = null;
  private channels: Channel[] = [];
  private songId: string | null = null;
  /** Alle beim Öffnen vorhandenen Versionen sind geladen (und spielen in der Engine); später fertige steigen synchron ein */
  private loaded = false;
  /** Mix wird gerade auf dem Server gemischt und geladen */
  private mixing = false;
  private editor: Editor | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  /** Fortschritt der laufenden Version (Song-Meldung) */
  private progress: string | null = null;

  constructor(deps: MixerViewDeps) {
    this.deps = deps;
    byId("mixerBack").addEventListener("click", () => deps.back());
    this.playBtn.addEventListener("click", () => void this.togglePlay());
    this.mixButton.addEventListener("click", () => void this.downloadMix());
    this.scrub.addEventListener("input", () => this.seekTo((Number(this.scrub.value) / 1000) * deps.engine.duration));
    deps.engine.onState(() => this.updatePlayButton());
    deps.engine.onTick(() => this.updateTransport());
    this.tracksEl.addEventListener("click", (e) => this.onTrackClick(e));
    this.tracksEl.addEventListener("input", (e) => this.onTrackInput(e));
    this.addButton.addEventListener("click", () => this.toggleAddPick());
    this.addPick.addEventListener("click", (e) => {
      const track = closest<HTMLElement>(e.target, "[data-track]")?.dataset.track as StemTrack | undefined;
      if (track) this.startAdd(track);
    });
    document.addEventListener("pointerdown", (e) => {
      if (!this.channels.length) return;
      if (closest(e.target, ".mixer-vol.is-open")) return;
      this.closeVolPopovers();
    });
  }

  /** Mixer öffnen bzw. Song wechseln. */
  async open(songId: string): Promise<void> {
    if (this.songId === songId && this.channels.length) return;
    // Ein anderer Song verstummt; läuft dieser schon (Player), spielt er weiter, bis die Spuren geladen sind
    if (this.deps.engine.songId !== songId) this.deps.engine.pause();
    this.destroy();
    this.songId = songId;
    this.root.classList.add("loading");
    this.playBtn.disabled = true;
    this.updatePlayButton();
    this.timeEl.textContent = "…";
    this.scrub.value = "0";
    this.zipLink.hidden = true;
    this.updateMixButton();

    let song = this.deps.findSong(songId);
    if (!song) {
      try { song = await this.deps.api.song(songId); }
      catch { this.showEmpty(this.deps.t("mixer_missing")); return; }
    }
    this.title.textContent = displayTitle(song);
    this.song = song;

    let stems: Stem[];
    try { stems = await this.deps.api.stems(songId); }
    catch { this.showEmpty(this.deps.t("mixer_missing")); return; }
    if (this.songId !== songId) return;

    // Ein Kanal je Spur mit einer fertigen Version oder einer neuen (auch wartend: hinzugefügte Spur), nach Position
    const tracks = channelTracks(stems);
    if (!tracks.length && !song.source_url) {
      this.showEmpty(this.deps.t("mixer_no_stems"));
      return;
    }

    this.tracksEl.innerHTML = "";
    this.channels = [];
    this.syncStems(stems);
    // Vorlage zuletzt: beim Ersetzen stumm (darin stecken die ersetzten Instrumente, zum Vergleichen per Solo),
    // beim Begleiten hörbar (die Aufnahme gehört zum Song, die Spuren begleiten sie nur)
    if (song.source_url) {
      const ch = this.createChannel({ key: SOURCE_CHANNEL, track: null, label: "source_track", muted: song.params.mode !== "accompany" });
      this.channels.push(ch);
      this.addTake(ch, { id: SOURCE_CHANNEL, kind: null, version: 1, status: "done", message: null, url: song.source_url, recipe: null });
      ch.activeId = SOURCE_CHANNEL;
      this.renderChannel(ch);
    }
    this.zipLink.href = `/api/songs/${songId}/stems.zip`;
    this.zipLink.hidden = false;
    this.renderAddBar();
    this.applyGains();
    this.root.classList.remove("loading");
    this.updateTransport();
    this.checkAllReady();
    this.schedulePoll();
  }

  /** Mixer verlassen und den Song zurückgeben, der offen war. Die Wiedergabe läuft weiter: der Player übernimmt sie. */
  close(): string | null {
    const songId = this.songId;
    this.destroy();
    this.songId = null;
    return songId;
  }

  /** Szene dieses Mixers in der Engine */
  private key(): string {
    return `mixer:${this.songId}`;
  }

  private owns(): boolean {
    return this.songId !== null && this.deps.engine.sceneKey === this.key();
  }

  refreshTexts(): void {
    if (!this.songId) return;
    this.channels.forEach((ch) => {
      ch.row.querySelector(".mixer-name")!.textContent = this.deps.t(ch.label);
      this.renderChannel(ch);
    });
    if (this.editor) this.renderEditor();
    this.renderAddBar();
    this.updateMixButton();
  }

  // ——— Kanäle und Versionen ———

  private createChannel(o: { key: string; track: StemTrack | null; label: string; muted: boolean }): Channel {
    const { t } = this.deps;
    const row = document.createElement("div");
    row.className = `mixer-track${o.muted ? " is-muted" : ""}`;
    row.dataset.ch = o.key;
    // Neue Version nur für Spuren, die ACE-Step kennt (nicht die Demucs-Restspur "other")
    const spark = o.track && o.track !== OTHER_TRACK
      ? `<button type="button" class="sek icon mixer-new" data-a="ver-open" title="${t("ver_new")}" aria-label="${t("ver_new")}" aria-expanded="false">${SPARK_SVG}</button>`
      : "";
    row.innerHTML = `
      <div class="mixer-label">
        <button type="button" class="mixer-title" data-a="fold" aria-expanded="false" disabled>
          <svg class="mixer-caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg><span class="mixer-name">${t(o.label)}</span>
          <span class="mixer-count"></span>
        </button>
        <div class="mixer-btns">
          <button type="button" class="sek icon mixer-mute" data-a="mute" aria-pressed="${o.muted}" title="${t("mixer_mute")}">M</button>
          <button type="button" class="sek icon mixer-solo" data-a="solo" aria-pressed="false" title="${t("mixer_solo")}">S</button>
          <a class="sek icon mixer-dl" download title="${t("download")}" aria-label="${t("download")}">↓</a>
          ${spark}
        </div>
      </div>
      <div class="mixer-lanes"></div>
      <div class="mixer-vol" data-level="high" style="--v:1">
        <button type="button" class="sek icon mixer-vol-btn" data-a="vol-toggle" title="${t("mixer_volume")}" aria-label="${t("mixer_volume")}" aria-expanded="false">${SPEAKER_SVG}</button>
        <input type="range" min="0" max="100" value="100" data-a="vol" aria-label="${t("mixer_volume")}">
      </div>
      <div class="mixer-ver" hidden></div>`;
    const ch: Channel = { key: o.key, track: o.track, label: o.label, row, takes: [], activeId: "", volume: 1, muted: o.muted, solo: false, added: false, draft: false };
    // Spuren vor die Vorlage (sie steht immer zuletzt)
    const source = this.channels.findIndex((c) => !c.track);
    if (o.track && source >= 0) {
      this.tracksEl.insertBefore(row, this.channels[source]!.row);
      this.channels.splice(source, 0, ch);
    } else {
      this.tracksEl.appendChild(row);
      this.channels.push(ch);
    }
    return ch;
  }

  /** Versionen der Kanäle an den Stand des Servers angleichen: neue Spalten, fertige Waveforms, Gelöschtes weg. */
  private syncStems(stems: Stem[]): void {
    const active = new Map(activeTakes(stems).map((s) => [s.track, s.id]));
    for (const track of channelTracks(stems)) {
      if (!this.channels.some((c) => c.key === track)) this.createChannel({ key: track, track, label: `track_${track}`, muted: false });
    }
    for (const ch of [...this.channels]) {
      if (!ch.track) continue;
      // Fertige Versionen; wartende und fehlgeschlagene nur bei neuen Versionen (fehlerhaftes Herauslösen nicht)
      const mine = stems.filter((s) => s.track === ch.track && (s.status === "done" || s.kind === "version"));
      if (!mine.length && !ch.draft) {   // hinzugefügte Spur ganz gelöscht
        ch.takes.forEach((take) => this.removeTake(ch, take));
        ch.row.remove();
        this.channels = this.channels.filter((c) => c !== ch);
        continue;
      }
      if (mine.length) {
        ch.added = mine.every((s) => s.kind === "version");
        ch.draft = false;
      }
      for (const take of [...ch.takes]) {
        if (!mine.some((s) => s.id === take.id)) this.removeTake(ch, take);
      }
      for (const stem of mine) {
        const take = ch.takes.find((x) => x.id === stem.id);
        if (!take) this.addTake(ch, stem);
        else {
          const finished = take.status !== "done" && stem.status === "done";
          Object.assign(take, { kind: stem.kind, status: stem.status, message: stem.message, url: stem.url, recipe: stem.recipe });
          if (finished) this.loadTake(take);
        }
      }
      ch.takes.sort((a, b) => a.version - b.version);
      const lanes = ch.row.querySelector(".mixer-lanes")!;
      if (ch.takes.some((take, i) => lanes.children[i] !== take.lane)) ch.takes.forEach((take) => lanes.appendChild(take.lane));
      ch.activeId = active.get(ch.track) ?? ch.takes.find((x) => x.status === "done")?.id ?? "";
      this.renderChannel(ch);
    }
    this.renderAddBar();
    this.applyGains();
  }

  private addTake(ch: Channel, s: Pick<Take, "id" | "kind" | "version" | "status" | "message" | "url" | "recipe">): void {
    const lane = document.createElement("div");
    lane.className = "mixer-lane";
    lane.dataset.take = s.id;
    lane.innerHTML = `<div class="mixer-lane-head"></div><div class="mixer-wave"></div>`;
    ch.row.querySelector(".mixer-lanes")!.appendChild(lane);
    const take: Take = { ...s, wave: null, buffer: null, failed: false, lane };
    ch.takes.push(take);
    if (take.status === "done") this.loadTake(take);
  }

  private removeTake(ch: Channel, take: Take): void {
    take.wave?.destroy();
    take.wave = null;
    take.lane.remove();
    ch.takes = ch.takes.filter((x) => x !== take);
    this.deps.engine.removeLayer(this.key(), take.id);
  }

  private loadTake(take: Take): void {
    if (take.wave || !take.url) return;
    const container = take.lane.querySelector<HTMLElement>(".mixer-wave")!;
    container.classList.remove("is-pending");
    take.wave = new Waveform(container, {
      height: 48, cursor: true,
      onSeek: (f) => { if (take.buffer) this.seekTo(f * take.buffer.duration); },
    });
    const songId = this.songId;
    const lateJoiner = this.loaded;
    this.deps.engine.load(take.url).then((buffer) => {
      if (this.songId !== songId || !take.wave) return;   // Mixer zu oder Version gelöscht
      take.buffer = buffer;
      take.wave.setBuffer(buffer);
      if (lateJoiner) {
        // Später fertig gewordene Version: an der aktuellen Stelle einsteigen
        this.deps.engine.addLayer(this.key(), { id: take.id, buffer, gain: this.gains().get(take.id) ?? 0 });
        this.updateTransport();
      } else this.checkAllReady();
    }, () => {
      take.failed = true;
      if (!lateJoiner) this.checkAllReady();
    });
  }

  /** Kopf (Name, Anzahl, Download) und die Zeilen der Versionen neu beschriften. */
  private renderChannel(ch: Channel): void {
    const { t } = this.deps;
    const many = ch.takes.length > 1;
    // Noch keine fertige Version (hinzugefügte Spur): Zeilen mit Status zeigen, sonst wäre der Kanal leer
    ch.row.classList.toggle("is-new", !!ch.track && !ch.takes.some((x) => x.status === "done"));
    const fold = ch.row.querySelector<HTMLButtonElement>(".mixer-title")!;
    fold.disabled = !many;
    if (!many) ch.row.classList.remove("is-open");
    fold.setAttribute("aria-expanded", String(ch.row.classList.contains("is-open")));
    fold.title = many ? t("ver_fold") : "";
    const active = ch.takes.find((x) => x.id === ch.activeId);
    const pending = ch.takes.filter((x) => x.status === "queued" || x.status === "running").length;
    ch.row.querySelector(".mixer-count")!.textContent = many
      ? `${active && ch.track ? `v${active.version} · ` : ""}${t("ver_versions", ch.takes.length)}${pending ? " …" : ""}`
      : "";
    const dl = ch.row.querySelector<HTMLAnchorElement>(".mixer-dl")!;
    if (active?.url) dl.href = `${active.url}?download=1`;
    dl.hidden = !active?.url;
    const spark = ch.row.querySelector<HTMLButtonElement>(".mixer-new");
    if (spark) {
      spark.disabled = !this.deps.stemsAvailable() || !active;
      spark.title = this.deps.stemsAvailable() ? t("ver_new") : stemsMissingText(t);
    }
    ch.takes.forEach((take) => this.renderLane(ch, take));
  }

  private renderLane(ch: Channel, take: Take): void {
    const { t } = this.deps;
    const on = take.id === ch.activeId;
    take.lane.classList.toggle("is-active", on);
    take.lane.classList.toggle("is-pending", take.status !== "done");
    take.lane.querySelector(".mixer-wave")!.classList.toggle("is-pending", take.status !== "done");
    const state = take.status === "done" ? ""
      : take.status === "running" ? `<span class="s run">${esc(this.runningText())}</span>`
      : take.status === "queued" ? `<span class="s">${t("waiting")}</span>`
      : `<span class="s err" title="${esc(take.message)}">${t(take.message === "cancelled" ? "cancelled" : "error")}</span>`;
    const desc = this.describe(ch, take);
    const dl = take.url ? `<a class="sek icon mini" href="${take.url}?download=1" download title="${t("download")}" aria-label="${t("download")}">↓</a>` : "";
    // Die hörbare Version und laufende lassen sich nicht löschen (erst umschalten bzw. abbrechen); eine hinzugefügte
    // Spur schon, auch ihre letzte Version: dann ist die Spur weg
    const idle = take.status !== "queued" && take.status !== "running";
    const deletable = ch.track && idle && (ch.added || (!on && ch.takes.length > 1));
    const del = deletable ? `<button type="button" class="sek icon mini" data-a="ver-del" title="${t("ver_del")}" aria-label="${t("ver_del")}">✕</button>` : "";
    // Nachbauen: Wünsche und Seed dieser Version ins ✦-Feld (nur Versionen mit gespeichertem Seed)
    const seed = take.recipe?.seed;
    const redo = ch.track && seed !== undefined
      ? `<button type="button" class="sek icon mini" data-a="ver-redo" title="${esc(t("ver_redo", seed))}" aria-label="${esc(t("ver_redo", seed))}">↻</button>` : "";
    const tip = [take.recipe?.caption, seed !== undefined ? `Seed ${seed}` : ""].filter(Boolean).join("\n");
    take.lane.querySelector(".mixer-lane-head")!.innerHTML = `
      <button type="button" class="mixer-take" data-a="activate" role="radio" aria-checked="${on}" ${take.status === "done" ? "" : "disabled"}
        title="${t("ver_activate")}"><span class="mixer-dot" aria-hidden="true"></span>v${take.version}</button>
      <span class="mixer-take-desc" title="${esc(tip)}">${esc(desc)}</span>${state}
      <span class="mixer-lane-btns">${redo}${dl}${del}</span>`;
  }

  /** "wird erzeugt … · 0:42": die Laufzeit aus der Song-Meldung ("1/2 drums v3 · 0:42") */
  private runningText(): string {
    const elapsed = this.progress?.split("·").pop()?.trim();
    return elapsed && /^\d+:\d\d$/.test(elapsed) ? `${this.deps.t("stem_running")} · ${elapsed}` : this.deps.t("stem_running");
  }

  /** Kurzbeschreibung einer Version: Knöpfe, übrige Regler, Freitext. */
  private describe(ch: Channel, take: Take): string {
    const { t } = this.deps;
    const r = take.recipe;
    if (!r || !ch.track) return t("ver_original");
    const chips = chipsFor(ch.track).filter((c) => r.chips.includes(c.id));
    const covered = (axis: VariationAxis) => chips.some((c) => c.axes?.[axis] === r.axes[axis]);
    const parts = [
      ...chips.map((c) => t(`ver_chip_${c.id}`)),
      ...VARIATION_AXES.filter((a) => r.axes[a] && !covered(a)).map((a) => `${t(`ver_axis_${a}`)} ${r.axes[a]! > 0 ? "+" : ""}${r.axes[a]}`),
      ...(r.text ? [`„${r.text}“`] : []),
    ];
    return parts.length ? parts.join(" · ") : t("ver_plain");
  }

  // ——— Wiedergabe ———

  private allTakes(): Take[] {
    return this.channels.flatMap((ch) => ch.takes);
  }

  /** Länge des Songs: die längste geladene Version */
  private duration(): number {
    return this.allTakes().reduce((d, x) => Math.max(d, x.buffer?.duration ?? 0), 0);
  }

  private checkAllReady(): void {
    if (this.loaded) return;
    const pending = this.allTakes().some((x) => x.status === "done" && x.url && !x.buffer && !x.failed);
    if (!pending) this.onAllReady();
  }

  /**
   * Alles geladen: die Spuren werden zur Szene der Engine. Spielte dieser Song schon (im Player), blendet sie an
   * derselben Stelle über; sonst steht der Mixer am Anfang bereit.
   */
  private onAllReady(): void {
    this.loaded = true;
    const engine = this.deps.engine;
    const same = engine.songId === this.songId;
    const gains = this.gains();
    const layers = this.allTakes().filter((x) => x.buffer).map((x) => ({ id: x.id, buffer: x.buffer!, gain: gains.get(x.id) ?? 0 }));
    if (!layers.length) return;   // nichts Abspielbares (nur wartende Versionen): der Song im Player läuft weiter
    this.playBtn.disabled = false;
    engine.show(this.key(), this.songId!, layers, same ? { at: "continue", play: "continue" } : { at: 0, play: false });
    this.applyGains();
    this.updateTransport();
    this.updateEditor();
  }

  private togglePlay(): void {
    if (this.owns()) this.deps.engine.toggle();
  }

  /** Springen: auch schon während des Ladens, wenn der Song im Player läuft (die Spuren steigen dort ein) */
  private seekTo(time: number): void {
    if (this.songId && this.deps.engine.songId === this.songId) this.deps.engine.seek(time);
  }

  private updatePlayButton(): void {
    const playing = this.owns() && this.deps.engine.playing;
    this.playBtn.textContent = playing ? "❚❚" : "▶";
    this.playBtn.setAttribute("aria-label", this.deps.t(playing ? "pause" : "play"));
  }

  private updateTransport(): void {
    const engine = this.deps.engine;
    if (!this.songId || engine.songId !== this.songId) return;
    const cur = engine.position;
    const dur = engine.duration;
    this.timeEl.textContent = `${formatDuration(cur)} / ${formatDuration(dur)}`;
    if (document.activeElement !== this.scrub) {
      this.scrub.value = String(dur > 0 ? Math.round((cur / dur) * 1000) : 0);
    }
    this.allTakes().forEach((x) => x.wave?.setProgress(x.buffer ? cur / x.buffer.duration : 0));
  }

  // ——— Bedienung ———

  private onTrackClick(e: Event): void {
    const btn = closest<HTMLElement>(e.target, "[data-a]");
    const row = closest<HTMLElement>(e.target, "[data-ch]");
    if (!btn || !row) return;
    const ch = this.channels.find((c) => c.key === row.dataset.ch);
    if (!ch) return;
    const take = ch.takes.find((x) => x.id === closest<HTMLElement>(btn, "[data-take]")?.dataset.take);
    switch (btn.dataset.a) {
      case "vol-toggle": {
        const box = closest<HTMLElement>(btn, ".mixer-vol");
        const open = !box?.classList.contains("is-open");
        this.closeVolPopovers();
        if (open && box) {
          box.classList.add("is-open");
          btn.setAttribute("aria-expanded", "true");
          box.querySelector<HTMLInputElement>("input[data-a=vol]")?.focus();
        }
        return;
      }
      case "mute":
        ch.muted = !ch.muted;
        btn.setAttribute("aria-pressed", String(ch.muted));
        row.classList.toggle("is-muted", ch.muted);
        this.applyGains();
        return;
      case "solo":
        ch.solo = !ch.solo;
        btn.setAttribute("aria-pressed", String(ch.solo));
        row.classList.toggle("is-solo", ch.solo);
        this.applyGains();
        return;
      case "fold":
        row.classList.toggle("is-open");
        this.renderChannel(ch);
        return;
      case "activate":
        if (take) void this.activate(ch, take);
        return;
      case "ver-del":
        if (take) void this.deleteTake(ch, take);
        return;
      case "ver-redo":
        if (take?.recipe) this.openEditor(ch, take.recipe);
        return;
      case "ver-open":
        this.toggleEditor(ch);
        return;
      default:
        this.onEditorClick(ch, btn);
    }
  }

  private onTrackInput(e: Event): void {
    const target = e.target as HTMLInputElement;
    const row = closest<HTMLElement>(target, "[data-ch]");
    const ch = row && this.channels.find((c) => c.key === row.dataset.ch);
    if (!ch) return;
    if (target.matches("input[data-a=vol]")) {
      ch.volume = Number(target.value) / 100;
      this.syncVolUi(row!, ch.volume);
      this.applyGains();
    } else if (this.editor?.key === ch.key) {
      this.onEditorInput(ch, target);
    }
  }

  /** Version umschalten: sofort hörbar (alle Versionen laufen mit), dann auf dem Server merken. */
  private async activate(ch: Channel, take: Take): Promise<void> {
    if (take.id === ch.activeId || take.status !== "done") return;
    const before = ch.activeId;
    ch.activeId = take.id;
    this.renderChannel(ch);
    this.applyGains();
    try {
      await this.deps.api.activateStem(take.id);
    } catch (e) {
      ch.activeId = before;
      this.renderChannel(ch);
      this.applyGains();
      void errorDialog(this.deps.t, e);
    }
  }

  private async deleteTake(ch: Channel, take: Take): Promise<void> {
    const { t } = this.deps;
    const last = ch.added && ch.takes.length === 1;
    const ok = await confirmDialog({
      title: last ? t("add_del_q", t(ch.label)) : t("ver_del_q", take.version), message: last ? t("add_del_msg") : t("ver_del_msg"),
      confirmLabel: t("del"), cancelLabel: t("cancel"), danger: true,
    });
    if (!ok) return;
    try {
      this.syncStems(await this.deps.api.deleteStem(take.id));
    } catch (e) {
      void errorDialog(t, e);
    }
  }

  private closeVolPopovers(): void {
    this.tracksEl.querySelectorAll<HTMLElement>(".mixer-vol.is-open").forEach((box) => {
      box.classList.remove("is-open");
      box.querySelector(".mixer-vol-btn")?.setAttribute("aria-expanded", "false");
    });
  }

  private syncVolUi(row: HTMLElement, volume: number): void {
    const box = row.querySelector<HTMLElement>(".mixer-vol");
    if (!box) return;
    box.dataset.level = volume === 0 ? "off" : volume < 0.5 ? "low" : "high";
    box.style.setProperty("--v", String(volume));
  }

  /**
   * Lautstärke je Version, wie sie zu hören ist: Solo → nur Solo-Kanäle, sonst Mute; Regler immer multipliziert.
   * Von mehreren Versionen eines Kanals hat nur die aktive Lautstärke, die anderen laufen stumm mit.
   */
  private gains(): Map<string, number> {
    const anySolo = this.channels.some((c) => c.solo);
    return new Map(this.channels.flatMap((ch) => {
      const gain = (anySolo ? ch.solo : !ch.muted) ? ch.volume : 0;
      return ch.takes.filter((x) => x.status === "done").map((x) => [x.id, x.id === ch.activeId ? gain : 0] as const);
    }));
  }

  private applyGains(): void {
    const gains = this.gains();
    this.channels.forEach((ch) => {
      ch.takes.forEach((x) => this.deps.engine.setGain(this.key(), x.id, gains.get(x.id) ?? 0));
      ch.row.classList.toggle("is-silent", !gains.get(ch.activeId));
    });
    this.updateMixButton();
  }

  /** „Mix ↓“: nur wenn etwas zu hören ist; während des Mischens „…“. */
  private updateMixButton(): void {
    const { t } = this.deps;
    const audible = [...this.gains().values()].some((g) => g > 0);
    this.mixButton.disabled = this.mixing || !audible;
    this.mixButton.textContent = this.mixing ? "…" : t("mix_dl");
    this.mixButton.title = audible ? t("mix_dl_tip") : t("mix_dl_silent");
  }

  /** Der Server mischt die gespeicherten Spuren mit den aktuellen Reglern; die WAV-Datei kommt als Download. */
  private async downloadMix(): Promise<void> {
    const songId = this.songId;
    if (!songId || this.mixing) return;
    this.mixing = true;
    this.updateMixButton();
    try {
      const { blob, filename } = await this.deps.api.mixdown(songId, this.gains());
      saveBlob(blob, filename);
    } catch (e) {
      void errorDialog(this.deps.t, e);
    } finally {
      this.mixing = false;
      this.updateMixButton();
    }
  }

  // ——— Neue Version (✦) ———

  private toggleEditor(ch: Channel): void {
    if (this.editor?.key === ch.key) this.closeEditor();
    else this.openEditor(ch);
  }

  /** ✦-Feld öffnen, leer oder mit den Wünschen und dem Seed einer vorhandenen Version (zum Nachbauen). */
  private openEditor(ch: Channel, from?: StemRecipe): void {
    this.closeEditor();
    if (!ch.track) return;
    this.editor = {
      key: ch.key, axes: Object.fromEntries(VARIATION_AXES.map((a) => [a, from?.axes[a] ?? 0])) as Record<VariationAxis, number>,
      chips: new Set(from?.chips ?? []), text: from?.text ?? "", count: 1, seed: from?.seed !== undefined ? String(from.seed) : "",
    };
    this.renderEditor();
    ch.row.querySelector<HTMLElement>(from ? "[data-a=ver-go]" : ".mixer-ver .chip")?.focus();
  }

  private closeEditor(): void {
    if (!this.editor) return;
    const ch = this.channels.find((c) => c.key === this.editor!.key);
    this.editor = null;
    if (!ch) return;
    if (ch.draft) {   // „+ Spur“ abgebrochen
      ch.row.remove();
      this.channels = this.channels.filter((c) => c !== ch);
      this.renderAddBar();
      return;
    }
    const box = ch.row.querySelector<HTMLElement>(".mixer-ver")!;
    box.hidden = true;
    box.innerHTML = "";
    ch.row.classList.remove("is-editing");
    ch.row.querySelector(".mixer-new")?.setAttribute("aria-expanded", "false");
  }

  private renderEditor(): void {
    const ed = this.editor;
    const ch = ed && this.channels.find((c) => c.key === ed.key);
    if (!ed || !ch?.track) return;
    const { t } = this.deps;
    const chips = chipsFor(ch.track).map((c) =>
      `<button type="button" class="chip" data-a="ver-chip" data-chip="${c.id}" aria-pressed="false">${esc(t(`ver_chip_${c.id}`))}</button>`).join("");
    const axes = VARIATION_AXES.map((a) => `
      <label class="axis"><span class="axis-end">${esc(t(`ver_lo_${a}`))}</span>
        <input type="range" min="${-AXIS_MAX}" max="${AXIS_MAX}" step="1" value="${ed.axes[a]}" data-axis="${a}" aria-label="${esc(t(`ver_axis_${a}`))}">
        <span class="axis-end hi">${esc(t(`ver_hi_${a}`))}</span></label>`).join("");
    const counts = Array.from({ length: MAX_VERSION_COUNT }, (_, i) => i + 1).map((n) =>
      `<button type="button" class="chip" data-a="ver-count" data-count="${n}" aria-pressed="false">${n}</button>`).join("");
    const box = ch.row.querySelector<HTMLElement>(".mixer-ver")!;
    box.innerHTML = `
      <div class="mixer-ver-head"><strong>${esc(t(ch.draft ? "add_title" : "ver_title", t(ch.label)))}</strong><span class="small">${esc(t(ch.draft ? "add_keep" : "ver_keep"))}</span></div>
      <div class="mixer-ver-chips">${chips}</div>
      <div class="axes mixer-ver-axes">${axes}</div>
      <input type="text" class="mixer-ver-text" maxlength="${MAX_VERSION_TEXT}" value="${esc(ed.text)}" placeholder="${esc(t("ver_text_ph"))}" aria-label="${esc(t("ver_text_ph"))}">
      <div class="mixer-ver-preview small"><span class="mixer-ver-prompt-lbl">${esc(t("ver_prompt"))}</span> <span class="mixer-ver-prompt"></span></div>
      <div class="mixer-ver-bar">
        <span class="small">${esc(t("ver_count"))}</span><span class="mixer-ver-counts">${counts}</span>
        <label class="small mixer-ver-seed" title="${esc(t("ver_seed_tip"))}">Seed
          <input type="number" min="0" step="1" value="${esc(ed.seed)}" placeholder="${esc(t("seed_ph"))}"></label>
        <span class="small mixer-ver-eta"></span>
        <span class="mixer-ver-actions">
          <button type="button" class="sek" data-a="ver-reset">${esc(t("ver_reset"))}</button>
          <button type="button" class="sek" data-a="ver-close">${esc(t("cancel"))}</button>
          <button type="button" class="aktion" data-a="ver-go">${esc(t("ver_go"))}</button>
        </span>
      </div>`;
    box.hidden = false;
    ch.row.classList.add("is-editing");
    ch.row.querySelector(".mixer-new")?.setAttribute("aria-expanded", "true");
    this.updateEditor();
  }

  /** Zustand des ✦-Felds in die Knöpfe, Regler und die Vorschau schreiben (ohne neu zu rendern: Fokus bleibt). */
  private updateEditor(): void {
    const ed = this.editor;
    const ch = ed && this.channels.find((c) => c.key === ed.key);
    if (!ed || !ch?.track) return;
    const { t } = this.deps;
    const box = ch.row.querySelector<HTMLElement>(".mixer-ver")!;
    box.querySelectorAll<HTMLElement>("[data-a=ver-chip]").forEach((b) => {
      const on = ed.chips.has(b.dataset.chip!);
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    box.querySelectorAll<HTMLInputElement>("input[data-axis]").forEach((input) => {
      const v = ed.axes[input.dataset.axis as VariationAxis];
      input.value = String(v);
      closest(input, ".axis")?.classList.toggle("set", v !== 0);
    });
    box.querySelectorAll<HTMLElement>("[data-a=ver-count]").forEach((b) => {
      const on = Number(b.dataset.count) === ed.count;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    const tags = variationTags(ch.track, { axes: ed.axes, chips: [...ed.chips] });
    if (ed.text.trim()) tags.push(ed.text.trim());
    box.querySelector(".mixer-ver-prompt")!.innerHTML = tags.length
      ? `${esc(tags.join(", "))} <span class="faint">${esc(t("ver_style"))}</span>`
      : `<span class="faint">${esc(t("ver_same"))}</span>`;
    const duration = this.duration();
    const minutes = Math.max(1, Math.round((ed.count * SECONDS_PER_TRACK_MINUTE * duration) / 3600));
    box.querySelector(".mixer-ver-eta")!.textContent = duration ? t("ver_eta", minutes) : "";
  }

  private onEditorClick(ch: Channel, btn: HTMLElement): void {
    const ed = this.editor;
    if (!ed || ed.key !== ch.key || !ch.track) return;
    switch (btn.dataset.a) {
      case "ver-chip": {
        const chip = chipsFor(ch.track).find((c) => c.id === btn.dataset.chip);
        if (chip) this.toggleChip(ed, ch.track, chip);
        break;
      }
      case "ver-count":
        ed.count = Number(btn.dataset.count) || 1;
        break;
      case "ver-reset":
        VARIATION_AXES.forEach((a) => { ed.axes[a] = 0; });
        ed.chips.clear();
        ed.text = "";
        ed.seed = "";
        ch.row.querySelector<HTMLInputElement>(".mixer-ver-text")!.value = "";
        ch.row.querySelector<HTMLInputElement>(".mixer-ver-seed input")!.value = "";
        break;
      case "ver-close":
        this.closeEditor();
        return;
      case "ver-go":
        void this.createVersions(ch, btn as HTMLButtonElement);
        return;
      default:
        return;
    }
    this.updateEditor();
  }

  private onEditorInput(ch: Channel, target: HTMLInputElement): void {
    const ed = this.editor!;
    if (target.matches(".mixer-ver-text")) {
      ed.text = target.value;
    } else if (target.matches(".mixer-ver-seed input")) {
      ed.seed = target.value;
      return;
    } else if (target.dataset.axis && ch.track) {
      const axis = target.dataset.axis as VariationAxis;
      ed.axes[axis] = Number(target.value);
      // Knöpfe, die diesen Regler anders setzen, gelten nicht mehr
      for (const c of chipsFor(ch.track)) {
        if (ed.chips.has(c.id) && c.axes?.[axis] !== undefined && c.axes[axis] !== ed.axes[axis]) ed.chips.delete(c.id);
      }
    }
    this.updateEditor();
  }

  /**
   * Schnellwahl an: setzt ihre Regler sichtbar und verdrängt Knöpfe derselben Gruppe oder mit anderem Reglerwert.
   * Aus: stellt ihre Regler auf 0 zurück, sofern sie noch so stehen.
   */
  private toggleChip(ed: Editor, track: StemTrack, chip: VariationChip): void {
    const axes = Object.entries(chip.axes ?? {}) as [VariationAxis, number][];
    if (ed.chips.has(chip.id)) {
      ed.chips.delete(chip.id);
      for (const [a, v] of axes) if (ed.axes[a] === v) ed.axes[a] = 0;
      return;
    }
    for (const other of chipsFor(track)) {
      if (!ed.chips.has(other.id)) continue;
      const clash = (chip.group && other.group === chip.group)
        || axes.some(([a, v]) => other.axes?.[a] !== undefined && other.axes[a] !== v);
      if (clash) ed.chips.delete(other.id);
    }
    ed.chips.add(chip.id);
    for (const [a, v] of axes) ed.axes[a] = v;
  }

  private async createVersions(ch: Channel, btn: HTMLButtonElement): Promise<void> {
    const ed = this.editor;
    const base = ch.takes.find((x) => x.id === ch.activeId);
    if (!ed || !this.songId || !ch.track || (!base && !ch.draft)) return;
    btn.disabled = true;
    try {
      const axes = Object.fromEntries(VARIATION_AXES.filter((a) => ed.axes[a]).map((a) => [a, ed.axes[a]]));
      const seed = ed.seed.trim() === "" ? undefined : Number(ed.seed);
      const request = { axes, chips: [...ed.chips], text: ed.text.trim(), count: ed.count, seed };
      const stems = ch.draft
        ? await this.deps.api.addTrack(this.songId, { track: ch.track, ...request })
        : await this.deps.api.createVersions(base!.id, request);
      ch.draft = false;   // ab jetzt ein echter Kanal: Schließen entfernt ihn nicht mehr
      this.closeEditor();
      ch.row.classList.add("is-open");
      this.syncStems(stems);
      this.schedulePoll();
    } catch (e) {
      btn.disabled = false;
      void errorDialog(this.deps.t, e);
    }
  }

  // ——— Abfrage wartender Versionen ———

  private schedulePoll(): void {
    clearTimeout(this.pollTimer);
    const pending = this.channels.some((ch) => ch.takes.some((x) => x.status === "queued" || x.status === "running"));
    if (!pending || !this.songId) return;
    const songId = this.songId;
    this.pollTimer = setTimeout(() => void this.poll(songId), POLL_MS);
  }

  private async poll(songId: string): Promise<void> {
    try {
      const [stems, song] = await Promise.all([this.deps.api.stems(songId), this.deps.api.song(songId)]);
      if (this.songId !== songId) return;
      this.progress = song.message;
      this.syncStems(stems);
    } catch {
      // Server kurz weg: beim nächsten Mal wieder versuchen
    }
    if (this.songId === songId) this.schedulePoll();
  }

  private showEmpty(message: string): void {
    this.root.classList.remove("loading");
    this.tracksEl.innerHTML = `<div class="empty">${message}</div>`;
    this.playBtn.disabled = true;
    this.timeEl.textContent = "";
    this.updateMixButton();
  }

  // ——— Neue Spur (+ Spur) ———

  /** „+ Spur“ nur mit Spuren-Modell, bei einem fertigen Song mit mindestens einer Spur; die Auswahl zeigt fehlende Spuren. */
  private renderAddBar(): void {
    const { t } = this.deps;
    const song = this.song;
    const hasTracks = this.channels.some((c) => c.track && !c.draft);
    this.addBar.hidden = !song || song.status !== "done" || !hasTracks;
    this.addButton.disabled = !this.deps.stemsAvailable();
    this.addButton.title = this.deps.stemsAvailable() ? t("add_track_tip") : stemsMissingText(t);
    if (this.addPick.hidden) return;
    const present = new Set(this.channels.map((c) => c.key));
    // Gesang nur mit gesungenen Lyrics: lego singt den Text des Songs
    const lyrics = !!song && !!generatedLyrics(song);
    this.addPick.innerHTML = STEM_TRACKS.filter((track) => !present.has(track)).map((track) => {
      const blocked = (track === "vocals" || track === "backing_vocals") && !lyrics;
      return `<button type="button" class="chip" data-track="${track}" ${blocked ? `disabled title="${esc(t("add_vocals_no_lyrics"))}"` : ""}>${esc(t(`track_${track}`))}</button>`;
    }).join("") || `<span class="small">${esc(t("add_none_left"))}</span>`;
  }

  private toggleAddPick(): void {
    this.addPick.hidden = !this.addPick.hidden;
    this.addButton.setAttribute("aria-expanded", String(!this.addPick.hidden));
    this.renderAddBar();
    if (!this.addPick.hidden) this.addPick.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }

  /** Spur gewählt: Entwurfskanal mit offenem ✦-Feld; erst „Erzeugen“ legt die Spur auf dem Server an. */
  private startAdd(track: StemTrack): void {
    this.addPick.hidden = true;
    this.addButton.setAttribute("aria-expanded", "false");
    this.closeEditor();
    const ch = this.createChannel({ key: track, track, label: `track_${track}`, muted: false });
    ch.draft = ch.added = true;
    this.renderChannel(ch);
    this.openEditor(ch);
    ch.row.scrollIntoView({ block: "nearest" });
  }

  private destroy(): void {
    clearTimeout(this.pollTimer);
    this.channels.forEach((ch) => ch.takes.forEach((x) => { x.wave?.destroy(); x.wave = null; }));
    this.channels = [];
    this.editor = null;
    this.progress = null;
    this.loaded = false;
    this.song = null;
    this.tracksEl.innerHTML = "";
    this.addBar.hidden = true;
    this.addPick.hidden = true;
  }
}

/** Spuren mit Kanal: eine fertige Version oder eine neue (auch wartend oder fehlgeschlagen), nach Position und Version */
function channelTracks(stems: readonly Stem[]): StemTrack[] {
  const shown = stems.filter((s) => s.status === "done" || s.kind === "version")
    .sort((a, b) => a.position - b.position || a.version - b.version);
  return [...new Set(shown.map((s) => s.track))];
}
