import Anthropic from "@anthropic-ai/sdk";
import { assertPublicHost, fetchPublicUrl } from "./assets.ts";
import { decryptSecret, encryptSecret, newAccessToken } from "./crypto.ts";
import { UserError } from "./errors.ts";
import { db, must, rows } from "./supabase.ts";

/** Per-user secrets and integrations. Plaintext secrets never leave the server. */

const ANTHROPIC_KEY = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

export type AiProvider = "anthropic" | "openai";

/** The in-app assistant's provider, with decrypted credentials. */
export type AiConfig =
  | { provider: "anthropic"; apiKey: string }
  | { provider: "openai"; apiKey: string; baseUrl: string; model: string };

const SECRET_COLUMNS =
  "ai_provider, anthropic_key_enc, anthropic_key_last4, openai_base_url, openai_model, openai_key_enc, openai_key_last4";

async function secretsRow(userId: string) {
  return must(await db().from("user_secrets").select(SECRET_COLUMNS).eq("user_id", userId).maybeSingle());
}

async function saveSecrets(userId: string, patch: Record<string, unknown>) {
  must(await db().from("user_secrets").upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }));
}

/** Null when the chosen provider isn't set up yet. */
export async function getAiConfig(userId: string): Promise<AiConfig | null> {
  const row = await secretsRow(userId);
  if (!row) return null;
  if (row.ai_provider === "openai") {
    if (!row.openai_key_enc || !row.openai_base_url || !row.openai_model) return null;
    return {
      provider: "openai",
      apiKey: decryptSecret(row.openai_key_enc, userId),
      baseUrl: row.openai_base_url,
      model: row.openai_model,
    };
  }
  return row.anthropic_key_enc ? { provider: "anthropic", apiKey: decryptSecret(row.anthropic_key_enc, userId) } : null;
}

export async function setAnthropicKey(userId: string, key: string) {
  key = key.trim();
  if (!ANTHROPIC_KEY.test(key)) throw new UserError("invalid_key_format");
  await saveSecrets(userId, { anthropic_key_enc: encryptSecret(key, userId), anthropic_key_last4: key.slice(-4) });
}

/** OpenAI-compatible provider: base URL (https, public host) and model; the key is optional when keeping the saved one. */
export async function setOpenAiProvider(userId: string, input: { baseUrl?: unknown; model?: unknown; apiKey?: unknown }) {
  const baseUrl = await checkBaseUrl(String(input.baseUrl ?? ""));
  const model = String(input.model ?? "").trim();
  if (!model || model.length > 120) throw new UserError("invalid_model");
  const key = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (key && key.length < 8) throw new UserError("invalid_key_format");
  await saveSecrets(userId, {
    openai_base_url: baseUrl,
    openai_model: model,
    ...(key && { openai_key_enc: encryptSecret(key, userId), openai_key_last4: key.slice(-4) }),
  });
}

export async function setAiProvider(userId: string, provider: unknown) {
  if (provider !== "anthropic" && provider !== "openai") throw new UserError("invalid_provider");
  await saveSecrets(userId, { ai_provider: provider });
}

export async function deleteAiKey(userId: string, provider: AiProvider) {
  await saveSecrets(
    userId,
    provider === "anthropic"
      ? { anthropic_key_enc: null, anthropic_key_last4: null }
      : { openai_key_enc: null, openai_key_last4: null },
  );
}

/** Checks a key against the provider without storing it (or the saved key when none is given). */
export async function testAiKey(userId: string, provider: AiProvider, input: { apiKey?: string; baseUrl?: string } = {}) {
  const row = await secretsRow(userId);
  const saved = (enc?: string | null) => (enc ? decryptSecret(enc, userId) : null);
  if (provider === "anthropic") {
    const key = input.apiKey?.trim() || saved(row?.anthropic_key_enc);
    if (!key) throw new UserError("no_key");
    try {
      await new Anthropic({ apiKey: key }).models.list({ limit: 1 });
      return { ok: true };
    } catch (err) {
      const status = err instanceof Anthropic.APIError ? err.status : undefined;
      return { ok: false, error: status === 401 ? "key_rejected" : "key_check_failed" };
    }
  }
  const key = input.apiKey?.trim() || saved(row?.openai_key_enc);
  if (!key) throw new UserError("no_key");
  const baseUrl = await checkBaseUrl(input.baseUrl || row?.openai_base_url || "");
  const res = await fetchPublicUrl(new URL(`${baseUrl}/models`), {
    headers: { Authorization: `Bearer ${key}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (res?.ok) return { ok: true };
  return { ok: false, error: res && (res.status === 401 || res.status === 403) ? "key_rejected" : "key_check_failed" };
}

/** https only, and never an internal address: the server calls this URL with the user's key. */
export async function checkBaseUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UserError("invalid_base_url");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new UserError("invalid_base_url");
  await assertPublicHost(url.hostname).catch(() => {
    throw new UserError("invalid_base_url");
  });
  return url.toString().replace(/\/$/, "");
}

// Remote MCP servers for the in-app agent

export interface McpServerConfig {
  name: string;
  url: string;
  authorizationToken?: string;
}

export async function enabledMcpServers(userId: string): Promise<McpServerConfig[]> {
  const servers = rows(await db().from("mcp_servers").select("name, url, token_enc").eq("user_id", userId).eq("enabled", true));
  return servers.map((r) => ({
    name: r.name,
    url: r.url,
    ...(r.token_enc && { authorizationToken: decryptSecret(r.token_enc, userId) }),
  }));
}

export async function addMcpServer(userId: string, input: { name?: unknown; url?: unknown; authorizationToken?: unknown }) {
  const name = String(input.name ?? "").trim();
  const url = String(input.url ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new UserError("invalid_server_name");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UserError("invalid_server_url");
  }
  if (parsed.protocol !== "https:") throw new UserError("invalid_server_url");
  const token = typeof input.authorizationToken === "string" ? input.authorizationToken.trim() : "";
  const { error } = await db()
    .from("mcp_servers")
    .insert({ user_id: userId, name, url: parsed.toString(), token_enc: token ? encryptSecret(token, userId) : null });
  if (error?.code === "23505") throw new UserError("duplicate_server_name");
  if (error) throw new Error(error.message);
}

export async function setMcpServerEnabled(userId: string, id: string, enabled: boolean) {
  must(await db().from("mcp_servers").update({ enabled }).eq("id", id).eq("user_id", userId));
}

export async function deleteMcpServer(userId: string, id: string) {
  must(await db().from("mcp_servers").delete().eq("id", id).eq("user_id", userId));
}

// Personal access tokens (MCP clients)

const MAX_TOKENS = 10;

export async function createAccessToken(userId: string, name: string) {
  name = name.trim().slice(0, 60) || "Agent";
  const { count } = await db()
    .from("mcp_tokens")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if ((count ?? 0) >= MAX_TOKENS) throw new UserError("too_many_tokens");
  const { token, hash, hint } = newAccessToken();
  const row = must(
    await db().from("mcp_tokens").insert({ user_id: userId, name, token_hash: hash, hint }).select("id").single(),
  )!;
  // The only time the token itself is returned.
  return { id: row.id, token, hint, name };
}

export async function revokeAccessToken(userId: string, id: string) {
  must(
    await db().from("mcp_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId),
  );
}

/** What the settings screen shows: no secret values, only whether they exist. */
export async function publicSettings(userId: string) {
  const [secret, servers, tokens] = await Promise.all([
    db().from("user_secrets").select(SECRET_COLUMNS).eq("user_id", userId).maybeSingle(),
    db().from("mcp_servers").select("id, name, url, enabled, token_enc").eq("user_id", userId).order("created_at"),
    db()
      .from("mcp_tokens")
      .select("id, name, hint, created_at, last_used_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("created_at"),
  ]);
  return {
    ai: {
      provider: (secret.data?.ai_provider ?? "anthropic") as AiProvider,
      anthropic: { configured: !!secret.data?.anthropic_key_enc, last4: secret.data?.anthropic_key_last4 ?? null },
      openai: {
        configured: !!secret.data?.openai_key_enc,
        last4: secret.data?.openai_key_last4 ?? null,
        baseUrl: secret.data?.openai_base_url ?? null,
        model: secret.data?.openai_model ?? null,
      },
    },
    mcpServers: rows(servers).map(({ token_enc, ...s }) => ({ ...s, hasToken: !!token_enc })),
    tokens: rows(tokens),
  };
}

/** Deletes the account: images first (storage has no cascade), then the user (rows cascade). */
export async function deleteAccount(userId: string) {
  const storage = db().storage.from("assets");
  for (;;) {
    const files = rows(await storage.list(userId, { limit: 1000 }));
    if (!files.length) break;
    must(await storage.remove(files.map((f) => `${userId}/${f.name}`)));
  }
  const { error } = await db().auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
}
