import { Circle, Frame, Hand, MousePointer2, Redo2, Sparkles, Square, Type, Undo2 } from "lucide-react";
import { useEditor, type Tool } from "../store.ts";
import { useUi } from "../ui.ts";

export const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { tool: "select", label: "Mover", key: "V", icon: <MousePointer2 size={17} /> },
  { tool: "hand", label: "Mão", key: "H", icon: <Hand size={17} /> },
  { tool: "frame", label: "Frame", key: "F", icon: <Frame size={17} /> },
  { tool: "rect", label: "Retângulo", key: "R", icon: <Square size={17} /> },
  { tool: "ellipse", label: "Elipse", key: "O", icon: <Circle size={17} /> },
  { tool: "text", label: "Texto", key: "T", icon: <Type size={17} /> },
];

export const TOOL_KEYS = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.tool]));

/** Floating toolbar at the bottom of the canvas. */
export function ToolDock() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const askClaude = useUi((s) => s.askClaude);

  return (
    <div className="dock" role="toolbar" aria-label="Ferramentas">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={`dock-btn ${tool === t.tool ? "active" : ""}`}
          title={`${t.label} (${t.key})`}
          aria-pressed={tool === t.tool}
          onClick={() => setTool(t.tool)}
        >
          {t.icon}
        </button>
      ))}
      <span className="dock-sep" />
      <button className="dock-btn" title="Desfazer (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
        <Undo2 size={17} />
      </button>
      <button className="dock-btn" title="Refazer (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
        <Redo2 size={17} />
      </button>
      <span className="dock-sep" />
      <button className="dock-ai" title="Perguntar ao Claude (Ctrl+K)" onClick={askClaude}>
        <Sparkles size={15} /> Claude
      </button>
    </div>
  );
}
