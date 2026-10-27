import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { byId, effective, withDescendants } from "../../shared/tree.ts";
import type { DesignNode, PrototypeDirection, PrototypeEasing, PrototypeTransition } from "../../shared/types.ts";
import { useAssetUrl } from "../assets.ts";
import { shadowFilter } from "../export.ts";
import { useT } from "../i18n/index.ts";
import { useEditor } from "../store.ts";
import { useUi } from "../ui.ts";

type Link = Pick<DesignNode, "prototypeTransition" | "prototypeDurationMs" | "prototypeDirection" | "prototypeEasing">;
type TransitionState = {
  toId: string;
  style: PrototypeTransition;
  duration: number;
  direction: PrototypeDirection;
  easing: PrototypeEasing;
  /** Where the entering frame is drawn, so it shows up in view when the page is scrolled. */
  top: number;
};

export function PrototypePlayer() {
  const t = useT();
  const nodes = useEditor((s) => s.nodes);
  const selection = useEditor((s) => s.selection);
  const setPrototypeOpen = useUi((s) => s.setPrototypeOpen);
  const frames = useMemo(() => nodes.filter((n) => n.type === "frame" && !n.parentId), [nodes]);
  const frameIds = frames.map((f) => f.id);
  const index = useMemo(() => byId(nodes), [nodes]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [transition, setTransition] = useState<TransitionState | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!frames.length) {
      setPrototypeOpen(false);
      return;
    }
    if (currentId && frameIds.includes(currentId)) return;
    const selected = selection.find((id) => frameIds.includes(id));
    setCurrentId(selected ?? frames[0].id);
  }, [currentId, frameIds, frames, selection, setPrototypeOpen]);

  const current = frames.find((f) => f.id === currentId) ?? null;

  const show = (toId: string) => {
    flushSync(() => {
      setCurrentId(toId);
      setTransition(null);
    });
    stageRef.current?.scrollTo({ top: 0 });
  };

  // Runs the transition once both frames are on screen, then swaps them.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const leave = viewport?.querySelector<SVGSVGElement>(".prototype-scene.leave");
    const enter = viewport?.querySelector<SVGSVGElement>(".prototype-scene.enter");
    const to = transition && index.get(transition.toId);
    if (!transition || !current || !to || !leave || !enter) return;
    const animations = animate(transition, leave, enter, current, to, nodes);
    let done = false;
    void Promise.all(animations.map((a) => a.finished))
      .then(() => {
        done = true;
        show(transition.toId);
        animations.forEach((a) => a.cancel());
      })
      .catch(() => {});
    return () => {
      if (!done) animations.forEach((a) => a.cancel());
    };
    // Live edits during a transition must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transition]);

  if (!current) return null;

  const goTo = (toId: string, link: Link) => {
    if (transition || !frameIds.includes(toId) || toId === current.id) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const style = reduced ? "instant" : link.prototypeTransition ?? "dissolve";
    if (style === "instant") return show(toId);
    const scrolled = (stageRef.current?.scrollTop ?? 0) - (viewportRef.current?.offsetTop ?? 0);
    setTransition({
      toId,
      style,
      duration: link.prototypeDurationMs ?? 280,
      direction: link.prototypeDirection ?? "left",
      easing: link.prototypeEasing ?? "ease",
      top: Math.max(0, scrolled),
    });
  };

  const nextFrame = (dir: 1 | -1) => {
    const at = frameIds.indexOf(current.id);
    const next = frameIds[(at + dir + frameIds.length) % frameIds.length];
    goTo(next, { prototypeTransition: "push", prototypeDirection: dir > 0 ? "left" : "right", prototypeDurationMs: 320, prototypeEasing: "easeInOut" });
  };

  const onActivate = (e: React.MouseEvent) => {
    const hitId = (e.target as Element).closest?.("[data-id]")?.getAttribute("data-id");
    const link = hitId ? linkOf(index, index.get(hitId)) : undefined;
    if (link?.prototypeToId) goTo(link.prototypeToId, link);
  };

  const toFrame = transition ? index.get(transition.toId) : undefined;

  return (
    <div className="prototype-player">
      <header className="prototype-topbar">
        <strong>{t("prototype.previewing", { name: current.name })}</strong>
        <div className="row">
          <button className="icon-btn sm" title={t("prototype.prev")} onClick={() => nextFrame(-1)}>
            <ChevronLeft size={14} />
          </button>
          <button className="icon-btn sm" title={t("prototype.next")} onClick={() => nextFrame(1)}>
            <ChevronRight size={14} />
          </button>
          <button className="icon-btn sm" title={t("common.close")} onClick={() => setPrototypeOpen(false)}>
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="prototype-stage" ref={stageRef} onClick={onActivate}>
        <div className="prototype-viewport" ref={viewportRef} style={{ width: `min(100%, ${Math.max(1, current.width)}px)` }}>
          <FrameScene key={current.id} frame={current} nodes={nodes} className={toFrame ? "leave" : ""} />
          {toFrame && transition && <FrameScene key={toFrame.id} frame={toFrame} nodes={nodes} className="enter" top={transition.top} />}
        </div>
      </div>
    </div>
  );
}

/** The node itself or the nearest group/frame above it that links somewhere. */
function linkOf(index: Map<string, DesignNode>, n: DesignNode | undefined) {
  while (n && !n.prototypeToId) n = n.parentId ? index.get(n.parentId) : undefined;
  return n;
}

const EASINGS: Record<PrototypeEasing, string> = {
  ease: "cubic-bezier(0.25, 0.1, 0.25, 1)",
  easeInOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  linear: "linear",
  spring:
    "linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1)",
};
/** Where the entering frame starts, in % of its size: "left" means content moves left. */
const OFFSETS: Record<PrototypeDirection, [number, number]> = { left: [100, 0], right: [-100, 0], up: [0, 100], down: [0, -100] };

function animate(tr: TransitionState, leave: SVGSVGElement, enter: SVGSVGElement, from: DesignNode, to: DesignNode, nodes: DesignNode[]) {
  const spring = tr.easing === "spring" && !CSS.supports("animation-timing-function", "linear(0, 1)");
  const opts: KeyframeAnimationOptions = { duration: tr.duration, easing: spring ? "cubic-bezier(0.34, 1.56, 0.64, 1)" : EASINGS[tr.easing], fill: "both" };
  const [dx, dy] = OFFSETS[tr.direction];
  const at = (x: number, y: number) => `translate(${x}%, ${y}%)`;
  switch (tr.style) {
    case "slide":
      return [enter.animate({ transform: [at(dx, dy), at(0, 0)] }, opts)];
    case "push":
      return [enter.animate({ transform: [at(dx, dy), at(0, 0)] }, opts), leave.animate({ transform: [at(0, 0), at(-dx, -dy)] }, opts)];
    case "smart":
      return smartAnimate(leave, enter, from, to, nodes, opts);
    default:
      return [enter.animate({ opacity: [0, 1] }, opts)];
  }
}

/**
 * Layers with the same name in both frames morph from their old box to the new one;
 * the rest of the new frame fades in over the old one.
 */
function smartAnimate(leave: SVGSVGElement, enter: SVGSVGElement, from: DesignNode, to: DesignNode, nodes: DesignNode[], opts: KeyframeAnimationOptions) {
  const index = byId(nodes);
  const before = layersByName(nodes, from);
  const animations: Animation[] = [];
  for (const [key, b] of layersByName(nodes, to)) {
    const el = enter.querySelector<SVGGElement>(`[data-node="${b.id}"]`);
    if (!el) continue;
    const opacity = effective(index, b).opacity;
    const a = key && before.get(key);
    if (!a) {
      animations.push(el.animate({ opacity: [0, opacity] }, opts));
      continue;
    }
    leave.querySelector(`[data-node="${a.id}"]`)?.setAttribute("visibility", "hidden");
    // Same transform list on both ends so each part interpolates on its own.
    const ax = a.x - from.x + to.x + a.width / 2;
    const ay = a.y - from.y + to.y + a.height / 2;
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    const back = `translate(${-bx}px, ${-by}px)`;
    // Colors and radius morph too (a text's color lives on its inner div).
    const paint = el.querySelector<SVGElement | HTMLElement>(b.type === "text" ? ".text-node" : "rect, ellipse");
    if (paint && a.fill !== b.fill) {
      animations.push(paint.animate(b.type === "text" ? { color: [a.fill, b.fill] } : { fill: [a.fill, b.fill] }, opts));
    }
    if (paint && b.type !== "text" && a.cornerRadius !== b.cornerRadius) {
      animations.push(paint.animate({ rx: [`${a.cornerRadius}px`, `${b.cornerRadius}px`] }, opts));
    }
    animations.push(
      el.animate(
        {
          transform: [
            `translate(${ax}px, ${ay}px) rotate(${a.rotation}deg) scale(${a.width / Math.max(1, b.width)}, ${a.height / Math.max(1, b.height)}) ${back}`,
            `translate(${bx}px, ${by}px) rotate(${b.rotation}deg) scale(1, 1) ${back}`,
          ],
          opacity: [effective(index, a).opacity, opacity],
        },
        opts,
      ),
    );
  }
  return animations;
}

/** Layers of a frame keyed by name (and occurrence, for repeated names); the frame itself never matches. */
function layersByName(nodes: DesignNode[], frame: DesignNode) {
  const inside = withDescendants(nodes, [frame.id]);
  const seen = new Map<string, number>();
  const out = new Map<string, DesignNode>();
  for (const n of nodes) {
    if (!inside.has(n.id) || n.type === "group") continue;
    if (n.id === frame.id) {
      out.set("", n);
      continue;
    }
    const i = seen.get(n.name) ?? 0;
    seen.set(n.name, i + 1);
    out.set(`${n.name}\n${i}`, n);
  }
  return out;
}

function FrameScene({ frame, nodes, className, top }: { frame: DesignNode; nodes: DesignNode[]; className?: string; top?: number }) {
  const include = withDescendants(nodes, [frame.id]);
  const index = byId(nodes);
  const scene = nodes.filter((n) => include.has(n.id) && n.type !== "group");
  return (
    <svg className={`prototype-scene ${className ?? ""}`} style={{ top }} viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}>
      <defs dangerouslySetInnerHTML={{ __html: scene.filter((n) => n.shadow).map((n) => shadowFilter(`shadow-${n.id}`, n.shadow!)).join("") }} />
      {scene.map((n) => {
        const eff = effective(index, n);
        return eff.visible ? <PrototypeNode key={n.id} node={n} opacity={eff.opacity} linked={!!linkOf(index, n)} /> : null;
      })}
    </svg>
  );
}

function PrototypeNode({ node: n, opacity, linked }: { node: DesignNode; opacity: number; linked: boolean }) {
  const imageUrl = useAssetUrl(n.type === "image" ? n.src : undefined);
  const shape = { "data-id": n.id, fill: n.fill, stroke: n.strokeWidth > 0 ? n.stroke : undefined, strokeWidth: n.strokeWidth || undefined };
  return (
    <g
      data-node={n.id}
      opacity={opacity}
      transform={rotation(n)}
      filter={n.shadow ? `url(#shadow-${n.id})` : undefined}
      style={linked ? { cursor: "pointer" } : undefined}
    >
      {n.type === "frame" || n.type === "rect" ? (
        <rect {...shape} x={n.x} y={n.y} width={n.width} height={n.height} rx={n.cornerRadius} />
      ) : n.type === "ellipse" ? (
        <ellipse {...shape} cx={n.x + n.width / 2} cy={n.y + n.height / 2} rx={n.width / 2} ry={n.height / 2} />
      ) : n.type === "text" ? (
        <foreignObject data-id={n.id} x={n.x} y={n.y} width={n.width} height={n.height}>
          <div data-id={n.id} className="text-node" style={textStyle(n)}>
            {n.text}
          </div>
        </foreignObject>
      ) : (
        <>
          <clipPath id={`clip-proto-${n.id}`}>
            <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={n.cornerRadius} />
          </clipPath>
          <image
            data-id={n.id}
            href={imageUrl}
            x={n.x}
            y={n.y}
            width={n.width}
            height={n.height}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#clip-proto-${n.id})`}
          />
        </>
      )}
    </g>
  );
}

function textStyle(n: DesignNode): React.CSSProperties {
  return {
    color: n.fill,
    fontSize: n.fontSize,
    fontWeight: n.fontWeight,
    fontFamily: `${n.fontFamily ?? "Inter"}, system-ui, sans-serif`,
    textAlign: n.textAlign,
    lineHeight: 1.25,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    width: "100%",
    height: "100%",
  };
}

function rotation(n: DesignNode) {
  return n.rotation ? `rotate(${n.rotation} ${n.x + n.width / 2} ${n.y + n.height / 2})` : undefined;
}
