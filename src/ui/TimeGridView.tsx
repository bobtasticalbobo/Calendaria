import { useEffect, useRef, useState } from "react";
import type { EventOccurrence } from "../db/events";
import { Temporal } from "../time/temporal";
import { timingBounds } from "../time/timing";
import { EventChip } from "./EventChip";
import { formatTime, formatWeekday } from "./dates";
import { BOARD_NOTE_MINUTES, layoutBoardNotes, snapToBoard, timeOfMinute } from "./board";
import { itemsOnDay, layoutDay } from "./layout";
import {
  DayNotes,
  NOTE_DRAG_TYPE,
  type NoteHandlers,
  dayTagStyle,
  firstTag,
  isNoteDrag,
  noteDropTarget,
  noteGrabOffset,
  notePaperStyle,
  noteTitle,
  startNoteDrag,
} from "./notes";
import { TagLabels } from "./TagPicker";

interface Props {
  days: Temporal.PlainDate[];
  items: EventOccurrence[];
  zone: string;
  colorOf: (calendarId: string) => string;
  onSelect: (item: EventOccurrence) => void;
  onCreate: (day: Temporal.PlainDate, time?: Temporal.PlainTime) => void;
  notes: NoteHandlers;
}

const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** The week and day views: an all-day row above a 24-hour grid. */
/** The half hour under the pointer in a day column. */
function timeAt(e: React.MouseEvent<HTMLElement>): Temporal.PlainTime {
  const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
  const halfHours = Math.min(47, Math.max(0, Math.floor(y / (HOUR_HEIGHT / 2))));
  return new Temporal.PlainTime(Math.floor(halfHours / 2), (halfHours % 2) * 30);
}

export function TimeGridView({ days, items, zone, colorOf, onSelect, onCreate, notes }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const now = Temporal.Now.zonedDateTimeISO(zone);
  const today = now.toPlainDate();

  useEffect(() => {
    // Start scrolled to 7:00 rather than midnight.
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR_HEIGHT;
  }, []);

  /** Where a note being dragged over the board would land. */
  const [landing, setLanding] = useState<{ day: string; minute: number; stuck: boolean } | null>(null);

  const columns = { gridTemplateColumns: `56px repeat(${days.length}, 1fr)` };
  const perDay = days.map((day) => {
    const { allDay, timed } = itemsOnDay(items, day, zone);
    return { day, allDay, segments: layoutDay(timed, day, zone) };
  });

  /** The board spot under a dragged note, from the pointer and where the note was grabbed. */
  const spotAt = (e: React.DragEvent<HTMLElement>, segments: ReturnType<typeof layoutDay>) => {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top - noteGrabOffset();
    return snapToBoard((y / HOUR_HEIGHT) * 60, segments);
  };

  return (
    <div className="timegrid">
      <div className="timegrid-header" style={columns}>
        <div />
        {days.map((day) => {
          const tags = notes.tagsOn(day);
          const tagged = dayTagStyle(tags);
          return (
            <div
              key={day.toString()}
              className={(day.equals(today) ? "timegrid-dayname today" : "timegrid-dayname") + tagged.className}
              style={tagged.style}
              onContextMenu={(e) => notes.menu(e, day)}
              {...noteDropTarget(day, notes, null)}
              title="Drop a note here to take it off the board"
            >
              <span>{formatWeekday(day)}</span>
              <strong>{day.day}</strong>
              <DayNotes day={day} handlers={notes} unplacedOnly />
              <TagLabels tags={tags} />
            </div>
          );
        })}
        <div className="timegrid-allday-label">all-day</div>
        {perDay.map(({ day, allDay }) => (
          <div
            key={day.toString()}
            className={day.equals(today) ? "timegrid-allday today" : "timegrid-allday"}
            onDoubleClick={() => onCreate(day)}
            onContextMenu={(e) => notes.menu(e, day)}
            {...noteDropTarget(day, notes, null)}
          >
            {allDay.map((item) => (
              <EventChip
                key={item.event.id + item.occurrence.key}
                item={item}
                color={colorOf(item.event.calendarId)}
                tag={firstTag(item.event.tags, notes.tag)}
                zone={zone}
                showTime={false}
                onSelect={onSelect}
                onMenu={notes.eventMenu}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="timegrid-body" ref={scroller}>
        <div className="timegrid-hours" style={{ ...columns, height: 24 * HOUR_HEIGHT }}>
          <div className="timegrid-gutter">
            {HOURS.slice(1).map((h) => (
              <span key={h} style={{ top: h * HOUR_HEIGHT }}>
                {formatTime(new Temporal.PlainTime(h))}
              </span>
            ))}
          </div>
          {perDay.map(({ day, segments }) => (
            <div
              key={day.toString()}
              className={day.equals(today) ? "timegrid-day today" : "timegrid-day"}
              onDoubleClick={(e) => onCreate(day, timeAt(e))}
              onContextMenu={(e) => notes.menu(e, day, timeAt(e))}
              onDragOver={(e) => {
                if (!isNoteDrag(e)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const spot = spotAt(e, segments);
                const key = day.toString();
                if (landing?.day !== key || landing.minute !== spot.minute) {
                  setLanding({ day: key, minute: spot.minute, stuck: !!spot.event });
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setLanding(null);
              }}
              onDrop={(e) => {
                setLanding(null);
                const id = e.dataTransfer.getData(NOTE_DRAG_TYPE);
                if (!id) return;
                e.preventDefault();
                notes.move(id, day, timeOfMinute(spotAt(e, segments).minute));
              }}
            >
              {HOURS.map((h) => (
                <div key={h} className="timegrid-line" style={{ top: h * HOUR_HEIGHT }} />
              ))}
              {segments.map((s) => {
                const { start, end } = timingBounds(s.item.occurrence.timing, zone);
                const tag = firstTag(s.item.event.tags, notes.tag);
                return (
                  <button
                    type="button"
                    key={s.item.event.id + s.item.occurrence.key}
                    className={tag ? "timegrid-event tagged-event" : "timegrid-event"}
                    style={
                      {
                        "--event-color": colorOf(s.item.event.calendarId),
                        "--tag": tag?.color,
                        top: (s.startMinute / 60) * HOUR_HEIGHT,
                        height: ((s.endMinute - s.startMinute) / 60) * HOUR_HEIGHT - 2,
                        left: `${(s.column / s.columns) * 100}%`,
                        width: `calc(${100 / s.columns}% - 4px)`,
                      } as React.CSSProperties
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(s.item);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => notes.eventMenu(e, s.item)}
                  >
                    <strong>{s.item.event.title || "(No title)"}</strong>
                    <span>
                      {formatTime(start)} – {formatTime(end)}
                    </span>
                  </button>
                );
              })}
              {layoutBoardNotes(notes.notesOn(day)).map(({ note, minute, offset }) => {
                const stuck = segments.some((s) => s.startMinute === minute || s.endMinute === minute);
                return (
                  <button
                    type="button"
                    key={note.id}
                    className={`board-note paper-${note.color}${stuck ? " stuck" : ""}${notes.hasReminder(note) ? " has-reminder" : ""}`}
                    style={{
                      ...notePaperStyle(firstTag(note.tags, notes.tag)),
                      top: (minute / 60) * HOUR_HEIGHT,
                      height: (BOARD_NOTE_MINUTES / 60) * HOUR_HEIGHT,
                      right: 4 + offset * 12,
                      zIndex: 3 + offset,
                    }}
                    title={noteTitle(note)}
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      startNoteDrag(e, note, e.clientY - e.currentTarget.getBoundingClientRect().top);
                    }}
                    onDragEnd={() => setLanding(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      notes.open(note, e.currentTarget);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    {noteTitle(note)}
                  </button>
                );
              })}
              {landing?.day === day.toString() && (
                <div
                  className={landing.stuck ? "board-landing stuck" : "board-landing"}
                  style={{ top: (landing.minute / 60) * HOUR_HEIGHT, height: (BOARD_NOTE_MINUTES / 60) * HOUR_HEIGHT }}
                >
                  <span>{formatTime(timeOfMinute(landing.minute))}</span>
                </div>
              )}
              {day.equals(today) && (
                <div
                  className="timegrid-now"
                  style={{ top: ((now.hour * 60 + now.minute) / 60) * HOUR_HEIGHT }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
