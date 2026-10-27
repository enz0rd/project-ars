import { z } from "zod/v4";
import { autoOrganize, groupNodes, ungroupNodes } from "../shared/tree.ts";
import { loadImage, storeAsset } from "./assets.ts";
import {
  NODE_DEFAULTS,
  PROTOTYPE_DIRECTIONS,
  PROTOTYPE_EASINGS,
  PROTOTYPE_TRANSITIONS,
  uid,
  type DesignNode,
  type DocOp,
} from "../shared/types.ts";

/**
 * Canvas-editing tools shared by the in-app Claude agent (server/ai.ts) and the
 * MCP server (server/mcp.ts). Each tool runs against a DocTarget, so the same
 * logic edits either a per-request working copy or the live browser document.
 */
export interface DocTarget {
  nodes(): DesignNode[];
  apply(ops: DocOp[]): void;
}

export const CANVAS_GUIDE = `Canvas model:
- Coordinates are in pixels, origin at the top-left, y grows downward.
- Nodes come as one flat array; array order is z-order: later nodes render on top.
- Hierarchy: "parentId" points at the containing frame or group. A frame is a screen/container; content placed on it
  should have its parentId and come after it. Coordinates stay absolute (canvas pixels) at every level.
  Moving a frame or group moves its content; deleting one deletes its content.
- A "group" has no look of its own; its box always wraps its children. Make groups with group_nodes
  (e.g. one per card, button or section) so the layers panel stays short; organize_layers does it automatically.
- Colors are hex strings like "#1E1E1E" (or "#RRGGBBAA" with alpha). Use "transparent" for no fill.
- Any node can have a drop shadow; subtle ones (e.g. y 4, blur 16, "#0000001A") look modern.
- Text nodes use "fill" as the text color; width/height define the text box.
- Image nodes show "src" covering their box (cropped to fit). Add pictures, logos and icons
  with import_image (base64 data or an https URL), which keeps the natural aspect ratio.

Guidelines:
- Produce clean, well-aligned layouts on an 8px grid with consistent spacing, sensible type scale and good contrast.
- Prefer create_nodes with many nodes in one call over many single calls.
- Give every node a meaningful name (it appears in the layers panel).
- Place new work in empty space unless asked to modify existing nodes.`;

const colorSchema = z.string().describe('Hex color like "#3B82F6", or "transparent"');

const nodeFields = {
  name: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional().describe("Degrees, clockwise"),
  fill: colorSchema.optional(),
  stroke: colorSchema.optional(),
  strokeWidth: z.number().optional(),
  cornerRadius: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  shadow: z
    .object({ x: z.number(), y: z.number(), blur: z.number().min(0), color: z.string().describe('Hex, alpha allowed: "#00000033"') })
    .nullable()
    .optional()
    .describe("Drop shadow; null removes it"),
  text: z.string().optional().describe("Text content (text nodes only)"),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional().describe("100-900"),
  fontFamily: z.string().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  src: z.string().optional().describe('Image nodes: an "asset:..." reference returned by import_image'),
  parentId: z.string().nullable().optional().describe("Id of the containing frame or group; null moves it to the top level"),
  prototypeToId: z.string().optional().describe("Prototype link: id of the top-level frame to show when this node is clicked in preview"),
  prototypeTransition: z
    .enum(PROTOTYPE_TRANSITIONS)
    .optional()
    .describe('"smart" morphs layers with the same name between the two frames (position, size, rotation, opacity)'),
  prototypeDirection: z.enum(PROTOTYPE_DIRECTIONS).optional().describe('"slide"/"push": the way the content moves, default "left"'),
  prototypeEasing: z.enum(PROTOTYPE_EASINGS).optional().describe('Default "ease"; "spring" overshoots slightly'),
  prototypeDurationMs: z.number().optional().describe("50-5000, default 280"),
};

const newNodeSchema = z.object({
  type: z.enum(["frame", "rect", "ellipse", "text", "image"]),
  ...nodeFields,
});

export const schemas = {
  createNodes: z.object({ nodes: z.array(newNodeSchema).min(1) }),
  updateNodes: z.object({ updates: z.array(z.object({ id: z.string(), ...nodeFields })).min(1) }),
  deleteNodes: z.object({ ids: z.array(z.string()).min(1) }),
  reorderNode: z.object({ id: z.string(), index: z.number().int().min(0) }),
  groupNodes: z.object({ ids: z.array(z.string()).min(1), name: z.string().optional() }),
  ungroupNodes: z.object({ ids: z.array(z.string()).min(1) }),
  organizeLayers: z.object({}),
  importImage: z.object({
    data: z.string().optional().describe("Image file contents, base64 (or a data: URL)"),
    mimeType: z.string().optional().describe('With data: "image/png", "image/svg+xml"…'),
    url: z.string().optional().describe("https URL of a public image"),
    path: z.string().optional().describe("Local file path — only on self-hosted installs with ARS_ALLOW_LOCAL_FILES=1"),
    name: z.string().optional(),
    x: z.number(),
    y: z.number(),
    width: z.number().optional().describe("Defaults to the natural width (or derived from height)"),
    height: z.number().optional().describe("Defaults to keeping the aspect ratio"),
    parentId: z.string().optional().describe("Frame or group to put it in"),
    cornerRadius: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
};

export const descriptions = {
  getDocument: "Return the current list of nodes on the canvas (in z-order, bottom to top) as JSON.",
  createNodes: "Create one or more nodes. They are appended on top of the z-order in the given order. Returns the new ids.",
  updateNodes: "Update properties of existing nodes. Only the given fields change.",
  deleteNodes: "Delete nodes by id.",
  reorderNode: "Move a node to a z-order index (0 = bottom, larger = higher).",
  groupNodes: "Wrap nodes in a new group (placed where the topmost of them was). Returns the group id.",
  ungroupNodes: "Dissolve groups; their children take the group's place.",
  importImage:
    "Place an image (photo, logo, icon) as an image node, from base64 data or an https URL. Give width or height to scale it; " +
    "the other side follows the aspect ratio. Returns the new id.",
  organizeLayers:
    "Tidy a flat document: put loose layers into the frame that contains them and group every card, button or panel " +
    "with the layers on top of it (each group named after its background shape).",
};

export function createNodes(doc: DocTarget, { nodes: specs }: z.infer<typeof schemas.createNodes>): string {
  const created = specs.map(buildNode);
  doc.apply(created.map((node) => ({ op: "create", node })));
  return JSON.stringify(created.map((n) => ({ id: n.id, name: n.name })));
}

export function updateNodes(doc: DocTarget, { updates }: z.infer<typeof schemas.updateNodes>): string {
  const known = new Set(doc.nodes().map((n) => n.id));
  const missing = updates.filter((u) => !known.has(u.id)).map((u) => u.id);
  doc.apply(
    updates
      .filter((u) => known.has(u.id))
      .map(({ id, parentId, ...patch }) => ({
        op: "update" as const,
        id,
        // null (top level) is stored as an absent parentId.
        patch: { ...stripUndefined(patch), ...(parentId !== undefined && { parentId: parentId ?? undefined }) },
      })),
  );
  return missing.length ? `Updated. Unknown ids skipped: ${missing.join(", ")}` : "Updated.";
}

export function deleteNodes(doc: DocTarget, { ids }: z.infer<typeof schemas.deleteNodes>): string {
  const known = new Set(doc.nodes().map((n) => n.id));
  doc.apply(ids.filter((id) => known.has(id)).map((id) => ({ op: "delete", id })));
  return "Deleted.";
}

export function groupNodesTool(doc: DocTarget, { ids, name }: z.infer<typeof schemas.groupNodes>): string {
  const out = groupNodes(doc.nodes(), ids, name);
  if (!out) return "Nothing to group: unknown ids.";
  doc.apply([{ op: "replace", nodes: out.nodes }]);
  return JSON.stringify({ id: out.group });
}

export function ungroupNodesTool(doc: DocTarget, { ids }: z.infer<typeof schemas.ungroupNodes>): string {
  const out = ungroupNodes(doc.nodes(), ids);
  if (!out) return "No groups among the given ids.";
  doc.apply([{ op: "replace", nodes: out.nodes }]);
  return `Ungrouped. Released: ${out.released.join(", ")}`;
}

export function organizeLayers(doc: DocTarget): string {
  const out = autoOrganize(doc.nodes());
  doc.apply([{ op: "replace", nodes: out.nodes }]);
  return `Organized: ${out.groups} groups created.`;
}

export async function importImage(
  doc: DocTarget,
  userId: string,
  input: z.infer<typeof schemas.importImage>,
): Promise<string> {
  const { data, mimeType, path, url, name, width, height, ...rest } = input;
  const { bytes, type } = await loadImage({ data, mimeType, path, url });
  const asset = await storeAsset(userId, bytes, type);
  const ratio = asset.width && asset.height ? asset.width / asset.height : 1;
  const w = width ?? (height ? height * ratio : (asset.width ?? 200));
  const h = height ?? w / ratio;
  const fallback = (path ?? url ?? "Image").split(/[\\/]/).pop()!.replace(/\.[a-z0-9]+$/i, "");
  return createNodes(doc, {
    nodes: [{ type: "image", name: name ?? fallback, src: asset.src, width: Math.round(w), height: Math.round(h), ...rest }],
  });
}

export function reorderNode(doc: DocTarget, { id, index }: z.infer<typeof schemas.reorderNode>): string {
  if (!doc.nodes().some((n) => n.id === id)) return `Unknown id ${id}`;
  doc.apply([{ op: "reorder", id, index }]);
  return "Reordered.";
}

function buildNode(input: z.infer<typeof newNodeSchema>): DesignNode {
  const { type, parentId, ...rest } = input;
  const base: DesignNode = {
    ...NODE_DEFAULTS,
    id: uid(),
    type,
    name: type === "text" ? (input.text ?? "Text").slice(0, 32) : type[0].toUpperCase() + type.slice(1),
  };
  if (type === "text") {
    Object.assign(base, { fill: "#000000", fontSize: 16, fontWeight: 400, fontFamily: "Inter", textAlign: "left", text: "Text", height: 24 });
  }
  if (type === "frame") base.fill = "#FFFFFF";
  if (type === "image") base.fill = "transparent";
  return { ...base, ...stripUndefined(rest), ...(parentId && { parentId }) };
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
