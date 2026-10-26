import { uid, type DesignNode } from "../shared/types.ts";
import { downloadPng, downloadSvg } from "./export.ts";
import { boundsOf, parentFrame, type Box } from "./geometry.ts";
import { useEditor } from "./store.ts";
import { useUi } from "./ui.ts";

/** Editor commands shared by shortcuts, menus and panels. Each one is a single undo step. */

const editor = () => useEditor.getState();
const selected = () => {
  const { nodes, selection } = editor();
  return nodes.filter((n) => selection.includes(n.id));
};

let clipboard: DesignNode[] = [];

export function copy() {
  clipboard = structuredClone(selected());
  if (clipboard.length) useUi.getState().showToast(`${clipboard.length} camada(s) copiada(s)`);
}

export function cut() {
  copy();
  editor().deleteSelection();
}

export function paste() {
  if (!clipboard.length) return;
  const s = editor();
  s.checkpoint();
  const copies = clipboard.map((n) => ({ ...n, id: uid(), x: n.x + 16, y: n.y + 16 }));
  // Next paste lands one step further, like Figma.
  clipboard = copies;
  s.setNodes([...s.nodes, ...copies], copies.map((c) => c.id));
}

export type AlignKind = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** Aligns the selection to its bounds, or a single node to the frame that contains it. */
export function align(kind: AlignKind) {
  const s = editor();
  const sel = selected().filter((n) => !n.locked);
  let target: Box | null | undefined;
  if (sel.length === 1) target = parentFrame(s.nodes, sel[0]);
  else target = boundsOf(sel);
  if (!target || !sel.length) return;
  const t = target;
  s.checkpoint();
  s.updateNodes(
    sel.map((n) => n.id),
    (n) => {
      switch (kind) {
        case "left":
          return { x: t.x };
        case "hcenter":
          return { x: Math.round(t.x + (t.width - n.width) / 2) };
        case "right":
          return { x: t.x + t.width - n.width };
        case "top":
          return { y: t.y };
        case "vcenter":
          return { y: Math.round(t.y + (t.height - n.height) / 2) };
        case "bottom":
          return { y: t.y + t.height - n.height };
      }
    },
  );
}

/** Equal gaps between three or more nodes along an axis. */
export function distribute(axis: "h" | "v") {
  const sel = selected().filter((n) => !n.locked);
  if (sel.length < 3) return;
  const pos = axis === "h" ? "x" : "y";
  const size = axis === "h" ? "width" : "height";
  const sorted = [...sel].sort((a, b) => a[pos] - b[pos]);
  const start = sorted[0][pos];
  const end = Math.max(...sorted.map((n) => n[pos] + n[size]));
  const total = sorted.reduce((sum, n) => sum + n[size], 0);
  const gap = (end - start - total) / (sorted.length - 1);
  const next = new Map<string, number>();
  let cursor = start;
  for (const n of sorted) {
    next.set(n.id, Math.round(cursor));
    cursor += n[size] + gap;
  }
  const s = editor();
  s.checkpoint();
  s.updateNodes([...next.keys()], (n) => ({ [pos]: next.get(n.id)! }));
}

export function zOrder(direction: "front" | "back" | "forward" | "backward") {
  const s = editor();
  const ids = new Set(s.selection);
  if (!ids.size) return;
  let nodes = [...s.nodes];
  const picked = nodes.filter((n) => ids.has(n.id));
  const rest = nodes.filter((n) => !ids.has(n.id));
  if (direction === "front") nodes = [...rest, ...picked];
  else if (direction === "back") nodes = [...picked, ...rest];
  else {
    // Move each selected node one step past its neighbour, keeping selected nodes together.
    const order = direction === "forward" ? [...nodes.keys()].reverse() : [...nodes.keys()];
    for (const i of order) {
      const j = direction === "forward" ? i + 1 : i - 1;
      if (j < 0 || j >= nodes.length || !ids.has(nodes[i].id) || ids.has(nodes[j].id)) continue;
      [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
    }
  }
  s.checkpoint();
  s.setNodes(nodes);
}

export function toggleSelection(prop: "visible" | "locked") {
  const sel = selected();
  if (!sel.length) return;
  const value = !sel.every((n) => n[prop]);
  const s = editor();
  s.checkpoint();
  s.updateNodes(sel.map((n) => n.id), { [prop]: value });
}

export function selectAll() {
  const s = editor();
  s.select(s.nodes.filter((n) => n.visible && !n.locked).map((n) => n.id));
}

// Viewport

export function zoomTo(box: Box | null, maxZoom = 2) {
  if (!box) return;
  const { width, height } = useUi.getState().canvasSize;
  const pad = 80;
  const zoom = Math.min(maxZoom, (width - pad * 2) / Math.max(box.width, 1), (height - pad * 2) / Math.max(box.height, 1));
  editor().setViewport({
    zoom,
    x: width / 2 - (box.x + box.width / 2) * zoom,
    y: height / 2 - (box.y + box.height / 2) * zoom,
  });
}

export const zoomToFit = () => zoomTo(boundsOf(editor().nodes.filter((n) => n.visible)), 1);
export const zoomToSelection = () => zoomTo(boundsOf(selected()), 4);

export function zoomBy(factor: number) {
  const { viewport: vp, setViewport } = editor();
  const { width, height } = useUi.getState().canvasSize;
  const zoom = Math.min(32, Math.max(0.05, vp.zoom * factor));
  const k = zoom / vp.zoom;
  setViewport({ zoom, x: width / 2 - (width / 2 - vp.x) * k, y: height / 2 - (height / 2 - vp.y) * k });
}

export function setZoom(zoom: number) {
  zoomBy(zoom / editor().viewport.zoom);
}

// Export

function exportTargets() {
  const sel = selected();
  return sel.length ? sel : editor().nodes;
}

function exportName() {
  const sel = selected();
  return (sel.length === 1 ? sel[0].name : editor().docName) || "design";
}

export async function exportPng(scale = 2) {
  const ok = await downloadPng(exportTargets(), exportName(), scale);
  useUi.getState().showToast(ok ? "PNG exportado" : "Nada para exportar");
}

export function exportSvg() {
  const ok = downloadSvg(exportTargets(), exportName());
  useUi.getState().showToast(ok ? "SVG exportado" : "Nada para exportar");
}
