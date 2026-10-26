import { useEffect } from "react";
import * as actions from "../actions.ts";
import { Canvas, isTyping } from "../components/Canvas.tsx";
import { ContextMenu } from "../components/ContextMenu.tsx";
import { Inspector } from "../components/Inspector.tsx";
import { SettingsModal } from "../components/SettingsModal.tsx";
import { ShortcutsDialog } from "../components/ShortcutsDialog.tsx";
import { Toast } from "../components/Toast.tsx";
import { TOOL_KEYS, ToolRail } from "../components/ToolRail.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { ZoomControls } from "../components/ZoomControls.tsx";
import { useT } from "../i18n/index.ts";
import { linkProps } from "../router.ts";
import { useSettings } from "../settings.ts";
import { useEditor } from "../store.ts";
import { closeProject, openProject, useSync } from "../sync.ts";
import { useUi } from "../ui.ts";

const ALIGN_KEYS: Record<string, actions.AlignKind> = {
  KeyA: "left",
  KeyD: "right",
  KeyW: "top",
  KeyS: "bottom",
  KeyH: "hcenter",
  KeyV: "vcenter",
};

export function EditorPage({ id }: { id: string }) {
  const t = useT();
  const status = useSync((s) => s.status);

  useEffect(() => {
    void openProject(id).then(() => {
      // Show the whole design once it's loaded.
      requestAnimationFrame(() => actions.zoomToFit());
    });
    useSettings.getState().refresh().catch(() => {});
    return () => void closeProject();
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (isTyping(e) || useSettings.getState().open || ui.shortcutsOpen) return;
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const handled = () => e.preventDefault();

      if (mod && e.shiftKey && key === "k") return handled(), actions.pickImages();
      if (mod && key === "k") return handled(), ui.askClaude();
      if (mod && key === "z") return handled(), e.shiftKey ? s.redo() : s.undo();
      if (mod && key === "y") return handled(), s.redo();
      if (mod && key === "c") return handled(), actions.copy();
      if (mod && key === "x") return handled(), actions.cut();
      // Ctrl+V is handled by the paste event below, which can see images on the clipboard.
      if (mod && key === "v") return;
      if (mod && key === "d") return handled(), s.duplicateSelection();
      if (mod && key === "a") return handled(), actions.selectAll();
      if (mod && key === "g") return handled(), e.shiftKey ? actions.ungroup() : actions.group();
      if (mod && e.shiftKey && key === "h") return handled(), actions.toggleSelection("visible");
      if (mod && e.shiftKey && key === "l") return handled(), actions.toggleSelection("locked");
      if (mod && e.code === "BracketRight") return handled(), actions.zOrder(e.shiftKey ? "front" : "forward");
      if (mod && e.code === "BracketLeft") return handled(), actions.zOrder(e.shiftKey ? "back" : "backward");
      if (mod && (key === "=" || key === "+")) return handled(), actions.zoomBy(1.25);
      if (mod && key === "-") return handled(), actions.zoomBy(1 / 1.25);
      if (mod && key === "0") return handled(), actions.setZoom(1);
      if (e.altKey && !mod && ALIGN_KEYS[e.code]) return handled(), actions.align(ALIGN_KEYS[e.code]);
      if (e.shiftKey && !mod && e.code === "Digit1") return handled(), actions.zoomToFit();
      if (e.shiftKey && !mod && e.code === "Digit2") return handled(), actions.zoomToSelection();
      if (e.shiftKey && !mod && e.code === "Digit0") return handled(), actions.setZoom(1);
      if (key === "?") return handled(), ui.setShortcutsOpen(true);
      if (key === "delete" || key === "backspace") return handled(), s.deleteSelection();
      if (key === "escape") {
        ui.setContextMenu(null);
        s.select([]);
        s.setTool("select");
        return;
      }
      if (key.startsWith("arrow") && s.selection.length) {
        handled();
        const step = e.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        s.checkpoint();
        s.updateNodes(s.selection, (n) => (n.locked ? {} : { x: n.x + dx, y: n.y + dy }));
        return;
      }
      if (!mod && !e.altKey && TOOL_KEYS[key]) s.setTool(TOOL_KEYS[key]);
    };
    // Pasting an image (e.g. a screenshot) adds it; otherwise paste the copied layers.
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e) || useSettings.getState().open) return;
      e.preventDefault();
      const files = [...(e.clipboardData?.files ?? [])];
      const text = e.clipboardData?.getData("text/plain");
      if (files.length && text !== actions.CLIPBOARD_MARKER) void actions.importImages(files);
      else actions.paste();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  if (status === "missing") {
    return (
      <div className="center-page">
        <h2>{t("editor.notFound")}</h2>
        <a className="btn primary" {...linkProps("/")}>
          {t("nav.backToProjects")}
        </a>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <ToolRail />
        <main className="stage">
          {status === "loading" ? <div className="stage-loading">{t("common.loading")}</div> : <Canvas />}
          <ZoomControls />
        </main>
        <Inspector />
      </div>
      <SettingsModal />
      <ShortcutsDialog />
      <ContextMenu />
      <Toast />
    </div>
  );
}
