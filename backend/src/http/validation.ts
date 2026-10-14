// Prüft und normalisiert JSON-Eingaben, bevor sie an die Services gehen.
import type { SongPatch } from "../../../shared/api.ts";
import type { GenerateCommand } from "../services/generation-service.ts";
import { HttpError } from "./request.ts";

type Input = Record<string, unknown>;

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
  };
}

export function parseSongPatch(input: Input): SongPatch {
  const patch: SongPatch = {};
  if (input.favorite !== undefined && input.favorite !== null) patch.favorite = bool(input, "favorite", false);
  if (input.title !== undefined && input.title !== null) patch.title = str(input, "title");
  if ("folder_id" in input) patch.folder_id = optionalId(input, "folder_id");   // null = unsortiert
  return patch;
}

export function parseFolderName(input: Input): string {
  if (typeof input.name !== "string") invalid("name", "string expected");
  return input.name;
}
