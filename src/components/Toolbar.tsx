import { useEditor, type Tool } from "../store.ts";

const TOOLS: { tool: Tool; label: string; key: string; icon: string }[] = [
  { tool: "select", label: "Mover", key: "V", icon: "↖" },
  { tool: "hand", label: "Mão", key: "H", icon: "✋" },
  { tool: "frame", label: "Frame", key: "F", icon: "#" },
  { tool: "rect", label: "Retângulo", key: "R", icon: "▭" },
  { tool: "ellipse", label: "Elipse", key: "O", icon: "◯" },
  { tool: "text", label: "Texto", key: "T", icon: "T" },
];

export const TOOL_KEYS = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.tool]));

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const docName = useEditor((s) => s.docName);
  const setDocName = useEditor((s) => s.setDocName);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  return (
    <header className="toolbar">
      <div className="toolbar-group">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={`tool-btn ${tool === t.tool ? "active" : ""}`}
            title={`${t.label} (${t.key})`}
            onClick={() => setTool(t.tool)}
          >
            {t.icon}
          </button>
        ))}
        <span className="divider" />
        <button className="tool-btn" title="Desfazer (Ctrl+Z)" disabled={!canUndo} onClick={undo}>↶</button>
        <button className="tool-btn" title="Refazer (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>↷</button>
      </div>
      <input className="doc-name" value={docName} onChange={(e) => setDocName(e.target.value)} />
      <div className="toolbar-group">
        <button className="text-btn" onClick={exportJson}>Exportar</button>
        <label className="text-btn">
          Importar
          <input type="file" accept="application/json" hidden onChange={importJson} />
        </label>
      </div>
    </header>
  );
}

function exportJson() {
  const { docName, nodes } = useEditor.getState();
  const blob = new Blob([JSON.stringify({ name: docName, nodes }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${docName || "design"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importJson(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    const doc = JSON.parse(await file.text());
    if (!Array.isArray(doc.nodes)) throw new Error("missing nodes");
    useEditor.getState().replaceNodes(doc.nodes);
    if (doc.name) useEditor.getState().setDocName(doc.name);
  } catch {
    alert("Arquivo inválido.");
  }
}
