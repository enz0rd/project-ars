import { byId, childrenOf, effective, withDescendants } from "../shared/tree.ts";
import type { DesignNode } from "../shared/types.ts";
import { inlineImages } from "./assets.ts";
import { boundsOf } from "./geometry.ts";
import { useEditor } from "./store.ts";

const PADDING = 0;

/**
 * Builds a standalone SVG for the given nodes and everything inside them. Frames and
 * groups become nested <g> elements and every element carries its layer name as `id`,
 * which Figma uses as the layer name when the file is imported.
 */
export function toSvg(
  nodes: DesignNode[],
  /** URLs by image src (see inlineImages); images missing here keep their reference. */
  images = new Map<string, string>(),
  /** The whole document the nodes come from (defaults to the one open in the editor). */
  doc?: DesignNode[],
): { svg: string; width: number; height: number } | null {
  const all = withContent(nodes, doc);
  const index = byId(all);
  const visible = all.filter((n) => n.type !== "group" && effective(index, n).visible);
  const b = boundsOf(visible);
  if (!b) return null;
  const width = Math.ceil(b.width + PADDING * 2);
  const height = Math.ceil(b.height + PADDING * 2);
  const ox = PADDING - b.x;
  const oy = PADDING - b.y;

  const defs: string[] = [];
  const kids = childrenOf(all);
  const inSet = new Set(all.map((n) => n.id));
  const element = (n: DesignNode): string => {
    if (!n.visible) return "";
    const children = (kids.get(n.id) ?? []).map(element).join("");
    const id = ` id="${esc(n.name)}"`;
    if (n.type === "group") return `<g${id}${n.opacity < 1 ? ` opacity="${n.opacity}"` : ""}>${children}</g>`;
    let filter = "";
    if (n.shadow) {
      defs.push(shadowFilter(`s-${n.id}`, n.shadow));
      filter = ` filter="url(#s-${n.id})"`;
    }
    const rot = n.rotation ? ` transform="rotate(${n.rotation} ${n.x + ox + n.width / 2} ${n.y + oy + n.height / 2})"` : "";
    let body = shape(n, ox, oy);
    if (n.type === "image") {
      defs.push(`<clipPath id="c-${n.id}"><rect x="${n.x + ox}" y="${n.y + oy}" width="${n.width}" height="${n.height}" rx="${n.cornerRadius}"/></clipPath>`);
      body = imageSvg(n, ox, oy, images.get(n.src ?? "") ?? n.src ?? "");
    }
    const own = `<g${n.type === "frame" ? "" : id} opacity="${n.opacity}"${filter}${rot}>${body}</g>`;
    return n.type === "frame" ? `<g${id}>${own}${children}</g>` : own;
  };
  const roots = all.filter((n) => !n.parentId || !inSet.has(n.parentId));
  const body = roots.map(element);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${
    defs.length ? `<defs>${defs.join("")}</defs>` : ""
  }${body.join("")}</svg>`;
  return { svg, width, height };
}

/** The given nodes plus their content, in z-order. */
function withContent(nodes: DesignNode[], doc = useEditor.getState().nodes): DesignNode[] {
  const ids = withDescendants(doc, nodes.map((n) => n.id));
  const inDoc = doc.filter((n) => ids.has(n.id));
  return inDoc.length ? inDoc : nodes;
}

export function shadowFilter(id: string, s: NonNullable<DesignNode["shadow"]>) {
  const c = paint(s.color);
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${s.x}" dy="${s.y}" stdDeviation="${s.blur / 2}" flood-color="${c.color}" flood-opacity="${c.opacity}"/></filter>`;
}

/** Splits "#RRGGBBAA" into a color and an opacity, which every SVG reader understands. */
function paint(value: string): { color: string; opacity: number } {
  if (/^#[0-9a-f]{8}$/i.test(value)) {
    return { color: value.slice(0, 7), opacity: Math.round((parseInt(value.slice(7), 16) / 255) * 1000) / 1000 };
  }
  return { color: value === "transparent" ? "none" : esc(value), opacity: 1 };
}

function fillAttrs(value: string, attr: "fill" | "stroke" = "fill") {
  const p = paint(value);
  return ` ${attr}="${p.color}"${p.opacity < 1 ? ` ${attr}-opacity="${p.opacity}"` : ""}`;
}

function shape(n: DesignNode, ox: number, oy: number): string {
  const x = Number(n.x) + ox;
  const y = Number(n.y) + oy;
  const stroke = n.strokeWidth > 0 ? `${fillAttrs(n.stroke, "stroke")} stroke-width="${n.strokeWidth}"` : "";
  switch (n.type) {
    case "frame":
    case "rect":
      return `<rect x="${x}" y="${y}" width="${n.width}" height="${n.height}" rx="${n.cornerRadius}"${fillAttrs(n.fill)}${stroke}/>`;
    case "ellipse":
      return `<ellipse cx="${x + n.width / 2}" cy="${y + n.height / 2}" rx="${n.width / 2}" ry="${n.height / 2}"${fillAttrs(n.fill)}${stroke}/>`;
    case "text":
      return textSvg(n, x, y);
    case "group":
    case "image":
      return "";
  }
}

function imageSvg(n: DesignNode, ox: number, oy: number, href: string) {
  const stroke =
    n.strokeWidth > 0
      ? `<rect x="${n.x + ox}" y="${n.y + oy}" width="${n.width}" height="${n.height}" rx="${n.cornerRadius}" fill="none"${fillAttrs(n.stroke, "stroke")} stroke-width="${n.strokeWidth}"/>`
      : "";
  return `<image href="${esc(href)}" x="${n.x + ox}" y="${n.y + oy}" width="${n.width}" height="${n.height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c-${n.id})"/>${stroke}`;
}

/** toSvg with every image embedded, so the file stands on its own. */
async function standaloneSvg(nodes: DesignNode[]) {
  const srcs = withContent(nodes).flatMap((n) => (n.src ? [n.src] : []));
  return toSvg(nodes, await inlineImages(srcs));
}

const measure = document.createElement("canvas").getContext("2d")!;

/** SVG text has no wrapping, so lay out lines the way the editor's HTML text does. */
function textSvg(n: DesignNode, x: number, y: number): string {
  const size = n.fontSize ?? 16;
  const family = n.fontFamily ?? "Inter";
  measure.font = `${n.fontWeight ?? 400} ${size}px ${family}, sans-serif`;
  const lines: string[] = [];
  for (const paragraph of (n.text ?? "").split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure.measureText(next).width > n.width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  const anchor = n.textAlign === "center" ? "middle" : n.textAlign === "right" ? "end" : "start";
  const ax = n.textAlign === "center" ? x + n.width / 2 : n.textAlign === "right" ? x + n.width : x;
  const lineHeight = size * 1.25;
  const tspans = lines
    .map((l, i) => `<tspan x="${ax}" y="${y + lineHeight * i + size}">${esc(l)}</tspan>`)
    .join("");
  return `<text font-family="${esc(family)}, sans-serif" font-size="${size}" font-weight="${n.fontWeight ?? 400}"${fillAttrs(n.fill)} text-anchor="${anchor}">${tspans}</text>`;
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function downloadSvg(nodes: DesignNode[], name: string) {
  const out = await standaloneSvg(nodes);
  if (!out) return false;
  download(new Blob([out.svg], { type: "image/svg+xml" }), `${name}.svg`);
  return true;
}

export async function downloadPng(nodes: DesignNode[], name: string, scale = 2) {
  const out = await standaloneSvg(nodes);
  if (!out) return false;
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([out.svg], { type: "image/svg+xml" }));
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = out.width * scale;
  canvas.height = out.height * scale;
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return false;
  download(blob, `${name}.png`);
  return true;
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
