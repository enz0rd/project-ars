import { useEffect, useState } from "react";
import type { DesignNode } from "../../shared/types.ts";
import { useEditor } from "../store.ts";

export function PropertiesPanel() {
  const nodes = useEditor((s) => s.nodes);
  const selection = useEditor((s) => s.selection);
  const selected = nodes.filter((n) => selection.includes(n.id));

  if (!selected.length) {
    return (
      <section className="props">
        <div className="panel-title">Design</div>
        <div className="muted pad">Selecione uma camada para editar suas propriedades.</div>
      </section>
    );
  }

  // Show the first node's values; edits apply to all selected nodes.
  const n = selected[0];
  const ids = selected.map((s) => s.id);
  const isText = selected.every((s) => s.type === "text");

  return (
    <section className="props">
      <div className="panel-title">{selected.length > 1 ? `${selected.length} camadas` : n.name}</div>

      <Group title="Posição e tamanho">
        <div className="grid2">
          <NumField label="X" value={n.x} ids={ids} prop="x" />
          <NumField label="Y" value={n.y} ids={ids} prop="y" />
          <NumField label="W" value={n.width} ids={ids} prop="width" min={0} />
          <NumField label="H" value={n.height} ids={ids} prop="height" min={0} />
          <NumField label="↻" value={n.rotation} ids={ids} prop="rotation" />
          <NumField label="◜" value={n.cornerRadius} ids={ids} prop="cornerRadius" min={0} />
        </div>
      </Group>

      <Group title="Camada">
        <NumField label="Opacidade %" value={Math.round(n.opacity * 100)} ids={ids} prop="opacity" min={0} max={100} scale={0.01} />
      </Group>

      <Group title={isText ? "Cor do texto" : "Preenchimento"}>
        <ColorField value={n.fill} ids={ids} prop="fill" />
      </Group>

      {!isText && (
        <Group title="Borda">
          <ColorField value={n.stroke} ids={ids} prop="stroke" />
          <NumField label="Espessura" value={n.strokeWidth} ids={ids} prop="strokeWidth" min={0} />
        </Group>
      )}

      {isText && (
        <Group title="Texto">
          <TextField label="Fonte" value={n.fontFamily ?? "Inter"} ids={ids} prop="fontFamily" />
          <div className="grid2">
            <NumField label="Tam." value={n.fontSize ?? 16} ids={ids} prop="fontSize" min={1} />
            <NumField label="Peso" value={n.fontWeight ?? 400} ids={ids} prop="fontWeight" min={100} max={900} />
          </div>
          <div className="segmented">
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} className={n.textAlign === a ? "active" : ""} onClick={() => commit(ids, { textAlign: a })}>
                {a === "left" ? "⇤" : a === "center" ? "↔" : "⇥"}
              </button>
            ))}
          </div>
        </Group>
      )}
    </section>
  );
}

function commit(ids: string[], patch: Partial<DesignNode>) {
  const s = useEditor.getState();
  s.checkpoint();
  s.updateNodes(ids, patch);
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="group">
      <div className="group-title">{title}</div>
      {children}
    </div>
  );
}

type NumProp = "x" | "y" | "width" | "height" | "rotation" | "cornerRadius" | "opacity" | "strokeWidth" | "fontSize" | "fontWeight";

function NumField(props: { label: string; value: number; ids: string[]; prop: NumProp; min?: number; max?: number; scale?: number }) {
  const { label, value, ids, prop, min, max, scale = 1 } = props;
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const apply = () => {
    let v = Number(draft);
    if (!Number.isFinite(v)) return setDraft(String(value));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) commit(ids, { [prop]: v * scale });
    else setDraft(String(value));
  };

  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
}

function TextField(props: { label: string; value: string; ids: string[]; prop: "fontFamily" }) {
  const { label, value, ids, prop } = props;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && commit(ids, { [prop]: draft })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
}

function ColorField({ value, ids, prop }: { value: string; ids: string[]; prop: "fill" | "stroke" }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const isHex = /^#[0-9a-f]{6}$/i.test(value);

  return (
    <div className="color-field">
      <input
        type="color"
        value={isHex ? value : "#000000"}
        onFocus={() => useEditor.getState().checkpoint()}
        onChange={(e) => useEditor.getState().updateNodes(ids, { [prop]: e.target.value.toUpperCase() })}
      />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && commit(ids, { [prop]: draft })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </div>
  );
}
