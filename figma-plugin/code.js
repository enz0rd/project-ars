// Rebuilds a Project Ars document (the .figma.json / .ars.json export, or a plain { nodes } JSON)
// as native Figma layers: frames, groups, rectangles, ellipses and editable text.

figma.showUI(__html__, { width: 360, height: 320, themeColors: true });

figma.ui.onmessage = async (msg) => {
  if (msg.type !== "import") return;
  try {
    const result = await importDocument(msg.doc);
    figma.ui.postMessage({ type: "done", ...result });
    figma.notify(`${result.count} layers imported`);
  } catch (err) {
    figma.ui.postMessage({ type: "error", message: String((err && err.message) || err) });
  }
};

async function importDocument(doc) {
  const nodes = Array.isArray(doc) ? doc : doc && doc.nodes;
  if (!Array.isArray(nodes) || !nodes.length) throw new Error("The file has no layers (nodes).");

  const fonts = await resolveFonts(nodes);
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map();
  for (const n of nodes) {
    const key = n.parentId && ids.has(n.parentId) ? n.parentId : "";
    if (!kids.has(key)) kids.set(key, []);
    kids.get(key).push(n);
  }

  // Keep the original layout, but next to whatever is already on the page.
  const page = figma.currentPage;
  const roots = kids.get("") || [];
  const minX = Math.min(...roots.map((n) => n.x));
  const minY = Math.min(...roots.map((n) => n.y));
  let origin = { x: 0, y: 0 };
  if (page.children.length) {
    const right = Math.max(...page.children.map((c) => c.x + c.width));
    const top = Math.min(...page.children.map((c) => c.y));
    origin = { x: minX - (right + 200), y: minY - top };
  }

  let count = 0;
  const build = (n, parent, origin) => {
    let node;
    if (n.type === "group") {
      const children = (kids.get(n.id) || []).map((c) => build(c, parent, origin)).filter(Boolean);
      if (!children.length) return null;
      node = figma.group(children, parent);
      node.name = n.name;
      node.opacity = n.opacity ?? 1;
      node.visible = n.visible !== false;
      node.locked = !!n.locked;
      count++;
      return node;
    }

    if (n.type === "image" && n.svg) {
      node = svgNode(n.svg, n);
      if (node) {
        parent.appendChild(node);
        node.name = n.name || "Image";
        if (n.cornerRadius) node.cornerRadius = n.cornerRadius;
        if (n.shadow) node.effects = [shadow(n.shadow)];
        node.opacity = n.opacity ?? 1;
        place(node, n, origin);
        node.visible = n.visible !== false;
        node.locked = !!n.locked;
        count++;
        return node;
      }
    }

    if (n.type === "frame") node = figma.createFrame();
    else if (n.type === "ellipse") node = figma.createEllipse();
    else if (n.type === "text") node = figma.createText();
    else node = figma.createRectangle();
    parent.appendChild(node);
    node.name = n.name || n.type;

    if (n.type === "text") {
      node.fontName = fonts.get(fontKey(n));
      node.characters = n.text || "";
      node.fontSize = n.fontSize || 16;
      node.lineHeight = { value: 125, unit: "PERCENT" };
      node.textAlignHorizontal = (n.textAlign || "left").toUpperCase();
      node.resize(Math.max(n.width, 1), Math.max(n.height, 1));
      node.textAutoResize = "HEIGHT";
    } else {
      node.resize(Math.max(n.width, 0.01), Math.max(n.height, 0.01));
      if (n.type !== "ellipse") node.cornerRadius = n.cornerRadius || 0;
    }
    node.fills = n.type === "image" ? imagePaints(n) : paints(n.fill);
    if (n.strokeWidth > 0) {
      node.strokes = paints(n.stroke);
      node.strokeWeight = n.strokeWidth;
      node.strokeAlign = "CENTER";
    }
    if (n.shadow) node.effects = [shadow(n.shadow)];
    node.opacity = n.opacity ?? 1;
    place(node, n, origin);

    if (n.type === "frame") {
      node.clipsContent = false;
      for (const c of kids.get(n.id) || []) build(c, node, { x: n.x, y: n.y });
    }
    node.visible = n.visible !== false;
    node.locked = !!n.locked;
    count++;
    return node;
  };

  const created = roots.map((n) => build(n, page, origin)).filter(Boolean);
  page.selection = created;
  figma.viewport.scrollAndZoomIntoView(created);
  return { count, missingFonts: [...fonts.missing] };
}

/** An SVG image as editable vectors, stretched to the node's box. */
function svgNode(svg, n) {
  let frame;
  try {
    frame = figma.createNodeFromSvg(svg);
  } catch {
    return null;
  }
  for (const child of frame.children) {
    if ("constraints" in child) child.constraints = { horizontal: "SCALE", vertical: "SCALE" };
  }
  frame.resize(Math.max(n.width, 0.01), Math.max(n.height, 0.01));
  frame.fills = [];
  frame.clipsContent = true;
  return frame;
}

/** A raster image as an image fill that covers the box, like the editor draws it. */
function imagePaints(n) {
  if (!n.bytes) return [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
  const image = figma.createImage(n.bytes instanceof Uint8Array ? n.bytes : new Uint8Array(Object.values(n.bytes)));
  return [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
}

/** Positions `node` relative to its container; rotation is clockwise around the centre. */
function place(node, n, origin) {
  const x = n.x - origin.x;
  const y = n.y - origin.y;
  const deg = n.rotation || 0;
  if (!deg) {
    node.x = x;
    node.y = y;
    return;
  }
  const t = (deg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const cx = x + n.width / 2;
  const cy = y + n.height / 2;
  const hx = -n.width / 2;
  const hy = -n.height / 2;
  node.relativeTransform = [
    [cos, -sin, cx + hx * cos - hy * sin],
    [sin, cos, cy + hx * sin + hy * cos],
  ];
}

function rgba(value) {
  let hex = String(value || "").trim().replace("#", "");
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null;
  const v = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return { r: v(0), g: v(2), b: v(4), a: hex.length === 8 ? v(6) : 1 };
}

function paints(value) {
  const c = rgba(value);
  if (!c) return [];
  return [{ type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }];
}

function shadow(s) {
  const c = rgba(s.color) || { r: 0, g: 0, b: 0, a: 0.25 };
  return {
    type: "DROP_SHADOW",
    color: c,
    offset: { x: s.x || 0, y: s.y || 0 },
    radius: s.blur || 0,
    spread: 0,
    visible: true,
    blendMode: "NORMAL",
  };
}

// Fonts

const WEIGHTS = [
  [/thin|hairline/, 100],
  [/extra ?light|ultra ?light/, 200],
  [/light/, 300],
  [/semi ?bold|demi ?bold/, 600],
  [/extra ?bold|ultra ?bold/, 800],
  [/black|heavy/, 900],
  [/bold/, 700],
  [/medium/, 500],
];

function styleWeight(style) {
  const s = style.toLowerCase();
  for (const [re, w] of WEIGHTS) if (re.test(s)) return w;
  return 400;
}

const fontKey = (n) => `${n.fontFamily || "Inter"}|${n.fontWeight || 400}`;

/** Loads the closest available style of each family/weight; unknown families fall back to Inter. */
async function resolveFonts(nodes) {
  const available = await figma.listAvailableFontsAsync();
  const families = new Map();
  for (const { fontName } of available) {
    if (/italic|oblique/i.test(fontName.style)) continue;
    if (!families.has(fontName.family)) families.set(fontName.family, []);
    families.get(fontName.family).push(fontName);
  }
  const closest = (family, weight) => {
    const styles = families.get(family);
    if (!styles) return null;
    return styles.reduce((best, f) =>
      Math.abs(styleWeight(f.style) - weight) < Math.abs(styleWeight(best.style) - weight) ? f : best,
    );
  };

  const out = new Map();
  out.missing = new Set();
  for (const n of nodes) {
    if (n.type !== "text" || out.has(fontKey(n))) continue;
    const family = n.fontFamily || "Inter";
    const weight = n.fontWeight || 400;
    let font = closest(family, weight);
    if (!font) {
      out.missing.add(family);
      font = closest("Inter", weight) || { family: "Inter", style: "Regular" };
    }
    await figma.loadFontAsync(font);
    out.set(fontKey(n), font);
  }
  return out;
}
