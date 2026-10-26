import { create } from "zustand";
import type { PublicSettings } from "../shared/types.ts";
import { api } from "./lib/api.ts";

export type SettingsTab = "account" | "ai" | "agents" | "mcp";

interface SettingsState {
  open: boolean;
  tab: SettingsTab;
  settings: PublicSettings | null;
  setOpen: (open: boolean, tab?: SettingsTab) => void;
  setTab: (tab: SettingsTab) => void;
  refresh: () => Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  open: false,
  tab: "account",
  settings: null,

  setOpen: (open, tab) => {
    set({ open, ...(tab && { tab }) });
    if (open) get().refresh().catch(() => {});
  },
  setTab: (tab) => set({ tab }),

  refresh: async () => {
    set({ settings: await api<PublicSettings>("GET", "/api/me/settings") });
  },
}));
