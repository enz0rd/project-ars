import type { LiveEvent, LiveSnapshot } from "../shared/types.ts";
import { useEditor } from "./store.ts";

export interface LiveStatus {
  connected: boolean;
  /** This editor is the one MCP clients (Claude Code, Claude Desktop) read and edit. */
  target: boolean;
}

/**
 * Keeps the server's copy of this editor's document in sync so MCP clients can
 * read it, and applies the edits they make. With several editors open, MCP
 * acts on the one used most recently.
 */
export function connectLive(onStatus: (status: LiveStatus) => void): () => void {
  let clientId: string | null = null;
  let rev = 0;
  let target = false;
  let pushTimer: ReturnType<typeof setTimeout> | undefined;

  const push = () => {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      if (!clientId) return;
      const { docName, nodes, selection } = useEditor.getState();
      const body: LiveSnapshot = { clientId, rev, name: docName, nodes, selection };
      fetch("/api/live/document", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    }, 150);
  };

  const source = new EventSource("/api/live");
  source.onerror = () => {
    clientId = null;
    target = false;
    onStatus({ connected: false, target });
  };
  source.onmessage = (msg) => {
    const event = JSON.parse(msg.data) as LiveEvent;
    const state = useEditor.getState();
    if (event.type === "hello") {
      // A new connection (also after a server restart) starts a fresh session.
      clientId = event.clientId;
      rev = 0;
      onStatus({ connected: true, target });
      push();
    } else if (event.type === "ops") {
      rev = event.rev;
      // Each MCP tool call is one undo step.
      state.checkpoint();
      state.applyOps(event.ops);
    } else if (event.type === "select") {
      state.select(event.ids);
    } else if (event.type === "target") {
      target = event.active;
      onStatus({ connected: true, target });
    }
  };

  const unsubscribe = useEditor.subscribe((s, prev) => {
    if (s.nodes !== prev.nodes || s.selection !== prev.selection || s.docName !== prev.docName) push();
  });
  // Coming back to this tab makes it the MCP target again.
  window.addEventListener("focus", push);

  return () => {
    unsubscribe();
    window.removeEventListener("focus", push);
    source.close();
    clearTimeout(pushTimer);
  };
}
