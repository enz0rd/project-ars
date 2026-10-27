import { NODE_DEFAULTS, PROTOTYPE_DIRECTIONS, PROTOTYPE_EASINGS, PROTOTYPE_TRANSITIONS, type DesignNode, type NodeType } from "./types.ts";

/**
 * Coerces untrusted node data (imported files, stored documents) into well-typed
 * nodes. Exports and previews build SVG markup from these fields, so a string
 * where a number belongs could otherwise break out of an attribute.
 */
const TYPES = new Set<NodeType>(["frame", "group", "rect", "ellipse", "text", "image"]);
const COLOR = /^(#[0-9a-f]{3,8}|transparent|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Images may only point at the user's storage, embedded data, or https. */
const SRC = /^(asset:[0-9a-f-]{36}\/[0-9a-f]{16,64}\.(png|jpg|gif|webp|svg)|data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+|https:\/\/\S+)$/;
const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : fallback);
const str = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.slice(0, max) : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[]): v is T => options.includes(v as T);
const color = (v: unknown, fallback: string) => (typeof v === "string" && COLOR.test(v.trim()) ? v.trim() : fallback);

export function sanitizeNodes(input: unknown): DesignNode[] {
  if (!Array.isArray(input)) return [];
  const out: DesignNode[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, 20000)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const type = r.type as NodeType;
    const id = typeof r.id === "string" && ID.test(r.id) ? r.id : "";
    if (!TYPES.has(type) || !id || seen.has(id)) continue;
    seen.add(id);
    const n: DesignNode = {
      ...NODE_DEFAULTS,
      id,
      type,
      name: str(r.name, 200, type),
      x: num(r.x),
      y: num(r.y),
      width: Math.max(0, num(r.width, 100)),
      height: Math.max(0, num(r.height, 100)),
      rotation: num(r.rotation),
      fill: color(r.fill, NODE_DEFAULTS.fill),
      stroke: color(r.stroke, NODE_DEFAULTS.stroke),
      strokeWidth: Math.max(0, num(r.strokeWidth)),
      cornerRadius: Math.max(0, num(r.cornerRadius)),
      opacity: Math.min(1, Math.max(0, num(r.opacity, 1))),
      visible: r.visible !== false,
      locked: r.locked === true,
    };
    if (typeof r.parentId === "string" && ID.test(r.parentId)) n.parentId = r.parentId;
    if (typeof r.prototypeToId === "string" && ID.test(r.prototypeToId)) n.prototypeToId = r.prototypeToId;
    if (oneOf(r.prototypeTransition, PROTOTYPE_TRANSITIONS)) n.prototypeTransition = r.prototypeTransition;
    if (oneOf(r.prototypeDirection, PROTOTYPE_DIRECTIONS)) n.prototypeDirection = r.prototypeDirection;
    if (oneOf(r.prototypeEasing, PROTOTYPE_EASINGS)) n.prototypeEasing = r.prototypeEasing;
    if (r.prototypeDurationMs !== undefined) n.prototypeDurationMs = Math.max(50, Math.min(5000, Math.round(num(r.prototypeDurationMs, 280))));
    const s = r.shadow as Record<string, unknown> | null | undefined;
    if (s && typeof s === "object") {
      n.shadow = { x: num(s.x), y: num(s.y), blur: Math.max(0, num(s.blur)), color: color(s.color, "#00000033") };
    }
    if (type === "text") {
      n.text = str(r.text, 20000);
      n.fontSize = Math.max(1, num(r.fontSize, 16));
      n.fontWeight = Math.min(900, Math.max(100, num(r.fontWeight, 400)));
      n.fontFamily = str(r.fontFamily, 80, "Inter").replace(/[^\w\s-]/g, "") || "Inter";
      n.textAlign = r.textAlign === "center" || r.textAlign === "right" ? r.textAlign : "left";
    }
    if (type === "image") n.src = typeof r.src === "string" && SRC.test(r.src) ? r.src : "";
    out.push(n);
  }
  return out;
}
