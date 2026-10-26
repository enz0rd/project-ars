import { useSyncExternalStore } from "react";

/** A tiny pushState router: the app has only a handful of screens. */
export type Route =
  | { name: "dashboard" }
  | { name: "editor"; id: string }
  | { name: "login" }
  | { name: "signup" }
  | { name: "forgot" }
  | { name: "reset" };

export function parse(path: string): Route {
  const editor = /^\/p\/([0-9a-f-]{36})\/?$/i.exec(path);
  if (editor) return { name: "editor", id: editor[1] };
  if (path === "/login") return { name: "login" };
  if (path === "/signup") return { name: "signup" };
  if (path === "/forgot") return { name: "forgot" };
  if (path === "/reset") return { name: "reset" };
  return { name: "dashboard" };
}

const listeners = new Set<() => void>();
window.addEventListener("popstate", () => listeners.forEach((l) => l()));

export function navigate(path: string, replace = false) {
  if (path === location.pathname) return;
  history[replace ? "replaceState" : "pushState"](null, "", path);
  listeners.forEach((l) => l());
}

export function useRoute(): Route {
  const path = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => location.pathname,
  );
  return parse(path);
}

/** For <a href> that should navigate without reloading. */
export function linkProps(path: string) {
  return {
    href: path,
    onClick: (e: React.MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      navigate(path);
    },
  };
}
