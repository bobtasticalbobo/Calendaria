import type { Note } from "../db/notes";
import type { Temporal } from "../time/temporal";

/** What the calendar views need to show notes and accept dropped ones. */
export interface NoteHandlers {
  notesOn: (day: Temporal.PlainDate) => Note[];
  open: (note: Note, anchor: HTMLElement) => void;
  move: (id: string, day: Temporal.PlainDate) => void;
  menu: (e: React.MouseEvent, day: Temporal.PlainDate, time?: Temporal.PlainTime) => void;
}

export const NOTE_DRAG_TYPE = "application/x-calendaria-note";

export function startNoteDrag(e: React.DragEvent, note: Note) {
  e.dataTransfer.setData(NOTE_DRAG_TYPE, note.id);
  e.dataTransfer.effectAllowed = "move";
}

/** The note's first line, for tooltips and notifications. */
export function noteTitle(note: Note): string {
  return note.body.trim().split("\n")[0] || "Empty note";
}

/** Props that make an element a place to drop a note on `day`. */
export function noteDropTarget(day: Temporal.PlainDate, handlers: NoteHandlers) {
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(NOTE_DRAG_TYPE);
  return {
    onDragOver(e: React.DragEvent<HTMLElement>) {
      if (!accepts(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      e.currentTarget.classList.add("note-drop");
    },
    onDragLeave(e: React.DragEvent<HTMLElement>) {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) e.currentTarget.classList.remove("note-drop");
    },
    onDrop(e: React.DragEvent<HTMLElement>) {
      e.currentTarget.classList.remove("note-drop");
      const id = e.dataTransfer.getData(NOTE_DRAG_TYPE);
      if (!id) return;
      e.preventDefault();
      handlers.move(id, day);
    },
  };
}

/** A day's notes, folded down to small paper squares until opened. */
export function DayNotes({ day, handlers }: { day: Temporal.PlainDate; handlers: NoteHandlers }) {
  const notes = handlers.notesOn(day);
  if (!notes.length) return null;
  return (
    <span className="day-notes">
      {notes.map((note) => (
        <button
          type="button"
          key={note.id}
          className={`note-marker paper-${note.color}${note.remind ? " has-reminder" : ""}`}
          title={noteTitle(note)}
          aria-label={`Note: ${noteTitle(note)}`}
          draggable
          onDragStart={(e) => startNoteDrag(e, note)}
          onClick={(e) => {
            e.stopPropagation();
            handlers.open(note, e.currentTarget);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ))}
    </span>
  );
}
