import { useEffect, useRef, useState } from "react";
import { uid, type DesignNode } from "../../shared/types.ts";
import { shadowFilter } from "../export.ts";
import { boundsOf, guidesFor, intersects, snapOffset, snapTargets, type Box, type Guide } from "../geometry.ts";
import { useEditor, type Viewport } from "../store.ts";
import { useUi } from "../ui.ts";

type Point = { x: number; y: number };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type Drag =
  | { kind: "pan"; start: Point; viewport: Viewport }
  | { kind: "create"; id: string; origin: Point }
  | { kind: "move"; start: Point; originals: Map<string, Point>; moved: boolean; duplicate: boolean }
  | { kind: "resize"; handle: Handle; start: Point; original: DesignNode }
  | { kind: "marquee"; start: Point; additive: string[] };

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
/** Snap distance in screen pixels. */
const SNAP_PX = 6;

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
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

  // Track canvas size for zoom-to-fit.
  useEffect(() => {
    const svg = svgRef.current!;
    const observer = new ResizeObserver(([entry]) =>
      useUi.getState().setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

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
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setViewport({ ...vp, x: vp.x - dx, y: vp.y - dy });
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  /** Snap targets: every visible node not being dragged. */
  const othersFor = (exclude: Set<string>): Box[] =>
    useEditor.getState().nodes.filter((n) => n.visible && !exclude.has(n.id));

  const onPointerDown = (e: React.PointerEvent) => {
    if (editingId) setEditingId(null);
    useUi.getState().setContextMenu(null);
    const state = useEditor.getState();
    const p = toWorld(e.clientX, e.clientY);

    if (e.button === 1 || spaceDown || state.tool === "hand") {
      svgRef.current!.setPointerCapture(e.pointerId);
      drag.current = { kind: "pan", start: { x: e.clientX, y: e.clientY }, viewport: state.viewport };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;
    svgRef.current!.setPointerCapture(e.pointerId);

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
        width: state.tool === "text" ? 160 : 0,
        height: state.tool === "text" ? 24 : 0,
      });
      drag.current = { kind: "create", id: node.id, origin: { x: node.x, y: node.y } };
      return;
    }

    const hit = hitNode(e.target, state.nodes);
    if (hit && !hit.locked) {
      let sel = state.selection;
      if (e.shiftKey) sel = sel.includes(hit.id) ? sel.filter((s) => s !== hit.id) : [...sel, hit.id];
      else if (!sel.includes(hit.id)) sel = [hit.id];
      state.select(sel);
      const originals = new Map(
        state.nodes.filter((n) => sel.includes(n.id) && !n.locked).map((n) => [n.id, { x: n.x, y: n.y }]),
      );
      drag.current = { kind: "move", start: p, originals, moved: false, duplicate: e.altKey };
    } else {
      const additive = e.shiftKey ? state.selection : [];
      if (!e.shiftKey) state.select([]);
      drag.current = { kind: "marquee", start: p, additive };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      if (useEditor.getState().tool === "select") setHoverId(hitNode(e.target, useEditor.getState().nodes)?.id ?? null);
      return;
    }
    const state = useEditor.getState();
    const threshold = SNAP_PX / state.viewport.zoom;
    // Hold Ctrl/Cmd to move freely.
    const snapping = !(e.ctrlKey || e.metaKey);

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
      let dx = p.x - d.start.x;
      let dy = p.y - d.start.y;
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      if (!d.moved) {
        if (Math.hypot(dx, dy) * state.viewport.zoom < 2) return;
        state.checkpoint();
        d.moved = true;
        if (d.duplicate) duplicateInPlace(d);
      }
      const ids = new Set(d.originals.keys());
      const start = boundsOf([...d.originals].map(([id, o]) => ({ ...state.nodes.find((n) => n.id === id)!, ...o })))!;
      const moved = { ...start, x: start.x + dx, y: start.y + dy };
      const others = othersFor(ids);
      if (snapping) {
        const { xs, ys } = snapTargets(others);
        dx += snapOffset([moved.x, moved.x + moved.width / 2, moved.x + moved.width], xs, threshold);
        dy += snapOffset([moved.y, moved.y + moved.height / 2, moved.y + moved.height], ys, threshold);
      }
      dx = Math.round(dx);
      dy = Math.round(dy);
      state.updateNodes([...ids], (n) => {
        const o = d.originals.get(n.id)!;
        return { x: o.x + dx, y: o.y + dy };
      });
      setGuides(snapping ? guidesFor({ ...start, x: start.x + dx, y: start.y + dy }, others) : []);
    } else if (d.kind === "resize") {
      const next = resize(d.original, d.handle, p.x - d.start.x, p.y - d.start.y, e.shiftKey);
      const others = othersFor(new Set([d.original.id]));
      if (snapping && !e.shiftKey) {
        const { xs, ys } = snapTargets(others);
        if (d.handle.includes("e")) next.width += snapOffset([next.x + next.width], xs, threshold);
        if (d.handle.includes("s")) next.height += snapOffset([next.y + next.height], ys, threshold);
        if (d.handle.includes("w")) {
          const off = snapOffset([next.x], xs, threshold);
          next.x += off;
          next.width -= off;
        }
        if (d.handle.includes("n")) {
          const off = snapOffset([next.y], ys, threshold);
          next.y += off;
          next.height -= off;
        }
      }
      state.updateNodes([d.original.id], next);
      setGuides(snapping ? guidesFor(next, others) : []);
    } else if (d.kind === "marquee") {
      setMarquee({ a: d.start, b: p });
      const box = normRect(d.start, p);
      const hits = state.nodes.filter((n) => n.visible && !n.locked && intersects(box, n)).map((n) => n.id);
      state.select([...new Set([...d.additive, ...hits])]);
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setMarquee(null);
    setGuides([]);
    setPanning(false);
    if (d?.kind === "create") {
      const state = useEditor.getState();
      const node = state.nodes.find((n) => n.id === d.id);
      // A click without dragging creates a default-sized shape.
      if (node && node.type !== "text" && node.width < 2 && node.height < 2) {
        state.updateNodes([d.id], node.type === "frame" ? { width: 375, height: 812 } : { width: 100, height: 100 });
      }
      state.setTool("select");
      if (node?.type === "text") setEditingId(node.id);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const node = hitNode(e.target, useEditor.getState().nodes);
    if (node?.type === "text" && !node.locked) setEditingId(node.id);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const state = useEditor.getState();
    const hit = hitNode(e.target, state.nodes);
    if (hit && !state.selection.includes(hit.id)) state.select([hit.id]);
    if (!hit) state.select([]);
    useUi.getState().setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const selectedNodes = nodes.filter((n) => selection.includes(n.id));
  const selBounds = boundsOf(selectedNodes);
  const hovered = hoverId && !selection.includes(hoverId) ? nodes.find((n) => n.id === hoverId) : undefined;
  const editing = nodes.find((n) => n.id === editingId);
  const z = viewport.zoom;
  const cursor =
    spaceDown || tool === "hand" ? (panning ? "grabbing" : "grab") : tool === "select" ? "default" : "crosshair";

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className="canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoverId(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        <DotGrid viewport={viewport} />
        <defs
          dangerouslySetInnerHTML={{
            __html: nodes.filter((n) => n.shadow).map((n) => shadowFilter(`shadow-${n.id}`, n.shadow!)).join(""),
          }}
        />
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${z})`}>
          {nodes.map((n) => n.visible && <NodeView key={n.id} node={n} zoom={z} hideText={n.id === editingId} />)}

          {hovered && (
            <rect
              className="hover-outline"
              x={hovered.x}
              y={hovered.y}
              width={hovered.width}
              height={hovered.height}
              transform={rotation(hovered)}
              strokeWidth={1.5 / z}
            />
          )}

          {selectedNodes.map((n) => (
            <rect
              key={n.id}
              className="selection-outline"
              x={n.x}
              y={n.y}
              width={n.width}
              height={n.height}
              transform={rotation(n)}
              strokeWidth={1 / z}
            />
          ))}
          {selectedNodes.length > 1 && selBounds && (
            <rect className="selection-outline group" {...selBounds} strokeWidth={1 / z} />
          )}

          {guides.map((g, i) =>
            g.axis === "x" ? (
              <line key={i} className="guide" x1={g.at} x2={g.at} y1={g.from} y2={g.to} strokeWidth={1 / z} />
            ) : (
              <line key={i} className="guide" y1={g.at} y2={g.at} x1={g.from} x2={g.to} strokeWidth={1 / z} />
            ),
          )}

          {selectedNodes.length === 1 && !selectedNodes[0].locked && (
            <g transform={rotation(selectedNodes[0])}>
              {HANDLES.map((h) => {
                const { x, y } = handlePos(selectedNodes[0], h);
                const s = 8 / z;
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
                    rx={1.5 / z}
                    strokeWidth={1 / z}
                  />
                );
              })}
            </g>
          )}

          {selBounds && !editing && <SizeLabel box={selBounds} zoom={z} />}

          {marquee && <rect className="marquee" {...normRect(marquee.a, marquee.b)} strokeWidth={1 / z} />}
        </g>
      </svg>

      {editing && <TextEditor node={editing} viewport={viewport} onDone={() => setEditingId(null)} />}

      {nodes.length === 0 && (
        <div className="canvas-empty">
          <div className="canvas-empty-card">
            <strong>Canvas vazio</strong>
            <span>Desenhe com a barra de ferramentas abaixo, ou peça ao Claude para criar algo.</span>
            <button className="btn primary" onClick={() => useUi.getState().askClaude()}>
              Perguntar ao Claude
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function duplicateInPlace(d: Extract<Drag, { kind: "move" }>) {
  const state = useEditor.getState();
  const copies = state.nodes
    .filter((n) => d.originals.has(n.id))
    .map((n) => ({ ...n, id: uid(), name: `${n.name} copy` }));
  // Leave the originals where they were and drag the copies instead.
  state.setNodes([...state.nodes, ...copies], copies.map((c) => c.id));
  d.originals = new Map(copies.map((c) => [c.id, { x: c.x, y: c.y }]));
}

function hitNode(target: EventTarget, nodes: DesignNode[]) {
  const id = (target as Element).closest?.("[data-id]")?.getAttribute("data-id");
  return id ? nodes.find((n) => n.id === id) : undefined;
}

/** Dot grid that follows pan/zoom and thins out as you zoom out. */
function DotGrid({ viewport }: { viewport: Viewport }) {
  let step = 24 * viewport.zoom;
  while (step < 16) step *= 2;
  while (step > 64) step /= 2;
  const r = clamp(viewport.zoom, 0.6, 1.2);
  return (
    <>
      <defs>
        <pattern
          id="dot-grid"
          width={step}
          height={step}
          patternUnits="userSpaceOnUse"
          x={mod(viewport.x, step)}
          y={mod(viewport.y, step)}
        >
          <circle cx={r} cy={r} r={r} className="grid-dot" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dot-grid)" />
    </>
  );
}

function SizeLabel({ box, zoom }: { box: Box; zoom: number }) {
  const text = `${Math.round(box.width)} × ${Math.round(box.height)}`;
  const fs = 11 / zoom;
  const w = (text.length * 6.4 + 12) / zoom;
  const h = 18 / zoom;
  const x = box.x + box.width / 2 - w / 2;
  const y = box.y + box.height + 8 / zoom;
  return (
    <g className="size-label" pointerEvents="none">
      <rect x={x} y={y} width={w} height={h} rx={4 / zoom} />
      <text x={x + w / 2} y={y + h / 2} fontSize={fs} textAnchor="middle" dominantBaseline="central">
        {text}
      </text>
    </g>
  );
}

function NodeView({ node: n, zoom, hideText }: { node: DesignNode; zoom: number; hideText: boolean }) {
  const shape = {
    "data-id": n.id,
    fill: n.fill,
    stroke: n.strokeWidth > 0 ? n.stroke : undefined,
    strokeWidth: n.strokeWidth || undefined,
  };

  let body: React.ReactNode;
  switch (n.type) {
    case "frame":
    case "rect":
      body = <rect {...shape} x={n.x} y={n.y} width={n.width} height={n.height} rx={n.cornerRadius} />;
      break;
    case "ellipse":
      body = <ellipse {...shape} cx={n.x + n.width / 2} cy={n.y + n.height / 2} rx={n.width / 2} ry={n.height / 2} />;
      break;
    case "text":
      body = (
        <foreignObject data-id={n.id} x={n.x} y={n.y} width={n.width} height={n.height}>
          <div data-id={n.id} className="text-node" style={{ ...textStyle(n), visibility: hideText ? "hidden" : undefined }}>
            {n.text}
          </div>
        </foreignObject>
      );
  }

  return (
    <>
      {n.type === "frame" && (
        <text data-id={n.id} x={n.x} y={n.y - 6 / zoom} fontSize={11 / zoom} className="frame-label" transform={rotation(n)}>
          {n.name}
        </text>
      )}
      <g opacity={n.opacity} transform={rotation(n)} filter={n.shadow ? `url(#shadow-${n.id})` : undefined}>
        {body}
      </g>
    </>
  );
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
      state.updateNodes([node.id], { text: value, ...(node.name === node.text?.slice(0, 32) && { name: value.slice(0, 32) || "Text" }) });
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

function resize(o: DesignNode, h: Handle, dx: number, dy: number, keepRatio: boolean): Box {
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

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function mod(a: number, n: number) {
  return ((a % n) + n) % n;
}

export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}
