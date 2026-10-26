import { create } from "zustand";
import { en } from "./en.ts";
import { es } from "./es.ts";
import { ptBR } from "./pt-BR.ts";

export type Key = keyof typeof en;
export type Messages = Record<Key, string>;
export type Locale = "en" | "pt-BR" | "es";

export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "pt-BR", label: "Português (Brasil)" },
  { id: "es", label: "Español" },
];

const DICTS: Record<Locale, Messages> = { en, "pt-BR": ptBR, es };
const STORAGE_KEY = "ars:locale";

function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in DICTS) return saved as Locale;
  } catch {
    // storage unavailable
  }
  for (const lang of navigator.languages ?? [navigator.language]) {
    if (/^pt\b/i.test(lang)) return "pt-BR";
    if (/^es\b/i.test(lang)) return "es";
    if (/^en\b/i.test(lang)) return "en";
  }
  return "en";
}

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useI18n = create<I18nState>((set) => ({
  locale: detect(),
  setLocale: (locale) => {
    set({ locale });
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // storage unavailable
    }
  },
}));
document.documentElement.lang = useI18n.getState().locale;

type Vars = Record<string, string | number>;

function format(text: string, vars?: Vars) {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Translates with the current locale. Outside React; components use useT() to re-render on change. */
export function t(key: Key, vars?: Vars): string {
  return format(DICTS[useI18n.getState().locale][key] ?? en[key], vars);
}

/** Plural form: "<base>.one" for 1, "<base>.other" otherwise; {count} is filled in. */
export function tc(base: string, count: number, vars?: Vars): string {
  return t(`${base}.${count === 1 ? "one" : "other"}` as Key, { count, ...vars });
}

export function useT() {
  useI18n((s) => s.locale);
  return t;
}

/** A translated message for an API or database error code, or the code itself. */
export function errorMessage(code: string): string {
  const base = code.split(":")[0].trim();
  const key = `error.${base}` as Key;
  return key in en ? t(key) : code;
}
