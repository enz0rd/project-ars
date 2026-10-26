import { Layers, SlidersHorizontal, Sparkles } from "lucide-react";
import { useT } from "../i18n/index.ts";
import { useUi } from "../ui.ts";
import { AiPanel } from "./AiPanel.tsx";
import { LayersPanel } from "./LayersPanel.tsx";
import { PropertiesPanel } from "./PropertiesPanel.tsx";

/** The single side panel: properties, layers and the assistant as tabs. */
export function Inspector() {
  const t = useT();
  const tab = useUi((s) => s.rightTab);
  const setTab = useUi((s) => s.setRightTab);
  const tabs = [
    { id: "design", label: t("inspector.design"), icon: <SlidersHorizontal size={14} /> },
    { id: "layers", label: t("inspector.layers"), icon: <Layers size={14} /> },
    { id: "claude", label: t("inspector.assistant"), icon: <Sparkles size={14} /> },
  ] as const;

  return (
    <aside className="panel inspector">
      <div className="tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>
      {/* All stay mounted so the chat keeps its state (and stream) while you edit. */}
      <div className="tab-body" hidden={tab !== "design"}>
        <PropertiesPanel />
      </div>
      <div className="tab-body" hidden={tab !== "layers"}>
        <LayersPanel />
      </div>
      <div className="tab-body" hidden={tab !== "claude"}>
        <AiPanel />
      </div>
    </aside>
  );
}
