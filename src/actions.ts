import {
  autoOrganize,
  byId,
  cloneSubtrees,
  groupNodes,
  reorderSiblings,
  topLevel,
  ungroupNodes,
  withDescendants,
} from "../shared/tree.ts";
import { NODE_DEFAULTS, uid, type DesignNode } from "../shared/types.ts";
import { inlineImages, isImageFile, uploadImage } from "./assets.ts";
import { download, downloadPng, downloadSvg } from "./export.ts";
import { boundsOf, parentFrame, type Box } from "./geometry.ts";
import { useEditor } from "./store.ts";
import { errorMessage, t, tc } from "./i18n/index.ts";
import { useUi } from "./ui.ts";

/** Editor commands shared by shortcuts, menus and panels. Each one is a single undo step. */

const editor = () => useEditor.getState();
const selected = () => {
  const { nodes, selection } = editor();
  return nodes.filter((n) => selection.includes(n.id));
};

let clipboard: DesignNode[] = [];
/** Put on the system clipboard when copying layers, so a later Ctrl+V pastes them and not an older image. */
export const CLIPBOARD_MARKER = "ars:layers";

export function copy() {
  navigator.clipboard?.writeText(CLIPBOARD_MARKER).catch(() => {});
  const { nodes, selection } = editor();
  const roots = topLevel(nodes, selection);
  // Groups and frames are copied with their content; the copy lands at the top level.
  const all = withDescendants(nodes, roots.map((r) => r.id));
  const rootIds = new Set(roots.map((r) => r.id));
  clipboard = structuredClone(nodes.filter((n) => all.has(n.id))).map((n) => {
    if (!rootIds.has(n.id)) return n;
    const { parentId: _, ...rest } = n;
    return rest as DesignNode;
  });
  if (roots.length) useUi.getState().showToast(tc("toast.copied", roots.length));
}

export function cut() {
  copy();
  editor().deleteSelection();
}

export function paste() {
  if (!clipboard.length) return;
  const s = editor();
  s.checkpoint();
  const { copies, roots } = cloneSubtrees(clipboard, clipboard.map((n) => n.id), 16, 16);
  // Next paste lands one step further, like Figma.
  clipboard = copies;
  s.setNodes([...s.nodes, ...copies], roots);
}

// Images

/** Largest side, in canvas pixels, of a newly imported image. */
const MAX_IMPORT_SIZE = 1200;

/**
 * Uploads image files and places them, cascading from `at` (default: centre of the
 * view). Images dropped on a frame go into it. One undo step.
 */
export async function importImages(files: File[], at?: { x: number; y: number }) {
  const images = files.filter(isImageFile);
  const ui = useUi.getState();
  if (!images.length) return ui.showToast(files.length ? t("error.unsupported_image") : "");
  ui.showToast(tc("toast.uploading", images.length));
  let uploaded;
  try {
    uploaded = await Promise.all(images.map(uploadImage));
  } catch (err) {
    return ui.showToast(errorMessage(err instanceof Error ? err.message : "upload_failed"));
  }

  const s = editor();
  const { width: cw, height: ch } = ui.canvasSize;
  const origin = at ?? { x: (cw / 2 - s.viewport.x) / s.viewport.zoom, y: (ch / 2 - s.viewport.y) / s.viewport.zoom };
  const nodes: DesignNode[] = uploaded.map((img, i) => {
    let width = img.width ?? 400;
    let height = img.height ?? 300;
    const k = Math.min(1, MAX_IMPORT_SIZE / Math.max(width, height));
    width = Math.round(width * k);
    height = Math.round(height * k);
    return {
      ...NODE_DEFAULTS,
      id: uid(),
      type: "image",
      name: images[i].name.replace(/\.[a-z0-9]+$/i, "") || t("type.image"),
      src: img.src,
      fill: "transparent",
      // Centred on the drop point (or the view); further images cascade from there.
      x: Math.round(origin.x - width / 2 + i * 24),
      y: Math.round(origin.y - height / 2 + i * 24),
      width,
      height,
    };
  });
  const all = [...s.nodes, ...nodes];
  for (const n of nodes) {
    const frame = parentFrame(all, n, true);
    if (frame) n.parentId = frame.id;
  }
  s.checkpoint();
  s.setNodes(all, nodes.map((n) => n.id));
  s.setTool("select");
  ui.showToast(tc("toast.imagesAdded", nodes.length));
}

/** Opens the file picker; with `replaceId`, the chosen image replaces that node's picture. */
export function pickImages(replaceId?: string) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
  input.multiple = !replaceId;
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    if (replaceId) void replaceImage(replaceId, files[0]);
    else void importImages(files);
  };
  input.click();
}

async function replaceImage(id: string, file: File | undefined) {
  if (!file || !isImageFile(file)) return;
  try {
    const img = await uploadImage(file);
    const s = editor();
    s.checkpoint();
    s.updateNodes([id], { src: img.src });
  } catch (err) {
    useUi.getState().showToast(errorMessage(err instanceof Error ? err.message : "upload_failed"));
  }
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

/** Changes the stacking order among siblings; content moves along with its frame or group. */
export function zOrder(direction: "front" | "back" | "forward" | "backward") {
  const s = editor();
  const ids = new Set(s.selection);
  if (!ids.size) return;
  const nodes = reorderSiblings(s.nodes, (siblings) => {
    if (!siblings.some((n) => ids.has(n.id))) return siblings;
    const picked = siblings.filter((n) => ids.has(n.id));
    const rest = siblings.filter((n) => !ids.has(n.id));
    if (direction === "front") return [...rest, ...picked];
    if (direction === "back") return [...picked, ...rest];
    // Move each selected node one step past its neighbour, keeping selected nodes together.
    const list = [...siblings];
    const order = direction === "forward" ? [...list.keys()].reverse() : [...list.keys()];
    for (const i of order) {
      const j = direction === "forward" ? i + 1 : i - 1;
      if (j < 0 || j >= list.length || !ids.has(list[i].id) || ids.has(list[j].id)) continue;
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  });
  s.checkpoint();
  s.setNodes(nodes);
}

export function group() {
  const s = editor();
  const out = groupNodes(s.nodes, s.selection);
  if (!out) return;
  s.checkpoint();
  s.setNodes(out.nodes, [out.group]);
}

export function ungroup() {
  const s = editor();
  const out = ungroupNodes(s.nodes, s.selection);
  if (!out) return;
  s.checkpoint();
  s.setNodes(out.nodes, out.released);
}

/** Puts loose layers into their frames and groups each card/button with its content. */
export function organizeLayers() {
  const s = editor();
  const before = s.nodes.filter((n) => n.parentId).length;
  const out = autoOrganize(s.nodes);
  const after = out.nodes.filter((n) => n.parentId).length;
  if (!out.groups && after === before) return useUi.getState().showToast(t("toast.alreadyOrganized"));
  s.checkpoint();
  s.setNodes(out.nodes, []);
  useUi.getState().showToast(tc("toast.groupsCreated", out.groups));
}

export function toggleSelection(prop: "visible" | "locked") {
  const sel = selected();
  if (!sel.length) return;
  const value = !sel.every((n) => n[prop]);
  const s = editor();
  s.checkpoint();
  s.updateNodes(sel.map((n) => n.id), { [prop]: value });
}

/** Selects every sibling of the current selection (the top level when nothing is selected). */
export function selectAll() {
  const s = editor();
  const first = byId(s.nodes).get(s.selection[0] ?? "");
  const parentId = first?.parentId;
  s.select(s.nodes.filter((n) => n.parentId === parentId && n.visible && !n.locked).map((n) => n.id));
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
  useUi.getState().showToast(ok ? t("toast.pngExported") : t("toast.nothingToExport"));
}

/**
 * Saves the document (or the selection with its content) for the import plugin in
 * figma-plugin/, which rebuilds it as native, editable layers in Figma.
 */
export async function exportFigma() {
  const { nodes } = editor();
  const ids = withDescendants(nodes, exportTargets().map((n) => n.id));
  const picked = nodes.filter((n) => ids.has(n.id));
  // The file must stand alone: images travel inside it.
  const images = await inlineImages(picked.flatMap((n) => (n.src ? [n.src] : [])));
  const out = picked.map((n) => (n.src && images.has(n.src) ? { ...n, src: images.get(n.src) } : n));
  const doc = { format: "ars", version: 1, name: exportName(), nodes: out };
  download(new Blob([JSON.stringify(doc)], { type: "application/json" }), `${exportName()}.figma.json`);
  useUi.getState().showToast(t("toast.figmaExported"));
}

export async function exportSvg() {
  const ok = await downloadSvg(exportTargets(), exportName());
  useUi.getState().showToast(ok ? t("toast.svgExported") : t("toast.nothingToExport"));
}
