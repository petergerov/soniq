// HTML einer Songzeile. Reine Darstellung: kennt weder API noch Ereignisse.
import { STEM_TRACKS, type Song, type Stem, type StemTrack } from "../../../../shared/api.ts";
import { escapeHtml as esc } from "../../core/dom.ts";
import { formatDuration, generationTime } from "../../core/format.ts";
import type { Translate } from "../../i18n/i18n.ts";

export interface SongRowContext {
  t: Translate;
  isCurrent: boolean;
  isPlaying: boolean;
  wasPlayed: boolean;
  lyricsOpen: boolean;
  editing: boolean;
  hasFolders: boolean;
  /** Erster Song einer neuen Prompt-Gruppe (Trennlinie) */
  startsGroup: boolean;
  /** Kreuzen: "from" = dieser Song ist A, "pick" = ein anderer Song ist A, dieser kann B werden */
  crossing: "from" | "pick" | null;
  /** Geschätzte Sekunden, bis der Song fertig ist (laufend/wartend), sonst undefined */
  eta: number | undefined;
  /** Spurenliste aufgeklappt; stems = geladene Spuren (undefined = lädt noch) */
  stemsOpen: boolean;
  stems: Stem[] | undefined;
  /** Spur, die gerade im Player ist, und ob sie läuft */
  currentStemId: string | null;
  stemPlaying: boolean;
  /** Spuren-Modell da? Sonst ist Herauslösen gesperrt */
  stemsAvailable: boolean;
  /** Gewählte Spuren im Extract-Picker */
  extractTracks: readonly StemTrack[];
}

const ICON_FOLDER = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
const ICON_CROSS = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>`;
const ICON_THUMB_DOWN = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V3"/><path d="M9 18.5L10 14H4.7a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 5.9 3H17v11l-4 7a2.4 2.4 0 0 1-4-2.5z"/></svg>`;
const ICON_STEMS = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h13"/></svg>`;
const ICON_REUSE = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 3l7 7h-4v10h-6V10H5l7-7z"/></svg>`;

export function shortCaption(song: Song): string {
  return song.caption.split(",").slice(0, 3).join(",");
}

export function displayTitle(song: Song): string {
  return (song.title || shortCaption(song)) + (song.letter ? ` ${song.letter}` : "");
}

/** Kurze, übersetzte Fehlerursache (der Server liefert deutsche Rohtexte). */
export function shortError(message: string | null, t: Translate): string {
  const msg = message ?? "";
  if (/nicht erreichbar/i.test(msg)) return t("err_offline");
  if (/Codes/i.test(msg)) return t("err_codes");
  if (/Zeitüberschreitung/i.test(msg)) return t("err_timeout");
  return t("err_details");
}

/** Vom Modell geschriebener Text (nur bei Songs mit Gesang), sonst "". */
export function generatedLyrics(song: Song): string {
  const lyrics = song.result_meta?.lyrics || "";
  const hasText = /[^\s[\]]/.test(lyrics.replace(/\[[^\]]*\]/g, ""));
  return song.status === "done" && song.lyrics !== "[Instrumental]" && hasText ? lyrics.trim() : "";
}

function metaLine(song: Song): string {
  const m = song.result_meta ?? {}, p = song.params;
  return [
    m.bpm && `${m.bpm}BPM`,
    p.inference_steps ? `${p.inference_steps}IT` : null,
    p.lm_temperature != null ? `${Number(p.lm_temperature).toFixed(1)}VAR` : null,
    m.keyscale,
    m.duration && formatDuration(m.duration),
  ].filter(Boolean).join(" · ");
}

function leftSlot(song: Song, ctx: SongRowContext): string {
  switch (song.status) {
    case "done": return `<button class="aktion round" data-a="play" aria-label="${ctx.t("play")}">${ctx.isPlaying ? "❚❚" : "▶"}</button>`;
    case "error": return `<div class="slot err" title="${esc(song.message)}">!</div>`;
    case "running": return `<div class="slot run">♪</div>`;
    case "cancelled": return `<div class="slot">✕</div>`;
    default: return `<div class="slot">…</div>`;
  }
}

/** " · noch ~2:10" bzw. " · fertig in ~6:40" (nur mit Schätzung) */
function eta(ctx: SongRowContext, key: "eta_left" | "eta_done"): string {
  if (ctx.eta === undefined) return "";
  return ` · <span class="eta">${ctx.eta < 5 ? ctx.t("eta_soon") : ctx.t(key, formatDuration(ctx.eta))}</span>`;
}

function stateLine(song: Song, ctx: SongRowContext): string {
  const { t } = ctx;
  switch (song.status) {
    case "running": return `<div class="s run">${esc(song.message || "0:00")}${eta(ctx, "eta_left")}</div><div class="mini-bar"></div>`;
    case "queued": return `<div class="s">${t("waiting")}${eta(ctx, "eta_done")}</div>`;
    case "cancelled": return `<div class="s">${t("cancelled")}</div>`;
    case "error": return `<div class="s err" title="${esc(song.message)}">${t("error")} · ${esc(shortError(song.message, t))}</div>`;
    case "done": {
      if (song.stems_pending > 0 && song.message) {
        return `<div class="s run">${esc(song.message)}${eta(ctx, "eta_left")}</div><div class="mini-bar"></div>`;
      }
      const took = ctx.wasPlayed ? null : generationTime(song.created_at, song.finished_at);
      return took ? `<div class="s took">${t("created_in")} ${took}</div>` : "";
    }
  }
}

function actionButtons(song: Song, lyrics: string, ctx: SongRowContext): string {
  const { t } = ctx;
  const done = song.status === "done";
  const active = song.status === "queued" || song.status === "running";
  return [
    done && `<button class="sek icon ${song.favorite ? "on" : ""}" data-a="fav" title="${t("fav")}">${song.favorite ? "★" : "☆"}</button>`,
    done && `<button class="sek icon hide ${song.hidden ? "on" : ""}" data-a="hide" title="${t(song.hidden ? "unhide" : "hide")}">${ICON_THUMB_DOWN}</button>`,
    done && `<a class="download icon fmt" href="${song.url}?download=1" title="${t("download")}">${song.file?.endsWith(".wav") ? "WAV" : "MP3"}</a>`,
    lyrics && `<button class="sek icon txt ${ctx.lyricsOpen ? "on" : ""}" data-a="lyrics" title="${t("show_lyrics")}">TXT</button>`,
    hasStems(song) && `<button class="sek icon ${ctx.stemsOpen ? "on" : ""}" data-a="stems" title="${t("stems_tip")}">${ICON_STEMS}</button>`,
    ctx.hasFolders && `<button class="sek icon" data-a="move" title="${t("move")}">${ICON_FOLDER}</button>`,
    `<button class="sek icon" data-a="more" title="${t("more")}">＋</button>`,
    `<button class="sek icon cross ${ctx.crossing === "from" ? "on" : ""}" data-a="cross" title="${t(ctx.crossing === "from" ? "cross_cancel" : ctx.crossing === "pick" ? "cross_pick" : "cross")}">${ICON_CROSS}</button>`,
    `<button class="sek icon" data-a="reuse" title="${t("reuse")}">${ICON_REUSE}</button>`,
    (song.status === "error" || song.status === "cancelled") && `<button class="sek icon" data-a="retry" title="${t("retry")}">↻</button>`,
    `<button class="sek icon del" data-a="del" title="${active ? t("cancel") : t("del")}">✕</button>`,
  ].filter(Boolean).join("");
}

function titleBlock(song: Song, ctx: SongRowContext): string {
  if (ctx.editing) {
    return `<input class="t-edit" data-id="${song.id}" value="${esc(song.title || "")}" placeholder="${esc(shortCaption(song))}">`;
  }
  return `<div class="t" data-a="rename" title="${ctx.t("rename")}">${esc(displayTitle(song))}</div>`;
}

function lyricsBlock(song: Song, lyrics: string, ctx: SongRowContext): string {
  if (!lyrics || !ctx.lyricsOpen) return "";
  const fileName = (displayTitle(song) || song.id).replace(/[\\/:*?"<>|]+/g, "_");
  return `<div class="lyr-wrap"><pre class="lyr">${esc(lyrics)}</pre><a class="download mini lyr-dl" download="${esc(fileName)}.txt" ` +
    `href="data:text/plain;charset=utf-8,${encodeURIComponent(lyrics)}" title="${ctx.t("lyrics_dl")}">TXT ↓</a></div>`;
}

/** Song mit Einzelspuren, oder fertiger Song (Herauslösen anbieten) */
export function hasStems(song: Song): boolean {
  return song.stems > 0 || song.stems_pending > 0 || (song.params.mode === "tracks" && song.status !== "queued") || song.status === "done";
}

function stemRow(stem: Stem, ctx: SongRowContext): string {
  const { t } = ctx;
  const current = stem.id === ctx.currentStemId;
  const state = stem.status === "done" ? "" : stem.status === "running" ? `<span class="s run">${t("stem_running")}</span>`
    : stem.status === "error" ? `<span class="s err" title="${esc(stem.message)}">${t(stem.message === "cancelled" ? "cancelled" : "error")}</span>`
    : `<span class="s">${t("waiting")}</span>`;
  const kind = stem.kind === "generated" ? "" : ` <span class="stem-kind">${t(`stem_kind_${stem.kind}`)}</span>`;
  return `<div class="stem ${current ? "playing" : ""}">
      <button class="sek icon" data-a="stem-play" data-stem="${stem.id}" ${stem.url ? "" : "disabled"} aria-label="${t("play")}">${current && ctx.stemPlaying ? "❚❚" : "▶"}</button>
      <span class="stem-name">${esc(t(`track_${stem.track}`))}${kind}</span>${state}
      ${stem.url ? `<a class="download mini" href="${stem.url}?download=1" title="${t("download")}">WAV ↓</a>` : ""}</div>`;
}

function extractBlock(song: Song, ctx: SongRowContext): string {
  if (song.status !== "done" || !song.file) return "";
  const { t } = ctx;
  const pending = song.stems_pending > 0;
  const chips = STEM_TRACKS.map((track) => {
    const on = ctx.extractTracks.includes(track);
    return `<button type="button" class="chip ${on ? "on" : ""}" data-a="extract-track" data-track="${track}" aria-pressed="${on}" ${pending || !ctx.stemsAvailable ? "disabled" : ""}>${t(`track_${track}`)}</button>`;
  }).join("");
  const action = pending
    ? `<button type="button" class="sek" data-a="extract-cancel">${t("extract_cancel")}</button>`
    : `<button type="button" class="sek" data-a="extract-go" ${!ctx.stemsAvailable || !ctx.extractTracks.length ? "disabled" : ""}>${t("extract_go")}</button>`;
  return `<div class="extract">
      <div class="small">${t(ctx.stemsAvailable ? "extract_honest" : "gen_tracks_missing")}</div>
      <div class="chips track-chips">${chips}</div>
      <div class="extract-bar">${action}<span class="small">${ctx.stemsAvailable ? t("extract_hint", ctx.extractTracks.length) : ""}</span></div>
    </div>`;
}

function stemsBlock(song: Song, ctx: SongRowContext): string {
  if (!ctx.stemsOpen) return "";
  if (!ctx.stems) return `<div class="stems">${extractBlock(song, ctx)}<div class="small">…</div></div>`;
  const ready = ctx.stems.some((s) => s.url);
  const zip = ready
    ? `<a class="download mini stems-zip" href="/api/songs/${song.id}/stems.zip" title="${ctx.t("stems_zip_tip")}">ZIP ↓</a>` : "";
  const mixer = ready
    ? `<button type="button" class="sek mini stems-mixer" data-a="mixer" title="${ctx.t("mixer_open_tip")}">${ctx.t("mixer_open")}</button>` : "";
  return `<div class="stems">${extractBlock(song, ctx)}${ctx.stems.map((s) => stemRow(s, ctx)).join("")}
      <div class="stems-actions">${mixer}${zip}</div></div>`;
}

export function renderSongRow(song: Song, ctx: SongRowContext): string {
  const lyrics = generatedLyrics(song);
  const classes = ["song", ctx.isCurrent && "playing", ctx.startsGroup && "new-group", ctx.crossing === "from" && "cross-from", song.hidden && "is-hidden"].filter(Boolean).join(" ");
  return `<div class="${classes}" data-id="${song.id}" draggable="${ctx.hasFolders && !ctx.editing}">
      ${leftSlot(song, ctx)}
      <div style="min-width:0">${titleBlock(song, ctx)}<div class="m" title="${ctx.t("meta_tip")}">${esc(metaLine(song))}</div>${stateLine(song, ctx)}</div>
      <div class="actions">${actionButtons(song, lyrics, ctx)}</div>${lyricsBlock(song, lyrics, ctx)}${stemsBlock(song, ctx)}</div>`;
}
