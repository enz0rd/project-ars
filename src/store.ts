import { create } from "zustand";
import { normalize, transformDescendants, withDescendants, cloneSubtrees } from "../shared/tree.ts";
import { NODE_DEFAULTS, applyOp, uid, type DesignNode, type DocOp, type NodeType } from "../shared/types.ts";
import { parentFrame } from "./geometry.ts";

export type Tool = "select" | "hand" | Exclude<NodeType, "group" | "image">;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface EditorState {
  /** The open project (src/sync.ts loads and saves it). */
  projectId: string | null;
  docName: string;
  nodes: DesignNode[];
  selection: string[];
  tool: Tool;
  viewport: Viewport;
  past: DesignNode[][];
  future: DesignNode[][];

  setTool: (tool: Tool) => void;
  setViewport: (v: Viewport) => void;
  setDocName: (name: string) => void;
  select: (ids: string[]) => void;
  /** Push the current nodes onto the undo stack. Call once before a batch of changes. */
  checkpoint: () => void;
  addNode: (type: Exclude<NodeType, "group" | "image">, rect: { x: number; y: number; width: number; height: number }) => DesignNode;
  updateNodes: (ids: string[], patch: Partial<DesignNode> | ((n: DesignNode) => Partial<DesignNode>)) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  applyOps: (ops: DocOp[]) => void;
  /** Replace nodes (and optionally the selection) without touching history. The hierarchy is normalized. */
  setNodes: (nodes: DesignNode[], selection?: string[]) => void;
  replaceNodes: (nodes: DesignNode[]) => void;
  undo: () => void;
  redo: () => void;
}

const HISTORY_LIMIT = 100;

export const useEditor = create<EditorState>((set, get) => ({
  projectId: null,
  docName: "",
  nodes: [],
  selection: [],
  tool: "select",
  viewport: { x: 0, y: 0, zoom: 1 },
  past: [],
  future: [],

  setTool: (tool) => set({ tool }),
  setViewport: (viewport) => set({ viewport }),
  setDocName: (docName) => set({ docName }),
  select: (selection) => set({ selection }),

  checkpoint: () =>
    set((s) => ({ past: [...s.past.slice(-HISTORY_LIMIT + 1), s.nodes], future: [] })),

  addNode: (type, rect) => {
    get().checkpoint();
    const count = get().nodes.filter((n) => n.type === type).length + 1;
    const label = type[0].toUpperCase() + type.slice(1);
    const node: DesignNode = {
      ...NODE_DEFAULTS,
      ...rect,
      id: uid(),
      type,
      name: `${label} ${count}`,
      ...(type === "frame" && { fill: "#FFFFFF" }),
      ...(type === "text" && {
        fill: "#000000",
        text: "Text",
        fontSize: 16,
        fontWeight: 400,
        fontFamily: "Inter",
        textAlign: "left" as const,
      }),
    };
    // Shapes drawn on a frame belong to it.
    const frame = type === "frame" ? undefined : parentFrame([...get().nodes, node], node, true);
    if (frame) node.parentId = frame.id;
    set((s) => ({ nodes: normalize([...s.nodes, node]), selection: [node.id] }));
    return node;
  },

  updateNodes: (ids, patch) =>
    set((s) => {
      const targets = new Set(ids);
      const changes = new Map<string, { before: DesignNode; after: DesignNode }>();
      let nodes = s.nodes.map((n) => {
        if (!targets.has(n.id)) return n;
        const after = { ...n, ...(typeof patch === "function" ? patch(n) : patch), id: n.id };
        changes.set(n.id, { before: n, after });
        return after;
      });
      // Moving or resizing a frame or group carries its content along.
      nodes = transformDescendants(nodes, changes);
      return { nodes: normalize(nodes) };
    }),

  deleteSelection: () => {
    const { selection } = get();
    if (!selection.length) return;
    get().checkpoint();
    const doomed = withDescendants(get().nodes, selection);
    set((s) => ({ nodes: normalize(s.nodes.filter((n) => !doomed.has(n.id))), selection: [] }));
  },

  duplicateSelection: () => {
    const { selection, nodes } = get();
    if (!selection.length) return;
    get().checkpoint();
    const { copies, roots } = cloneSubtrees(nodes, selection, 16, 16, " copy");
    set((s) => ({ nodes: normalize([...s.nodes, ...copies]), selection: roots }));
  },

  applyOps: (ops) => set((s) => ({ nodes: normalize(ops.reduce(applyOp, s.nodes)) })),

  setNodes: (nodes, selection) => set(selection ? { nodes: normalize(nodes), selection } : { nodes: normalize(nodes) }),

  replaceNodes: (nodes) => {
    get().checkpoint();
    set({ nodes: normalize(nodes), selection: [] });
  },

  undo: () =>
    set((s) => {
      if (!s.past.length) return s;
      return { past: s.past.slice(0, -1), future: [s.nodes, ...s.future], nodes: s.past[s.past.length - 1], selection: [] };
    }),

  redo: () =>
    set((s) => {
      if (!s.future.length) return s;
      return { past: [...s.past, s.nodes], future: s.future.slice(1), nodes: s.future[0], selection: [] };
    }),
}));
