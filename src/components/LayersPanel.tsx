import { useState } from "react";
import { useEditor } from "../store.ts";

const ICONS = { frame: "#", rect: "▭", ellipse: "◯", text: "T" };

export function LayersPanel() {
  const nodes = useEditor((s) => s.nodes);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const updateNodes = useEditor((s) => s.updateNodes);
  const checkpoint = useEditor((s) => s.checkpoint);
  const moveInZ = useEditor((s) => s.moveInZ);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // Top of the z-order first, like Figma.
  const ordered = [...nodes].reverse();

  return (
    <aside className="panel layers">
      <div className="panel-title">Camadas</div>
      {ordered.length === 0 && <div className="muted pad">Nenhuma camada</div>}
      <ul>
        {ordered.map((n) => (
          <li
            key={n.id}
            className={`layer ${selection.includes(n.id) ? "selected" : ""} ${n.visible ? "" : "hidden-layer"}`}
            draggable
            onDragStart={() => setDragId(n.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragId && dragId !== n.id) moveInZ(dragId, nodes.findIndex((x) => x.id === n.id));
              setDragId(null);
            }}
            onClick={(e) =>
              select(
                e.shiftKey
                  ? selection.includes(n.id)
                    ? selection.filter((s) => s !== n.id)
                    : [...selection, n.id]
                  : [n.id],
              )
            }
            onDoubleClick={() => setRenaming(n.id)}
          >
            <span className="layer-icon">{ICONS[n.type]}</span>
            {renaming === n.id ? (
              <input
                autoFocus
                defaultValue={n.name}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                onBlur={(e) => {
                  checkpoint();
                  updateNodes([n.id], { name: e.target.value || n.name });
                  setRenaming(null);
                }}
              />
            ) : (
              <span className="layer-name">{n.name}</span>
            )}
            <button
              className="icon-btn"
              title={n.locked ? "Desbloquear" : "Bloquear"}
              onClick={(e) => {
                e.stopPropagation();
                checkpoint();
                updateNodes([n.id], { locked: !n.locked });
              }}
            >
              {n.locked ? "🔒" : "🔓"}
            </button>
            <button
              className="icon-btn"
              title={n.visible ? "Ocultar" : "Mostrar"}
              onClick={(e) => {
                e.stopPropagation();
                checkpoint();
                updateNodes([n.id], { visible: !n.visible });
              }}
            >
              {n.visible ? "👁" : "–"}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
