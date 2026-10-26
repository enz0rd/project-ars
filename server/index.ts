import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { localhostHostValidation, localhostOriginValidation } from "@modelcontextprotocol/node";
import express from "express";
import type { AiEvent, AiRequest } from "../shared/types.ts";
import { MODEL, MissingApiKeyError, createClient, runDesignAgent } from "./ai.ts";
import { liveRouter } from "./live.ts";
import { mcpNodeHandler } from "./mcp.ts";
import {
  SettingsError,
  addMcpServer,
  deleteMcpServer,
  publicSettings,
  setApiKey,
  updateMcpServer,
} from "./settings.ts";

const port = Number(process.env.PORT ?? 8787);
// Localhost only by default: these endpoints change the API key in use and edit the open document.
const host = process.env.HOST ?? "127.0.0.1";

const app = express();
// When bound to loopback, reject foreign Host headers (DNS rebinding) and requests from
// other websites' pages (Origin), for the API and the MCP endpoint alike.
if (["localhost", "127.0.0.1", "::1"].includes(host)) {
  const validHost = localhostHostValidation();
  const validOrigin = localhostOriginValidation();
  app.use((req, res, next) => {
    if (validHost(req, res) && validOrigin(req, res)) next();
  });
}
app.use(express.json({ limit: "10mb" }));

app.use("/api/live", liveRouter);
app.all("/mcp", (req, res) => void mcpNodeHandler(req, res, req.body));

app.get("/api/health", (_req, res) => {
  const mcpHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  res.json({ ok: true, mcpUrl: `http://${mcpHost}:${port}/mcp` });
});

// Settings — secrets are write-only: responses only say whether a key/token is set.
app.get("/api/settings", async (_req, res) => {
  res.json(await publicSettings());
});

app.put("/api/settings/api-key", async (req, res) => {
  const apiKey = String(req.body?.apiKey ?? "").trim();
  if (!apiKey) throw new SettingsError("Informe a chave da API.");
  await setApiKey(apiKey);
  res.json(await publicSettings());
});

app.delete("/api/settings/api-key", async (_req, res) => {
  await setApiKey(undefined);
  res.json(await publicSettings());
});

/** Checks a key (the one sent, or the configured one) without spending tokens. */
app.post("/api/settings/api-key/test", async (req, res) => {
  const candidate = String(req.body?.apiKey ?? "").trim() || undefined;
  try {
    const client = await createClient(candidate);
    await client.models.retrieve(MODEL);
    res.json({ ok: true, message: `Chave válida — ${MODEL} disponível.` });
  } catch (err) {
    res.json({ ok: false, message: describeError(err) });
  }
});

app.post("/api/settings/mcp", async (req, res) => {
  await addMcpServer(req.body ?? {});
  res.json(await publicSettings());
});

app.patch("/api/settings/mcp/:id", async (req, res) => {
  await updateMcpServer(req.params.id, req.body ?? {});
  res.json(await publicSettings());
});

app.delete("/api/settings/mcp/:id", async (req, res) => {
  await deleteMcpServer(req.params.id);
  res.json(await publicSettings());
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
  if (err instanceof MissingApiKeyError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "Chave da API inválida — confira nas configurações (⚙).";
  if (err instanceof Anthropic.RateLimitError) return "Limite de requisições atingido — tente novamente em instantes.";
  if (err instanceof Anthropic.PermissionDeniedError) return "A chave não tem permissão para este modelo ou recurso.";
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

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof SettingsError) res.status(err.status).json({ error: err.message });
  else {
    console.error(err);
    res.status(500).json({ error: "Erro interno." });
  }
});

app.listen(port, host, () => console.log(`API on http://${host}:${port}`));
