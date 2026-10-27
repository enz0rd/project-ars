import { ArrowRight, Check, Sparkles } from "lucide-react";
import { ArsLogo, SLOGAN } from "../components/Brand.tsx";
import { LanguageSelect } from "../components/LanguageSelect.tsx";
import { useT } from "../i18n/index.ts";
import { linkProps } from "../router.ts";

const REPO_URL = import.meta.env.VITE_REPO_URL as string | undefined;

const FEATURES = [1, 2, 3] as const;
const STEPS = [1, 2, 3, 4] as const;

export function LandingPage() {
  const t = useT();
  return (
    <div className="landing-page">
      <header className="landing-header">
        <ArsLogo withSlogan />
        <div className="row">
          <LanguageSelect />
          <a className="btn subtle sm" {...linkProps("/login")}>
            {t("landing.signIn")}
          </a>
          <a className="btn primary sm" {...linkProps("/signup")}>
            {t("landing.signUp")}
          </a>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <span className="landing-kicker">
            <Sparkles size={14} /> {t("landing.kicker")}
          </span>
          <h1>
            {t("landing.title1")} <em>{t("landing.title2")}</em>
          </h1>
          <p>
            {t("landing.pitch")}
          </p>
          <p className="muted">{SLOGAN}</p>
          <div className="landing-cta">
            <a className="btn primary" {...linkProps("/signup")}>
              {t("landing.start")} <ArrowRight size={15} />
            </a>
            <a className="btn subtle" {...linkProps("/login")}>
              {t("landing.haveAccount")}
            </a>
            {REPO_URL && (
              <a className="btn ghost" href={REPO_URL} target="_blank" rel="noreferrer">
                {t("landing.code")}
              </a>
            )}
          </div>
        </section>

        <section className="landing-grid" aria-label={t("landing.featuresLabel")}>
          {FEATURES.map((n) => (
            <article key={n} className="landing-card">
              <h2>{t(`landing.f${n}.title`)}</h2>
              <p>{t(`landing.f${n}.text`)}</p>
            </article>
          ))}
        </section>

        <section className="landing-steps">
          <h2>{t("landing.howTitle")}</h2>
          <ol>
            {STEPS.map((n) => (
              <li key={n}>
                <Check size={15} />
                <span>{t(`landing.s${n}`)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-final-cta">
          <h2>{t("landing.finalTitle")}</h2>
          <a className="btn primary" {...linkProps("/signup")}>
            {t("landing.finalCta")} <ArrowRight size={15} />
          </a>
        </section>
      </main>
    </div>
  );
}
