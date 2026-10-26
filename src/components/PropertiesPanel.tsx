import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ImageDown,
  Minus,
  Plus,
  RotateCw,
  Sparkles,
  SquareRoundCorner,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { DesignNode, Shadow } from "../../shared/types.ts";
import { align, distribute, exportPng, exportSvg } from "../actions.ts";
import { useEditor } from "../store.ts";
import { useUi } from "../ui.ts";

const DEFAULT_SHADOW: Shadow = { x: 0, y: 4, blur: 16, color: "#0000001F" };

export function PropertiesPanel() {
  const nodes = useEditor((s) => s.nodes);
  const selection = useEditor((s) => s.selection);
  const selected = nodes.filter((n) => selection.includes(n.id));

  if (!selected.length) return <DocumentInfo />;

  // Show the first node's values; edits apply to all selected nodes.
  const n = selected[0];
  const ids = selected.map((s) => s.id);
  const isText = selected.every((s) => s.type === "text");
  const hasRadius = selected.every((s) => s.type === "rect" || s.type === "frame");

  return (
    <div className="props">
      <div className="props-title">
        <span>{selected.length > 1 ? `${selected.length} camadas` : n.name}</span>
        <span className="type-chip">{selected.length > 1 ? "Misto" : TYPE_LABEL[n.type]}</span>
      </div>

      <Section>
        <div className="align-bar">
          <IconAction title="Alinhar à esquerda (Alt+A)" onClick={() => align("left")} icon={<AlignStartVertical size={15} />} />
          <IconAction title="Centralizar horizontalmente (Alt+H)" onClick={() => align("hcenter")} icon={<AlignCenterVertical size={15} />} />
          <IconAction title="Alinhar à direita (Alt+D)" onClick={() => align("right")} icon={<AlignEndVertical size={15} />} />
          <IconAction title="Alinhar ao topo (Alt+W)" onClick={() => align("top")} icon={<AlignStartHorizontal size={15} />} />
          <IconAction title="Centralizar verticalmente (Alt+V)" onClick={() => align("vcenter")} icon={<AlignCenterHorizontal size={15} />} />
          <IconAction title="Alinhar à base (Alt+S)" onClick={() => align("bottom")} icon={<AlignEndHorizontal size={15} />} />
          <IconAction
            title="Distribuir horizontalmente"
            disabled={selected.length < 3}
            onClick={() => distribute("h")}
            icon={<AlignHorizontalDistributeCenter size={15} />}
          />
          <IconAction
            title="Distribuir verticalmente"
            disabled={selected.length < 3}
            onClick={() => distribute("v")}
            icon={<AlignVerticalDistributeCenter size={15} />}
          />
        </div>
      </Section>

      <Section title="Layout">
        <div className="grid2">
          <NumField label="X" value={n.x} ids={ids} prop="x" />
          <NumField label="Y" value={n.y} ids={ids} prop="y" />
          <NumField label="W" value={n.width} ids={ids} prop="width" min={0} />
          <NumField label="H" value={n.height} ids={ids} prop="height" min={0} />
          <NumField label={<RotateCw size={12} />} value={n.rotation} ids={ids} prop="rotation" suffix="°" />
          {hasRadius && (
            <NumField label={<SquareRoundCorner size={12} />} value={n.cornerRadius} ids={ids} prop="cornerRadius" min={0} />
          )}
        </div>
      </Section>

      <Section title="Camada">
        <OpacityField value={n.opacity} ids={ids} />
      </Section>

      <Section title={isText ? "Cor do texto" : "Preenchimento"}>
        <ColorField value={n.fill} ids={ids} prop="fill" />
      </Section>

      {isText && (
        <Section title="Tipografia">
          <TextField value={n.fontFamily ?? "Inter"} ids={ids} />
          <div className="grid2">
            <NumField label="Tam" value={n.fontSize ?? 16} ids={ids} prop="fontSize" min={1} />
            <WeightField value={n.fontWeight ?? 400} ids={ids} />
          </div>
          <div className="segmented">
            {(
              [
                ["left", <AlignLeft size={14} />],
                ["center", <AlignCenter size={14} />],
                ["right", <AlignRight size={14} />],
              ] as const
            ).map(([a, icon]) => (
              <button key={a} className={n.textAlign === a ? "active" : ""} onClick={() => commit(ids, { textAlign: a })}>
                {icon}
              </button>
            ))}
          </div>
        </Section>
      )}

      {!isText && (
        <Section
          title="Borda"
          action={
            n.strokeWidth > 0 ? (
              <IconAction title="Remover borda" onClick={() => commit(ids, { strokeWidth: 0 })} icon={<Minus size={14} />} />
            ) : (
              <IconAction title="Adicionar borda" onClick={() => commit(ids, { strokeWidth: 1 })} icon={<Plus size={14} />} />
            )
          }
        >
          {n.strokeWidth > 0 && (
            <div className="row">
              <ColorField value={n.stroke} ids={ids} prop="stroke" />
              <div className="narrow">
                <NumField label="px" value={n.strokeWidth} ids={ids} prop="strokeWidth" min={0} />
              </div>
            </div>
          )}
        </Section>
      )}

      <Section
        title="Sombra"
        action={
          n.shadow ? (
            <IconAction title="Remover sombra" onClick={() => commit(ids, { shadow: null })} icon={<Minus size={14} />} />
          ) : (
            <IconAction title="Adicionar sombra" onClick={() => commit(ids, { shadow: DEFAULT_SHADOW })} icon={<Plus size={14} />} />
          )
        }
      >
        {n.shadow && <ShadowFields shadow={n.shadow} ids={ids} />}
      </Section>

      <Section title="Exportar">
        <div className="row">
          <button className="btn subtle grow" onClick={() => exportPng(2)}>
            <ImageDown size={14} /> PNG 2x
          </button>
          <button className="btn subtle grow" onClick={exportSvg}>
            SVG
          </button>
        </div>
      </Section>
    </div>
  );
}

const TYPE_LABEL: Record<DesignNode["type"], string> = { frame: "Frame", rect: "Retângulo", ellipse: "Elipse", text: "Texto" };

function DocumentInfo() {
  const nodes = useEditor((s) => s.nodes);
  const askClaude = useUi((s) => s.askClaude);
  const counts = nodes.reduce<Record<string, number>>((acc, n) => ({ ...acc, [n.type]: (acc[n.type] ?? 0) + 1 }), {});

  return (
    <div className="props">
      <div className="props-title">
        <span>Documento</span>
      </div>
      <Section title="Resumo">
        <div className="stats">
          {(["frame", "rect", "ellipse", "text"] as const).map((t) => (
            <div key={t} className="stat">
              <strong>{counts[t] ?? 0}</strong>
              <span>{TYPE_LABEL[t]}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Dicas">
        <ul className="tips">
          <li>Selecione uma camada para editar suas propriedades.</li>
          <li>Arraste com Alt para duplicar; segure Ctrl para mover sem guias.</li>
          <li>Clique com o botão direito para mais opções.</li>
        </ul>
        <button className="btn ai grow" onClick={askClaude}>
          <Sparkles size={14} /> Pedir um layout ao Claude
        </button>
      </Section>
    </div>
  );
}

function commit(ids: string[], patch: Partial<DesignNode>) {
  const s = useEditor.getState();
  s.checkpoint();
  s.updateNodes(ids, patch);
}

function Section({ title, action, children }: { title?: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="section">
      {title && (
        <div className="section-title">
          <span>{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function IconAction({ title, icon, onClick, disabled }: { title: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="icon-btn sm" title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      {icon}
    </button>
  );
}

type NumProp = "x" | "y" | "width" | "height" | "rotation" | "cornerRadius" | "strokeWidth" | "fontSize";

/** Numeric input; drag the label horizontally to scrub the value, like Figma. */
function NumField(props: {
  label: React.ReactNode;
  value: number;
  ids: string[];
  prop: NumProp;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const { label, value, ids, prop, min, max, suffix } = props;
  const [draft, setDraft] = useState(String(round(value)));
  useEffect(() => setDraft(String(round(value))), [value]);

  const clampV = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));

  const apply = () => {
    const v = evaluate(draft);
    if (v === null) return setDraft(String(round(value)));
    const next = clampV(v);
    if (next !== value) commit(ids, { [prop]: next });
    else setDraft(String(round(value)));
  };

  const onScrubStart = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const start = value;
    let started = false;
    const move = (ev: PointerEvent) => {
      const delta = Math.round((ev.clientX - startX) / 2) * (ev.shiftKey ? 10 : 1);
      if (!started && delta) {
        useEditor.getState().checkpoint();
        started = true;
      }
      if (started) useEditor.getState().updateNodes(ids, { [prop]: clampV(start + delta) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <label className="field">
      <span className="field-label scrub" onPointerDown={onScrubStart}>
        {label}
      </span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const step = (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
            commit(ids, { [prop]: clampV(value + step) });
          }
        }}
      />
      {suffix && <span className="field-suffix">{suffix}</span>}
    </label>
  );
}

function OpacityField({ value, ids }: { value: number; ids: string[] }) {
  return (
    <div className="row">
      <input
        type="range"
        className="range grow"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onPointerDown={() => useEditor.getState().checkpoint()}
        onChange={(e) => useEditor.getState().updateNodes(ids, { opacity: Number(e.target.value) / 100 })}
      />
      <span className="value-chip">{Math.round(value * 100)}%</span>
    </div>
  );
}

const WEIGHTS = [
  [100, "Thin"],
  [300, "Light"],
  [400, "Regular"],
  [500, "Medium"],
  [600, "Semibold"],
  [700, "Bold"],
  [800, "Extrabold"],
  [900, "Black"],
] as const;

function WeightField({ value, ids }: { value: number; ids: string[] }) {
  return (
    <label className="field">
      <select value={value} onChange={(e) => commit(ids, { fontWeight: Number(e.target.value) })}>
        {WEIGHTS.map(([w, name]) => (
          <option key={w} value={w}>
            {name}
          </option>
        ))}
        {!WEIGHTS.some(([w]) => w === value) && <option value={value}>{value}</option>}
      </select>
    </label>
  );
}

const FONTS = ["Inter", "Roboto", "Poppins", "Montserrat", "Playfair Display", "JetBrains Mono", "system-ui", "Georgia"];

function TextField({ value, ids }: { value: string; ids: string[] }) {
  return (
    <label className="field">
      <select value={value} onChange={(e) => commit(ids, { fontFamily: e.target.value })}>
        {FONTS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
        {!FONTS.includes(value) && <option value={value}>{value}</option>}
      </select>
    </label>
  );
}

function ColorField({ value, ids, prop }: { value: string; ids: string[]; prop: "fill" | "stroke" }) {
  return <ColorInput value={value} onPreview={(v) => useEditor.getState().updateNodes(ids, { [prop]: v })} onCommit={(v) => commit(ids, { [prop]: v })} />;
}

/** Swatch + hex input. `onPreview` updates live while picking; `onCommit` records an undo step. */
function ColorInput({
  value,
  onPreview,
  onCommit,
}: {
  value: string;
  onPreview: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const hex6 = /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : "#000000";
  const alpha = /^#[0-9a-f]{8}$/i.test(value) ? value.slice(7) : "";

  return (
    <div className="color-field grow">
      <label className="swatch" style={{ background: value === "transparent" ? undefined : value }}>
        <input
          type="color"
          value={hex6}
          onFocus={() => useEditor.getState().checkpoint()}
          onChange={(e) => onPreview(e.target.value.toUpperCase() + alpha)}
        />
      </label>
      <input
        className="hex"
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          let v = draft.trim();
          if (/^[0-9a-f]{3,8}$/i.test(v)) v = `#${v}`;
          if (v !== value) onCommit(v.toUpperCase().replace("TRANSPARENT", "transparent"));
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </div>
  );
}

function ShadowFields({ shadow, ids }: { shadow: Shadow; ids: string[] }) {
  const set = (patch: Partial<Shadow>) => commit(ids, { shadow: { ...shadow, ...patch } });
  return (
    <>
      <div className="grid3">
        {(["x", "y", "blur"] as const).map((k) => (
          <label key={k} className="field">
            <span className="field-label">{k === "blur" ? "Blur" : k.toUpperCase()}</span>
            <input
              defaultValue={shadow[k]}
              key={shadow[k]}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v !== shadow[k]) set({ [k]: k === "blur" ? Math.max(0, v) : v });
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </label>
        ))}
      </div>
      <ColorInput
        value={shadow.color}
        onPreview={(v) => useEditor.getState().updateNodes(ids, { shadow: { ...shadow, color: v } })}
        onCommit={(v) => set({ color: v })}
      />
    </>
  );
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}

/** Accepts plain numbers and simple arithmetic like "120+16" or "375/2". */
function evaluate(input: string): number | null {
  const expr = input.replace(/,/g, ".").trim();
  if (!/^[\d.+\-*/() ]+$/.test(expr)) return null;
  try {
    const v = Function(`"use strict"; return (${expr});`)() as unknown;
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  } catch {
    return null;
  }
}
