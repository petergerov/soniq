// Fachliche Fehler. Sie kennen kein HTTP: die HTTP-Schicht übersetzt Art -> Statuscode
// und Meldungsschlüssel -> Text in der Sprache der Oberfläche.
import type { MessageKey } from "../i18n/messages.ts";

export type ErrorKind =
  | "invalid"            // Eingabe fehlt oder ist falsch
  | "bad_request"        // Aktion so nicht möglich
  | "not_found"
  | "conflict"           // gerade nicht möglich (z. B. Songs in Arbeit)
  | "unsupported_media"
  | "too_large"
  | "upstream";          // Modellserver oder GitHub hat versagt

export type MessageParams = Record<string, string | number>;

export class AppError extends Error {
  override name = "AppError";
  readonly kind: ErrorKind;
  /** Übersetzbare Meldung; fehlt sie, wird `message` unverändert gezeigt. */
  readonly messageKey: MessageKey | undefined;
  readonly params: MessageParams;

  constructor(kind: ErrorKind, messageKey?: MessageKey, params: MessageParams = {}, rawMessage = "") {
    super(rawMessage || messageKey || kind);
    this.kind = kind;
    this.messageKey = messageKey;
    this.params = params;
  }

  /** Fehler mit festem (nicht übersetzbarem) Text, z. B. aus Git oder dem Modellserver. */
  static raw(kind: ErrorKind, message: string): AppError {
    return new AppError(kind, undefined, {}, message);
  }
}
