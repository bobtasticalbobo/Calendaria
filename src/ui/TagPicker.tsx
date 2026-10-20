import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { TAG_COLORS, type Tag } from "../db/tags";

interface PickerProps {
  tags: Tag[];
  selected: string[];
  onToggle: (tagId: string, on: boolean) => void;
  onCreate: (name: string, color: string) => Promise<Tag>;
}

/** Every tag with a check for the ones applied, and a field to make a new one. */
export function TagPicker({ tags, selected, onToggle, onCreate }: PickerProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[tags.length % TAG_COLORS.length]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const tag = await onCreate(name, color);
    onToggle(tag.id, true);
    setName("");
    setColor(TAG_COLORS[(tags.length + 1) % TAG_COLORS.length]);
  }

  return (
    <div className="tag-picker">
      {tags.map((tag) => {
        const on = selected.includes(tag.id);
        return (
          <button
            type="button"
            key={tag.id}
            className={on ? "tag-option on" : "tag-option"}
            onClick={() => onToggle(tag.id, !on)}
          >
            <span className="tag-dot" style={{ background: tag.color }} />
            <span className="tag-option-name">{tag.name}</span>
            {on && <span className="tag-check">✓</span>}
          </button>
        );
      })}
      <form className="tag-new" onSubmit={submit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag" aria-label="New tag name" />
        <ColorDots value={color} onChange={setColor} />
      </form>
    </div>
  );
}

export function ColorDots({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="tag-colors">
      {TAG_COLORS.map((c) => (
        <button
          type="button"
          key={c}
          className={c === value ? "tag-color active" : "tag-color"}
          style={{ background: c }}
          aria-label={`Color ${c}`}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

/** A floating panel at the pointer that closes on Escape or a click outside it. */
export function Popover({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 228);
  const top = Math.min(y, window.innerHeight - 320);
  return (
    <div ref={ref} className="popover" style={{ left, top }}>
      {children}
    </div>
  );
}

/** Small labels for a day's or note's tags. */
export function TagLabels({ tags }: { tags: Tag[] }) {
  if (!tags.length) return null;
  return (
    <span className="tag-labels">
      {tags.map((tag) => (
        <span key={tag.id} className="tag-label" style={{ color: tag.color }}>
          {tag.name}
        </span>
      ))}
    </span>
  );
}
