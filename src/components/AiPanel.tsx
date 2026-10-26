import { useEffect, useRef, useState } from "react";
import type { AiChatTurn, AiEvent, AiRequest } from "../../shared/types.ts";
import { useEditor } from "../store.ts";

interface ChatMessage extends AiChatTurn {
  error?: boolean;
  edits?: number;
}

const SUGGESTIONS = [
  "Crie uma tela de login mobile",
  "Monte um card de preço com 3 planos",
  "Deixe a seleção com cantos arredondados e sombra suave",
];

export function AiPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = async (prompt: string) => {
    prompt = prompt.trim();
    if (!prompt || busy) return;
    const state = useEditor.getState();
    const body: AiRequest = {
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

    // One undo step for everything Claude does in this turn.
    state.checkpoint();
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      for await (const event of readSse(res.body)) {
        if (event.type === "text") patchLast((m) => ({ ...m, text: m.text + event.text }));
        else if (event.type === "op") {
          useEditor.getState().applyOps([event.op]);
          patchLast((m) => ({ ...m, edits: (m.edits ?? 0) + 1 }));
        } else if (event.type === "error") patchLast((m) => ({ ...m, text: event.message, error: true }));
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        patchLast((m) => ({ ...m, text: `Falha ao falar com o servidor: ${(err as Error).message}`, error: true }));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <aside className="panel ai">
      <div className="panel-title">
        Claude <span className="badge">IA</span>
        {messages.length > 0 && (
          <button className="link-btn" onClick={() => setMessages([])} disabled={busy}>
            Limpar
          </button>
        )}
      </div>

      <div className="chat" ref={listRef}>
        {messages.length === 0 && (
          <div className="suggestions">
            <p className="muted">Descreva o que quer desenhar ou alterar. O Claude edita o canvas ao vivo.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
            {m.text || (busy && i === messages.length - 1 ? <span className="typing">Pensando…</span> : null)}
            {!!m.edits && <div className="edits">{m.edits} alteraç{m.edits === 1 ? "ão" : "ões"} no canvas</div>}
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
        <textarea
          value={input}
          placeholder="Peça algo ao Claude…"
          rows={3}
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
          <button type="button" className="primary" onClick={() => abortRef.current?.abort()}>
            Parar
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!input.trim()}>
            Enviar
          </button>
        )}
      </form>
    </aside>
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
