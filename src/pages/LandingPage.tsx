import { ArrowRight, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { ArsLogo, SLOGAN } from "../components/Brand.tsx";
import { LanguageSelect } from "../components/LanguageSelect.tsx";
import { useT } from "../i18n/index.ts";
import { linkProps } from "../router.ts";

const REPO_URL = import.meta.env.VITE_REPO_URL as string | undefined;

const STEPS = [1, 2, 3, 4] as const;
const SWATCHES = ["#d4ff3a", "#8b7bff", "#ff5d8f", "#ffb547", "#eceef1"] as const;

type Layout = "scrambled" | "aligned";
type ShapeId = "circle" | "square" | "diamond";

/** Positions in canvas-width units (cqw), so the demo scales with its container. */
const LAYOUTS: Record<Layout, Record<ShapeId, { x: number; y: number; r: number }>> = {
  scrambled: {
    circle: { x: 66, y: 4, r: 0 },
    square: { x: 9, y: 24, r: -14 },
    diamond: { x: 40, y: 29, r: 31 },
  },
  aligned: {
    circle: { x: 12, y: 15, r: 0 },
    square: { x: 42, y: 15, r: 0 },
    diamond: { x: 72, y: 15, r: 0 },
  },
};

const SHAPES: { id: ShapeId; name: string }[] = [
  { id: "circle", name: "Ellipse 1" },
  { id: "square", name: "Rectangle 2" },
  { id: "diamond", name: "Polygon 3" },
];

/** Marks every [data-reveal] element with data-in as it scrolls into view. */
function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || !("IntersectionObserver" in window)) return;
    el.classList.add("armed");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.in = "";
          io.unobserve(e.target);
        }
      },
      { threshold: 0.12 },
    );
    el.querySelectorAll("[data-reveal]").forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [root]);
}

/** A working fragment of the editor: select a shape, recolour it, or hand the layout to the agent. */
function EditorDemo() {
  const t = useT();
  const [layout, setLayout] = useState<Layout>("scrambled");
  const [selected, setSelected] = useState<ShapeId>("square");
  const [fills, setFills] = useState<Record<ShapeId, string>>({
    circle: "#8b7bff",
    square: "#d4ff3a",
    diamond: "#ff5d8f",
  });
  const aligned = layout === "aligned";

  return (
    <div className="demo" data-ui>
      <div className="demo-bar">
        <span className="demo-dots" aria-hidden="true" />
        <span className="demo-title">poster.ars</span>
        <span className="demo-live">
          <i aria-hidden="true" /> Claude Code
        </span>
      </div>
      <div className="demo-body">
        <aside className="demo-layers" aria-label={t("landing.demo.layers")}>
          <b>{t("landing.demo.layers")}</b>
          {SHAPES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={selected === s.id ? "on" : ""}
              aria-pressed={selected === s.id}
              onClick={() => setSelected(s.id)}
            >
              <i style={{ background: fills[s.id] }} aria-hidden="true" />
              {s.name}
            </button>
          ))}
        </aside>

        <div className="demo-canvas">
          {SHAPES.map((s) => {
            const p = LAYOUTS[layout][s.id];
            const style = {
              "--x": p.x,
              "--y": p.y,
              "--r": `${p.r}deg`,
              background: fills[s.id],
            } as CSSProperties;
            return (
              <button
                key={s.id}
                type="button"
                className={`demo-shape ${s.id}${selected === s.id ? " on" : ""}`}
                style={style}
                aria-label={s.name}
                onClick={() => setSelected(s.id)}
              />
            );
          })}
          <p className="demo-bubble" aria-live="polite">
            <Sparkles size={13} aria-hidden="true" />
            {aligned ? t("landing.demo.done") : t("landing.demo.prompt")}
          </p>
        </div>

        <aside className="demo-props">
          <b>{t("landing.demo.fill")}</b>
          <div className="demo-swatches">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={fills[selected] === c}
                className={fills[selected] === c ? "on" : ""}
                style={{ background: c }}
                onClick={() => setFills((f) => ({ ...f, [selected]: c }))}
              />
            ))}
          </div>
          <code>{fills[selected].toUpperCase()}</code>
        </aside>
      </div>
      <div className="demo-foot">
        <button type="button" className="demo-run" onClick={() => setLayout(aligned ? "scrambled" : "aligned")}>
          {aligned ? t("landing.demo.scramble") : t("landing.demo.agent")}
        </button>
      </div>
    </div>
  );
}

export function LandingPage() {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  const words = t("landing.marquee").split(" · ");

  return (
    <div className="landing-page" ref={root}>
      <header className="landing-header">
        <ArsLogo />
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

      <main>
        <section className="lp-hero">
          <h1>
            <span>{t("landing.title1")}</span>
            <span>{t("landing.title2")}</span>
          </h1>
          <div className="lp-hero-side">
            <p>{t("landing.pitch")}</p>
            <div className="lp-cta">
              <a className="btn primary lg" {...linkProps("/signup")}>
                {t("landing.start")} <ArrowRight size={16} />
              </a>
              <a className="btn ghost lg" {...linkProps("/login")}>
                {t("landing.haveAccount")}
              </a>
              {REPO_URL && (
                <a className="btn ghost lg" href={REPO_URL} target="_blank" rel="noreferrer">
                  {t("landing.code")}
                </a>
              )}
            </div>
          </div>
          <div className="lp-demo-wrap">
            <p className="lp-demo-label">{t("landing.demo.label")}</p>
            <EditorDemo />
          </div>
        </section>

        <div className="lp-marquee" aria-hidden="true">
          <div className="lp-marquee-track">
            {[0, 1].map((n) => (
              <ul key={n}>
                {words.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        <section className="lp-features" aria-label={t("landing.featuresLabel")}>
          <article className="lp-tile lime wide" data-reveal>
            <h2>{t("landing.f1.title")}</h2>
            <p>{t("landing.f1.text")}</p>
            <div className="lp-art art-vector" aria-hidden="true">
              <svg viewBox="0 0 320 120">
                <path d="M10 100 C60 10, 120 10, 160 60 S260 110, 310 20" />
                <circle cx="10" cy="100" r="6" />
                <circle cx="160" cy="60" r="6" />
                <circle cx="310" cy="20" r="6" />
              </svg>
            </div>
          </article>
          <article className="lp-tile violet" data-reveal>
            <h2>{t("landing.f2.title")}</h2>
            <p>{t("landing.f2.text")}</p>
            <div className="lp-art art-chat" aria-hidden="true">
              <span>{t("landing.demo.prompt")}</span>
              <span className="reply">{t("landing.demo.done")}</span>
            </div>
          </article>
          <article className="lp-tile ink" data-reveal>
            <h2>{t("landing.f3.title")}</h2>
            <p>{t("landing.f3.text")}</p>
            <pre className="lp-art art-code" aria-hidden="true">
              <code>{`{
  "mcpServers": {
    "ars": {
      "url": "…/mcp"
    }
  }
}`}</code>
            </pre>
          </article>
        </section>

        <section className="lp-steps">
          <h2 data-reveal>{t("landing.howTitle")}</h2>
          <ol>
            {STEPS.map((n) => (
              <li key={n} data-reveal>
                {t(`landing.s${n}`)}
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-final">
          <h2 data-reveal>{t("landing.finalTitle")}</h2>
          <a className="lp-final-btn" {...linkProps("/signup")}>
            {t("landing.finalCta")}
            <ArrowRight aria-hidden="true" />
          </a>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-row">
          <ArsLogo withSlogan />
          <p>{t("landing.footerNote")}</p>
          <nav className="row">
            <a className="btn subtle sm" {...linkProps("/login")}>
              {t("landing.signIn")}
            </a>
            {REPO_URL && (
              <a className="btn subtle sm" href={REPO_URL} target="_blank" rel="noreferrer">
                {t("landing.code")}
              </a>
            )}
          </nav>
        </div>
        <p className="lp-footer-word" aria-hidden="true">
          Project Ars
        </p>
        <span className="sr-only">{SLOGAN}</span>
      </footer>
    </div>
  );
}
