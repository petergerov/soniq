// Dateiformate der erzeugten Songs und wie ace-server sie erwartet (output_format + mp3_bitrate).
import type { OutputFormat } from "../../../shared/api.ts";

export interface AceOutputFormat {
  output_format: "wav16" | "wav24" | "wav32" | "mp3";
  mp3_bitrate?: number;
}

export const OUTPUT_FORMATS: Record<OutputFormat, AceOutputFormat> = {
  "wav16": { output_format: "wav16" },     // 48 kHz / 16 Bit, verlustfrei (Vorgabe)
  "wav24": { output_format: "wav24" },
  "wav32": { output_format: "wav32" },     // 32 Bit Gleitkomma
  "mp3-320": { output_format: "mp3", mp3_bitrate: 320 },
  "mp3-192": { output_format: "mp3", mp3_bitrate: 192 },
  "mp3-128": { output_format: "mp3", mp3_bitrate: 128 },
};

export const DEFAULT_OUTPUT_FORMAT: OutputFormat = "wav16";

export function isOutputFormat(value: unknown): value is OutputFormat {
  return typeof value === "string" && Object.hasOwn(OUTPUT_FORMATS, value);
}
