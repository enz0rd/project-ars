import { Circle, Eye, EyeOff, Frame, Lock, Search, Square, Type, Unlock, X } from "lucide-react";
import { useState } from "react";
import type { NodeType } from "../../shared/types.ts";
import { useEditor } from "../store.ts";

const ICONS: Record<NodeType, React.ReactNode> = {
  frame: <Frame size={13} />,
  rect: <Square size={13} />,
  ellipse: <Circle size={13} />,
  text: <Type size={13} />,
};

export function LayersPanel() {
  const nodes = useEditor((s) => s.nodes);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const updateNodes = useEditor((s) => s.updateNodes);
  const checkpoint = useEditor((s) => s.checkpoint);
  const moveInZ = useEditor((s) => s.moveInZ);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Top of the z-order first, like Figma.
  const q = query.trim().toLowerCase();
  const ordered = [...nodes].reverse().filter((n) => !q || n.name.toLowerCase().includes(q));

  const toggle = (id: string, prop: "visible" | "locked", value: boolean) => {
    checkpoint();
    updateNodes([id], { [prop]: value });
  };

  return (
    <aside className="panel layers">
      <div className="panel-header">
        <span>Camadas</span>
        <span className="count">{nodes.length}</span>
      </div>
      <div className="search">
        <Search size={13} />
        <input placeholder="Buscar camadas" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <button className="icon-btn xs" onClick={() => setQuery("")} aria-label="Limpar busca">
            <X size={12} />
          </button>
        )}
      </div>
      {nodes.length === 0 && <div className="empty-hint">Nenhuma camada ainda.</div>}
      {nodes.length > 0 && ordered.length === 0 && <div className="empty-hint">Nada encontrado.</div>}
      <ul className="layer-list">
        {ordered.map((n) => (
          <li
            key={n.id}
            className={[
              "layer",
              selection.includes(n.id) && "selected",
              !n.visible && "is-hidden",
              dropId === n.id && "drop-target",
            ]
              .filter(Boolean)
              .join(" ")}
            draggable={!q}
            onDragStart={() => setDragId(n.id)}
            onDragOver={(e) => {
              e.preventDefault();
              setDropId(n.id);
            }}
            onDragLeave={() => setDropId(null)}
            onDrop={() => {
              if (dragId && dragId !== n.id) moveInZ(dragId, nodes.findIndex((x) => x.id === n.id));
              setDragId(null);
              setDropId(null);
            }}
            onClick={(e) =>
              select(
                e.shiftKey || e.metaKey || e.ctrlKey
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
                className="layer-rename"
                defaultValue={n.name}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
                onBlur={(e) => {
                  if (e.target.value && e.target.value !== n.name) {
                    checkpoint();
                    updateNodes([n.id], { name: e.target.value });
                  }
                  setRenaming(null);
                }}
              />
            ) : (
              <span className="layer-name">{n.name}</span>
            )}
            <span className={`layer-actions ${n.locked || !n.visible ? "pinned" : ""}`}>
              <button
                className={`icon-btn xs ${n.locked ? "on" : ""}`}
                title={n.locked ? "Desbloquear" : "Bloquear"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(n.id, "locked", !n.locked);
                }}
              >
                {n.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
              <button
                className={`icon-btn xs ${!n.visible ? "on" : ""}`}
                title={n.visible ? "Ocultar" : "Mostrar"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(n.id, "visible", !n.visible);
                }}
              >
                {n.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
