import type { Session } from "@supabase/supabase-js";
import { create } from "zustand";
import { supabase } from "./lib/supabase.ts";

interface AuthState {
  /** False until the stored session has been read. */
  ready: boolean;
  session: Session | null;
  /** Set when the user followed a password-reset link and must choose a new password. */
  recovering: boolean;
}

export const useAuth = create<AuthState>(() => ({ ready: false, session: null, recovering: false }));

supabase.auth.getSession().then(({ data }) => useAuth.setState({ ready: true, session: data.session }));
supabase.auth.onAuthStateChange((event, session) => {
  useAuth.setState({ ready: true, session, ...(event === "PASSWORD_RECOVERY" && { recovering: true }) });
});

export const userId = () => useAuth.getState().session?.user.id ?? null;
