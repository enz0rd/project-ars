import { create } from "zustand";

export type Theme = "light" | "dark";
export type RightTab = "design" | "layers" | "claude";

interface UiState {
  theme: Theme;
  rightTab: RightTab;
  shortcutsOpen: boolean;
  contextMenu: { x: number; y: number } | null;
  /** Canvas size in screen pixels, for zoom-to-fit. */
  canvasSize: { width: number; height: number };
  toast: { id: number; text: string } | null;
  /** Bumped to ask the Claude composer to take focus. */
  focusComposer: number;
  prototypeOpen: boolean;

  setTheme: (theme: Theme) => void;
  setRightTab: (tab: RightTab) => void;
  setShortcutsOpen: (open: boolean) => void;
  setContextMenu: (menu: { x: number; y: number } | null) => void;
  setCanvasSize: (size: { width: number; height: number }) => void;
  showToast: (text: string) => void;
  askClaude: () => void;
  setPrototypeOpen: (open: boolean) => void;
}

const THEME_KEY = "ars:theme";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // storage unavailable
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export const useUi = create<UiState>((set) => ({
  theme: initialTheme(),
  rightTab: "design",
  shortcutsOpen: false,
  contextMenu: null,
  canvasSize: { width: 800, height: 600 },
  toast: null,
  focusComposer: 0,
  prototypeOpen: false,

  setTheme: (theme) => {
    set({ theme });
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // storage unavailable
    }
  },
  setRightTab: (rightTab) => set({ rightTab }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setContextMenu: (contextMenu) => set({ contextMenu }),
  setCanvasSize: (canvasSize) => set({ canvasSize }),
  showToast: (text) => {
    const id = Date.now();
    set({ toast: { id, text } });
    setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : s)), 2200);
  },
  askClaude: () => set((s) => ({ rightTab: "claude", focusComposer: s.focusComposer + 1 })),
  setPrototypeOpen: (prototypeOpen) => set({ prototypeOpen }),
}));
