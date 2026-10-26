import { X } from "lucide-react";
import { useT, type Key } from "../i18n/index.ts";
import { useUi } from "../ui.ts";

export const SHORTCUTS: [Key, [string, Key][]][] = [
  [
    "shortcuts.tools",
    [
      ["V", "tool.select"],
      ["H / Space", "tool.hand"],
      ["A", "tool.artboard"],
      ["R", "tool.rect"],
      ["O", "tool.ellipse"],
      ["T", "tool.text"],
      ["Ctrl+Shift+K", "shortcuts.image"],
    ],
  ],
  [
    "shortcuts.editing",
    [
      ["Ctrl+Z / Ctrl+Shift+Z", "shortcuts.undoRedo"],
      ["Ctrl+C / X / V", "shortcuts.clipboard"],
      ["Ctrl+D", "menu.duplicate"],
      ["Alt + drag", "shortcuts.altDrag"],
      ["Del", "menu.delete"],
      ["Arrows (Shift = 10px)", "shortcuts.nudge"],
      ["Ctrl + drag", "shortcuts.noSnap"],
      ["Shift + drag", "shortcuts.lockAxis"],
    ],
  ],
  [
    "shortcuts.arrange",
    [
      ["Ctrl+G / Ctrl+Shift+G", "shortcuts.groupUngroup"],
      ["Double-click", "shortcuts.enterGroup"],
      ["Ctrl+] / Ctrl+[", "shortcuts.forwardBackward"],
      ["Ctrl+Shift+] / [", "shortcuts.frontBack"],
      ["Alt+A / Alt+D", "shortcuts.alignLR"],
      ["Alt+W / Alt+S", "shortcuts.alignTB"],
      ["Alt+H / Alt+V", "shortcuts.alignCenter"],
      ["Ctrl+Shift+H / L", "shortcuts.hideLock"],
    ],
  ],
  [
    "shortcuts.view",
    [
      ["Ctrl + scroll", "shortcuts.zoom"],
      ["Shift+1", "zoom.fit"],
      ["Shift+2", "zoom.selection"],
      ["Shift+0", "shortcuts.zoom100"],
      ["Ctrl+K", "menu.ask"],
      ["?", "shortcuts.thisList"],
    ],
  ],
];

export function ShortcutsDialog() {
  const t = useT();
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);
  if (!open) return null;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal wide" role="dialog" aria-labelledby="shortcuts-title" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
        <header className="modal-header">
          <h2 id="shortcuts-title">{t("editor.shortcuts")}</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label={t("common.close")} autoFocus>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body shortcuts">
          {SHORTCUTS.map(([group, rows]) => (
            <section key={group}>
              <h3>{t(group)}</h3>
              {rows.map(([keys, label]) => (
                <div key={keys} className="shortcut-row">
                  <span>{t(label)}</span>
                  <kbd>{keys}</kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
