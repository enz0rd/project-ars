import { ArrowRight, Check, Sparkles } from "lucide-react";
import { ArsLogo, SLOGAN } from "../components/Brand.tsx";
import { LanguageSelect } from "../components/LanguageSelect.tsx";
import { linkProps } from "../router.ts";

const REPO_URL = import.meta.env.VITE_REPO_URL as string | undefined;

const FEATURES = [
  {
    title: "Editor vetorial completo",
    text: "Pranchetas, formas, texto, imagens, alinhamento, distribuição, export para PNG/SVG e arquivo do projeto.",
  },
  {
    title: "Assistente de IA no canvas",
    text: "Conecte sua própria chave (Claude ou OpenAI compatível) e peça layouts e ajustes com aplicação ao vivo.",
  },
  {
    title: "Integração com agentes via MCP",
    text: "Use Claude Code, Cursor, Codex, Gemini CLI e outros clientes para editar projetos em tempo real.",
  },
];

const STEPS = [
  "Crie sua conta em segundos.",
  "Abra um projeto e desenhe normalmente.",
  "Peça ao assistente para gerar ou refinar partes do layout.",
  "Conecte seus agentes para colaborar no mesmo documento.",
];

export function LandingPage() {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <ArsLogo withSlogan />
        <div className="row">
          <LanguageSelect />
          <a className="btn subtle sm" {...linkProps("/login")}>
            Entrar
          </a>
          <a className="btn primary sm" {...linkProps("/signup")}>
            Criar conta
          </a>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <span className="landing-kicker">
            <Sparkles size={14} /> Open source · MCP ready
          </span>
          <h1>Desenhe com liberdade. Automatize com IA.</h1>
          <p>
            O Project Ars é um editor de design vetorial com assistente integrado e colaboração ao vivo com seus
            agentes de código.
          </p>
          <p className="muted">{SLOGAN}</p>
          <div className="landing-cta">
            <a className="btn primary" {...linkProps("/signup")}>
              Começar agora <ArrowRight size={15} />
            </a>
            <a className="btn subtle" {...linkProps("/login")}>
              Já tenho conta
            </a>
            {REPO_URL && (
              <a className="btn ghost" href={REPO_URL} target="_blank" rel="noreferrer">
                Ver código
              </a>
            )}
          </div>
        </section>

        <section className="landing-grid" aria-label="Recursos principais">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="landing-card">
              <h2>{feature.title}</h2>
              <p>{feature.text}</p>
            </article>
          ))}
        </section>

        <section className="landing-steps">
          <h2>Como funciona</h2>
          <ol>
            {STEPS.map((step) => (
              <li key={step}>
                <Check size={15} />
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-final-cta">
          <h2>Pronto para criar sem limites?</h2>
          <a className="btn primary" {...linkProps("/signup")}>
            Criar conta grátis <ArrowRight size={15} />
          </a>
        </section>
      </main>
    </div>
  );
}
