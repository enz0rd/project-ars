import { create } from "zustand";
import { NODE_DEFAULTS, applyOp, uid, type DesignNode, type DocOp, type NodeType } from "../shared/types.ts";

export type Tool = "select" | "hand" | NodeType;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface EditorState {
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
  addNode: (type: NodeType, rect: { x: number; y: number; width: number; height: number }) => DesignNode;
  updateNodes: (ids: string[], patch: Partial<DesignNode> | ((n: DesignNode) => Partial<DesignNode>)) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  moveInZ: (id: string, index: number) => void;
  applyOps: (ops: DocOp[]) => void;
  /** Replace nodes (and optionally the selection) without touching history. */
  setNodes: (nodes: DesignNode[], selection?: string[]) => void;
  replaceNodes: (nodes: DesignNode[]) => void;
  undo: () => void;
  redo: () => void;
}

const STORAGE_KEY = "figma-claude:doc";
const HISTORY_LIMIT = 100;

function load(): { docName: string; nodes: DesignNode[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore corrupt / unavailable storage
  }
  return { docName: "Untitled", nodes: [] };
}

const initial = load();

export const useEditor = create<EditorState>((set, get) => ({
  docName: initial.docName,
  nodes: initial.nodes,
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
    set((s) => ({ nodes: [...s.nodes, node], selection: [node.id] }));
    return node;
  },

  updateNodes: (ids, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        ids.includes(n.id) ? { ...n, ...(typeof patch === "function" ? patch(n) : patch) } : n,
      ),
    })),

  deleteSelection: () => {
    const { selection } = get();
    if (!selection.length) return;
    get().checkpoint();
    set((s) => ({ nodes: s.nodes.filter((n) => !selection.includes(n.id)), selection: [] }));
  },

  duplicateSelection: () => {
    const { selection, nodes } = get();
    if (!selection.length) return;
    get().checkpoint();
    const copies = nodes
      .filter((n) => selection.includes(n.id))
      .map((n) => ({ ...n, id: uid(), name: `${n.name} copy`, x: n.x + 16, y: n.y + 16 }));
    set((s) => ({ nodes: [...s.nodes, ...copies], selection: copies.map((c) => c.id) }));
  },

  moveInZ: (id, index) => {
    get().checkpoint();
    set((s) => ({ nodes: applyOp(s.nodes, { op: "reorder", id, index }) }));
  },

  applyOps: (ops) => set((s) => ({ nodes: ops.reduce(applyOp, s.nodes) })),

  setNodes: (nodes, selection) => set(selection ? { nodes, selection } : { nodes }),

  replaceNodes: (nodes) => {
    get().checkpoint();
    set({ nodes, selection: [] });
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

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useEditor.subscribe((s, prev) => {
  if (s.nodes === prev.nodes && s.docName === prev.docName) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ docName: s.docName, nodes: s.nodes }));
    } catch {
      // storage full or unavailable — the editor keeps working in memory
    }
  }, 300);
});
