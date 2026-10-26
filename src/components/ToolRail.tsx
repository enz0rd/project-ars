import { Circle, Hand, ImagePlus, MousePointer2, Redo2, Sparkles, Square, SquareDashed, Type, Undo2 } from "lucide-react";
import { pickImages } from "../actions.ts";
import { useT, type Key } from "../i18n/index.ts";
import { useEditor, type Tool } from "../store.ts";
import { useUi } from "../ui.ts";

export const TOOLS: { tool: Tool; label: Key; key: string; icon: React.ReactNode }[] = [
  { tool: "select", label: "tool.select", key: "V", icon: <MousePointer2 size={18} /> },
  { tool: "hand", label: "tool.hand", key: "H", icon: <Hand size={18} /> },
  { tool: "frame", label: "tool.artboard", key: "A", icon: <SquareDashed size={18} /> },
  { tool: "rect", label: "tool.rect", key: "R", icon: <Square size={18} /> },
  { tool: "ellipse", label: "tool.ellipse", key: "O", icon: <Circle size={18} /> },
  { tool: "text", label: "tool.text", key: "T", icon: <Type size={18} /> },
];

export const TOOL_KEYS = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.tool]));

/** Vertical tool rail on the left of the canvas. */
export function ToolRail() {
  const t = useT();
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const askAssistant = useUi((s) => s.askClaude);

  return (
    <nav className="rail" aria-label={t("tool.tools")}>
      {TOOLS.map((item) => (
        <button
          key={item.tool}
          className={`rail-btn ${tool === item.tool ? "active" : ""}`}
          title={`${t(item.label)} (${item.key})`}
          aria-pressed={tool === item.tool}
          onClick={() => setTool(item.tool)}
        >
          {item.icon}
        </button>
      ))}
      <button className="rail-btn" title={`${t("tool.image")} (Ctrl+Shift+K)`} onClick={() => pickImages()}>
        <ImagePlus size={18} />
      </button>
      <span className="rail-sep" />
      <button className="rail-btn" title={`${t("tool.undo")} (Ctrl+Z)`} disabled={!canUndo} onClick={undo}>
        <Undo2 size={18} />
      </button>
      <button className="rail-btn" title={`${t("tool.redo")} (Ctrl+Shift+Z)`} disabled={!canRedo} onClick={redo}>
        <Redo2 size={18} />
      </button>
      <span className="grow" />
      <button className="rail-btn ai" title={`${t("tool.assistant")} (Ctrl+K)`} onClick={askAssistant}>
        <Sparkles size={18} />
      </button>
    </nav>
  );
}
