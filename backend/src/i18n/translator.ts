import type { MessageParams } from "../domain/errors.ts";
import { MESSAGES, type MessageKey } from "./messages.ts";

export type Translate = (key: MessageKey, params?: MessageParams) => string;

/** Übersetzer für eine Sprache (Header X-Lang, z. B. "de" oder "de-AT"). Unbekannt -> Englisch. */
export function translatorFor(lang: string | undefined): Translate {
  const code = (lang || "en").toLowerCase().slice(0, 2);
  return (key, params = {}) => {
    const texts: Record<string, string> = MESSAGES[key];
    const text = texts[code] ?? texts.en;
    return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
  };
}
