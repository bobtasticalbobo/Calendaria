import type { EventOccurrence } from "../db/events";
import { Temporal } from "../time/temporal";
import { EventChip } from "./EventChip";
import { itemsOnDay } from "./layout";

interface Props {
  days: Temporal.PlainDate[];
  month: number;
  items: EventOccurrence[];
  zone: string;
  colorOf: (calendarId: string) => string;
  onSelect: (item: EventOccurrence) => void;
  onCreate: (day: Temporal.PlainDate) => void;
  onOpenDay: (day: Temporal.PlainDate) => void;
}

const MAX_PER_DAY = 4;

export function MonthView({ days, month, items, zone, colorOf, onSelect, onCreate, onOpenDay }: Props) {
  const today = Temporal.Now.plainDateISO(zone);
  return (
    <div className="month">
      {days.slice(0, 7).map((d) => (
        <div key={d.dayOfWeek} className="month-weekday">
          {d.toLocaleString(undefined, { weekday: "short" })}
        </div>
      ))}
      {days.map((day) => {
        const { allDay, timed } = itemsOnDay(items, day, zone);
        const dayItems = [...allDay, ...timed];
        const hidden = dayItems.length - MAX_PER_DAY;
        const classes = ["month-day"];
        if (day.month !== month) classes.push("other-month");
        if (day.equals(today)) classes.push("today");
        return (
          <div key={day.toString()} className={classes.join(" ")} onDoubleClick={() => onCreate(day)}>
            <button type="button" className="month-day-number" onClick={() => onOpenDay(day)}>
              {day.day}
            </button>
            {dayItems.slice(0, hidden > 0 ? MAX_PER_DAY - 1 : MAX_PER_DAY).map((item) => (
              <EventChip
                key={item.event.id + item.occurrence.key}
                item={item}
                color={colorOf(item.event.calendarId)}
                zone={zone}
                showTime
                onSelect={onSelect}
              />
            ))}
            {hidden > 0 && (
              <button type="button" className="month-more" onClick={() => onOpenDay(day)}>
                {hidden + 1} more
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
