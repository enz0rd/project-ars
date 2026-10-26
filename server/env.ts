/** Server configuration, read lazily so builds and tests don't need real secrets. */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

let encryptionKey: Buffer | undefined;

export const env = {
  get supabaseUrl() {
    return required("SUPABASE_URL").replace(/\/$/, "");
  },
  /** Bypasses row level security: server-only, never expose it to the browser. */
  get serviceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  /** 32 random bytes, base64. Encrypts users' Claude API keys and MCP server tokens. */
  get encryptionKey(): Buffer {
    if (!encryptionKey) {
      encryptionKey = Buffer.from(required("ARS_ENCRYPTION_KEY"), "base64");
      if (encryptionKey.length !== 32) throw new Error("ARS_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    }
    return encryptionKey;
  },
  model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  effort: (process.env.CLAUDE_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max",
  /**
   * Lets MCP's import_image read files from the server's disk. Only for a
   * single-user install on your own machine — never on a shared deployment.
   */
  allowLocalFiles: process.env.ARS_ALLOW_LOCAL_FILES === "1",
};
