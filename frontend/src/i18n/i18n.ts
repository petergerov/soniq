// Oberflächensprache. Statische Texte tragen data-i18n (Text), data-i18n-title, data-i18n-ph (Platzhalter)
// oder data-i18n-aria; dynamische Texte kommen über t("schlüssel").
import { storage } from "../core/storage.ts";
import { LANGUAGES, TRANSLATIONS, type Dictionary, type Lang } from "./translations.ts";

const STORAGE_KEY = "ui_lang";
const ATTRIBUTES: [dataKey: string, attribute: string][] = [["i18nTitle", "title"], ["i18nPh", "placeholder"], ["i18nAria", "aria-label"]];

function isLang(value: string | null | undefined): value is Lang {
  return !!value && value in LANGUAGES;
}

function initialLang(): Lang {
  const saved = storage.get(STORAGE_KEY);
  const system = (navigator.language || "en").toLowerCase().slice(0, 2);
  return isLang(saved) ? saved : isLang(system) ? system : "en";
}

export type Translate = (key: string, ...args: (string | number)[]) => string;

export class I18n {
  private current: Lang = initialLang();
  private readonly listeners: (() => void)[] = [];

  get lang(): Lang {
    return this.current;
  }

  readonly t: Translate = (key, ...args) => {
    const dict = (lang: Lang): Dictionary => TRANSLATIONS[lang];
    const value = dict(this.current)[key] ?? dict("en")[key] ?? dict("de")[key] ?? key;
    return typeof value === "function" ? (value as (...a: (string | number)[]) => string)(...args) : value;
  };

  setLang(lang: string): void {
    if (!isLang(lang)) return;
    this.current = lang;
    storage.set(STORAGE_KEY, lang);
    this.apply();
    this.listeners.forEach((fn) => fn());
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** Übersetzt alle markierten statischen Texte. */
  apply(root: ParentNode = document): void {
    document.documentElement.lang = this.current;
    root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => { el.textContent = this.t(el.dataset.i18n!); });
    for (const [dataKey, attribute] of ATTRIBUTES) {
      const selector = `[data-i18n-${dataKey.slice(4).toLowerCase()}]`;
      root.querySelectorAll<HTMLElement>(selector).forEach((el) => el.setAttribute(attribute, this.t(el.dataset[dataKey]!)));
    }
  }

  /** Füllt die Sprachauswahl und hält sie aktuell. */
  bindSelect(select: HTMLSelectElement): void {
    for (const [code, name] of Object.entries(LANGUAGES)) select.add(new Option(name, code));
    select.value = this.current;
    select.addEventListener("change", () => this.setLang(select.value));
  }
}
