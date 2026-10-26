import { NODE_DEFAULTS, uid, type DesignNode } from "./types.ts";

/**
 * Layer hierarchy. Nodes stay in one flat array (array order is z-order) and point
 * at their container through `parentId`. Frames and groups can contain other nodes;
 * a group has no look of its own and its box always wraps its children.
 */

export const isContainer = (n: DesignNode | undefined) => n?.type === "frame" || n?.type === "group";

export function byId(nodes: DesignNode[]) {
  return new Map(nodes.map((n) => [n.id, n]));
}

/** Children of every node (key `""` = top level), in z-order. */
export function childrenOf(nodes: DesignNode[]) {
  const map = new Map<string, DesignNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? "";
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    list.push(n);
  }
  return map;
}

/** Ancestors of `node`, nearest first. */
export function ancestors(index: Map<string, DesignNode>, node: DesignNode): DesignNode[] {
  const out: DesignNode[] = [];
  let p = node.parentId ? index.get(node.parentId) : undefined;
  while (p && out.length < 64) {
    out.push(p);
    p = p.parentId ? index.get(p.parentId) : undefined;
  }
  return out;
}

/** `ids` plus everything inside them. */
export function withDescendants(nodes: DesignNode[], ids: Iterable<string>): Set<string> {
  const kids = childrenOf(nodes);
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    for (const c of kids.get(id) ?? []) visit(c.id);
  };
  for (const id of ids) visit(id);
  return out;
}

/** The given nodes minus any whose ancestor is also given, in z-order. */
export function topLevel(nodes: DesignNode[], ids: Iterable<string>): DesignNode[] {
  const set = new Set(ids);
  const index = byId(nodes);
  return nodes.filter((n) => set.has(n.id) && !ancestors(index, n).some((a) => set.has(a.id)));
}

/** Visibility, opacity and lock as inherited from the ancestors. */
export function effective(index: Map<string, DesignNode>, node: DesignNode) {
  let visible = node.visible;
  let opacity = node.opacity;
  let locked = node.locked;
  for (const a of ancestors(index, node)) {
    visible &&= a.visible;
    locked ||= a.locked;
    if (a.type === "group") opacity *= a.opacity;
  }
  return { visible, opacity, locked };
}

/**
 * Puts the array in canonical order (each node followed by its subtree, siblings
 * keeping their relative order), drops dangling or cyclic parents and fits every
 * group to its children.
 */
export function normalize(nodes: DesignNode[]): DesignNode[] {
  const index = byId(nodes);
  const fixed = nodes.map((n) => {
    if (!n.parentId) return n;
    const parent = index.get(n.parentId);
    const cyclic = parent && ancestors(index, parent).some((a) => a.id === n.id);
    if (!isContainer(parent) || parent!.id === n.id || cyclic) {
      const { parentId: _, ...rest } = n;
      return rest as DesignNode;
    }
    return n;
  });

  const kids = childrenOf(fixed);
  const ordered: DesignNode[] = [];
  const emit = (n: DesignNode): DesignNode[] => {
    const children = kids.get(n.id) ?? [];
    const placed = children.map(emit);
    if (n.type === "group" && children.length) {
      const boxes = placed.map((p) => p[0]);
      const x = Math.min(...boxes.map((b) => b.x));
      const y = Math.min(...boxes.map((b) => b.y));
      const width = Math.max(...boxes.map((b) => b.x + b.width)) - x;
      const height = Math.max(...boxes.map((b) => b.y + b.height)) - y;
      if (x !== n.x || y !== n.y || width !== n.width || height !== n.height || n.rotation) {
        n = { ...n, x, y, width, height, rotation: 0 };
      }
    }
    return [n, ...placed.flat()];
  };
  for (const root of kids.get("") ?? []) ordered.push(...emit(root));
  return ordered;
}

/** Copies whole subtrees with fresh ids. Copies of the roots keep the original parent. */
export function cloneSubtrees(nodes: DesignNode[], rootIds: Iterable<string>, dx = 0, dy = 0, suffix = "") {
  const roots = topLevel(nodes, rootIds);
  const all = withDescendants(nodes, roots.map((r) => r.id));
  const rootSet = new Set(roots.map((r) => r.id));
  const ids = new Map<string, string>();
  for (const id of all) ids.set(id, uid());
  const copies = nodes
    .filter((n) => all.has(n.id))
    .map((n) => ({
      ...n,
      id: ids.get(n.id)!,
      name: rootSet.has(n.id) ? n.name + suffix : n.name,
      parentId: n.parentId && ids.has(n.parentId) ? ids.get(n.parentId) : n.parentId,
      x: n.x + dx,
      y: n.y + dy,
    }));
  return { copies, roots: roots.map((r) => ids.get(r.id)!) };
}

/** Wraps the given nodes in a new group, placed where the topmost of them was. */
export function groupNodes(nodes: DesignNode[], ids: Iterable<string>, name = "Grupo") {
  const roots = topLevel(nodes, ids);
  if (!roots.length) return null;
  const top = roots[roots.length - 1];
  const group: DesignNode = {
    ...NODE_DEFAULTS,
    id: uid(),
    type: "group",
    name,
    fill: "transparent",
    ...(top.parentId && { parentId: top.parentId }),
  };
  const rootSet = new Set(roots.map((r) => r.id));
  const next = nodes.map((n) => (rootSet.has(n.id) ? { ...n, parentId: group.id } : n));
  next.splice(nodes.indexOf(top), 0, group);
  return { nodes: normalize(next), group: group.id };
}

/** Dissolves the given groups; their children take the group's place. */
export function ungroupNodes(nodes: DesignNode[], ids: Iterable<string>) {
  const index = byId(nodes);
  const groups = new Set([...ids].filter((id) => index.get(id)?.type === "group"));
  if (!groups.size) return null;
  const released: string[] = [];
  const next = nodes
    .filter((n) => !groups.has(n.id))
    .map((n) => {
      if (!n.parentId || !groups.has(n.parentId)) return n;
      released.push(n.id);
      const parentId = index.get(n.parentId)!.parentId;
      const { parentId: _, ...rest } = n;
      return (parentId ? { ...rest, parentId } : rest) as DesignNode;
    });
  return { nodes: normalize(next), released };
}

/**
 * Moves/scales a container's descendants after the container itself moved from
 * `before` to `after`. Frames carry their content along; groups also scale it.
 */
export function transformDescendants(
  nodes: DesignNode[],
  changes: Map<string, { before: DesignNode; after: DesignNode }>,
): DesignNode[] {
  if (![...changes.values()].some(({ after }) => isContainer(after))) return nodes;
  const index = byId(nodes);
  return nodes.map((n) => {
    if (changes.has(n.id)) return n;
    // The nearest changed container drives this node.
    const driver = ancestors(index, n).find((a) => changes.has(a.id));
    if (!driver) return n;
    const { before, after } = changes.get(driver.id)!;
    if (before.x === after.x && before.y === after.y && before.width === after.width && before.height === after.height) {
      return n;
    }
    if (after.type === "frame" || !before.width || !before.height) {
      return { ...n, x: n.x + after.x - before.x, y: n.y + after.y - before.y };
    }
    const sx = after.width / before.width;
    const sy = after.height / before.height;
    return {
      ...n,
      x: Math.round((after.x + (n.x - before.x) * sx) * 100) / 100,
      y: Math.round((after.y + (n.y - before.y) * sy) * 100) / 100,
      width: Math.round(n.width * sx * 100) / 100,
      height: Math.round(n.height * sy * 100) / 100,
    };
  });
}

type Box = { x: number; y: number; width: number; height: number };
const inside = (outer: Box, inner: Box, tol = 0.5) =>
  inner.x >= outer.x - tol &&
  inner.y >= outer.y - tol &&
  inner.x + inner.width <= outer.x + outer.width + tol &&
  inner.y + inner.height <= outer.y + outer.height + tol;

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/**
 * Builds a hierarchy for a flat document: nodes move into the frame that contains
 * them, and every shape that sits behind other layers (a card, a button, a panel)
 * becomes a group named after it, holding the shape and what lies on top of it.
 */
export function autoOrganize(nodes: DesignNode[]): { nodes: DesignNode[]; groups: number } {
  let next = nodes.map((n) => ({ ...n }));

  // 1. Frames adopt the top-level nodes they fully contain.
  for (let i = 0; i < next.length; i++) {
    const n = next[i];
    if (n.parentId) continue;
    for (let j = i - 1; j >= 0; j--) {
      const f = next[j];
      if (f.type === "frame" && inside(f, n)) {
        n.parentId = f.id;
        break;
      }
    }
  }
  next = normalize(next);

  // 2. Inside each container, shapes with content on top of them become groups.
  // Each new group with the background it is inserted in front of.
  const created: [DesignNode, string][] = [];
  const organize = (scope: DesignNode[], skipFirst: boolean) => {
    const claimed = new Set<string>();
    const candidates = scope
      .map((n, i) => ({ n, i }))
      .filter(({ n, i }) => (n.type === "rect" || n.type === "ellipse") && !(skipFirst && i === 0))
      .sort((a, b) => b.n.width * b.n.height - a.n.width * a.n.height);
    for (const { n: bg, i } of candidates) {
      if (claimed.has(bg.id)) continue;
      // A layer joins only if no layer left out between it and the background overlaps it,
      // so grouping never changes what is drawn on top of what.
      const members: DesignNode[] = [];
      const skipped: DesignNode[] = [];
      for (const m of scope.slice(i + 1)) {
        if (!claimed.has(m.id) && inside(bg, m) && !skipped.some((k) => overlaps(k, m))) members.push(m);
        else skipped.push(m);
      }
      if (!members.length) continue;
      const group: DesignNode = {
        ...NODE_DEFAULTS,
        id: uid(),
        type: "group",
        name: bg.name,
        fill: "transparent",
        ...(bg.parentId && { parentId: bg.parentId }),
      };
      const inner = [bg, ...members];
      for (const m of inner) {
        claimed.add(m.id);
        m.parentId = group.id;
      }
      created.push([group, bg.id]);
      // Nested cards get their own groups.
      organize(inner, true);
    }
  };
  const kids = childrenOf(next);
  organize(kids.get("") ?? [], false);
  for (const n of next) if (n.type === "frame") organize(kids.get(n.id) ?? [], false);

  // Each group takes its background's place in the z-order.
  for (const [group, at] of created) next.splice(next.findIndex((n) => n.id === at), 0, group);
  return { nodes: normalize(next), groups: created.length };
}

/** Rebuilds the array after `reorder` rearranges each list of siblings (bottom to top). */
export function reorderSiblings(nodes: DesignNode[], reorder: (siblings: DesignNode[]) => DesignNode[]): DesignNode[] {
  const kids = childrenOf(nodes);
  const out: DesignNode[] = [];
  const emit = (list: DesignNode[]) => {
    for (const n of reorder(list)) {
      out.push(n);
      emit(kids.get(n.id) ?? []);
    }
  };
  emit(kids.get("") ?? []);
  return normalize(out);
}

/** Moves `id` (with its content) next to `targetId`, as its sibling just above it. */
export function placeAbove(nodes: DesignNode[], id: string, targetId: string): DesignNode[] | null {
  const index = byId(nodes);
  const node = index.get(id);
  const target = index.get(targetId);
  if (!node || !target || id === targetId || ancestors(index, target).some((a) => a.id === id)) return null;
  const { parentId: _, ...rest } = node;
  const moved = (target.parentId ? { ...rest, parentId: target.parentId } : rest) as DesignNode;
  const next = nodes.filter((n) => n.id !== id);
  next.splice(next.indexOf(target) + 1, 0, moved);
  return normalize(next);
}
