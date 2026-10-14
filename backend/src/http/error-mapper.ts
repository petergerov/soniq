// Übersetzt Fehler in HTTP-Status + Meldung (Body: {"detail": "..."}).
import type { ErrorKind } from "../domain/errors.ts";
import { AppError } from "../domain/errors.ts";
import type { Translate } from "../i18n/translator.ts";
import { HttpError } from "./request.ts";

const STATUS: Record<ErrorKind, number> = {
  invalid: 422,
  bad_request: 400,
  not_found: 404,
  conflict: 409,
  unsupported_media: 415,
  too_large: 413,
  upstream: 502,
};

const FALLBACK_TEXT: Partial<Record<number, string>> = { 404: "Not Found" };

export interface MappedError {
  status: number;
  detail: string;
  /** true = unerwartet, gehört ins Log */
  unexpected: boolean;
}

export function mapError(e: unknown, t: Translate): MappedError {
  if (e instanceof AppError) {
    const status = STATUS[e.kind];
    const detail = e.messageKey ? t(e.messageKey, e.params) : e.message !== e.kind ? e.message : FALLBACK_TEXT[status] ?? e.kind;
    return { status, detail, unexpected: false };
  }
  if (e instanceof HttpError) return { status: e.status, detail: e.message, unexpected: false };
  return { status: 500, detail: t("unexpected", { e: (e as Error)?.name ?? "Error" }), unexpected: true };
}
