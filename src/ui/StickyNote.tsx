import { useEffect, useRef, useState } from "react";
import type { NoteReminder } from "../db/noteReminders";
import { NOTE_COLORS, type Note, type NoteInput } from "../db/notes";
import type { Tag } from "../db/tags";
import { Temporal } from "../time/temporal";
import { formatDate, formatWeekday } from "./dates";
import { notePaperStyle, startNoteDrag } from "./notes";
import { TagLabels, TagPicker } from "./TagPicker";

interface Props {
  note: Note;
  reminders: NoteReminder[];
  anchor: DOMRect;
  zone: string;
  tags: Tag[];
  onCreateTag: (name: string, color: string) => Promise<Tag>;
  onChange: (patch: NoteInput) => void;
  onDelete: () => void;
  onClose: () => void;
  onAddReminder: (at: Temporal.PlainDateTime) => void;
  onMoveReminder: (id: string, at: Temporal.PlainDateTime) => void;
  onRemoveReminders: (ids: string[]) => void;
  onOpenInNotes: () => void;
}

const WIDTH = 240;
const HEIGHT = 230;
const SAVE_DELAY_MS = 400;

/** The default reminder: 9:00 on the note's day, or for a note on today, the next full hour once 9:00 has passed. */
function defaultReminder(day: Temporal.PlainDate, zone: string): Temporal.PlainDateTime {
  const nineAm = day.toPlainDateTime(new Temporal.PlainTime(9));
  const now = Temporal.Now.plainDateTimeISO(zone);
  if (!day.equals(now.toPlainDate()) || Temporal.PlainDateTime.compare(nineAm, now) > 0) return nineAm;
  const nextHour = now.round({ smallestUnit: "hour", roundingMode: "ceil" });
  return nextHour.toPlainDate().equals(day) ? nextHour : now.round({ smallestUnit: "minute", roundingMode: "ceil" });
}

/** An open sticky note, placed beside the marker it was opened from. */
export function StickyNote(props: Props) {
  const { note, reminders, anchor, zone, tags, onCreateTag, onChange, onDelete, onClose } = props;
  const remind = reminders[0];
  const ref = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState(false);
  const noteTags = note.tags.map((id) => tags.find((t) => t.id === id)).filter((t): t is Tag => !!t);
  const [body, setBody] = useState(note.body);
  const pending = useRef<number | undefined>(undefined);
  const latest = useRef({ body, reminders, onChange, onDelete, onClose });
  latest.current = { body, reminders, onChange, onDelete, onClose };

  const flush = () => {
    if (pending.current === undefined) return;
    clearTimeout(pending.current);
    pending.current = undefined;
    latest.current.onChange({ body: latest.current.body });
  };

  const discard = () => {
    clearTimeout(pending.current);
    pending.current = undefined;
    latest.current.onDelete();
  };

  /** Closing a note that was left empty throws it away. */
  const close = () => {
    const { body, reminders } = latest.current;
    if (!body.trim() && !reminders.length) discard();
    else {
      flush();
      latest.current.onClose();
    }
  };

  useEffect(() => {
    const onMouseDown = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      // Opening another note's marker is handled by its own click.
      if ((e.target as Element).closest?.(".note-marker")) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      flush();
    };
  }, []);

  const left = Math.max(8, Math.min(anchor.right + 6, window.innerWidth - WIDTH - 8));
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - HEIGHT - 8));

  return (
    <div
      ref={ref}
      className={`sticky paper-${note.color}`}
      style={{ left, top, width: WIDTH, ...notePaperStyle(noteTags[0]) }}
    >
      <div
        className="sticky-bar"
        draggable
        onDragStart={(e) => {
          flush();
          startNoteDrag(e, note);
        }}
        title="Drag onto a day to move this note"
      >
        <span className="sticky-day">{note.day && `${formatWeekday(note.day)} ${formatDate(note.day)}`}</span>
        <span className="spacer" />
        {NOTE_COLORS.map((color) => (
          <button
            type="button"
            key={color}
            className={`sticky-color paper-${color}${color === note.color ? " active" : ""}`}
            aria-label={`${color} paper`}
            onClick={() => onChange({ color })}
          />
        ))}
      </div>
      {noteTags.length > 0 && (
        <div className="sticky-tags">
          <TagLabels tags={noteTags} />
        </div>
      )}
      <textarea
        className="sticky-text"
        autoFocus
        value={body}
        placeholder="Write a note…"
        onChange={(e) => {
          setBody(e.target.value);
          clearTimeout(pending.current);
          pending.current = window.setTimeout(flush, SAVE_DELAY_MS);
        }}
        onBlur={flush}
      />
      <div className="sticky-foot">
        <label className="sticky-remind">
          <input
            type="checkbox"
            checked={!!remind}
            onChange={(e) =>
              e.target.checked
                ? props.onAddReminder(defaultReminder(note.day ?? Temporal.Now.plainDateISO(zone), zone))
                : props.onRemoveReminders(reminders.map((r) => r.id))
            }
          />
          {reminders.length > 1 ? `${reminders.length} reminders` : "Remind"}
        </label>
        {remind && reminders.length === 1 && (
          <input
            type="datetime-local"
            aria-label="Reminder time"
            value={remind.at.toString({ smallestUnit: "minute" })}
            onChange={(e) => {
              if (!e.target.value) return;
              props.onMoveReminder(remind.id, Temporal.PlainDateTime.from(e.target.value));
            }}
          />
        )}
        <span className="spacer" />
        <button
          type="button"
          title="Open as a page in Notes"
          onClick={() => {
            flush();
            props.onOpenInNotes();
          }}
        >
          Open
        </button>
        <button type="button" onClick={() => setPicking((p) => !p)}>
          Tags
        </button>
        <button type="button" className="sticky-delete" aria-label="Delete note" title="Delete note" onClick={discard}>
          Delete
        </button>
      </div>
      {picking && (
        <div className={top > window.innerHeight / 2 ? "sticky-picker above" : "sticky-picker"}>
          <TagPicker
            tags={tags}
            selected={note.tags}
            onCreate={onCreateTag}
            onToggle={(id, on) => onChange({ tags: on ? [...note.tags, id] : note.tags.filter((t) => t !== id) })}
          />
        </div>
      )}
    </div>
  );
}
