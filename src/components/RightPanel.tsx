import { SlidersHorizontal, Sparkles } from "lucide-react";
import { useUi } from "../ui.ts";
import { AiPanel } from "./AiPanel.tsx";
import { PropertiesPanel } from "./PropertiesPanel.tsx";

export function RightPanel() {
  const tab = useUi((s) => s.rightTab);
  const setTab = useUi((s) => s.setRightTab);

  return (
    <aside className="panel right">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "design"} className={tab === "design" ? "active" : ""} onClick={() => setTab("design")}>
          <SlidersHorizontal size={14} /> Design
        </button>
        <button role="tab" aria-selected={tab === "claude"} className={tab === "claude" ? "active" : ""} onClick={() => setTab("claude")}>
          <Sparkles size={14} /> Claude
        </button>
      </div>
      {/* Both stay mounted so the chat keeps its state (and stream) while you edit. */}
      <div className="tab-body" hidden={tab !== "design"}>
        <PropertiesPanel />
      </div>
      <div className="tab-body" hidden={tab !== "claude"}>
        <AiPanel />
      </div>
    </aside>
  );
}
