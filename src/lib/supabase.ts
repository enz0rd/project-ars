import { createClient } from "@supabase/supabase-js";

/**
 * Browser client. It uses the publishable (anon) key: everything it can reach is
 * limited by row level security to the signed-in user's own rows.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = !!url && !!key;

// `||`, not `??`: an empty value in .env must not crash the app before it can say so.
export const supabase = createClient(url || "http://localhost:54321", key || "missing-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});
