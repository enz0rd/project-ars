import { Minus, Plus } from "lucide-react";
import { setZoom, zoomBy, zoomToFit, zoomToSelection } from "../actions.ts";
import { useT } from "../i18n/index.ts";
import { useEditor } from "../store.ts";
import { MenuButton } from "./Menu.tsx";

export function ZoomControls() {
  const t = useT();
  const zoom = useEditor((s) => s.viewport.zoom);
  const hasSelection = useEditor((s) => s.selection.length > 0);

  return (
    <div className="zoom-controls">
      <button className="icon-btn" title={`${t("zoom.out")} (Ctrl+-)`} onClick={() => zoomBy(1 / 1.25)}>
        <Minus size={14} />
      </button>
      <MenuButton
        className="zoom-value"
        align="up"
        title="Zoom"
        items={() => [
          { label: t("zoom.fit"), shortcut: "Shift+1", onSelect: zoomToFit },
          { label: t("zoom.selection"), shortcut: "Shift+2", disabled: !hasSelection, onSelect: zoomToSelection },
          { separator: true },
          { label: "50%", onSelect: () => setZoom(0.5) },
          { label: "100%", shortcut: "Shift+0", onSelect: () => setZoom(1) },
          { label: "200%", onSelect: () => setZoom(2) },
        ]}
      >
        {Math.round(zoom * 100)}%
      </MenuButton>
      <button className="icon-btn" title={`${t("zoom.in")} (Ctrl++)`} onClick={() => zoomBy(1.25)}>
        <Plus size={14} />
      </button>
    </div>
  );
}
