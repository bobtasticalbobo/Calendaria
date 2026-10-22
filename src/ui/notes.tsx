import type { EventOccurrence } from "../db/events";
import type { NoteReminder } from "../db/noteReminders";
import type { Note } from "../db/notes";
import type { Tag } from "../db/tags";
import { pageTitle } from "../notes/pages";
import type { Temporal } from "../time/temporal";
import { formatTime } from "./dates";
import { BellIcon } from "./icons";

/** What the calendar views need to show notes and day tags, and accept dropped notes. */
export interface NoteHandlers {
  notesOn: (day: Temporal.PlainDate) => Note[];
  /** Reminders from pages that go off on `day`, wherever the page is. */
  remindersOn: (day: Temporal.PlainDate) => { reminder: NoteReminder; note: Note }[];
  hasReminder: (note: Note) => boolean;
  /** Opens a page in the notes view. */
  openPage: (id: string) => void;
  tagsOn: (day: Temporal.PlainDate) => Tag[];
  tag: (id: string) => Tag | undefined;
  open: (note: Note, anchor: HTMLElement) => void;
  move: (id: string, day: Temporal.PlainDate) => void;
  menu: (e: React.MouseEvent, day: Temporal.PlainDate, time?: Temporal.PlainTime) => void;
  /** Right-click on an event: pick its tags. */
  eventMenu: (e: React.MouseEvent, item: EventOccurrence) => void;
}

export const NOTE_DRAG_TYPE = "application/x-calendaria-note";

export function startNoteDrag(e: React.DragEvent, note: Note) {
  e.dataTransfer.setData(NOTE_DRAG_TYPE, note.id);
  e.dataTransfer.effectAllowed = "move";
}

/** The note's title, for tooltips and notifications. */
export function noteTitle(note: Note): string {
  return note.body.trim() ? pageTitle(note) : "Empty note";
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

/** The first of `ids` that is a live tag; its color is the one shown. */
export function firstTag(ids: string[], lookup: (id: string) => Tag | undefined): Tag | undefined {
  for (const id of ids) {
    const tag = lookup(id);
    if (tag) return tag;
  }
  return undefined;
}

/** A note's paper, turned toward its tag's color but kept light enough for dark text. */
export function notePaperStyle(tag: Tag | undefined): React.CSSProperties | undefined {
  return tag ? ({ "--paper": `color-mix(in srgb, ${tag.color} 60%, #f2efe6)` } as React.CSSProperties) : undefined;
}

/** Class and style that tint a day in its first tag's color. */
export function dayTagStyle(tags: Tag[]): { className: string; style?: React.CSSProperties } {
  if (!tags.length) return { className: "" };
  return { className: " tagged", style: { "--tag": tags[0].color } as React.CSSProperties };
}

/** A day's notes, folded down to small paper squares until opened. */
export function DayNotes({ day, handlers }: { day: Temporal.PlainDate; handlers: NoteHandlers }) {
  const notes = handlers.notesOn(day);
  const reminders = handlers.remindersOn(day);
  if (!notes.length && !reminders.length) return null;
  return (
    <span className="day-notes">
      {notes.map((note) => {
        const tag = firstTag(note.tags, handlers.tag);
        return (
          <button
            type="button"
            key={note.id}
            className={`note-marker paper-${note.color}${handlers.hasReminder(note) ? " has-reminder" : ""}`}
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
      {reminders.map(({ reminder, note }) => (
        <button
          type="button"
          key={reminder.id}
          className="reminder-marker"
          title={`${formatTime(reminder.at.toPlainTime())} · ${noteTitle(note)}`}
          aria-label={`Reminder: ${noteTitle(note)}`}
          onClick={(e) => {
            e.stopPropagation();
            handlers.openPage(note.id);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <BellIcon />
        </button>
      ))}
    </span>
  );
}
