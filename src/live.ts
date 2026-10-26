import type { LiveEvent, LiveSnapshot } from "../shared/types.ts";
import { useEditor } from "./store.ts";

/**
 * Keeps the server's copy of the document in sync so MCP clients (Claude Code,
 * Claude Desktop) can read it, and applies the edits they make.
 */
export function connectLive(onStatus: (connected: boolean) => void): () => void {
  let rev = 0;
  let pushTimer: ReturnType<typeof setTimeout> | undefined;

  const push = () => {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      const { docName, nodes, selection } = useEditor.getState();
      const body: LiveSnapshot = { rev, name: docName, nodes, selection };
      fetch("/api/live/document", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    }, 150);
  };

  const source = new EventSource("/api/live");
  source.onopen = () => onStatus(true);
  source.onerror = () => onStatus(false);
  source.onmessage = (msg) => {
    const event = JSON.parse(msg.data) as LiveEvent;
    const state = useEditor.getState();
    if (event.type === "hello") {
      rev = event.rev;
      push();
    } else if (event.type === "ops") {
      rev = event.rev;
      // Each MCP tool call is one undo step.
      state.checkpoint();
      state.applyOps(event.ops);
    } else if (event.type === "select") {
      state.select(event.ids);
    }
  };

  const unsubscribe = useEditor.subscribe((s, prev) => {
    if (s.nodes !== prev.nodes || s.selection !== prev.selection || s.docName !== prev.docName) push();
  });

  return () => {
    unsubscribe();
    source.close();
    clearTimeout(pushTimer);
  };
}
