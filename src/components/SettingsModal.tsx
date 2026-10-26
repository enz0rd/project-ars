import { useEffect, useState } from "react";
import type { McpServerInput, PublicSettings } from "../../shared/types.ts";
import { useSettings } from "../settings.ts";

export function SettingsModal() {
  const open = useSettings((s) => s.open);
  const setOpen = useSettings((s) => s.setOpen);
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
      <div className="modal" role="dialog" aria-labelledby="settings-title" onKeyDown={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2 id="settings-title">Configurações</h2>
          <button className="icon-close" onClick={() => setOpen(false)} aria-label="Fechar">
            ✕
          </button>
        </header>
        {settings ? (
          <div className="modal-body">
            <ApiKeySection settings={settings} />
            <McpSection settings={settings} />
          </div>
        ) : (
          <div className="modal-body muted">Carregando…</div>
        )}
      </div>
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
        <button type="button" className="secondary" disabled={busy || (!key.trim() && !apiKey.configured)} onClick={test}>
          Testar
        </button>
        <button type="submit" className="primary" disabled={busy || !key.trim()}>
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
              className="secondary"
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY_FORM);
                setError(null);
              }}
            >
              Cancelar
            </button>
          )}
          <button type="submit" className="primary" disabled={busy || !form.name.trim() || !form.url.trim()}>
            {editingId ? "Salvar" : "Adicionar"}
          </button>
        </div>
        {error && <div className="status err">{error}</div>}
      </form>
    </section>
  );
}
