import type { EventOccurrence } from "../db/events";
import { timingBounds } from "../time/timing";
import { formatTime } from "./dates";

interface Props {
  item: EventOccurrence;
  color: string;
  zone: string;
  showTime: boolean;
  onSelect: (item: EventOccurrence) => void;
}

/** A one-line event in the month grid or the all-day row. */
export function EventChip({ item, color, zone, showTime, onSelect }: Props) {
  const { timing } = item.occurrence;
  const title = item.event.title || "(No title)";
  return (
    <button
      type="button"
      className={timing.allDay ? "chip chip-allday" : "chip"}
      style={{ "--event-color": color } as React.CSSProperties}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item);
      }}
      title={title}
    >
      {!timing.allDay && showTime && (
        <span className="chip-time">{formatTime(timingBounds(timing, zone).start)}</span>
      )}
      <span className="chip-title">{title}</span>
    </button>
  );
}
