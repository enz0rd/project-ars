import { ArrowUp, KeyRound, Layers, Plug, Sparkles, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AiChatTurn, AiEvent, AiRequest } from "../../shared/types.ts";
import { errorMessage, tc, useT, type Key } from "../i18n/index.ts";
import { apiFetch } from "../lib/api.ts";
import { useSettings } from "../settings.ts";
import { useEditor } from "../store.ts";
import { useUi } from "../ui.ts";

interface ChatMessage extends AiChatTurn {
  error?: boolean;
  edits?: number;
  mcpCalls?: string[];
}

const SUGGESTIONS: [Key, Key][] = [
  ["ai.s1.title", "ai.s1.prompt"],
  ["ai.s2.title", "ai.s2.prompt"],
  ["ai.s3.title", "ai.s3.prompt"],
  ["ai.s4.title", "ai.s4.prompt"],
];

export function AiPanel() {
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const settings = useSettings((s) => s.settings);
  const openSettings = useSettings((s) => s.setOpen);
  const selectionCount = useEditor((s) => s.selection.length);
  const focusComposer = useUi((s) => s.focusComposer);
  const ai = settings?.ai;
  const missingKey = !!ai && !(ai.provider === "anthropic" ? ai.anthropic.configured : ai.openai.configured);
  const providerName = ai?.provider === "openai" ? (ai.openai.model ?? "OpenAI") : "Claude";
  const activeMcp = settings?.mcpServers.filter((m) => m.enabled).length ?? 0;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (focusComposer) setTimeout(() => inputRef.current?.focus(), 0);
  }, [focusComposer]);

  // Grow the composer with its content.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const send = async (prompt: string) => {
    prompt = prompt.trim();
    if (!prompt || busy) return;
    const state = useEditor.getState();
    if (!state.projectId) return;
    const body: AiRequest = {
      projectId: state.projectId,
      prompt,
      document: { name: state.docName, nodes: state.nodes },
      selection: state.selection,
      history: messages.filter((m) => !m.error && m.text).map(({ role, text }) => ({ role, text })),
    };

    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text: prompt }, { role: "assistant", text: "", edits: 0 }]);
    const patchLast = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);

    // One undo step for everything the assistant does in this turn.
    state.checkpoint();
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await apiFetch("POST", "/api/ai", body, abort.signal);
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `http_${res.status}`);
      }

      for await (const event of readSse(res.body)) {
        if (event.type === "text") patchLast((m) => ({ ...m, text: m.text + event.text }));
        else if (event.type === "op") {
          useEditor.getState().applyOps([event.op]);
          patchLast((m) => ({ ...m, edits: (m.edits ?? 0) + 1 }));
        } else if (event.type === "mcp") {
          patchLast((m) => ({ ...m, mcpCalls: [...(m.mcpCalls ?? []), `${event.server} › ${event.tool}`] }));
        } else if (event.type === "error") patchLast((m) => ({ ...m, text: errorMessage(event.message), error: true }));
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        patchLast((m) => ({ ...m, text: errorMessage((err as Error).message), error: true }));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="ai">
      <div className="ai-header">
        <div className="ai-title">
          <span className="ai-avatar">
            <Sparkles size={13} />
          </span>
          {t("inspector.assistant")}
          {ai && <span className="chip">{providerName}</span>}
          {activeMcp > 0 && ai?.provider === "anthropic" && (
            <span className="chip" title={t("ai.activeMcp")}>
              <Plug size={11} /> {activeMcp}
            </span>
          )}
        </div>
        {messages.length > 0 && (
          <button className="icon-btn sm" title={t("ai.clear")} onClick={() => setMessages([])} disabled={busy}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="chat" ref={listRef}>
        {missingKey && (
          <div className="setup-banner">
            <KeyRound size={16} />
            <div>
              <strong>{t("ai.setupTitle")}</strong>
              <span>{t("ai.setupText")}</span>
            </div>
            <button className="btn primary sm" onClick={() => openSettings(true, "ai")}>
              {t("ai.setupButton")}
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="welcome">
            <div className="welcome-icon">
              <Sparkles size={20} />
            </div>
            <h3>{t("ai.welcomeTitle")}</h3>
            <p>{t("ai.welcomeText")}</p>
            <div className="suggestions">
              {SUGGESTIONS.map(([title, prompt]) => (
                <button key={title} className="suggestion" onClick={() => send(t(prompt))} disabled={busy || missingKey}>
                  <strong>{t(title)}</strong>
                  <span>{t(prompt)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
            {!!m.mcpCalls?.length && (
              <div className="mcp-calls">
                {m.mcpCalls.map((c, j) => (
                  <span key={j} className="chip">
                    <Plug size={11} /> {c}
                  </span>
                ))}
              </div>
            )}
            {m.text ||
              (busy && i === messages.length - 1 ? (
                <span className="typing">
                  <i />
                  <i />
                  <i />
                </span>
              ) : null)}
            {!!m.edits && (
              <div className="edits">
                <Layers size={11} /> {tc("ai.edits", m.edits)}
              </div>
            )}
          </div>
        ))}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        {selectionCount > 0 && (
          <div className="context-chip">
            <Layers size={11} /> {tc("ai.selected", selectionCount)}
          </div>
        )}
        <div className="composer-box">
          <textarea
            ref={inputRef}
            value={input}
            aria-label={selectionCount ? t("ai.placeholderSelection") : t("ai.placeholder")}
            placeholder={selectionCount ? t("ai.placeholderSelection") : t("ai.placeholder")}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          {busy ? (
            <button type="button" className="send stop" title={t("ai.stop")} onClick={() => abortRef.current?.abort()}>
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" className="send" title={`${t("ai.send")} (Enter)`} disabled={!input.trim()}>
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<AiEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith("data: ")) yield JSON.parse(chunk.slice(6)) as AiEvent;
    }
  }
}
