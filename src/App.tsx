import { useEffect } from "react";
import { useAuth } from "./auth.ts";
import { useI18n, type Locale } from "./i18n/index.ts";
import { supabase } from "./lib/supabase.ts";
import { AuthPage } from "./pages/AuthPage.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { EditorPage } from "./pages/EditorPage.tsx";
import { navigate, useRoute } from "./router.ts";
import { useUi } from "./ui.ts";

const PUBLIC = new Set(["login", "signup", "forgot", "reset"]);

export function App() {
  const theme = useUi((s) => s.theme);
  const route = useRoute();
  const ready = useAuth((s) => s.ready);
  const session = useAuth((s) => s.session);
  const recovering = useAuth((s) => s.recovering);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Signed-out visitors go to the login screen; signed-in ones skip it.
  useEffect(() => {
    if (!ready) return;
    if (recovering && route.name !== "reset") navigate("/reset", true);
    else if (!session && !PUBLIC.has(route.name)) navigate("/login", true);
    else if (session && !recovering && (route.name === "login" || route.name === "signup")) navigate("/", true);
  }, [ready, session, recovering, route.name]);

  // The account's saved language wins over the browser's.
  useEffect(() => {
    const id = session?.user.id;
    if (!id) return;
    void supabase
      .from("profiles")
      .select("locale")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.locale && data.locale !== useI18n.getState().locale) useI18n.getState().setLocale(data.locale as Locale);
      });
  }, [session?.user.id]);

  if (!ready) return <div className="center-page" />;
  if (route.name === "login" || route.name === "signup" || route.name === "forgot" || route.name === "reset") {
    return <AuthPage mode={route.name} />;
  }
  if (!session) return <div className="center-page" />;
  if (route.name === "editor") return <EditorPage key={route.id} id={route.id} />;
  return <Dashboard />;
}
