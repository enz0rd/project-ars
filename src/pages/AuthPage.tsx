import { LogIn, Mail } from "lucide-react";
import { useState } from "react";
import { ArsLogo, SLOGAN } from "../components/Brand.tsx";
import { LanguageSelect } from "../components/LanguageSelect.tsx";
import { useAuth } from "../auth.ts";
import { errorMessage, useT } from "../i18n/index.ts";
import { configured, supabase } from "../lib/supabase.ts";
import { linkProps, navigate, type Route } from "../router.ts";

type Mode = Extract<Route["name"], "login" | "signup" | "forgot" | "reset">;

const GITHUB_ENABLED = import.meta.env.VITE_AUTH_GITHUB === "true";
const REPO_URL = import.meta.env.VITE_REPO_URL as string | undefined;
/** Matches the minimum set in Supabase Auth (see docs/DEPLOY.md). */
const MIN_PASSWORD = 8;

export function AuthPage({ mode }: { mode: Mode }) {
  const t = useT();
  const recovering = useAuth((s) => s.recovering);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(authCode(err)) });
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      const redirect = `${location.origin}/`;
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/", true);
      } else if (mode === "signup") {
        if (password.length < MIN_PASSWORD) throw { code: "weak_password" };
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        // With email confirmation on (recommended), there's no session until the link is clicked.
        if (data.session) navigate("/", true);
        else setMessage({ ok: true, text: t("auth.checkEmail") });
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset` });
        if (error) throw error;
        // Same answer whether or not the address has an account (no account enumeration).
        setMessage({ ok: true, text: t("auth.resetSent") });
      } else {
        if (password.length < MIN_PASSWORD) throw { code: "weak_password" };
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        useAuth.setState({ recovering: false });
        navigate("/", true);
      }
    });

  const title = {
    login: t("auth.loginTitle"),
    signup: t("auth.signupTitle"),
    forgot: t("auth.forgotTitle"),
    reset: t("auth.resetTitle"),
  }[mode];

  return (
    <div className="auth-page">
      <div className="auth-art" aria-hidden="true">
        <div className="auth-art-inner">
          <ArsLogo />
          <h1 className="auth-slogan">{SLOGAN}</h1>
          <p>{t("auth.pitch")}</p>
        </div>
      </div>
      <main className="auth-panel">
        <div className="auth-top">
          <LanguageSelect />
        </div>
        <form
          className="auth-card"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="auth-mobile-logo">
            <ArsLogo withSlogan />
          </div>
          <h2>{title}</h2>
          {!configured && <div className="status err">{t("auth.notConfigured")}</div>}
          {mode === "reset" && !recovering && <p className="muted">{t("auth.resetHint")}</p>}

          {mode !== "reset" && (
            <label className="field-block">
              <span>{t("auth.email")}</span>
              <input
                className="input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {mode !== "forgot" && (
            <label className="field-block">
              <span className="row">
                {mode === "reset" ? t("auth.newPassword") : t("auth.password")}
                {mode === "login" && (
                  <a className="link-btn small push" {...linkProps("/forgot")}>
                    {t("auth.forgotLink")}
                  </a>
                )}
              </span>
              <input
                className="input"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                minLength={mode === "login" ? undefined : MIN_PASSWORD}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode !== "login" && <small className="muted">{t("auth.passwordRule", { n: MIN_PASSWORD })}</small>}
            </label>
          )}

          <button className="btn primary block" disabled={busy || !configured}>
            {mode === "login" ? (
              <>
                <Mail size={15} /> {t("auth.loginButton")}
              </>
            ) : mode === "signup" ? (
              t("auth.signupButton")
            ) : mode === "forgot" ? (
              t("auth.forgotButton")
            ) : (
              t("auth.resetButton")
            )}
          </button>

          {GITHUB_ENABLED && (mode === "login" || mode === "signup") && (
            <>
              <div className="divider">
                <span>{t("auth.or")}</span>
              </div>
              <button
                type="button"
                className="btn subtle block"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const { error } = await supabase.auth.signInWithOAuth({
                      provider: "github",
                      options: { redirectTo: `${location.origin}/` },
                    });
                    if (error) throw error;
                  })
                }
              >
                <LogIn size={15} /> {t("auth.github")}
              </button>
            </>
          )}

          {message && <div className={`status ${message.ok ? "ok" : "err"}`}>{message.text}</div>}

          <div className="auth-switch">
            {mode === "login" ? (
              <>
                {t("auth.noAccount")} <a {...linkProps("/signup")}>{t("auth.signupLink")}</a>
              </>
            ) : (
              <>
                {t("auth.haveAccount")} <a {...linkProps("/login")}>{t("auth.loginLink")}</a>
              </>
            )}
          </div>
        </form>
        {REPO_URL && (
          <footer className="auth-footer">
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              {t("auth.openSource")}
            </a>
          </footer>
        )}
      </main>
    </div>
  );
}

/** Supabase auth errors carry a stable `code` (e.g. invalid_credentials); fall back to a generic one. */
function authCode(err: unknown): string {
  const code = (err as { code?: string })?.code;
  return code ? `auth_${code}` : "auth_unknown";
}
