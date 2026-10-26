import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eye,
  Group,
  Lock,
  Scissors,
  Sparkles,
  Trash2,
  Ungroup,
  WandSparkles,
} from "lucide-react";
import { copy, cut, group, organizeLayers, paste, selectAll, toggleSelection, ungroup, zOrder, zoomToFit } from "../actions.ts";
import { useT } from "../i18n/index.ts";
import { useEditor } from "../store.ts";
import { useUi } from "../ui.ts";
import { MenuList, type MenuItem } from "./Menu.tsx";

export function ContextMenu() {
  const t = useT();
  const menu = useUi((s) => s.contextMenu);
  const setMenu = useUi((s) => s.setContextMenu);
  const hasSelection = useEditor((s) => s.selection.length > 0);
  const hasGroup = useEditor((s) => s.nodes.some((n) => n.type === "group" && s.selection.includes(n.id)));
  if (!menu) return null;

  const s = useEditor.getState();
  const items: MenuItem[] = hasSelection
    ? [
        { label: t("menu.askAbout"), icon: <Sparkles size={14} />, shortcut: "Ctrl+K", onSelect: useUi.getState().askClaude },
        { separator: true },
        { label: t("menu.copy"), icon: <Copy size={14} />, shortcut: "Ctrl+C", onSelect: copy },
        { label: t("menu.cut"), icon: <Scissors size={14} />, shortcut: "Ctrl+X", onSelect: cut },
        { label: t("menu.paste"), icon: <ClipboardPaste size={14} />, shortcut: "Ctrl+V", onSelect: paste },
        { label: t("menu.duplicate"), icon: <CopyPlus size={14} />, shortcut: "Ctrl+D", onSelect: s.duplicateSelection },
        { separator: true },
        { label: t("menu.group"), icon: <Group size={14} />, shortcut: "Ctrl+G", onSelect: group },
        ...(hasGroup
          ? [{ label: t("menu.ungroup"), icon: <Ungroup size={14} />, shortcut: "Ctrl+Shift+G", onSelect: ungroup }]
          : []),
        { separator: true },
        { label: t("menu.front"), icon: <ArrowUpToLine size={14} />, shortcut: "Ctrl+Shift+]", onSelect: () => zOrder("front") },
        { label: t("menu.forward"), icon: <ArrowUp size={14} />, shortcut: "Ctrl+]", onSelect: () => zOrder("forward") },
        { label: t("menu.backward"), icon: <ArrowDown size={14} />, shortcut: "Ctrl+[", onSelect: () => zOrder("backward") },
        { label: t("menu.back"), icon: <ArrowDownToLine size={14} />, shortcut: "Ctrl+Shift+[", onSelect: () => zOrder("back") },
        { separator: true },
        { label: t("menu.toggleVisible"), icon: <Eye size={14} />, shortcut: "Ctrl+Shift+H", onSelect: () => toggleSelection("visible") },
        { label: t("menu.toggleLock"), icon: <Lock size={14} />, shortcut: "Ctrl+Shift+L", onSelect: () => toggleSelection("locked") },
        { separator: true },
        { label: t("menu.delete"), icon: <Trash2 size={14} />, shortcut: "Del", danger: true, onSelect: s.deleteSelection },
      ]
    : [
        { label: t("menu.paste"), icon: <ClipboardPaste size={14} />, shortcut: "Ctrl+V", onSelect: paste },
        { label: t("menu.selectAll"), shortcut: "Ctrl+A", onSelect: selectAll },
        { label: t("zoom.fit"), shortcut: "Shift+1", onSelect: zoomToFit },
        { label: t("layers.organize"), icon: <WandSparkles size={14} />, onSelect: organizeLayers },
        { separator: true },
        { label: t("menu.ask"), icon: <Sparkles size={14} />, shortcut: "Ctrl+K", onSelect: useUi.getState().askClaude },
      ];

  return <MenuList items={items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />;
}
