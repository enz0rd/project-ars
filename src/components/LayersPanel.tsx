import { ChevronRight, Circle, Eye, EyeOff, Frame, Group, Image as ImageIcon, Lock, Search, Square, Type, Unlock, WandSparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ancestors, byId, childrenOf, placeAbove } from "../../shared/tree.ts";
import type { DesignNode, NodeType } from "../../shared/types.ts";
import { organizeLayers } from "../actions.ts";
import { useT } from "../i18n/index.ts";
import { useEditor } from "../store.ts";

const ICONS: Record<NodeType, React.ReactNode> = {
  frame: <Frame size={13} />,
  group: <Group size={13} />,
  rect: <Square size={13} />,
  ellipse: <Circle size={13} />,
  text: <Type size={13} />,
  image: <ImageIcon size={13} />,
};

type Row = { node: DesignNode; depth: number; hasChildren: boolean };

export function LayersPanel() {
  const t = useT();
  const nodes = useEditor((s) => s.nodes);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const updateNodes = useEditor((s) => s.updateNodes);
  const checkpoint = useEditor((s) => s.checkpoint);
  const setNodes = useEditor((s) => s.setNodes);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Reveal layers selected on the canvas.
  useEffect(() => {
    const index = byId(useEditor.getState().nodes);
    const open = selection.flatMap((id) => (index.get(id) ? ancestors(index, index.get(id)!).map((a) => a.id) : []));
    if (open.some((id) => !expanded.has(id))) setExpanded((e) => new Set([...e, ...open]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // Top of the z-order first. A search lists every match, flat.
  const q = query.trim().toLowerCase();
  const rows = useMemo<Row[]>(() => {
    const kids = childrenOf(nodes);
    if (q) {
      return nodes
        .filter((n) => n.name.toLowerCase().includes(q))
        .reverse()
        .map((node) => ({ node, depth: 0, hasChildren: false }));
    }
    const out: Row[] = [];
    const walk = (list: DesignNode[], depth: number) => {
      for (const node of [...list].reverse()) {
        const children = kids.get(node.id) ?? [];
        out.push({ node, depth, hasChildren: children.length > 0 });
        if (children.length && expanded.has(node.id)) walk(children, depth + 1);
      }
    };
    walk(kids.get("") ?? [], 0);
    return out;
  }, [nodes, q, expanded]);

  const toggleOpen = (id: string) =>
    setExpanded((e) => {
      const next = new Set(e);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const toggle = (id: string, prop: "visible" | "locked", value: boolean) => {
    checkpoint();
    updateNodes([id], { [prop]: value });
  };

  return (
    <div className="layers">
      <div className="panel-header">
        <span>{t("inspector.layers")}</span>
        <span className="row">
          <span className="count">{nodes.length}</span>
          <button className="icon-btn xs" title={t("layers.organizeHint")} onClick={organizeLayers}>
            <WandSparkles size={13} />
          </button>
        </span>
      </div>
      <div className="search">
        <Search size={13} />
        <input aria-label={t("layers.search")} placeholder={t("layers.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <button className="icon-btn xs" onClick={() => setQuery("")} aria-label={t("layers.clearSearch")}>
            <X size={12} />
          </button>
        )}
      </div>
      {nodes.length === 0 && <div className="empty-hint">{t("layers.empty")}</div>}
      {nodes.length > 0 && rows.length === 0 && <div className="empty-hint">{t("layers.noMatch")}</div>}
      <ul className="layer-list">
        {rows.map(({ node: n, depth, hasChildren }) => (
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
              // Dropping a layer on another puts it right above, in the same frame or group.
              const next = dragId ? placeAbove(nodes, dragId, n.id) : null;
              if (next) {
                checkpoint();
                setNodes(next);
              }
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
            style={{ paddingLeft: 4 + depth * 14 }}
          >
            {hasChildren ? (
              <button
                className={`layer-toggle ${expanded.has(n.id) ? "open" : ""}`}
                aria-label={expanded.has(n.id) ? t("layers.collapse") : t("layers.expand")}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleOpen(n.id);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <ChevronRight size={12} />
              </button>
            ) : (
              <span className="layer-toggle" />
            )}
            <span className="layer-icon">{ICONS[n.type]}</span>
            {renaming === n.id ? (
              <input
                autoFocus
                className="layer-rename"
                defaultValue={n.name}
                aria-label={t("dashboard.rename")}
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
                title={n.locked ? t("layers.unlock") : t("layers.lock")}
                aria-label={n.locked ? t("layers.unlock") : t("layers.lock")}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(n.id, "locked", !n.locked);
                }}
              >
                {n.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
              <button
                className={`icon-btn xs ${!n.visible ? "on" : ""}`}
                title={n.visible ? t("layers.hide") : t("layers.show")}
                aria-label={n.visible ? t("layers.hide") : t("layers.show")}
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
    </div>
  );
}
