import type { NextFunction, Request, Response } from "express";
import { hashToken } from "./crypto.ts";
import { db } from "./supabase.ts";

export interface AuthedUser {
  id: string;
  email?: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthedUser;
  }
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/**
 * Browser API routes: the Supabase session's access token, checked with the
 * Auth server on every call (so signed-out or deleted users are refused at once).
 */
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token || token.startsWith("ars_")) return void res.status(401).json({ error: "unauthorized" });
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) return void res.status(401).json({ error: "unauthorized" });
  req.user = { id: data.user.id, email: data.user.email };
  next();
}

/** MCP endpoint: a personal access token created in Settings → Agents. */
export async function requireAccessToken(req: Request, res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token?.startsWith("ars_")) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="ars"');
    return void res.status(401).json({ error: "Missing or invalid access token. Create one in Settings → Agents (MCP)." });
  }
  const { data } = await db()
    .from("mcp_tokens")
    .select("id, user_id, last_used_at")
    .eq("token_hash", hashToken(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="ars", error="invalid_token"');
    return void res.status(401).json({ error: "Invalid or revoked access token" });
  }
  // Record use at most every few minutes; it's shown in Settings.
  if (!data.last_used_at || Date.now() - Date.parse(data.last_used_at) > 5 * 60_000) {
    void db().from("mcp_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => {});
  }
  req.user = { id: data.user_id };
  // The MCP SDK hands this to the server factory (see server/mcp.ts).
  (req as Request & { auth?: unknown }).auth = { token: "", clientId: data.id, scopes: [], extra: { userId: data.user_id } };
  next();
}

/** Per-user fixed-window limit backed by Postgres (works across serverless instances). */
export function rateLimit(bucket: string, limit: number, windowSeconds: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { data, error } = await db().rpc("hit_rate_limit", {
      p_user: req.user!.id,
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) return next(error);
    if (data === false) {
      res.setHeader("Retry-After", String(windowSeconds));
      return void res.status(429).json({ error: "rate_limited" });
    }
    next();
  };
}
