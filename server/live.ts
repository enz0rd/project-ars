import express from "express";
import { applyOp, type DocOp, type LiveEvent, type LiveSnapshot } from "../shared/types.ts";
import type { DocTarget } from "./docTools.ts";

/**
 * Bridge between the editor open in the browser and server-side editors (MCP).
 * The browser pushes a snapshot after each local change; edits made here are
 * applied to the snapshot and streamed to every open editor over SSE.
 */
let snapshot: LiveSnapshot | null = null;
let rev = 0;
const clients = new Set<express.Response>();

export const liveRouter = express.Router();

liveRouter.get("/", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  clients.add(res);
  send(res, { type: "hello", rev });
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

liveRouter.put("/document", (req, res) => {
  const body = req.body as LiveSnapshot;
  if (!Array.isArray(body?.nodes) || typeof body.rev !== "number") {
    res.status(400).json({ error: "invalid snapshot" });
    return;
  }
  // An editor that hasn't applied our latest ops yet would overwrite them.
  if (body.rev >= rev) snapshot = { rev, name: String(body.name ?? ""), nodes: body.nodes, selection: body.selection ?? [] };
  res.status(204).end();
});

/** The live document, or null when no editor is open. */
export function liveSnapshot(): LiveSnapshot | null {
  return clients.size ? snapshot : null;
}

export const liveDoc: DocTarget = {
  nodes: () => snapshot?.nodes ?? [],
  apply: (ops: DocOp[]) => {
    if (!snapshot || !ops.length) return;
    rev++;
    snapshot = { ...snapshot, rev, nodes: ops.reduce(applyOp, snapshot.nodes) };
    broadcast({ type: "ops", rev, ops });
  },
};

export function setLiveSelection(ids: string[]) {
  if (!snapshot) return;
  snapshot = { ...snapshot, selection: ids };
  broadcast({ type: "select", ids });
}

function broadcast(event: LiveEvent) {
  for (const res of clients) send(res, event);
}

function send(res: express.Response, event: LiveEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
