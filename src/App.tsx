import { useEffect } from "react";
import * as actions from "./actions.ts";
import { Canvas, isTyping } from "./components/Canvas.tsx";
import { ContextMenu } from "./components/ContextMenu.tsx";
import { LayersPanel } from "./components/LayersPanel.tsx";
import { RightPanel } from "./components/RightPanel.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { ShortcutsDialog } from "./components/ShortcutsDialog.tsx";
import { Toast } from "./components/Toast.tsx";
import { TOOL_KEYS, ToolDock } from "./components/ToolDock.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { ZoomControls } from "./components/ZoomControls.tsx";
import { connectLive } from "./live.ts";
import { useSettings } from "./settings.ts";
import { useEditor } from "./store.ts";
import { useUi } from "./ui.ts";

const ALIGN_KEYS: Record<string, actions.AlignKind> = {
  KeyA: "left",
  KeyD: "right",
  KeyW: "top",
  KeyS: "bottom",
  KeyH: "hcenter",
  KeyV: "vcenter",
};

export function App() {
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    useSettings.getState().refresh().catch(() => {});
    return connectLive((live) => useSettings.setState({ live }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (isTyping(e) || useSettings.getState().open || ui.shortcutsOpen) return;
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const handled = () => e.preventDefault();

      if (mod && key === "k") return handled(), ui.askClaude();
      if (mod && key === "z") return handled(), e.shiftKey ? s.redo() : s.undo();
      if (mod && key === "y") return handled(), s.redo();
      if (mod && key === "c") return handled(), actions.copy();
      if (mod && key === "x") return handled(), actions.cut();
      if (mod && key === "v") return handled(), actions.paste();
      if (mod && key === "d") return handled(), s.duplicateSelection();
      if (mod && key === "a") return handled(), actions.selectAll();
      if (mod && e.shiftKey && key === "h") return handled(), actions.toggleSelection("visible");
      if (mod && e.shiftKey && key === "l") return handled(), actions.toggleSelection("locked");
      if (mod && e.code === "BracketRight") return handled(), actions.zOrder(e.shiftKey ? "front" : "forward");
      if (mod && e.code === "BracketLeft") return handled(), actions.zOrder(e.shiftKey ? "back" : "backward");
      if (mod && (key === "=" || key === "+")) return handled(), actions.zoomBy(1.25);
      if (mod && key === "-") return handled(), actions.zoomBy(1 / 1.25);
      if (mod && key === "0") return handled(), actions.setZoom(1);
      if (e.altKey && !mod && ALIGN_KEYS[e.code]) return handled(), actions.align(ALIGN_KEYS[e.code]);
      if (e.shiftKey && !mod && e.code === "Digit1") return handled(), actions.zoomToFit();
      if (e.shiftKey && !mod && e.code === "Digit2") return handled(), actions.zoomToSelection();
      if (e.shiftKey && !mod && e.code === "Digit0") return handled(), actions.setZoom(1);
      if (key === "?") return handled(), ui.setShortcutsOpen(true);
      if (key === "delete" || key === "backspace") return handled(), s.deleteSelection();
      if (key === "escape") {
        ui.setContextMenu(null);
        s.select([]);
        s.setTool("select");
        return;
      }
      if (key.startsWith("arrow") && s.selection.length) {
        handled();
        const step = e.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        s.checkpoint();
        s.updateNodes(s.selection, (n) => (n.locked ? {} : { x: n.x + dx, y: n.y + dy }));
        return;
      }
      if (!mod && !e.altKey && TOOL_KEYS[key]) s.setTool(TOOL_KEYS[key]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <LayersPanel />
        <main className="stage">
          <Canvas />
          <ToolDock />
          <ZoomControls />
        </main>
        <RightPanel />
      </div>
      <SettingsModal />
      <ShortcutsDialog />
      <ContextMenu />
      <Toast />
    </div>
  );
}
