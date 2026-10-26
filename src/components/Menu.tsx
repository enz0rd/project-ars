import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuItem =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      icon?: React.ReactNode;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      onSelect: () => void;
    };

/** A floating list of commands at a screen position; closes on outside click or Escape. */
export function MenuList({
  items,
  x,
  y,
  above = false,
  onClose,
}: {
  items: MenuItem[];
  x: number;
  y: number;
  /** Treat `y` as the menu's bottom edge. */
  above?: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current!;
    const { width, height } = el.getBoundingClientRect();
    const top = above ? y - height : y;
    setPos({ x: Math.max(8, Math.min(x, window.innerWidth - width - 8)), y: Math.max(8, Math.min(top, window.innerHeight - height - 8)) });
  }, [x, y, above]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="menu" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item ${item.danger ? "danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span className="menu-icon">{item.icon}</span>
            <span className="menu-label">{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** A button that opens a MenuList below itself. */
export function MenuButton({
  items,
  children,
  className = "icon-btn",
  title,
  align = "left",
}: {
  items: MenuItem[] | (() => MenuItem[]);
  children: React.ReactNode;
  className?: string;
  title?: string;
  align?: "left" | "right" | "up";
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  // Clicking the trigger while open closes the menu (outside pointerdown) — don't reopen it on the click.
  const closedAt = useRef(0);
  const close = () => {
    closedAt.current = Date.now();
    setAt(null);
  };

  return (
    <>
      <button
        ref={ref}
        className={`${className} ${at ? "active" : ""}`}
        title={title}
        onClick={() => {
          if (at || Date.now() - closedAt.current < 300) return close();
          const r = ref.current!.getBoundingClientRect();
          if (align === "up") setAt({ x: r.left, y: r.top - 6 });
          else setAt({ x: align === "right" ? r.right - 220 : r.left, y: r.bottom + 6 });
        }}
      >
        {children}
      </button>
      {at && (
        <MenuList
          items={typeof items === "function" ? items() : items}
          x={at.x}
          y={at.y}
          above={align === "up"}
          onClose={close}
        />
      )}
    </>
  );
}
