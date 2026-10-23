import type { Note } from "../db/notes";
import { Temporal } from "../time/temporal";
import type { DaySegment } from "./layout";

/** A note on the board is drawn about this many minutes tall, at the grid's scale. */
export const BOARD_NOTE_MINUTES = 45;
/** A note dropped this close to an event's start or end sticks to it. */
export const SNAP_MINUTES = 20;
/** Away from events, notes land on quarter hours. */
const GRID_MINUTES = 15;
const LAST_MINUTE = 24 * 60 - BOARD_NOTE_MINUTES;

export interface BoardSpot {
  minute: number;
  /** The event the note stuck to, if it did. */
  event?: DaySegment;
}

/**
 * Where a note dropped with its top at `minute` lands: on the nearest event
 * edge when one is within SNAP_MINUTES, otherwise on the nearest quarter hour.
 */
export function snapToBoard(minute: number, segments: DaySegment[]): BoardSpot {
  let best: BoardSpot | undefined;
  let bestDistance = SNAP_MINUTES + 1;
  for (const segment of segments) {
    for (const edge of [segment.startMinute, segment.endMinute]) {
      const distance = Math.abs(edge - minute);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { minute: edge, event: segment };
      }
    }
  }
  const spot = best ?? { minute: Math.round(minute / GRID_MINUTES) * GRID_MINUTES };
  return { ...spot, minute: Math.max(0, Math.min(LAST_MINUTE, spot.minute)) };
}

export function minuteOfTime(time: Temporal.PlainTime): number {
  return time.hour * 60 + time.minute;
}

export function timeOfMinute(minute: number): Temporal.PlainTime {
  return new Temporal.PlainTime(Math.floor(minute / 60), minute % 60);
}

export interface BoardNote {
  note: Note;
  minute: number;
  /** Steps to the side, so notes that would cover each other stay visible. */
  offset: number;
}

/** A day's placed notes in time order, with overlapping ones fanned out. */
export function layoutBoardNotes(notes: Note[]): BoardNote[] {
  const placed = notes
    .filter((n): n is Note & { boardTime: Temporal.PlainTime } => n.boardTime !== null)
    .map((note) => ({ note, minute: minuteOfTime(note.boardTime), offset: 0 }))
    .sort((a, b) => a.minute - b.minute || (a.note.id < b.note.id ? -1 : 1));
  placed.forEach((item, i) => {
    const taken = new Set<number>();
    for (let j = i - 1; j >= 0 && item.minute - placed[j].minute < BOARD_NOTE_MINUTES; j--) taken.add(placed[j].offset);
    while (taken.has(item.offset)) item.offset++;
  });
  return placed;
}
