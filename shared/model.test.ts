import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeNodes } from "./sanitize.ts";
import { autoOrganize, cloneSubtrees, groupNodes, normalize, placeAbove, transformDescendants, ungroupNodes } from "./tree.ts";
import { applyOp, NODE_DEFAULTS, type DesignNode } from "./types.ts";

const mk = (id: string, type: DesignNode["type"], x: number, y: number, w: number, h: number, parentId?: string): DesignNode => ({
  ...NODE_DEFAULTS,
  id,
  type,
  name: id,
  x,
  y,
  width: w,
  height: h,
  ...(parentId && { parentId }),
});

test("sanitize coerces hostile input into well-typed nodes", () => {
  const [n] = sanitizeNodes([
    { id: "a", type: "rect", x: '0" onload="alert(1)', width: "10", fill: "red;background:url(x)", name: 5, opacity: 9 },
  ]);
  assert.equal(n.x, 0);
  assert.equal(n.width, 10);
  assert.equal(n.fill, NODE_DEFAULTS.fill);
  assert.equal(n.name, "rect");
  assert.equal(n.opacity, 1);
  const [img] = sanitizeNodes([{ id: "i", type: "image", src: "javascript:alert(1)" }]);
  assert.equal(img.src, "");
  assert.equal(sanitizeNodes([{ id: "x", type: "script" }, { type: "rect" }, null, "str"]).length, 0);
  const [dupe, ...rest] = sanitizeNodes([mk("d", "rect", 0, 0, 1, 1), mk("d", "rect", 0, 0, 1, 1)]);
  assert.ok(dupe);
  assert.equal(rest.length, 0);
  const [font] = sanitizeNodes([{ id: "t", type: "text", fontFamily: 'Inter", serif; } <x', text: "<b>hi</b>" }]);
  assert.equal(font.fontFamily, "Inter serif  x");
  assert.equal(font.text, "<b>hi</b>");
  const [proto] = sanitizeNodes([{ id: "p", type: "rect", prototypeToId: "target", prototypeTransition: "smart", prototypeDurationMs: "700", prototypeDirection: "up", prototypeEasing: "bogus" }]);
  assert.equal(proto.prototypeToId, "target");
  assert.equal(proto.prototypeTransition, "smart");
  assert.equal(proto.prototypeDurationMs, 700);
  assert.equal(proto.prototypeDirection, "up");
  assert.equal(proto.prototypeEasing, undefined);
});

test("groups fit their children and move/scale them", () => {
  const nodes = normalize([mk("F", "frame", 0, 0, 500, 500), mk("G", "group", 0, 0, 0, 0, "F"), mk("a", "rect", 10, 10, 20, 20, "G"), mk("b", "rect", 50, 50, 50, 50, "G")]);
  const g = nodes.find((n) => n.id === "G")!;
  assert.deepEqual([g.x, g.y, g.width, g.height], [10, 10, 90, 90]);
  const f = nodes[0];
  const moved = normalize(transformDescendants(nodes.map((n) => (n.id === "F" ? { ...f, x: 100 } : n)), new Map([["F", { before: f, after: { ...f, x: 100 } }]])));
  assert.equal(moved.find((n) => n.id === "a")!.x, 110);
  const scaled = normalize(transformDescendants(nodes.map((n) => (n.id === "G" ? { ...g, width: 180, height: 180 } : n)), new Map([["G", { before: g, after: { ...g, width: 180, height: 180 } }]])));
  assert.equal(scaled.find((n) => n.id === "b")!.width, 100);
});

test("group/ungroup round-trips and deletes cascade", () => {
  const nodes = normalize([mk("a", "rect", 0, 0, 10, 10), mk("b", "rect", 20, 0, 10, 10), mk("c", "rect", 40, 0, 10, 10)]);
  const grouped = groupNodes(nodes, ["a", "b"])!;
  assert.equal(grouped.nodes.find((n) => n.id === "a")!.parentId, grouped.group);
  assert.deepEqual(ungroupNodes(grouped.nodes, [grouped.group])!.nodes, nodes);
  assert.deepEqual(applyOp(grouped.nodes, { op: "delete", id: grouped.group }).map((n) => n.id), ["c"]);
});

test("copies remap parents; layers can't be dropped into themselves", () => {
  const nodes = normalize([mk("G", "group", 0, 0, 0, 0), mk("a", "rect", 0, 0, 10, 10, "G")]);
  const { copies, roots } = cloneSubtrees(nodes, ["G"], 5, 5);
  assert.equal(copies.length, 2);
  assert.equal(copies.find((c) => c.id !== roots[0])!.parentId, roots[0]);
  assert.equal(placeAbove(nodes, "G", "a"), null);
});

test("auto-organize nests content without moving or restacking anything", () => {
  const nodes = [
    mk("F", "frame", 0, 0, 400, 400),
    mk("card", "rect", 10, 10, 200, 100),
    mk("title", "text", 20, 20, 100, 20),
    mk("btn", "rect", 20, 60, 80, 30),
    mk("label", "text", 25, 65, 60, 20),
  ];
  const { nodes: out, groups } = autoOrganize(nodes);
  assert.equal(groups, 2);
  assert.ok(out.filter((n) => n.type !== "group").every((n) => n.id === "F" || n.parentId));
  assert.deepEqual(out.filter((n) => n.type !== "group").map((n) => n.id), nodes.map((n) => n.id));
});
