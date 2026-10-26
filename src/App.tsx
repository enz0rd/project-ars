import { useEffect } from "react";
import { AiPanel } from "./components/AiPanel.tsx";
import { Canvas, isTyping } from "./components/Canvas.tsx";
import { LayersPanel } from "./components/LayersPanel.tsx";
import { PropertiesPanel } from "./components/PropertiesPanel.tsx";
import { TOOL_KEYS, Toolbar } from "./components/Toolbar.tsx";
import { useEditor } from "./store.ts";

export function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        s.redo();
      } else if (mod && key === "d") {
        e.preventDefault();
        s.duplicateSelection();
      } else if (mod && key === "a") {
        e.preventDefault();
        s.select(s.nodes.filter((n) => n.visible && !n.locked).map((n) => n.id));
      } else if (key === "delete" || key === "backspace") {
        s.deleteSelection();
      } else if (key === "escape") {
        s.select([]);
        s.setTool("select");
      } else if (key.startsWith("arrow") && s.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        s.checkpoint();
        s.updateNodes(s.selection, (n) => ({ x: n.x + dx, y: n.y + dy }));
      } else if (!mod && TOOL_KEYS[key]) {
        s.setTool(TOOL_KEYS[key]);
      } else if (mod && key === "0") {
        e.preventDefault();
        s.setViewport({ x: 0, y: 0, zoom: 1 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <LayersPanel />
        <Canvas />
        <div className="right">
          <PropertiesPanel />
          <AiPanel />
        </div>
      </div>
    </div>
  );
}
