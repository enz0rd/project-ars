import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import type { AiEvent, AiRequest } from "../shared/types.ts";
import { runDesignAgent } from "./ai.ts";

const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/ai", async (req, res) => {
  const body = req.body as AiRequest;
  if (!body?.prompt || !body.document) {
    res.status(400).json({ error: "prompt and document are required" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const emit = (e: AiEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);

  const abort = new AbortController();
  res.on("close", () => abort.abort());

  try {
    await runDesignAgent(body, emit, abort.signal);
  } catch (err) {
    if (!abort.signal.aborted) emit({ type: "error", message: describeError(err) });
  } finally {
    emit({ type: "done" });
    res.end();
  }
});

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Chave da API inválida ou ausente (ANTHROPIC_API_KEY).";
  if (err instanceof Anthropic.RateLimitError) return "Limite de requisições atingido — tente novamente em instantes.";
  if (err instanceof Anthropic.BadRequestError) return `Requisição inválida: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Erro da API (${err.status}): ${err.message}`;
  console.error(err);
  return err instanceof Error ? err.message : String(err);
}

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`API on http://localhost:${port}`));
