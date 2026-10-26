import { z } from "zod/v4";
import { NODE_DEFAULTS, uid, type DesignNode, type DocOp } from "../shared/types.ts";

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
- Nodes are flat (no nesting). Array order is z-order: later nodes render on top.
  A "frame" is a background container (e.g. a screen or card); put its contents after it so they render above.
- Colors are hex strings like "#1E1E1E" (or "#RRGGBBAA" with alpha). Use "transparent" for no fill.
- Any node can have a drop shadow; subtle ones (e.g. y 4, blur 16, "#0000001A") look modern.
- Text nodes use "fill" as the text color; width/height define the text box.

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
};

const newNodeSchema = z.object({
  type: z.enum(["frame", "rect", "ellipse", "text"]),
  ...nodeFields,
});

export const schemas = {
  createNodes: z.object({ nodes: z.array(newNodeSchema).min(1) }),
  updateNodes: z.object({ updates: z.array(z.object({ id: z.string(), ...nodeFields })).min(1) }),
  deleteNodes: z.object({ ids: z.array(z.string()).min(1) }),
  reorderNode: z.object({ id: z.string(), index: z.number().int().min(0) }),
};

export const descriptions = {
  getDocument: "Return the current list of nodes on the canvas (in z-order, bottom to top) as JSON.",
  createNodes: "Create one or more nodes. They are appended on top of the z-order in the given order. Returns the new ids.",
  updateNodes: "Update properties of existing nodes. Only the given fields change.",
  deleteNodes: "Delete nodes by id.",
  reorderNode: "Move a node to a z-order index (0 = bottom, larger = higher).",
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
      .map(({ id, ...patch }) => ({ op: "update", id, patch: stripUndefined(patch) })),
  );
  return missing.length ? `Updated. Unknown ids skipped: ${missing.join(", ")}` : "Updated.";
}

export function deleteNodes(doc: DocTarget, { ids }: z.infer<typeof schemas.deleteNodes>): string {
  const known = new Set(doc.nodes().map((n) => n.id));
  doc.apply(ids.filter((id) => known.has(id)).map((id) => ({ op: "delete", id })));
  return "Deleted.";
}

export function reorderNode(doc: DocTarget, { id, index }: z.infer<typeof schemas.reorderNode>): string {
  if (!doc.nodes().some((n) => n.id === id)) return `Unknown id ${id}`;
  doc.apply([{ op: "reorder", id, index }]);
  return "Reordered.";
}

function buildNode(input: z.infer<typeof newNodeSchema>): DesignNode {
  const { type, ...rest } = input;
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
  return { ...base, ...stripUndefined(rest) };
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
