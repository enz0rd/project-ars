import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.ts";

let admin: SupabaseClient | undefined;

/** Service-role client: bypasses row level security, so every query must filter by user itself. */
export function db(): SupabaseClient {
  admin ??= createClient(env.supabaseUrl, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return admin;
}

/** Like must, for queries that return rows. */
export function rows<T>(res: { data: T[] | null; error: { message: string; code?: string } | null }): T[] {
  return must(res) ?? [];
}

/** Throws on a Supabase error, returning the data otherwise. */
export function must<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code });
  return res.data;
}
