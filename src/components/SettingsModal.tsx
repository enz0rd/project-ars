import { Check, Copy, KeyRound, Plug, Terminal, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { McpServerInput, PublicSettings } from "../../shared/types.ts";
import { useSettings } from "../settings.ts";

type Tab = "key" | "mcp" | "claude-code";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "key", label: "Chave da API", icon: <KeyRound size={14} /> },
  { id: "mcp", label: "Servidores MCP", icon: <Plug size={14} /> },
  { id: "claude-code", label: "Claude Code", icon: <Terminal size={14} /> },
];

export function SettingsModal() {
  const open = useSettings((s) => s.open);
  const setOpen = useSettings((s) => s.setOpen);
  const settings = useSettings((s) => s.settings);
  const [tab, setTab] = useState<Tab>("key");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal settings" role="dialog" aria-labelledby="settings-title" onKeyDown={(e) => {
          // Keep editor shortcuts from firing while typing here.
          e.stopPropagation();
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <header className="modal-header">
          <h2 id="settings-title">Configurações</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Fechar">
            <X size={16} />
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
                {t.icon} {t.label}
              </button>
            ))}
          </nav>
          <div className="modal-body">
            {!settings ? (
              <div className="muted">Carregando…</div>
            ) : tab === "key" ? (
              <ApiKeySection settings={settings} />
            ) : tab === "mcp" ? (
              <McpSection settings={settings} />
            ) : (
              <ClaudeCodeSection />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ClaudeCodeSection() {
  const live = useSettings((s) => s.live);
  const [mcpUrl, setMcpUrl] = useState("http://127.0.0.1:8787/mcp");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => d.mcpUrl && setMcpUrl(d.mcpUrl))
      .catch(() => {});
  }, []);

  const desktopConfig = JSON.stringify(
    { mcpServers: { "figma-claude": { command: "npx", args: ["-y", "mcp-remote", mcpUrl] } } },
    null,
    2,
  );

  return (
    <section className="settings-section">
      <h3>Controlar este editor pelo Claude Code</h3>
      <p className="muted">
        Este app também é um servidor MCP. Conecte o Claude Code (ou o Claude Desktop) e ele poderá ler e editar o canvas
        aberto aqui, ao vivo. Cada ação dele vira um passo de desfazer.
      </p>

      <div className="key-status">
        <span className={`dot ${live.target ? "ok" : "off"}`} />
        {!live.connected
          ? "Editor desconectado do servidor"
          : live.target
            ? "O MCP está lendo e editando esta aba"
            : "Outra aba aberta está ativa para o MCP — volte a ela ou edite algo aqui para trocar"}
      </div>

      <div className="form-title">Claude Code — rode no terminal</div>
      <CopyBlock text={`claude mcp add --transport http figma-claude ${mcpUrl}`} />

      <div className="form-title">Claude Desktop — claude_desktop_config.json</div>
      <CopyBlock text={desktopConfig} />

      <p className="muted small">
        Ferramentas: get_document, create_nodes, update_nodes, delete_nodes, reorder_node, select_nodes. O servidor só aceita
        conexões desta máquina.
      </p>
    </section>
  );
}

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-block">
      <pre>{text}</pre>
      <button
        className="icon-btn sm"
        title="Copiar"
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

function ApiKeySection({ settings }: { settings: PublicSettings }) {
  const call = useSettings((s) => s.call);
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { apiKey } = settings;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
    } catch (err) {
      setStatus({ ok: false, message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const test = () =>
    run(async () => {
      setStatus(await call<{ ok: boolean; message: string }>("POST", "/api/settings/api-key/test", { apiKey: key }));
    });

  const save = () =>
    run(async () => {
      await call("PUT", "/api/settings/api-key", { apiKey: key });
      setKey("");
      setStatus({ ok: true, message: "Chave salva." });
    });

  const remove = () =>
    run(async () => {
      await call("DELETE", "/api/settings/api-key");
      setStatus(null);
    });

  return (
    <section className="settings-section">
      <h3>Chave da API do Claude</h3>
      <p className="muted">
        Fica salva apenas no servidor local e nunca é enviada de volta ao navegador. Crie uma em{" "}
        <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
          platform.claude.com
        </a>
        .
      </p>

      <div className="key-status">
        <span className={`dot ${apiKey.configured ? "ok" : "off"}`} />
        {apiKey.configured ? (
          <>
            Configurada <code>…{apiKey.last4}</code>
            <span className="muted">{apiKey.source === "env" ? " (variável ANTHROPIC_API_KEY)" : " (salva nesta tela)"}</span>
          </>
        ) : (
          "Nenhuma chave configurada"
        )}
      </div>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) save();
        }}
      >
        <input
          type="password"
          className="input"
          placeholder={apiKey.configured ? "Substituir chave…" : "sk-ant-…"}
          value={key}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
        />
        <button type="button" className="btn subtle" disabled={busy || (!key.trim() && !apiKey.configured)} onClick={test}>
          Testar
        </button>
        <button type="submit" className="btn primary" disabled={busy || !key.trim()}>
          Salvar
        </button>
      </form>

      {apiKey.source === "settings" && (
        <button className="link-btn danger" disabled={busy} onClick={remove}>
          Remover chave salva
        </button>
      )}
      {status && <div className={`status ${status.ok ? "ok" : "err"}`}>{status.message}</div>}
    </section>
  );
}

const EMPTY_FORM: McpServerInput = { name: "", url: "", authorizationToken: "" };

function McpSection({ settings }: { settings: PublicSettings }) {
  const call = useSettings((s) => s.call);
  const [form, setForm] = useState<McpServerInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      if (editingId) {
        // An empty token field while editing means "keep the current token".
        const { authorizationToken, ...rest } = form;
        await call("PATCH", `/api/settings/mcp/${editingId}`, authorizationToken ? form : rest);
      } else {
        await call("POST", "/api/settings/mcp", form);
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
    });

  return (
    <section className="settings-section">
      <h3>Servidores MCP</h3>
      <p className="muted">
        Servidores MCP remotos dão novas ferramentas ao Claude enquanto ele desenha (dados, ícones, design system…). A
        API da Anthropic se conecta a eles diretamente, então a URL precisa ser pública e usar HTTPS.
      </p>

      {settings.mcpServers.length > 0 && (
        <ul className="mcp-list">
          {settings.mcpServers.map((m) => (
            <li key={m.id} className={m.enabled ? "" : "disabled"}>
              <label className="switch" title={m.enabled ? "Desativar" : "Ativar"}>
                <input
                  type="checkbox"
                  checked={m.enabled}
                  disabled={busy}
                  onChange={(e) => run(() => call("PATCH", `/api/settings/mcp/${m.id}`, { enabled: e.target.checked }))}
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
                className="link-btn"
                disabled={busy}
                onClick={() => {
                  setEditingId(m.id);
                  setForm({ name: m.name, url: m.url, authorizationToken: "" });
                  setError(null);
                }}
              >
                Editar
              </button>
              <button
                className="link-btn danger"
                disabled={busy}
                onClick={() => confirm(`Remover o servidor "${m.name}"?`) && run(() => call("DELETE", `/api/settings/mcp/${m.id}`))}
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mcp-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="form-title">{editingId ? "Editar servidor" : "Adicionar servidor"}</div>
        <div className="row">
          <input
            className="input name"
            placeholder="nome (ex.: icons)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className="input"
            placeholder="https://exemplo.com/mcp"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
        </div>
        <input
          type="password"
          className="input"
          autoComplete="off"
          placeholder={editingId ? "Token de autorização (deixe vazio para manter)" : "Token de autorização (opcional)"}
          value={form.authorizationToken}
          onChange={(e) => setForm({ ...form, authorizationToken: e.target.value })}
        />
        <div className="row end">
          {editingId && (
            <button
              type="button"
              className="btn subtle"
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY_FORM);
                setError(null);
              }}
            >
              Cancelar
            </button>
          )}
          <button type="submit" className="btn primary" disabled={busy || !form.name.trim() || !form.url.trim()}>
            {editingId ? "Salvar" : "Adicionar"}
          </button>
        </div>
        {error && <div className="status err">{error}</div>}
      </form>
    </section>
  );
}
