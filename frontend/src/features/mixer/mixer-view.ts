// Mixer: alle fertigen Spuren eines Songs mit Waveform, Lautstärke, Mute und Solo, dazu die hochgeladene Vorlage
// (Ersetzen/Begleiten). Wiedergabe synchron über mehrere WaveSurfer-Instanzen; Solo dämpft alle anderen.
// Herunterladen: jede Spur einzeln, alle als ZIP, und der Mix so, wie er gerade klingt.
//
// Versionen: Jede Spur ist ein Kanal mit einer oder mehreren Versionen ("Takes"), die alle mitlaufen; zu hören ist
// nur die aktive. Mit mehreren Versionen lässt sich der Kanal aufklappen, um sie zu sehen und umzuschalten (sofort,
// auch während der Wiedergabe). ✦ öffnet das Feld für eine neue Version (Knöpfe, Regler, Freitext); die alte bleibt.
import WaveSurfer from "wavesurfer.js";
import { activeTakes, OTHER_TRACK, SOURCE_CHANNEL, VARIATION_AXES, type Song, type Stem, type StemRecipe, type StemStatus, type StemTrack, type VariationAxis } from "../../../../shared/api.ts";
import { AXIS_MAX, chipsFor, MAX_VERSION_COUNT, MAX_VERSION_TEXT, variationTags, type VariationChip } from "../../../../shared/track-variation.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { confirmDialog, errorDialog } from "../../core/dialogs.ts";
import { byId, closest, escapeHtml as esc, saveBlob } from "../../core/dom.ts";
import { formatDuration } from "../../core/format.ts";
import { stemsMissingText } from "../../core/stems-hint.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { displayTitle } from "../library/song-row.ts";

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
  /** Haupt-Player pausieren, solange der Mixer läuft */
  pauseMainPlayer: () => void;
  /** Haupt-Player anhalten; lief dort gerade dieser Song, seine Stelle (der Mixer spielt dort weiter) */
  handOffMainPlayer: (songId: string) => number | null;
  /** Der Mixer spielte beim Verlassen: der Haupt-Player spielt den Song an dieser Stelle weiter */
  resumeMainPlayer: (songId: string, time: number) => void;
  /** Spuren-Modell vorhanden (sonst keine neuen Versionen) */
  stemsAvailable: () => boolean;
}

/** Eine Version eines Kanals: Spur-ID (oder SOURCE_CHANNEL für die Vorlage) und ihre Waveform, sobald fertig */
interface Take {
  id: string;
  version: number;
  status: StemStatus;
  message: string | null;
  url: string | null;
  recipe: StemRecipe | null;
  ws: WaveSurfer | null;
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
  private channels: Channel[] = [];
  private songId: string | null = null;
  private syncing = false;
  private playing = false;
  /** Alle beim Öffnen vorhandenen Waveforms sind geladen; später fertige Versionen steigen synchron ein */
  private loaded = false;
  /** Mix wird gerade auf dem Server gemischt und geladen */
  private mixing = false;
  private editor: Editor | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  /** Fortschritt der laufenden Version (Song-Meldung) */
  private progress: string | null = null;
  /** Stelle, an der der Haupt-Player den Song beim Öffnen spielte: dort geht es weiter, sobald alles geladen ist */
  private resumeAt: number | null = null;

  constructor(deps: MixerViewDeps) {
    this.deps = deps;
    byId("mixerBack").addEventListener("click", () => deps.back());
    this.playBtn.addEventListener("click", () => void this.togglePlay());
    this.mixButton.addEventListener("click", () => void this.downloadMix());
    this.scrub.addEventListener("input", () => {
      const master = this.master();
      if (!master) return;
      const t = (Number(this.scrub.value) / 1000) * (master.getDuration() || 0);
      this.seekAll(t);
    });
    this.tracksEl.addEventListener("click", (e) => this.onTrackClick(e));
    this.tracksEl.addEventListener("input", (e) => this.onTrackInput(e));
    document.addEventListener("pointerdown", (e) => {
      if (!this.channels.length) return;
      if (closest(e.target, ".mixer-vol.is-open")) return;
      this.closeVolPopovers();
    });
  }

  /** Mixer öffnen bzw. Song wechseln. */
  async open(songId: string): Promise<void> {
    if (this.songId === songId && this.channels.length) return;
    const resumeAt = this.deps.handOffMainPlayer(songId);
    this.destroy();
    this.resumeAt = resumeAt;
    this.songId = songId;
    this.root.classList.add("loading");
    this.playBtn.disabled = true;
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

    let stems: Stem[];
    try { stems = await this.deps.api.stems(songId); }
    catch { this.showEmpty(this.deps.t("mixer_missing")); return; }
    if (this.songId !== songId) return;

    // Ein Kanal je Spur mit mindestens einer fertigen Version, in der Reihenfolge der Spuren
    const tracks = activeTakes(stems).map((s) => s.track);
    if (!tracks.length && !song.source_url) {
      this.showEmpty(this.deps.t("mixer_no_stems"));
      return;
    }

    this.tracksEl.innerHTML = "";
    this.channels = tracks.map((track) => this.createChannel({ key: track, track, label: `track_${track}`, muted: false }));
    this.syncStems(stems);
    // Vorlage zuletzt: beim Ersetzen stumm (darin stecken die ersetzten Instrumente, zum Vergleichen per Solo),
    // beim Begleiten hörbar (die Aufnahme gehört zum Song, die Spuren begleiten sie nur)
    if (song.source_url) {
      const ch = this.createChannel({ key: SOURCE_CHANNEL, track: null, label: "source_track", muted: song.params.mode !== "accompany" });
      this.channels.push(ch);
      this.addTake(ch, { id: SOURCE_CHANNEL, version: 1, status: "done", message: null, url: song.source_url, recipe: null });
      ch.activeId = SOURCE_CHANNEL;
      this.renderChannel(ch);
    }
    this.zipLink.href = `/api/songs/${songId}/stems.zip`;
    this.zipLink.hidden = false;
    this.applyGains();
    this.root.classList.remove("loading");
    this.schedulePoll();
  }

  /** Mixer verlassen: Player und Speicher freigeben. */
  close(): void {
    const songId = this.songId;
    const time = this.playing ? this.master()?.getCurrentTime() : undefined;
    this.destroy();
    this.songId = null;
    if (songId && time !== undefined) this.deps.resumeMainPlayer(songId, time);
  }

  refreshTexts(): void {
    if (!this.songId) return;
    this.channels.forEach((ch) => {
      ch.row.querySelector(".mixer-name")!.textContent = this.deps.t(ch.label);
      this.renderChannel(ch);
    });
    if (this.editor) this.renderEditor();
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
    this.tracksEl.appendChild(row);
    return { key: o.key, track: o.track, label: o.label, row, takes: [], activeId: "", volume: 1, muted: o.muted, solo: false };
  }

  /** Versionen der Kanäle an den Stand des Servers angleichen: neue Spalten, fertige Waveforms, Gelöschtes weg. */
  private syncStems(stems: Stem[]): void {
    const active = new Map(activeTakes(stems).map((s) => [s.track, s.id]));
    for (const ch of this.channels) {
      if (!ch.track) continue;
      // Fertige Versionen; wartende und fehlgeschlagene nur bei neuen Versionen (fehlerhaftes Herauslösen nicht)
      const mine = stems.filter((s) => s.track === ch.track && (s.status === "done" || s.kind === "version"));
      for (const take of [...ch.takes]) {
        if (!mine.some((s) => s.id === take.id)) this.removeTake(ch, take);
      }
      for (const stem of mine) {
        const take = ch.takes.find((x) => x.id === stem.id);
        if (!take) this.addTake(ch, stem);
        else {
          const finished = take.status !== "done" && stem.status === "done";
          Object.assign(take, { status: stem.status, message: stem.message, url: stem.url, recipe: stem.recipe });
          if (finished) this.loadWave(take);
        }
      }
      ch.takes.sort((a, b) => a.version - b.version);
      const lanes = ch.row.querySelector(".mixer-lanes")!;
      if (ch.takes.some((take, i) => lanes.children[i] !== take.lane)) ch.takes.forEach((take) => lanes.appendChild(take.lane));
      ch.activeId = active.get(ch.track) ?? ch.takes.find((x) => x.status === "done")?.id ?? "";
      this.renderChannel(ch);
    }
    this.applyGains();
  }

  private addTake(ch: Channel, s: Pick<Take, "id" | "version" | "status" | "message" | "url" | "recipe">): void {
    const lane = document.createElement("div");
    lane.className = "mixer-lane";
    lane.dataset.take = s.id;
    lane.innerHTML = `<div class="mixer-lane-head"></div><div class="mixer-wave"></div>`;
    ch.row.querySelector(".mixer-lanes")!.appendChild(lane);
    const take: Take = { ...s, ws: null, lane };
    ch.takes.push(take);
    if (take.status === "done") this.loadWave(take);
  }

  private removeTake(ch: Channel, take: Take): void {
    take.ws?.destroy();
    take.lane.remove();
    ch.takes = ch.takes.filter((x) => x !== take);
  }

  private loadWave(take: Take): void {
    if (take.ws || !take.url) return;
    const css = getComputedStyle(document.documentElement);
    const container = take.lane.querySelector<HTMLElement>(".mixer-wave")!;
    container.classList.remove("is-pending");
    const ws = WaveSurfer.create({
      container, height: 48, barWidth: 2, barGap: 1, barRadius: 2, cursorWidth: 1,
      waveColor: css.getPropertyValue("--wave").trim() || "#2b2b36",
      progressColor: css.getPropertyValue("--wave-progress").trim() || "#a78bfa",
      interact: true, url: take.url,
    });
    take.ws = ws;
    const lateJoiner = this.loaded;
    ws.on("ready", () => {
      if (lateJoiner) {
        // Später fertig gewordene Version: an der aktuellen Stelle einsteigen
        this.applyGains();
        const master = this.master();
        if (master && master !== ws) {
          ws.setTime(master.getCurrentTime());
          if (this.playing) void ws.play();
        }
        return;
      }
      if (this.allWaves().every((w) => w.getDuration() > 0)) this.onAllReady();
    });
    ws.on("timeupdate", () => {
      if (this.master() === ws) this.updateTransport();
    });
    ws.on("seeking", (time) => {
      if (this.syncing) return;
      this.seekAll(time);
    });
    ws.on("finish", () => {
      if (this.master() === ws) this.setPlaying(false);
    });
    ws.on("play", () => {
      if (this.master() === ws) this.setPlaying(true);
    });
    ws.on("pause", () => {
      if (this.master() === ws && !this.syncing) this.setPlaying(false);
    });
  }

  /** Kopf (Name, Anzahl, Download) und die Zeilen der Versionen neu beschriften. */
  private renderChannel(ch: Channel): void {
    const { t } = this.deps;
    const many = ch.takes.length > 1;
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
    // Die hörbare Version und laufende lassen sich nicht löschen (erst umschalten bzw. abbrechen)
    const deletable = ch.track && !on && take.status !== "queued" && take.status !== "running" && ch.takes.length > 1;
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

  private allWaves(): WaveSurfer[] {
    return this.channels.flatMap((ch) => ch.takes.map((x) => x.ws).filter((ws): ws is WaveSurfer => !!ws));
  }

  /** Taktgeber für Transport und Zeit: die erste Waveform (Version 1 der ersten Spur bleibt es auch mit neuen Versionen) */
  private master(): WaveSurfer | undefined {
    return this.allWaves()[0];
  }

  private onAllReady(): void {
    this.loaded = true;
    this.playBtn.disabled = false;
    this.applyGains();
    this.updateTransport();
    const resumeAt = this.resumeAt;
    this.resumeAt = null;
    if (resumeAt === null) return;
    this.seekAll(Math.min(resumeAt, Math.max(0, (this.master()?.getDuration() ?? 0) - 0.1)));
    // Ohne Nutzergeste kann der Browser das Abspielen verweigern: dann steht der Mixer an der Stelle bereit
    this.togglePlay().catch(() => this.pauseAll());
  }

  private async togglePlay(): Promise<void> {
    const master = this.master();
    if (!master) return;
    this.deps.pauseMainPlayer();
    if (master.isPlaying()) {
      this.pauseAll();
      return;
    }
    // Alle Spuren auf denselben Zeitpunkt bringen, dann starten
    const t = master.getCurrentTime();
    this.syncing = true;
    try {
      await Promise.all(this.allWaves().map(async (ws) => {
        ws.setTime(t);
        await ws.play();
      }));
    } finally {
      this.syncing = false;
    }
    this.setPlaying(true);
  }

  private pauseAll(): void {
    this.syncing = true;
    this.allWaves().forEach((ws) => { if (ws.isPlaying()) ws.pause(); });
    this.syncing = false;
    this.setPlaying(false);
  }

  private seekAll(time: number): void {
    this.syncing = true;
    this.allWaves().forEach((ws) => ws.setTime(time));
    this.syncing = false;
    this.updateTransport();
  }

  private setPlaying(playing: boolean): void {
    this.playing = playing;
    this.playBtn.textContent = playing ? "❚❚" : "▶";
    this.playBtn.setAttribute("aria-label", this.deps.t(playing ? "pause" : "play"));
  }

  private updateTransport(): void {
    const master = this.master();
    if (!master) return;
    const cur = master.getCurrentTime();
    const dur = master.getDuration() || 0;
    this.timeEl.textContent = `${formatDuration(cur)} / ${formatDuration(dur)}`;
    if (document.activeElement !== this.scrub) {
      this.scrub.value = String(dur > 0 ? Math.round((cur / dur) * 1000) : 0);
    }
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
        if (take) void this.deleteTake(take);
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

  private async deleteTake(take: Take): Promise<void> {
    const { t } = this.deps;
    const ok = await confirmDialog({
      title: t("ver_del_q", take.version), message: t("ver_del_msg"), confirmLabel: t("del"), cancelLabel: t("cancel"), danger: true,
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
      ch.takes.forEach((x) => x.ws?.setVolume(gains.get(x.id) ?? 0));
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
      <div class="mixer-ver-head"><strong>${esc(t("ver_title", t(ch.label)))}</strong><span class="small">${esc(t("ver_keep"))}</span></div>
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
    const duration = this.master()?.getDuration() ?? 0;
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
    if (!ed || !base) return;
    btn.disabled = true;
    try {
      const axes = Object.fromEntries(VARIATION_AXES.filter((a) => ed.axes[a]).map((a) => [a, ed.axes[a]]));
      const seed = ed.seed.trim() === "" ? undefined : Number(ed.seed);
      const stems = await this.deps.api.createVersions(base.id, { axes, chips: [...ed.chips], text: ed.text.trim(), count: ed.count, seed });
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

  private destroy(): void {
    clearTimeout(this.pollTimer);
    if (this.channels.length) this.pauseAll();
    this.channels.forEach((ch) => ch.takes.forEach((x) => x.ws?.destroy()));
    this.channels = [];
    this.editor = null;
    this.progress = null;
    this.loaded = false;
    this.resumeAt = null;
    this.tracksEl.innerHTML = "";
  }
}
