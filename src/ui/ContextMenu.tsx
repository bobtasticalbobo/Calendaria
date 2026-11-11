import { useEffect, useRef } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** A keyboard shortcut shown on the right. */
  hint?: string;
  disabled?: boolean;
  /** Draw a line above this item. */
  divider?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** A small right-click menu at the pointer. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("contextmenu", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("contextmenu", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Keep the menu on screen near the right and bottom edges.
  const left = Math.min(x, window.innerWidth - 168);
  const top = Math.min(y, window.innerHeight - items.length * 32 - 16);
  return (
    <div ref={ref} className="context-menu" style={{ left, top }} role="menu">
      {items.map((item) => (
        <button
          type="button"
          role="menuitem"
          key={item.label}
          className={item.divider ? "divided" : undefined}
          disabled={item.disabled}
          // Keep focus (and the selection) where it was, e.g. in the page text.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          <span>{item.label}</span>
          {item.hint && <span className="menu-hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}
