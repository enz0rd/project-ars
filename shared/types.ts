export type NodeType = "frame" | "rect" | "ellipse" | "text";

export interface DesignNode {
  id: string;
  type: NodeType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  // text-only
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  textAlign?: "left" | "center" | "right";
}

/** Nodes are stored flat; array order is z-order (last = top). */
export interface DesignDocument {
  name: string;
  nodes: DesignNode[];
}

/** Mutations streamed from the AI server to the editor. */
export type DocOp =
  | { op: "create"; node: DesignNode }
  | { op: "update"; id: string; patch: Partial<DesignNode> }
  | { op: "delete"; id: string }
  | { op: "reorder"; id: string; index: number };

/** Server-sent events emitted by POST /api/ai. */
export type AiEvent =
  | { type: "text"; text: string }
  | { type: "op"; op: DocOp }
  | { type: "error"; message: string }
  | { type: "done" };

export interface AiChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AiRequest {
  prompt: string;
  document: DesignDocument;
  selection: string[];
  history: AiChatTurn[];
}

export const NODE_DEFAULTS: Omit<DesignNode, "id" | "type" | "name"> = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  fill: "#D9D9D9",
  stroke: "#000000",
  strokeWidth: 0,
  cornerRadius: 0,
  opacity: 1,
  visible: true,
  locked: false,
};

export function applyOp(nodes: DesignNode[], op: DocOp): DesignNode[] {
  switch (op.op) {
    case "create":
      return [...nodes.filter((n) => n.id !== op.node.id), op.node];
    case "update":
      return nodes.map((n) => (n.id === op.id ? { ...n, ...op.patch, id: n.id } : n));
    case "delete":
      return nodes.filter((n) => n.id !== op.id);
    case "reorder": {
      const node = nodes.find((n) => n.id === op.id);
      if (!node) return nodes;
      const rest = nodes.filter((n) => n.id !== op.id);
      const index = Math.max(0, Math.min(op.index, rest.length));
      return [...rest.slice(0, index), node, ...rest.slice(index)];
    }
  }
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
