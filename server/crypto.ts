import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env.ts";

/**
 * Secrets at rest (Claude API keys, MCP server tokens): AES-256-GCM with a random
 * IV, and the owner's user id as associated data — a ciphertext copied into
 * another user's row fails to decrypt instead of leaking the key to them.
 * Format: "v1:" + base64(iv | tag | ciphertext). The version prefix allows
 * rotating to a new key or algorithm later.
 */
export function encryptSecret(plain: string, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", env.encryptionKey, iv);
  cipher.setAAD(Buffer.from(userId));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")}`;
}

export function decryptSecret(stored: string, userId: string): string {
  if (!stored.startsWith("v1:")) throw new Error("Unknown secret format");
  const raw = Buffer.from(stored.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", env.encryptionKey, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** Personal access tokens for MCP: "ars_" + 32 random bytes. Only the hash is stored. */
export function newAccessToken() {
  const token = `ars_${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token), hint: `ars_…${token.slice(-4)}` };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

