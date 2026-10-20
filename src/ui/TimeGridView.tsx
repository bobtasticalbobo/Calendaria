import { useEffect, useRef } from "react";
import type { EventOccurrence } from "../db/events";
import { Temporal } from "../time/temporal";
import { timingBounds } from "../time/timing";
import { EventChip } from "./EventChip";
import { formatTime, formatWeekday } from "./dates";
import { itemsOnDay, layoutDay } from "./layout";
import { DayNotes, type NoteHandlers, dayTagStyle, firstTag, noteDropTarget } from "./notes";
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

  const columns = { gridTemplateColumns: `56px repeat(${days.length}, 1fr)` };
  const perDay = days.map((day) => ({ day, ...itemsOnDay(items, day, zone) }));

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
              {...noteDropTarget(day, notes)}
            >
              <span>{formatWeekday(day)}</span>
              <strong>{day.day}</strong>
              <DayNotes day={day} handlers={notes} />
              <TagLabels tags={tags} />
            </div>
          );
        })}
        <div className="timegrid-allday-label">all-day</div>
        {perDay.map(({ day, allDay }) => (
          <div
            key={day.toString()}
            className="timegrid-allday"
            onDoubleClick={() => onCreate(day)}
            onContextMenu={(e) => notes.menu(e, day)}
            {...noteDropTarget(day, notes)}
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
          {perDay.map(({ day, timed }) => (
            <div
              key={day.toString()}
              className="timegrid-day"
              onDoubleClick={(e) => onCreate(day, timeAt(e))}
              onContextMenu={(e) => notes.menu(e, day, timeAt(e))}
              {...noteDropTarget(day, notes)}
            >
              {HOURS.map((h) => (
                <div key={h} className="timegrid-line" style={{ top: h * HOUR_HEIGHT }} />
              ))}
              {layoutDay(timed, day, zone).map((s) => {
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
