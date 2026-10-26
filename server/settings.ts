import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { uid, type McpServerInput, type PublicSettings } from "../shared/types.ts";

/** Settings persisted on the server. Secrets in here never go back to the browser. */
interface StoredSettings {
  apiKey?: string;
  mcpServers: StoredMcpServer[];
}

export interface StoredMcpServer {
  id: string;
  name: string;
  url: string;
  authorizationToken?: string;
  enabled: boolean;
}

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
const FILE = path.join(DATA_DIR, "settings.json");

let cache: StoredSettings | undefined;

export async function getSettings(): Promise<StoredSettings> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(FILE, "utf8")) as StoredSettings;
  } catch {
    cache = { mcpServers: [] };
  }
  return cache;
}

async function save(next: StoredSettings) {
  await mkdir(DATA_DIR, { recursive: true });
  // Write to a temp file first so a crash never leaves a half-written settings file.
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, FILE);
  cache = next;
}

/** The key the app should use: the one saved from the settings screen, else ANTHROPIC_API_KEY. */
export async function resolveApiKey(): Promise<string | undefined> {
  return (await getSettings()).apiKey || process.env.ANTHROPIC_API_KEY || undefined;
}

export async function setApiKey(apiKey: string | undefined) {
  const s = await getSettings();
  await save({ ...s, apiKey: apiKey || undefined });
}

export async function addMcpServer(input: McpServerInput) {
  const s = await getSettings();
  validateMcp(input, s.mcpServers);
  const server: StoredMcpServer = {
    id: uid(),
    name: input.name.trim(),
    url: input.url.trim(),
    authorizationToken: input.authorizationToken?.trim() || undefined,
    enabled: input.enabled ?? true,
  };
  await save({ ...s, mcpServers: [...s.mcpServers, server] });
}

/** Partial update. An omitted authorizationToken keeps the stored one; an empty string clears it. */
export async function updateMcpServer(id: string, input: Partial<McpServerInput>) {
  const s = await getSettings();
  const current = s.mcpServers.find((m) => m.id === id);
  if (!current) throw new SettingsError("Servidor MCP não encontrado.", 404);
  const next: StoredMcpServer = {
    ...current,
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(input.url !== undefined && { url: input.url.trim() }),
    ...(input.enabled !== undefined && { enabled: input.enabled }),
    ...(input.authorizationToken !== undefined && { authorizationToken: input.authorizationToken.trim() || undefined }),
  };
  validateMcp(next, s.mcpServers.filter((m) => m.id !== id));
  await save({ ...s, mcpServers: s.mcpServers.map((m) => (m.id === id ? next : m)) });
}

export async function deleteMcpServer(id: string) {
  const s = await getSettings();
  await save({ ...s, mcpServers: s.mcpServers.filter((m) => m.id !== id) });
}

export async function publicSettings(): Promise<PublicSettings> {
  const s = await getSettings();
  const key = s.apiKey ?? process.env.ANTHROPIC_API_KEY;
  return {
    apiKey: {
      configured: !!key,
      source: s.apiKey ? "settings" : process.env.ANTHROPIC_API_KEY ? "env" : null,
      last4: key ? key.slice(-4) : null,
    },
    mcpServers: s.mcpServers.map(({ authorizationToken, ...m }) => ({ ...m, hasToken: !!authorizationToken })),
  };
}

export class SettingsError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function validateMcp(m: Pick<McpServerInput, "name" | "url">, others: StoredMcpServer[]) {
  const name = m.name?.trim() ?? "";
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    throw new SettingsError("Nome inválido: use 1–64 letras, números, '-' ou '_'.");
  }
  if (others.some((o) => o.name === name)) throw new SettingsError(`Já existe um servidor chamado "${name}".`);
  let url: URL;
  try {
    url = new URL(m.url?.trim() ?? "");
  } catch {
    throw new SettingsError("URL inválida.");
  }
  // The Anthropic API connects to the MCP server from its own infrastructure, so it must be public HTTPS.
  if (url.protocol !== "https:") throw new SettingsError("A URL do servidor MCP precisa usar https://.");
}
