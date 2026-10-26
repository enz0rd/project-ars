import { useEffect, useRef, useState } from "react";
import type { DesignNode } from "../../shared/types.ts";
import { useEditor, type Viewport } from "../store.ts";

type Point = { x: number; y: number };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type Drag =
  | { kind: "pan"; start: Point; viewport: Viewport }
  | { kind: "create"; id: string; origin: Point }
  | { kind: "move"; start: Point; originals: Map<string, Point>; moved: boolean }
  | { kind: "resize"; handle: Handle; start: Point; original: DesignNode }
  | { kind: "marquee"; start: Point; current: Point; additive: string[] };

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const nodes = useEditor((s) => s.nodes);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const viewport = useEditor((s) => s.viewport);

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    const { x, y, zoom } = useEditor.getState().viewport;
    return { x: (clientX - rect.left - x) / zoom, y: (clientY - rect.top - y) / zoom };
  };

  // Space-to-pan, like Figma.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Wheel: pan, or zoom around the cursor with ctrl/cmd (also trackpad pinch).
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { viewport: vp, setViewport } = useEditor.getState();
      if (e.ctrlKey || e.metaKey) {
        const rect = svg.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const zoom = clamp(vp.zoom * Math.exp(-e.deltaY * 0.01), 0.05, 32);
        const k = zoom / vp.zoom;
        setViewport({ zoom, x: px - (px - vp.x) * k, y: py - (py - vp.y) * k });
      } else {
        setViewport({ ...vp, x: vp.x - e.deltaX, y: vp.y - e.deltaY });
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (editingId) setEditingId(null);
    const state = useEditor.getState();
    const p = toWorld(e.clientX, e.clientY);
    svgRef.current!.setPointerCapture(e.pointerId);

    if (e.button === 1 || spaceDown || state.tool === "hand") {
      drag.current = { kind: "pan", start: { x: e.clientX, y: e.clientY }, viewport: state.viewport };
      return;
    }
    if (e.button !== 0) return;

    const handle = (e.target as Element).closest("[data-handle]")?.getAttribute("data-handle") as Handle | null;
    if (handle && state.selection.length === 1) {
      const original = state.nodes.find((n) => n.id === state.selection[0])!;
      state.checkpoint();
      drag.current = { kind: "resize", handle, start: p, original };
      return;
    }

    if (state.tool !== "select") {
      const node = state.addNode(state.tool, {
        x: Math.round(p.x),
        y: Math.round(p.y),
        width: state.tool === "text" ? 120 : 0,
        height: state.tool === "text" ? 24 : 0,
      });
      drag.current = { kind: "create", id: node.id, origin: { x: node.x, y: node.y } };
      return;
    }

    const id = (e.target as Element).closest("[data-id]")?.getAttribute("data-id");
    const hit = id ? state.nodes.find((n) => n.id === id) : undefined;
    if (hit && !hit.locked) {
      let sel = state.selection;
      if (e.shiftKey) sel = sel.includes(hit.id) ? sel.filter((s) => s !== hit.id) : [...sel, hit.id];
      else if (!sel.includes(hit.id)) sel = [hit.id];
      state.select(sel);
      const originals = new Map(
        state.nodes.filter((n) => sel.includes(n.id) && !n.locked).map((n) => [n.id, { x: n.x, y: n.y }]),
      );
      drag.current = { kind: "move", start: p, originals, moved: false };
    } else {
      const additive = e.shiftKey ? state.selection : [];
      if (!e.shiftKey) state.select([]);
      drag.current = { kind: "marquee", start: p, current: p, additive };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const state = useEditor.getState();

    if (d.kind === "pan") {
      state.setViewport({
        ...d.viewport,
        x: d.viewport.x + e.clientX - d.start.x,
        y: d.viewport.y + e.clientY - d.start.y,
      });
      return;
    }

    const p = toWorld(e.clientX, e.clientY);
    if (d.kind === "create") {
      let w = p.x - d.origin.x;
      let h = p.y - d.origin.y;
      if (e.shiftKey) w = h = Math.max(Math.abs(w), Math.abs(h)) * Math.sign(w || 1);
      state.updateNodes([d.id], {
        x: Math.round(Math.min(d.origin.x, d.origin.x + w)),
        y: Math.round(Math.min(d.origin.y, d.origin.y + h)),
        width: Math.round(Math.abs(w)),
        height: Math.round(Math.abs(h)),
      });
    } else if (d.kind === "move") {
      const dx = Math.round(p.x - d.start.x);
      const dy = Math.round(p.y - d.start.y);
      if (!d.moved && (dx || dy)) {
        state.checkpoint();
        d.moved = true;
      }
      state.updateNodes([...d.originals.keys()], (n) => {
        const o = d.originals.get(n.id)!;
        return { x: o.x + dx, y: o.y + dy };
      });
    } else if (d.kind === "resize") {
      state.updateNodes([d.original.id], resize(d.original, d.handle, p.x - d.start.x, p.y - d.start.y, e.shiftKey));
    } else if (d.kind === "marquee") {
      d.current = p;
      setMarquee({ a: d.start, b: p });
      const box = normRect(d.start, p);
      const hits = state.nodes
        .filter((n) => n.visible && !n.locked && intersects(box, n))
        .map((n) => n.id);
      state.select([...new Set([...d.additive, ...hits])]);
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setMarquee(null);
    if (d?.kind === "create") {
      const state = useEditor.getState();
      const node = state.nodes.find((n) => n.id === d.id);
      // A click without dragging creates a default-sized shape.
      if (node && node.type !== "text" && node.width < 2 && node.height < 2) {
        state.updateNodes([d.id], { width: 100, height: 100 });
      }
      state.setTool("select");
      if (node?.type === "text") setEditingId(node.id);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const id = (e.target as Element).closest("[data-id]")?.getAttribute("data-id");
    const node = useEditor.getState().nodes.find((n) => n.id === id);
    if (node?.type === "text") setEditingId(node.id);
  };

  const selectedNodes = nodes.filter((n) => selection.includes(n.id));
  const editing = nodes.find((n) => n.id === editingId);
  const cursor =
    spaceDown || tool === "hand" ? (drag.current?.kind === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : "crosshair";

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className="canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {nodes.map((n) => n.visible && <NodeView key={n.id} node={n} zoom={viewport.zoom} hideText={n.id === editingId} />)}

          {selectedNodes.map((n) => (
            <rect
              key={n.id}
              className="selection-outline"
              x={n.x}
              y={n.y}
              width={n.width}
              height={n.height}
              transform={rotation(n)}
              strokeWidth={1 / viewport.zoom}
            />
          ))}

          {selectedNodes.length === 1 && !selectedNodes[0].locked && (
            <g transform={rotation(selectedNodes[0])}>
              {HANDLES.map((h) => {
                const { x, y } = handlePos(selectedNodes[0], h);
                const s = 8 / viewport.zoom;
                return (
                  <rect
                    key={h}
                    data-handle={h}
                    className="handle"
                    style={{ cursor: `${h}-resize` }}
                    x={x - s / 2}
                    y={y - s / 2}
                    width={s}
                    height={s}
                    strokeWidth={1 / viewport.zoom}
                  />
                );
              })}
            </g>
          )}

          {marquee && (
            <rect className="marquee" {...normRect(marquee.a, marquee.b)} strokeWidth={1 / viewport.zoom} />
          )}
        </g>
      </svg>

      {editing && (
        <TextEditor node={editing} viewport={viewport} onDone={() => setEditingId(null)} />
      )}

      {nodes.length === 0 && (
        <div className="canvas-empty">
          Desenhe com a barra de ferramentas, ou peça ao Claude no painel à direita.
        </div>
      )}
      <div className="zoom-badge">{Math.round(viewport.zoom * 100)}%</div>
    </div>
  );
}

function NodeView({ node: n, zoom, hideText }: { node: DesignNode; zoom: number; hideText: boolean }) {
  const common = {
    "data-id": n.id,
    opacity: n.opacity,
    transform: rotation(n),
    fill: n.fill,
    stroke: n.strokeWidth > 0 ? n.stroke : undefined,
    strokeWidth: n.strokeWidth || undefined,
  };

  switch (n.type) {
    case "frame":
      return (
        <g>
          <text x={n.x} y={n.y - 6 / zoom} fontSize={11 / zoom} className="frame-label" transform={rotation(n)}>
            {n.name}
          </text>
          <rect {...common} x={n.x} y={n.y} width={n.width} height={n.height} rx={n.cornerRadius} />
        </g>
      );
    case "rect":
      return <rect {...common} x={n.x} y={n.y} width={n.width} height={n.height} rx={n.cornerRadius} />;
    case "ellipse":
      return (
        <ellipse {...common} cx={n.x + n.width / 2} cy={n.y + n.height / 2} rx={n.width / 2} ry={n.height / 2} />
      );
    case "text":
      return (
        <foreignObject data-id={n.id} x={n.x} y={n.y} width={n.width} height={n.height} transform={rotation(n)} opacity={n.opacity}>
          <div data-id={n.id} className="text-node" style={{ ...textStyle(n), visibility: hideText ? "hidden" : undefined }}>
            {n.text}
          </div>
        </foreignObject>
      );
  }
}

function TextEditor({ node, viewport, onDone }: { node: DesignNode; viewport: Viewport; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(node.text ?? "");

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    const state = useEditor.getState();
    if (value !== node.text) {
      state.checkpoint();
      state.updateNodes([node.id], { text: value });
    }
    onDone();
  };

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) commit();
      }}
      style={{
        ...textStyle(node),
        left: viewport.x + node.x * viewport.zoom,
        top: viewport.y + node.y * viewport.zoom,
        width: node.width,
        height: node.height,
        transform: `scale(${viewport.zoom})`,
      }}
    />
  );
}

function textStyle(n: DesignNode): React.CSSProperties {
  return {
    color: n.fill,
    fontSize: n.fontSize,
    fontWeight: n.fontWeight,
    fontFamily: `${n.fontFamily ?? "Inter"}, system-ui, sans-serif`,
    textAlign: n.textAlign,
  };
}

function rotation(n: DesignNode) {
  return n.rotation ? `rotate(${n.rotation} ${n.x + n.width / 2} ${n.y + n.height / 2})` : undefined;
}

function handlePos(n: DesignNode, h: Handle): Point {
  const x = h.includes("w") ? n.x : h.includes("e") ? n.x + n.width : n.x + n.width / 2;
  const y = h.includes("n") ? n.y : h.includes("s") ? n.y + n.height : n.y + n.height / 2;
  return { x, y };
}

function resize(o: DesignNode, h: Handle, dx: number, dy: number, keepRatio: boolean): Partial<DesignNode> {
  let { x, y, width, height } = o;
  if (h.includes("e")) width = o.width + dx;
  if (h.includes("s")) height = o.height + dy;
  if (h.includes("w")) {
    width = o.width - dx;
    x = o.x + dx;
  }
  if (h.includes("n")) {
    height = o.height - dy;
    y = o.y + dy;
  }
  if (keepRatio && o.width && o.height && h.length === 2) {
    const ratio = o.width / o.height;
    if (Math.abs(width / o.width) > Math.abs(height / o.height)) height = width / ratio;
    else width = height * ratio;
    if (h.includes("n")) y = o.y + o.height - height;
    if (h.includes("w")) x = o.x + o.width - width;
  }
  // Flip instead of going negative.
  if (width < 0) {
    x += width;
    width = -width;
  }
  if (height < 0) {
    y += height;
    height = -height;
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function normRect(a: Point, b: Point) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

function intersects(r: { x: number; y: number; width: number; height: number }, n: DesignNode) {
  return r.x < n.x + n.width && r.x + r.width > n.x && r.y < n.y + n.height && r.y + r.height > n.y;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
}
