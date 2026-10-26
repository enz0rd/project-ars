import { create } from "zustand";
import type { PublicSettings } from "../shared/types.ts";
import type { LiveStatus } from "./live.ts";

interface SettingsState {
  open: boolean;
  /** This editor's connection to the server's live/MCP bridge. */
  live: LiveStatus;
  settings: PublicSettings | null;
  setOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
  /** Calls a settings endpoint; responses that return PublicSettings update the store. */
  call: <T = PublicSettings>(method: string, url: string, body?: unknown) => Promise<T>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  open: false,
  live: { connected: false, target: false },
  settings: null,

  setOpen: (open) => {
    set({ open });
    if (open) get().refresh().catch(() => {});
  },

  refresh: async () => {
    set({ settings: await get().call("GET", "/api/settings") });
  },

  call: async (method, url, body) => {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    if (data && "apiKey" in data && "mcpServers" in data) set({ settings: data });
    return data;
  },
}));
