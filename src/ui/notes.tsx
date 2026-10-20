import type { Note } from "../db/notes";
import type { Tag } from "../db/tags";
import type { Temporal } from "../time/temporal";

/** What the calendar views need to show notes and day tags, and accept dropped notes. */
export interface NoteHandlers {
  notesOn: (day: Temporal.PlainDate) => Note[];
  tagsOn: (day: Temporal.PlainDate) => Tag[];
  tag: (id: string) => Tag | undefined;
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

/** A note's paper turned toward a tag's color, kept light enough for dark text. */
export function notePaperStyle(tag: Tag | undefined): React.CSSProperties | undefined {
  return tag ? ({ "--paper": `color-mix(in srgb, ${tag.color} 60%, #f2efe6)` } as React.CSSProperties) : undefined;
}

/**
 * Class and style that tint a day in its first tag's color. Events and notes
 * inside pick the color up from the --tag variable.
 */
export function dayTagStyle(tags: Tag[]): { className: string; style?: React.CSSProperties } {
  if (!tags.length) return { className: "" };
  return { className: " tagged", style: { "--tag": tags[0].color } as React.CSSProperties };
}

/** A day's notes, folded down to small paper squares until opened. */
export function DayNotes({ day, handlers }: { day: Temporal.PlainDate; handlers: NoteHandlers }) {
  const notes = handlers.notesOn(day);
  if (!notes.length) return null;
  return (
    <span className="day-notes">
      {notes.map((note) => {
        // A note's own tag wins; otherwise it takes its day's color (see .tagged in App.css).
        const tag = note.tags.map(handlers.tag).find(Boolean);
        return (
          <button
            type="button"
            key={note.id}
            className={`note-marker paper-${note.color}${note.remind ? " has-reminder" : ""}`}
            style={notePaperStyle(tag)}
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
        );
      })}
    </span>
  );
}
