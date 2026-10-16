// HTML einer Songzeile. Reine Darstellung: kennt weder API noch Ereignisse.
import { EXTRACT_COUNTS, type ExtractCount, type Song, type SynthCompute } from "../../../../shared/api.ts";
import { escapeHtml as esc } from "../../core/dom.ts";
import { formatDuration, generationTime } from "../../core/format.ts";
import { stemsMissingText } from "../../core/stems-hint.ts";
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
  /** Stem Separation aufgeklappt (Spuren selbst zeigt der Mixer) */
  extractOpen: boolean;
  /** Spuren-Modell da? Sonst ist Herauslösen gesperrt */
  stemsAvailable: boolean;
  /** Gewählte Stem-Anzahl (2 / 4 / 6) */
  extractCount: ExtractCount;
  /** Synth CPU/GPU für Stem Separation */
  synthCompute: SynthCompute;
  /** Überlaufmenü (⋮) dieser Zeile ist offen */
  menuOpen: boolean;
}

const ICON_FOLDER = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
const ICON_CROSS = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>`;
const ICON_THUMB_DOWN = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V3"/><path d="M9 18.5L10 14H4.7a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 5.9 3H17v11l-4 7a2.4 2.4 0 0 1-4-2.5z"/></svg>`;
const ICON_STEMS = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h13"/></svg>`;
const ICON_REUSE = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 3l7 7h-4v10h-6V10H5l7-7z"/></svg>`;
const ICON_DOTS = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>`;
const ICON_MIXER = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 8h10"/><path d="M18 8h2"/><circle cx="16" cy="8" r="2"/><path d="M4 16h2"/><path d="M10 16h10"/><circle cx="8" cy="16" r="2"/></svg>`;

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

function menuItem(action: string, label: string, opts: { icon?: string; on?: boolean; danger?: boolean } = {}): string {
  const cls = ["song-menu-item", opts.on && "on", opts.danger && "danger"].filter(Boolean).join(" ");
  return `<button type="button" class="${cls}" data-a="${action}" role="menuitem">${opts.icon ?? ""}${esc(label)}</button>`;
}

function actionButtons(song: Song, lyrics: string, ctx: SongRowContext): string {
  const { t } = ctx;
  const done = song.status === "done";
  const active = song.status === "queued" || song.status === "running";
  const hasMixer = done && song.stems > 0;
  const crossTip = t(ctx.crossing === "from" ? "cross_cancel" : ctx.crossing === "pick" ? "cross_pick" : "cross");
  // Sichtbar: Favorit, Kreuzen, Einstellungen übernehmen, Mixer — Rest hinter ⋮
  const primary = [
    done && `<button class="sek icon ${song.favorite ? "on" : ""}" data-a="fav" title="${t("fav")}">${song.favorite ? "★" : "☆"}</button>`,
    done && `<button class="sek icon cross ${ctx.crossing === "from" ? "on" : ""}" data-a="cross" title="${esc(crossTip)}">${ICON_CROSS}</button>`,
    `<button class="sek icon" data-a="reuse" title="${t("reuse")}">${ICON_REUSE}</button>`,
    hasMixer && `<button class="sek icon" data-a="mixer" title="${t("mixer_open_tip")}">${ICON_MIXER}</button>`,
  ].filter(Boolean);

  const overflow = [
    done && menuItem("hide", t(song.hidden ? "unhide" : "hide"), { icon: ICON_THUMB_DOWN, on: song.hidden }),
    done && song.url && `<a class="song-menu-item" href="${song.url}?download=1" role="menuitem" data-a="download" download>${esc(t("download"))}</a>`,
    lyrics && menuItem("lyrics", t("show_lyrics"), { on: ctx.lyricsOpen }),
    // Stereo-Mix ohne Spuren: „Stem Separation“. Fertige Spuren hört, lädt und bearbeitet man im Mixer
    canExtract(song) && (song.stems === 0 || song.stems_pending > 0)
      && menuItem("extract", t("stem_separation"), { icon: ICON_STEMS, on: ctx.extractOpen }),
    ctx.hasFolders && menuItem("move", t("move"), { icon: ICON_FOLDER }),
    menuItem("more", t("more")),
    (song.status === "error" || song.status === "cancelled") && menuItem("retry", t("retry")),
    hasMixer && !song.stems_pending && menuItem("stems-del-all", t("stems_del_all"), { danger: true }),
    menuItem("del", active ? t("cancel") : t("del"), { danger: true }),
  ].filter(Boolean).join("");

  return [
    ...primary,
    `<div class="song-menu-wrap${ctx.menuOpen ? " open" : ""}">
      <button type="button" class="sek icon song-menu-btn" data-a="menu" title="${t("song_menu")}" aria-label="${t("song_menu")}" aria-expanded="${ctx.menuOpen}" aria-haspopup="menu">${ICON_DOTS}</button>
      <div class="song-menu" role="menu">${overflow}</div>
    </div>`,
  ].join("");
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

/** Herauslösen nur aus dem Stereo-Mix — nicht bei Spur-für-Spur / Replace / Begleitung */
export function canExtract(song: Song): boolean {
  if (song.status !== "done" || !song.file) return false;
  const mode = song.params.mode;
  return !mode || mode === "full";
}

function extractBlock(song: Song, ctx: SongRowContext): string {
  if (!canExtract(song)) return "";
  const { t } = ctx;
  const pending = song.stems_pending > 0;
  if (song.stems > 0 && !pending) return "";   // fertig: weiter im Mixer
  const chips = EXTRACT_COUNTS.map((n) => {
    const on = ctx.extractCount === n;
    return `<button type="button" class="chip ${on ? "on" : ""}" data-a="extract-count" data-count="${n}" aria-pressed="${on}" ${pending || !ctx.stemsAvailable ? "disabled" : ""}>${t("extract_n", n)}</button>`;
  }).join("");
  const action = pending
    ? `<button type="button" class="sek" data-a="extract-cancel">${t("extract_cancel")}</button>`
    : `<button type="button" class="sek" data-a="extract-go" ${!ctx.stemsAvailable ? "disabled" : ""}>${t("extract_go")}</button>`;
  const compute = computeBadge(ctx.synthCompute, t);
  return `<div class="extract">
      <div class="extract-head"><div class="small">${(ctx.stemsAvailable ? t("extract_honest") : stemsMissingText(t))}</div>${compute}</div>
      <div class="chips track-chips">${chips}</div>
      <div class="extract-bar">${action}<span class="small">${ctx.stemsAvailable ? t("extract_hint", ctx.extractCount) : ""}</span></div>
    </div>`;
}

function computeBadge(c: SynthCompute, t: Translate): string {
  if (c.mode === "unknown") return "";
  const label = c.mode === "gpu" ? t("extract_gpu", c.kind || c.device) : t("extract_cpu");
  return `<span class="extract-device ${c.mode}" title="${esc(c.device || label)}">${esc(label)}</span>`;
}

function extractPanel(song: Song, ctx: SongRowContext): string {
  const block = ctx.extractOpen ? extractBlock(song, ctx) : "";
  return block ? `<div class="stems">${block}</div>` : "";
}

export function renderSongRow(song: Song, ctx: SongRowContext): string {
  const lyrics = generatedLyrics(song);
  const classes = ["song", ctx.isCurrent && "playing", ctx.startsGroup && "new-group", ctx.crossing === "from" && "cross-from", song.hidden && "is-hidden", ctx.menuOpen && "menu-open"].filter(Boolean).join(" ");
  return `<div class="${classes}" data-id="${song.id}" draggable="${ctx.hasFolders && !ctx.editing}">
      ${leftSlot(song, ctx)}
      <div style="min-width:0">${titleBlock(song, ctx)}<div class="m" title="${ctx.t("meta_tip")}">${esc(metaLine(song))}</div>${stateLine(song, ctx)}</div>
      <div class="actions">${actionButtons(song, lyrics, ctx)}</div>${lyricsBlock(song, lyrics, ctx)}${extractPanel(song, ctx)}</div>`;
}
