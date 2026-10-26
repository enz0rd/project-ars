import type { DesignNode } from "../shared/types.ts";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function boundsOf(nodes: Box[]): Box | null {
  if (!nodes.length) return null;
  const x = Math.min(...nodes.map((n) => n.x));
  const y = Math.min(...nodes.map((n) => n.y));
  const right = Math.max(...nodes.map((n) => n.x + n.width));
  const bottom = Math.max(...nodes.map((n) => n.y + n.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function intersects(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function contains(outer: Box, inner: Box) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The topmost frame below `node` in z-order that fully contains it. */
export function parentFrame(nodes: DesignNode[], node: DesignNode): DesignNode | undefined {
  const index = nodes.indexOf(node);
  for (let i = index - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.type === "frame" && n.visible && contains(n, node)) return n;
  }
}

export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };

const xEdges = (b: Box) => [b.x, b.x + b.width / 2, b.x + b.width];
const yEdges = (b: Box) => [b.y, b.y + b.height / 2, b.y + b.height];

/**
 * Smallest offset (within `threshold`) that aligns one of `edges` with one of `targets`.
 * Returns 0 when nothing is close enough.
 */
export function snapOffset(edges: number[], targets: number[], threshold: number): number {
  let best = 0;
  let bestDist = threshold;
  for (const e of edges) {
    for (const t of targets) {
      const d = Math.abs(t - e);
      if (d < bestDist) {
        bestDist = d;
        best = t - e;
      }
    }
  }
  return best;
}

export function snapTargets(others: Box[]) {
  return { xs: others.flatMap(xEdges), ys: others.flatMap(yEdges) };
}

/** Guide lines for every edge of `box` that lines up exactly with an edge of another box. */
export function guidesFor(box: Box, others: Box[]): Guide[] {
  const guides: Guide[] = [];
  for (const o of others) {
    for (const x of xEdges(box)) {
      if (xEdges(o).some((ox) => Math.abs(ox - x) < 0.5)) {
        guides.push({ axis: "x", at: x, from: Math.min(box.y, o.y), to: Math.max(box.y + box.height, o.y + o.height) });
      }
    }
    for (const y of yEdges(box)) {
      if (yEdges(o).some((oy) => Math.abs(oy - y) < 0.5)) {
        guides.push({ axis: "y", at: y, from: Math.min(box.x, o.x), to: Math.max(box.x + box.width, o.x + o.width) });
      }
    }
  }
  return guides;
}
