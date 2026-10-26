import { Bot, Check, Copy, KeyRound, LogOut, Plug, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { PublicSettings } from "../../shared/types.ts";
import { useAuth } from "../auth.ts";
import { errorMessage, useT, type Key } from "../i18n/index.ts";
import { api } from "../lib/api.ts";
import { supabase } from "../lib/supabase.ts";
import { navigate } from "../router.ts";
import { useSettings, type SettingsTab } from "../settings.ts";
import { LanguageSelect } from "./LanguageSelect.tsx";

const TABS: { id: SettingsTab; label: Key; icon: React.ReactNode }[] = [
  { id: "account", label: "settings.account", icon: <UserRound size={14} /> },
  { id: "ai", label: "settings.ai", icon: <KeyRound size={14} /> },
  { id: "agents", label: "settings.agents", icon: <Bot size={14} /> },
  { id: "mcp", label: "settings.mcp", icon: <Plug size={14} /> },
];

export function SettingsModal() {
  const t = useT();
  const open = useSettings((s) => s.open);
  const setOpen = useSettings((s) => s.setOpen);
  const tab = useSettings((s) => s.tab);
  const setTab = useSettings((s) => s.setTab);
  const settings = useSettings((s) => s.settings);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div
        className="modal settings"
        role="dialog"
        aria-labelledby="settings-title"
        onKeyDown={(e) => {
          // Keep editor shortcuts from firing while typing here.
          e.stopPropagation();
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <header className="modal-header">
          <h2 id="settings-title">{t("settings.title")}</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav">
            {TABS.map((item) => (
              <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
                {item.icon} {t(item.label)}
              </button>
            ))}
          </nav>
          <div className="modal-body">
            {tab === "account" ? (
              <AccountSection />
            ) : !settings ? (
              <div className="muted">{t("common.loading")}</div>
            ) : tab === "ai" ? (
              <AiSection settings={settings} />
            ) : tab === "agents" ? (
              <AgentsSection settings={settings} />
            ) : (
              <McpSection settings={settings} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Runs an action with busy/error state; errors are translated API codes. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setStatus(null);
    try {
      const done = await fn();
      if (done) setStatus({ ok: true, text: done });
    } catch (err) {
      setStatus({ ok: false, text: errorMessage((err as Error).message) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, status, setStatus, run };
}

function Status({ status }: { status: { ok: boolean; text: string } | null }) {
  return status && <div className={`status ${status.ok ? "ok" : "err"}`}>{status.text}</div>;
}

// Account

function AccountSection() {
  const t = useT();
  const email = useAuth((s) => s.session?.user.email);
  const setOpen = useSettings((s) => s.setOpen);
  const [confirmText, setConfirmText] = useState("");
  const { busy, status, run } = useAction();

  return (
    <section className="settings-section">
      <h3>{t("settings.account")}</h3>
      <div className="key-status">
        <UserRound size={15} /> {email}
      </div>
      <label className="field-block">
        <span>{t("common.language")}</span>
        <LanguageSelect />
      </label>
      <div className="row">
        <button
          className="btn subtle"
          onClick={async () => {
            await supabase.auth.signOut();
            setOpen(false);
            navigate("/login", true);
          }}
        >
          <LogOut size={14} /> {t("settings.signOut")}
        </button>
      </div>

      <div className="danger-zone">
        <h3>{t("settings.deleteAccount")}</h3>
        <p className="muted">{t("settings.deleteAccountText")}</p>
        <div className="row">
          <input
            className="input"
            placeholder={t("settings.deleteConfirmPlaceholder")}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
          <button
            className="btn danger"
            disabled={busy || confirmText !== "DELETE"}
            onClick={() =>
              run(async () => {
                await api("DELETE", "/api/me", { confirm: "DELETE" });
                await supabase.auth.signOut();
                setOpen(false);
                navigate("/signup", true);
              })
            }
          >
            <Trash2 size={14} /> {t("settings.deleteAccountButton")}
          </button>
        </div>
        <Status status={status} />
      </div>
    </section>
  );
}

// AI provider (bring your own key)

// Model names change often: the user types the one their provider offers.
const OPENAI_PRESETS = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
  { id: "custom", label: "custom", baseUrl: "" },
] as const;

function AiSection({ settings }: { settings: PublicSettings }) {
  const t = useT();
  const refresh = useSettings((s) => s.refresh);
  const { ai } = settings;
  const { busy, status, run } = useAction();

  const choose = (provider: "anthropic" | "openai") =>
    run(async () => {
      await api("PUT", "/api/me/ai/provider", { provider });
      await refresh();
    });

  return (
    <section className="settings-section">
      <h3>{t("settings.ai")}</h3>
      <p className="muted">{t("settings.aiIntro")}</p>
      <div className="segmented big">
        <button className={ai.provider === "anthropic" ? "active" : ""} disabled={busy} onClick={() => choose("anthropic")}>
          Claude (Anthropic)
        </button>
        <button className={ai.provider === "openai" ? "active" : ""} disabled={busy} onClick={() => choose("openai")}>
          {t("settings.openaiCompatible")}
        </button>
      </div>
      <Status status={status} />
      {ai.provider === "anthropic" ? <AnthropicForm settings={settings} /> : <OpenAiForm settings={settings} />}
      <p className="muted small">{t("settings.keySecurity")}</p>
    </section>
  );
}

function KeyState({ configured, last4 }: { configured: boolean; last4: string | null }) {
  const t = useT();
  return (
    <div className="key-status">
      <span className={`dot ${configured ? "ok" : "off"}`} />
      {configured ? (
        <>
          {t("settings.keySaved")} <code>…{last4}</code>
        </>
      ) : (
        t("settings.noKey")
      )}
    </div>
  );
}

function AnthropicForm({ settings }: { settings: PublicSettings }) {
  const t = useT();
  const refresh = useSettings((s) => s.refresh);
  const [key, setKey] = useState("");
  const { busy, status, run } = useAction();
  const { anthropic } = settings.ai;

  return (
    <>
      <p className="muted">
        {t("settings.anthropicHelp")}{" "}
        <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
          platform.claude.com
        </a>
      </p>
      <KeyState {...anthropic} />
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!key.trim()) return;
          run(async () => {
            await api("PUT", "/api/me/ai/anthropic", { apiKey: key });
            setKey("");
            await refresh();
            return t("settings.keySavedOk");
          });
        }}
      >
        <input
          type="password"
          className="input"
          placeholder={anthropic.configured ? t("settings.replaceKey") : "sk-ant-…"}
          value={key}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
        />
        <TestButton provider="anthropic" input={{ apiKey: key }} disabled={busy || (!key.trim() && !anthropic.configured)} run={run} />
        <button type="submit" className="btn primary" disabled={busy || !key.trim()}>
          {t("common.save")}
        </button>
      </form>
      {anthropic.configured && (
        <button
          className="link-btn danger"
          disabled={busy}
          onClick={() => run(async () => (await api("DELETE", "/api/me/ai/anthropic"), await refresh()))}
        >
          {t("settings.removeKey")}
        </button>
      )}
      <Status status={status} />
    </>
  );
}

function OpenAiForm({ settings }: { settings: PublicSettings }) {
  const t = useT();
  const refresh = useSettings((s) => s.refresh);
  const { openai } = settings.ai;
  const [baseUrl, setBaseUrl] = useState(openai.baseUrl ?? OPENAI_PRESETS[0].baseUrl);
  const [model, setModel] = useState(openai.model ?? "");
  const [key, setKey] = useState("");
  const { busy, status, run } = useAction();
  const preset = OPENAI_PRESETS.find((p) => p.baseUrl === baseUrl)?.id ?? "custom";

  return (
    <>
      <p className="muted">{t("settings.openaiHelp")}</p>
      <KeyState {...openai} />
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api("PUT", "/api/me/ai/openai", { baseUrl, model, ...(key.trim() && { apiKey: key }) });
            setKey("");
            await refresh();
            return t("settings.keySavedOk");
          });
        }}
      >
        <label className="field-block">
          <span>{t("settings.provider")}</span>
          <select
            className="input"
            value={preset}
            onChange={(e) => {
              const p = OPENAI_PRESETS.find((x) => x.id === e.target.value)!;
              if (p.id !== "custom") setBaseUrl(p.baseUrl);
            }}
          >
            {OPENAI_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === "custom" ? t("settings.customProvider") : p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-block">
          <span>{t("settings.baseUrl")}</span>
          <input className="input" value={baseUrl} placeholder="https://…/v1" onChange={(e) => setBaseUrl(e.target.value)} />
        </label>
        <label className="field-block">
          <span>{t("settings.model")}</span>
          <input className="input" value={model} placeholder={t("settings.modelPlaceholder")} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label className="field-block">
          <span>{t("settings.apiKey")}</span>
          <input
            type="password"
            className="input"
            placeholder={openai.configured ? t("settings.keepKey") : ""}
            value={key}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <div className="row end">
          <TestButton
            provider="openai"
            input={{ apiKey: key, baseUrl }}
            disabled={busy || (!key.trim() && !openai.configured)}
            run={run}
          />
          <button type="submit" className="btn primary" disabled={busy || !baseUrl.trim() || !model.trim() || (!key.trim() && !openai.configured)}>
            {t("common.save")}
          </button>
        </div>
      </form>
      {openai.configured && (
        <button className="link-btn danger" disabled={busy} onClick={() => run(async () => (await api("DELETE", "/api/me/ai/openai"), await refresh()))}>
          {t("settings.removeKey")}
        </button>
      )}
      <Status status={status} />
    </>
  );
}

function TestButton({
  provider,
  input,
  disabled,
  run,
}: {
  provider: "anthropic" | "openai";
  input: Record<string, string>;
  disabled: boolean;
  run: (fn: () => Promise<string | void>) => Promise<void>;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className="btn subtle"
      disabled={disabled}
      onClick={() =>
        run(async () => {
          const res = await api<{ ok: boolean; error?: string }>("POST", `/api/me/ai/${provider}/test`, input);
          if (!res.ok) throw new Error(res.error ?? "key_check_failed");
          return t("settings.keyWorks");
        })
      }
    >
      {t("settings.test")}
    </button>
  );
}

// Agents: MCP access for Claude Code, Cursor, Codex, Gemini CLI…

type AgentId = "claude-code" | "claude-desktop" | "cursor" | "vscode" | "codex" | "gemini" | "windsurf" | "other";

const AGENTS: { id: AgentId; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code (Copilot)" },
  { id: "codex", label: "Codex CLI" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "windsurf", label: "Windsurf" },
  { id: "other", label: "other" },
];

function agentConfig(agent: AgentId, url: string, token: string): { file?: string; text: string } {
  const auth = `Bearer ${token}`;
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  switch (agent) {
    case "claude-code":
      return { text: `claude mcp add --transport http ars ${url} --header "Authorization: ${auth}"` };
    case "claude-desktop":
      return {
        file: "claude_desktop_config.json",
        text: json({
          mcpServers: {
            ars: { command: "npx", args: ["-y", "mcp-remote", url, "--header", "Authorization:${ARS_AUTH}"], env: { ARS_AUTH: auth } },
          },
        }),
      };
    case "cursor":
      return { file: "~/.cursor/mcp.json", text: json({ mcpServers: { ars: { url, headers: { Authorization: auth } } } }) };
    case "vscode":
      return { file: ".vscode/mcp.json", text: json({ servers: { ars: { type: "http", url, headers: { Authorization: auth } } } }) };
    case "codex":
      return {
        file: "~/.codex/config.toml",
        text: `[mcp_servers.ars]\nurl = "${url}"\nbearer_token_env_var = "ARS_TOKEN"\n\n# then: export ARS_TOKEN=${token}`,
      };
    case "gemini":
      return { file: "~/.gemini/settings.json", text: json({ mcpServers: { ars: { httpUrl: url, headers: { Authorization: auth } } } }) };
    case "windsurf":
      return {
        file: "~/.codeium/windsurf/mcp_config.json",
        text: json({ mcpServers: { ars: { serverUrl: url, headers: { Authorization: auth } } } }),
      };
    default:
      return { text: `URL: ${url}\nTransport: Streamable HTTP\nHeader: Authorization: ${auth}` };
  }
}

function AgentsSection({ settings }: { settings: PublicSettings }) {
  const t = useT();
  const refresh = useSettings((s) => s.refresh);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [agent, setAgent] = useState<AgentId>("claude-code");
  const { busy, status, run } = useAction();
  const url = `${location.origin}/mcp`;
  const config = agentConfig(agent, url, created?.token ?? "<ARS_TOKEN>");

  return (
    <section className="settings-section">
      <h3>{t("settings.agents")}</h3>
      <p className="muted">{t("settings.agentsIntro")}</p>

      <div className="form-title">{t("settings.tokens")}</div>
      {settings.tokens.length > 0 ? (
        <ul className="mcp-list">
          {settings.tokens.map((tok) => (
            <li key={tok.id}>
              <div className="mcp-info">
                <div className="mcp-name">
                  {tok.name} <code>{tok.hint}</code>
                </div>
                <div className="mcp-url">
                  {tok.last_used_at
                    ? t("settings.tokenUsed", { date: new Date(tok.last_used_at).toLocaleString() })
                    : t("settings.tokenNeverUsed")}
                </div>
              </div>
              <button
                className="link-btn danger"
                disabled={busy}
                onClick={() =>
                  confirm(t("settings.revokeConfirm", { name: tok.name })) &&
                  run(async () => (await api("DELETE", `/api/me/tokens/${tok.id}`), await refresh()))
                }
              >
                {t("settings.revoke")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{t("settings.noTokens")}</p>
      )}

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const res = await api<{ token: string; name: string }>("POST", "/api/me/tokens", { name: name || "Agent" });
            setCreated(res);
            setName("");
            await refresh();
          });
        }}
      >
        <input className="input" placeholder={t("settings.tokenName")} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" disabled={busy}>
          {t("settings.createToken")}
        </button>
      </form>
      <Status status={status} />

      {created && (
        <div className="token-once">
          <strong>{t("settings.tokenOnce")}</strong>
          <CopyBlock text={created.token} />
        </div>
      )}

      <div className="form-title">{t("settings.connect")}</div>
      <div className="agent-tabs">
        {AGENTS.map((a) => (
          <button key={a.id} className={agent === a.id ? "active" : ""} onClick={() => setAgent(a.id)}>
            {a.id === "other" ? t("settings.otherAgent") : a.label}
          </button>
        ))}
      </div>
      {config.file && <div className="muted small">{config.file}</div>}
      <CopyBlock text={config.text} />
      <p className="muted small">{t("settings.agentsTools")}</p>
    </section>
  );
}

function CopyBlock({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-block">
      <pre>{text}</pre>
      <button
        className="icon-btn sm"
        title={t("common.copy")}
        onClick={() => {
          navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

// Remote MCP servers for the in-app assistant (Claude only)

function McpSection({ settings }: { settings: PublicSettings }) {
  const t = useT();
  const refresh = useSettings((s) => s.refresh);
  const [form, setForm] = useState({ name: "", url: "", authorizationToken: "" });
  const { busy, status, run } = useAction();

  return (
    <section className="settings-section">
      <h3>{t("settings.mcp")}</h3>
      <p className="muted">{t("settings.mcpIntro")}</p>
      {settings.ai.provider !== "anthropic" && <div className="status err">{t("settings.mcpClaudeOnly")}</div>}

      {settings.mcpServers.length > 0 && (
        <ul className="mcp-list">
          {settings.mcpServers.map((m) => (
            <li key={m.id} className={m.enabled ? "" : "disabled"}>
              <label className="switch" title={m.enabled ? t("settings.disable") : t("settings.enable")}>
                <input
                  type="checkbox"
                  checked={m.enabled}
                  disabled={busy}
                  onChange={(e) =>
                    run(async () => (await api("PATCH", `/api/me/mcp-servers/${m.id}`, { enabled: e.target.checked }), await refresh()))
                  }
                />
                <span />
              </label>
              <div className="mcp-info">
                <div className="mcp-name">
                  {m.name}
                  {m.hasToken && <span className="tag">token</span>}
                </div>
                <div className="mcp-url">{m.url}</div>
              </div>
              <button
                className="link-btn danger"
                disabled={busy}
                onClick={() =>
                  confirm(t("settings.removeServerConfirm", { name: m.name })) &&
                  run(async () => (await api("DELETE", `/api/me/mcp-servers/${m.id}`), await refresh()))
                }
              >
                {t("common.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mcp-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api("POST", "/api/me/mcp-servers", form);
            setForm({ name: "", url: "", authorizationToken: "" });
            await refresh();
          });
        }}
      >
        <div className="form-title">{t("settings.addServer")}</div>
        <div className="row">
          <input
            className="input name"
            placeholder={t("settings.serverName")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input className="input" placeholder="https://example.com/mcp" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        </div>
        <input
          type="password"
          className="input"
          autoComplete="off"
          placeholder={t("settings.serverToken")}
          value={form.authorizationToken}
          onChange={(e) => setForm({ ...form, authorizationToken: e.target.value })}
        />
        <div className="row end">
          <button type="submit" className="btn primary" disabled={busy || !form.name.trim() || !form.url.trim()}>
            {t("common.add")}
          </button>
        </div>
        <Status status={status} />
      </form>
    </section>
  );
}
