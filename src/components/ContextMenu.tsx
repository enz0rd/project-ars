import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eye,
  Lock,
  Scissors,
  Sparkles,
  Trash2,
} from "lucide-react";
import { copy, cut, paste, selectAll, toggleSelection, zOrder, zoomToFit } from "../actions.ts";
import { useEditor } from "../store.ts";
import { useUi } from "../ui.ts";
import { MenuList, type MenuItem } from "./Menu.tsx";

export function ContextMenu() {
  const menu = useUi((s) => s.contextMenu);
  const setMenu = useUi((s) => s.setContextMenu);
  const hasSelection = useEditor((s) => s.selection.length > 0);
  if (!menu) return null;

  const s = useEditor.getState();
  const items: MenuItem[] = hasSelection
    ? [
        { label: "Perguntar ao Claude sobre isto", icon: <Sparkles size={14} />, shortcut: "Ctrl+K", onSelect: useUi.getState().askClaude },
        { separator: true },
        { label: "Copiar", icon: <Copy size={14} />, shortcut: "Ctrl+C", onSelect: copy },
        { label: "Recortar", icon: <Scissors size={14} />, shortcut: "Ctrl+X", onSelect: cut },
        { label: "Colar", icon: <ClipboardPaste size={14} />, shortcut: "Ctrl+V", onSelect: paste },
        { label: "Duplicar", icon: <CopyPlus size={14} />, shortcut: "Ctrl+D", onSelect: s.duplicateSelection },
        { separator: true },
        { label: "Trazer para frente", icon: <ArrowUpToLine size={14} />, shortcut: "Ctrl+Shift+]", onSelect: () => zOrder("front") },
        { label: "Avançar", icon: <ArrowUp size={14} />, shortcut: "Ctrl+]", onSelect: () => zOrder("forward") },
        { label: "Recuar", icon: <ArrowDown size={14} />, shortcut: "Ctrl+[", onSelect: () => zOrder("backward") },
        { label: "Enviar para trás", icon: <ArrowDownToLine size={14} />, shortcut: "Ctrl+Shift+[", onSelect: () => zOrder("back") },
        { separator: true },
        { label: "Mostrar/ocultar", icon: <Eye size={14} />, shortcut: "Ctrl+Shift+H", onSelect: () => toggleSelection("visible") },
        { label: "Bloquear/desbloquear", icon: <Lock size={14} />, shortcut: "Ctrl+Shift+L", onSelect: () => toggleSelection("locked") },
        { separator: true },
        { label: "Excluir", icon: <Trash2 size={14} />, shortcut: "Del", danger: true, onSelect: s.deleteSelection },
      ]
    : [
        { label: "Colar", icon: <ClipboardPaste size={14} />, shortcut: "Ctrl+V", onSelect: paste },
        { label: "Selecionar tudo", shortcut: "Ctrl+A", onSelect: selectAll },
        { label: "Ajustar à tela", shortcut: "Shift+1", onSelect: zoomToFit },
        { separator: true },
        { label: "Perguntar ao Claude", icon: <Sparkles size={14} />, shortcut: "Ctrl+K", onSelect: useUi.getState().askClaude },
      ];

  return <MenuList items={items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />;
}
