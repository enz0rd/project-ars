import type { DesignNode } from "../shared/types.ts";
import { boundsOf } from "./geometry.ts";

const PADDING = 0;

/** Builds a standalone SVG for the given nodes (z-order preserved). */
export function toSvg(nodes: DesignNode[]): { svg: string; width: number; height: number } | null {
  const visible = nodes.filter((n) => n.visible);
  const b = boundsOf(visible);
  if (!b) return null;
  const width = Math.ceil(b.width + PADDING * 2);
  const height = Math.ceil(b.height + PADDING * 2);
  const ox = PADDING - b.x;
  const oy = PADDING - b.y;

  const defs: string[] = [];
  const body = visible.map((n) => {
    let filter = "";
    if (n.shadow) {
      defs.push(shadowFilter(`s-${n.id}`, n.shadow));
      filter = ` filter="url(#s-${n.id})"`;
    }
    const rot = n.rotation ? ` transform="rotate(${n.rotation} ${n.x + ox + n.width / 2} ${n.y + oy + n.height / 2})"` : "";
    return `<g opacity="${n.opacity}"${filter}${rot}>${shape(n, ox, oy)}</g>`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${
    defs.length ? `<defs>${defs.join("")}</defs>` : ""
  }${body.join("")}</svg>`;
  return { svg, width, height };
}

export function shadowFilter(id: string, s: NonNullable<DesignNode["shadow"]>) {
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${s.x}" dy="${s.y}" stdDeviation="${s.blur / 2}" flood-color="${esc(s.color)}"/></filter>`;
}

function shape(n: DesignNode, ox: number, oy: number): string {
  const x = n.x + ox;
  const y = n.y + oy;
  const stroke = n.strokeWidth > 0 ? ` stroke="${esc(n.stroke)}" stroke-width="${n.strokeWidth}"` : "";
  switch (n.type) {
    case "frame":
    case "rect":
      return `<rect x="${x}" y="${y}" width="${n.width}" height="${n.height}" rx="${n.cornerRadius}" fill="${esc(n.fill)}"${stroke}/>`;
    case "ellipse":
      return `<ellipse cx="${x + n.width / 2}" cy="${y + n.height / 2}" rx="${n.width / 2}" ry="${n.height / 2}" fill="${esc(n.fill)}"${stroke}/>`;
    case "text":
      return textSvg(n, x, y);
  }
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
  return `<text font-family="${esc(family)}, sans-serif" font-size="${size}" font-weight="${n.fontWeight ?? 400}" fill="${esc(n.fill)}" text-anchor="${anchor}">${tspans}</text>`;
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function downloadSvg(nodes: DesignNode[], name: string) {
  const out = toSvg(nodes);
  if (!out) return false;
  download(new Blob([out.svg], { type: "image/svg+xml" }), `${name}.svg`);
  return true;
}

export async function downloadPng(nodes: DesignNode[], name: string, scale = 2) {
  const out = toSvg(nodes);
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
