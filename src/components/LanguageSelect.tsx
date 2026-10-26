import { Languages } from "lucide-react";
import { LOCALES, useI18n, useT, type Locale } from "../i18n/index.ts";
import { supabase } from "../lib/supabase.ts";
import { userId } from "../auth.ts";

export function LanguageSelect() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const setLocale = useI18n((s) => s.setLocale);
  return (
    <label className="lang-select" title={t("common.language")}>
      <Languages size={14} />
      <select
        value={locale}
        aria-label={t("common.language")}
        onChange={(e) => {
          const next = e.target.value as Locale;
          setLocale(next);
          // Remember it on the account too, for other devices.
          const id = userId();
          if (id) void supabase.from("profiles").update({ locale: next }).eq("id", id);
        }}
      >
        {LOCALES.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
