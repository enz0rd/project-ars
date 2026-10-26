import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import type { AiEvent, AiRequest } from "../shared/types.ts";
import { runDesignAgent } from "./ai.ts";
import { rateLimit, requireAccessToken, requireUser } from "./auth.ts";
import { UserError } from "./errors.ts";
import { mcpNodeHandler } from "./mcp.ts";
import {
  addMcpServer,
  createAccessToken,
  deleteAccount,
  deleteAiKey,
  deleteMcpServer,
  publicSettings,
  revokeAccessToken,
  setAiProvider,
  setAnthropicKey,
  setMcpServerEnabled,
  setOpenAiProvider,
  testAiKey,
  type AiProvider,
} from "./secrets.ts";

/**
 * The API, shared by local development (server/index.ts) and the Vercel function
 * (scripts/build-vercel.mjs). Browsers authenticate with their Supabase session;
 * MCP clients with a personal access token. Errors carry short codes the UI translates.
 */
export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "4mb" }));
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) =>
    fn(req, res).catch(next);

const provider = (value: unknown): AiProvider => {
  if (value !== "anthropic" && value !== "openai") throw new UserError("invalid_provider");
  return value;
};

app.get("/api/health", (_req, res) => void res.json({ ok: true }));

// Settings — secrets are write-only: responses only say whether a key/token is set.
const me = express.Router();
me.use(requireUser);
me.get("/settings", wrap(async (req, res) => res.json(await publicSettings(req.user!.id))));
me.put("/ai/provider", wrap(async (req, res) => (await setAiProvider(req.user!.id, req.body?.provider), res.status(204).end())));
me.put(
  "/ai/anthropic",
  rateLimit("settings", 30, 3600),
  wrap(async (req, res) => (await setAnthropicKey(req.user!.id, String(req.body?.apiKey ?? "")), res.status(204).end())),
);
me.put(
  "/ai/openai",
  rateLimit("settings", 30, 3600),
  wrap(async (req, res) => (await setOpenAiProvider(req.user!.id, req.body ?? {}), res.status(204).end())),
);
me.delete("/ai/:provider", wrap(async (req, res) => (await deleteAiKey(req.user!.id, provider(req.params.provider)), res.status(204).end())));
me.post(
  "/ai/:provider/test",
  rateLimit("key-test", 20, 3600),
  wrap(async (req, res) => res.json(await testAiKey(req.user!.id, provider(req.params.provider), req.body ?? {}))),
);
me.post("/mcp-servers", wrap(async (req, res) => (await addMcpServer(req.user!.id, req.body ?? {}), res.status(204).end())));
me.patch(
  "/mcp-servers/:id",
  wrap(async (req, res) => (await setMcpServerEnabled(req.user!.id, String(req.params.id), !!req.body?.enabled), res.status(204).end())),
);
me.delete("/mcp-servers/:id", wrap(async (req, res) => (await deleteMcpServer(req.user!.id, String(req.params.id)), res.status(204).end())));
me.post(
  "/tokens",
  rateLimit("tokens", 20, 3600),
  wrap(async (req, res) => res.json(await createAccessToken(req.user!.id, String(req.body?.name ?? "")))),
);
me.delete("/tokens/:id", wrap(async (req, res) => (await revokeAccessToken(req.user!.id, String(req.params.id)), res.status(204).end())));
me.delete(
  "/",
  wrap(async (req, res) => {
    // Typed confirmation, so a stray request can't wipe an account.
    if (req.body?.confirm !== "DELETE") throw new UserError("confirmation_required");
    await deleteAccount(req.user!.id);
    res.status(204).end();
  }),
);
app.use("/api/me", me);

app.post(
  "/api/ai",
  requireUser,
  rateLimit("ai", 30, 600),
  wrap(async (req, res) => {
    const body = req.body as AiRequest;
    if (!body?.prompt || !Array.isArray(body.document?.nodes)) throw new UserError("bad_request");

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store", Connection: "keep-alive" });
    const emit = (e: AiEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    try {
      await runDesignAgent(req.user!.id, body, emit, abort.signal);
    } catch (err) {
      if (!abort.signal.aborted) emit({ type: "error", message: describeAiError(err) });
    } finally {
      emit({ type: "done" });
      res.end();
    }
  }),
);

function describeAiError(err: unknown): string {
  if (err instanceof UserError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "key_rejected";
  if (err instanceof Anthropic.RateLimitError) return "provider_rate_limited";
  if (err instanceof Anthropic.PermissionDeniedError) return "provider_forbidden";
  if (err instanceof Anthropic.APIError) return `provider_error: ${err.status} ${err.message}`;
  console.error(err);
  return "internal_error";
}

// MCP for Claude Code, Cursor, Codex, Gemini CLI… (personal access token)
app.all("/mcp", requireAccessToken, rateLimit("mcp", 300, 60), (req, res) => void mcpNodeHandler(req, res, req.body));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return void res.end();
  if (err instanceof UserError) return void res.status(400).json({ error: err.message });
  if ((err as { type?: string })?.type === "entity.too.large") return void res.status(413).json({ error: "too_large" });
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});
