// Prüft und normalisiert JSON-Eingaben, bevor sie an die Services gehen.
import { SEPARATORS, VARIATION_AXES, type DemucsModel, type ExtractRequest, type NewVersionRequest, type PresetValues, type SongPatch, type StemTrack } from "../../../shared/api.ts";
import { AXIS_MAX, MAX_VERSION_COUNT, MAX_VERSION_TEXT } from "../../../shared/track-variation.ts";
import { isStemTrack, orderTracks } from "../domain/stem.ts";
import type { GenerateCommand } from "../services/generation-service.ts";
import { HttpError } from "./request.ts";

type Input = Record<string, unknown>;

/** Größter Seed einer Spur-Version: der Server nutzt die unteren 32 Bit */
const MAX_SEED = 2 ** 32 - 1;

function invalid(field: string, expected: string): never {
  throw new HttpError(422, `${field}: ${expected}`);
}

function str(input: Input, field: string, fallback = ""): string {
  const v = input[field];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "string") invalid(field, "string expected");
  return v;
}

function optionalId(input: Input, field: string): string | null {
  const v = input[field];
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") invalid(field, "string expected");
  return v;
}

function num(input: Input, field: string, fallback: number, opts: { integer?: boolean; min?: number; max?: number } = {}): number {
  const v = input[field];
  if (v === undefined || v === null) return fallback;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) invalid(field, "number expected");
  if (opts.integer && !Number.isInteger(n)) invalid(field, "integer expected");
  if (opts.min !== undefined && n < opts.min) invalid(field, `must be >= ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) invalid(field, `must be <= ${opts.max}`);
  return n;
}

function bool(input: Input, field: string, fallback: boolean): boolean {
  const v = input[field];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "boolean") invalid(field, "boolean expected");
  return v;
}

export function parseGenerateCommand(input: Input): GenerateCommand {
  return {
    prompt: str(input, "prompt"),
    style: str(input, "style"),
    caption: str(input, "caption"),
    lyrics: str(input, "lyrics"),
    instrumental: bool(input, "instrumental", true),
    keepCaption: bool(input, "keep_caption", true),
    title: str(input, "title"),
    duration: num(input, "duration", 0),
    bpm: num(input, "bpm", 0, { integer: true }),
    keyscale: str(input, "keyscale"),
    timesignature: String(input.timesignature ?? ""),
    vocalLanguage: str(input, "vocal_language"),
    seed: num(input, "seed", -1, { integer: true }),
    variants: num(input, "variants", 1, { integer: true, min: 1, max: 50 }),
    inferenceSteps: num(input, "inference_steps", 0, { integer: true }),
    lmTemperature: input.lm_temperature === undefined || input.lm_temperature === null ? null : num(input, "lm_temperature", 0),
    groupId: optionalId(input, "group_id"),
    folderId: optionalId(input, "folder_id"),
    ...tracksMode(input),
  };
}

/** mode "tracks" mit mindestens einer bekannten Spur; sonst ganzer Song. */
function tracksMode(input: Input): { mode: "full" | "tracks"; tracks: StemTrack[] } {
  const mode = str(input, "mode", "full");
  if (mode !== "full" && mode !== "tracks") invalid("mode", '"full" or "tracks" expected');
  if (mode === "full") return { mode, tracks: [] };
  const tracks = input.tracks;
  if (!Array.isArray(tracks) || !tracks.length || !tracks.every(isStemTrack)) invalid("tracks", "non-empty list of track names expected");
  return { mode, tracks: orderTracks(tracks) };
}

export function parseSongPatch(input: Input): SongPatch {
  const patch: SongPatch = {};
  if (input.favorite !== undefined && input.favorite !== null) patch.favorite = bool(input, "favorite", false);
  if (input.hidden !== undefined && input.hidden !== null) patch.hidden = bool(input, "hidden", false);
  if (input.title !== undefined && input.title !== null) patch.title = str(input, "title");
  if ("folder_id" in input) patch.folder_id = optionalId(input, "folder_id");   // null = unsortiert
  return patch;
}

export function parsePresetValues(input: Input): PresetValues {
  const vocals = str(input, "vocals", "instrumental");
  if (vocals !== "instrumental" && vocals !== "song") invalid("vocals", '"instrumental" or "song" expected');
  return {
    style: str(input, "style"),
    vocals,
    vocal_language: str(input, "vocal_language"),
    duration: num(input, "duration", 90, { min: 0, max: 600 }),
    bpm: num(input, "bpm", 0, { min: 0, max: 300 }),
    keyscale: str(input, "keyscale"),
    timesignature: String(input.timesignature ?? ""),
    inference_steps: num(input, "inference_steps", 50, { integer: true, min: 1, max: 200 }),
    lm_temperature: num(input, "lm_temperature", 0.85, { min: 0, max: 2 }),
    variants: num(input, "variants", 2, { integer: true, min: 1, max: 50 }),
    theme: str(input, "theme", "all"),
  };
}

export function parseFolderName(input: Input): string {
  if (typeof input.name !== "string") invalid("name", "string expected");
  return input.name;
}

/** Stem Separation: { separator: "demucs_ft" | "demucs_6s" } oder ACE-Step mit { tracks } (separator "ace" oder fehlt). */
export function parseExtractRequest(input: Input): ExtractRequest {
  const separator = input.separator ?? "ace";
  if (!(SEPARATORS as readonly unknown[]).includes(separator)) invalid("separator", `one of ${SEPARATORS.join(", ")} expected`);
  if (separator !== "ace") return { separator: separator as DemucsModel };
  const tracks = input.tracks;
  if (!Array.isArray(tracks) || !tracks.length || !tracks.every(isStemTrack)) invalid("tracks", "non-empty list of track names expected");
  return { separator: "ace", tracks: orderTracks(tracks) };
}

/** Neue Version einer Spur: Regler −2…+2, Knopf-IDs (unbekannte fallen später weg), Freitext, Anzahl 1–3. */
export function parseNewVersion(input: Input): NewVersionRequest {
  const rawAxes = input.axes;
  if (rawAxes !== undefined && (typeof rawAxes !== "object" || rawAxes === null || Array.isArray(rawAxes))) invalid("axes", "object expected");
  const axes: NewVersionRequest["axes"] = {};
  for (const axis of VARIATION_AXES) {
    const v = num((rawAxes ?? {}) as Input, axis, 0, { integer: true, min: -AXIS_MAX, max: AXIS_MAX });
    if (v) axes[axis] = v;
  }
  const chips = input.chips ?? [];
  if (!Array.isArray(chips) || !chips.every((c) => typeof c === "string")) invalid("chips", "list of strings expected");
  const text = str(input, "text").trim();
  if (text.length > MAX_VERSION_TEXT) invalid("text", `at most ${MAX_VERSION_TEXT} characters`);
  const seed = num(input, "seed", -1, { integer: true, min: -1, max: MAX_SEED });
  return {
    axes, chips: [...new Set(chips as string[])], text, count: num(input, "count", 1, { integer: true, min: 1, max: MAX_VERSION_COUNT }),
    ...(seed >= 0 ? { seed } : {}),
  };
}

/** `gains=<id>:<0…1>,…` des Mixers (Spur-IDs und "source"); fehlende Kanäle sind stumm. */
export function parseMixGains(value: string | null): Map<string, number> {
  const gains = new Map<string, number>();
  for (const pair of (value ?? "").split(",").filter(Boolean)) {
    const m = /^([\w-]+):(\d+(?:\.\d+)?)$/.exec(pair.trim());
    if (!m || Number(m[2]) > 1) invalid("gains", "list of <id>:<0…1> expected");
    gains.set(m[1]!, Number(m[2]));
  }
  return gains;
}

export function parseStemUploadCommand(input: Input): import("../services/generation-service.ts").StemUploadCommand {
  const intent = str(input, "intent");
  if (intent !== "replace" && intent !== "accompany") invalid("intent", '"replace" or "accompany" expected');
  const tracks = input.tracks;
  if (!Array.isArray(tracks) || !tracks.length || !tracks.every(isStemTrack)) invalid("tracks", "non-empty list of track names expected");
  const keepersRaw = input.keepers;
  const keepers = Array.isArray(keepersRaw) && keepersRaw.every(isStemTrack) ? orderTracks(keepersRaw) : [];
  if (intent === "replace" && !keepers.length) invalid("keepers", "non-empty list of track names expected");
  return {
    intent, tracks: orderTracks(tracks), keepers,
    title: str(input, "title"), caption: str(input, "caption"), lyrics: str(input, "lyrics"),
    duration: num(input, "duration", 0), bpm: num(input, "bpm", 0, { integer: true }),
    keyscale: str(input, "keyscale"), timesignature: String(input.timesignature ?? ""),
    vocalLanguage: str(input, "vocal_language"), seed: num(input, "seed", -1, { integer: true }),
    folderId: optionalId(input, "folder_id"),
  };
}
