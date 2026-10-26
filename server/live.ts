import express from "express";
import { applyOp, uid, type DocOp, type LiveEvent, type LiveSnapshot } from "../shared/types.ts";
import type { DocTarget } from "./docTools.ts";

/**
 * Bridge between editors open in the browser and server-side editors (MCP).
 * Each open editor is a client that pushes a snapshot after every local change.
 * MCP tools act on the most recently active editor only, and their edits are
 * streamed back to that editor over SSE.
 */
interface Client {
  res: express.Response;
  snapshot: LiveSnapshot | null;
  /** Number of op batches sent to this client. */
  rev: number;
  activeAt: number;
}

const clients = new Map<string, Client>();
let targetId: string | null = null;

export const liveRouter = express.Router();

liveRouter.get("/", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const clientId = uid();
  clients.set(clientId, { res, snapshot: null, rev: 0, activeAt: 0 });
  send(clientId, { type: "hello", clientId });
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(clientId);
    updateTarget();
  });
});

liveRouter.put("/document", (req, res) => {
  const body = req.body as LiveSnapshot;
  const client = clients.get(body?.clientId);
  if (!client) {
    res.status(404).json({ error: "unknown editor" });
    return;
  }
  if (!Array.isArray(body.nodes) || typeof body.rev !== "number") {
    res.status(400).json({ error: "invalid snapshot" });
    return;
  }
  // An editor that hasn't applied our latest ops yet would overwrite them.
  if (body.rev >= client.rev) {
    client.snapshot = { ...body, rev: client.rev, name: String(body.name ?? ""), selection: body.selection ?? [] };
  }
  client.activeAt = Date.now();
  updateTarget();
  res.status(204).end();
});

/** The editor MCP tools act on: the most recently active one with a document. */
function target(): [string, Client & { snapshot: LiveSnapshot }] | null {
  const id = targetId && clients.get(targetId)?.snapshot ? targetId : null;
  return id ? [id, clients.get(id) as Client & { snapshot: LiveSnapshot }] : null;
}

function updateTarget() {
  let best: string | null = null;
  for (const [id, c] of clients) {
    if (c.snapshot && (!best || c.activeAt > clients.get(best)!.activeAt)) best = id;
  }
  if (best === targetId) return;
  const previous = targetId;
  targetId = best;
  if (previous && clients.has(previous)) send(previous, { type: "target", active: false });
  if (best) send(best, { type: "target", active: true });
}

/** The live document, or null when no editor is open. */
export function liveSnapshot(): LiveSnapshot | null {
  return target()?.[1].snapshot ?? null;
}

export const liveDoc: DocTarget = {
  nodes: () => liveSnapshot()?.nodes ?? [],
  apply: (ops: DocOp[]) => {
    const t = target();
    if (!t || !ops.length) return;
    const [id, client] = t;
    client.rev++;
    client.snapshot = { ...client.snapshot, rev: client.rev, nodes: ops.reduce(applyOp, client.snapshot.nodes) };
    send(id, { type: "ops", rev: client.rev, ops });
  },
};

export function setLiveSelection(ids: string[]) {
  const t = target();
  if (!t) return;
  const [id, client] = t;
  client.snapshot = { ...client.snapshot, selection: ids };
  send(id, { type: "select", ids });
}

function send(clientId: string, event: LiveEvent) {
  clients.get(clientId)?.res.write(`data: ${JSON.stringify(event)}\n\n`);
}
