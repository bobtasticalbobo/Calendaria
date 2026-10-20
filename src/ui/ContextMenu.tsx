import { useEffect, useRef } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
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
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
