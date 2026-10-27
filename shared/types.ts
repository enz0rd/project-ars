export type NodeType = "frame" | "group" | "rect" | "ellipse" | "text" | "image";

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
  shadow?: Shadow | null;
  /** Containing frame or group (see shared/tree.ts). */
  parentId?: string;
  /** Image-only: /api/assets/<file> (or a data: URL). The image covers the box. */
  src?: string;
  // text-only
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  textAlign?: "left" | "center" | "right";
}

export interface Shadow {
  x: number;
  y: number;
  blur: number;
  /** Hex color, optionally with alpha (#RRGGBBAA). */
  color: string;
}

/** Nodes are stored flat; array order is z-order (last = top). Hierarchy lives in `parentId`. */
export interface DesignDocument {
  name: string;
  nodes: DesignNode[];
}

/** Mutations streamed from the AI server to the editor. */
export type DocOp =
  | { op: "create"; node: DesignNode }
  | { op: "update"; id: string; patch: Partial<DesignNode> }
  | { op: "delete"; id: string }
  | { op: "reorder"; id: string; index: number }
  /** Whole-document result of a structural edit (grouping, organizing). */
  | { op: "replace"; nodes: DesignNode[] };

/** Server-sent events emitted by POST /api/ai. */
export type AiEvent =
  | { type: "text"; text: string }
  | { type: "op"; op: DocOp }
  /** Claude called a tool on a connected MCP server. */
  | { type: "mcp"; server: string; tool: string }
  | { type: "error"; message: string }
  | { type: "done" };

/** Events the API broadcasts to editors that have a project open (edits made through MCP). */
export type LiveEvent =
  /** Ops already saved as `version`. */
  | { type: "ops"; version: number; ops: DocOp[] }
  /** Too big to send: fetch the project again. */
  | { type: "reload"; version: number }
  | { type: "select"; ids: string[] };

export interface AiChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AiRequest {
  projectId: string;
  prompt: string;
  document: DesignDocument;
  selection: string[];
  history: AiChatTurn[];
}

/** Settings as the browser sees them: secrets are never included. */
export interface PublicSettings {
  ai: {
    /** Which provider the in-app assistant uses. */
    provider: "anthropic" | "openai";
    anthropic: { configured: boolean; last4: string | null };
    /** Any OpenAI-compatible Chat Completions API. */
    openai: { configured: boolean; last4: string | null; baseUrl: string | null; model: string | null };
  };
  mcpServers: { id: string; name: string; url: string; enabled: boolean; hasToken: boolean }[];
  /** MCP personal access tokens (only a hint of each). */
  tokens: { id: string; name: string; hint: string; created_at: string; last_used_at: string | null }[];
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
    case "delete": {
      // Deleting a frame or group deletes its contents too.
      const doomed = new Set([op.id]);
      for (const n of nodes) if (n.parentId && doomed.has(n.parentId)) doomed.add(n.id);
      return nodes.filter((n) => !doomed.has(n.id));
    }
    case "replace":
      return op.nodes;
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
