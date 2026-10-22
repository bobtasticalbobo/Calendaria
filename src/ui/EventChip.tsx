import type { EventOccurrence } from "../db/events";
import type { Tag } from "../db/tags";
import { timingBounds } from "../time/timing";
import { formatTime } from "./dates";
import { inkOn } from "./ink";

interface Props {
  item: EventOccurrence;
  color: string;
  /** Tints the chip in the tag's color. */
  tag?: Tag;
  zone: string;
  showTime: boolean;
  onSelect: (item: EventOccurrence) => void;
  onMenu: (e: React.MouseEvent, item: EventOccurrence) => void;
}

/** A one-line event in the month grid or the all-day row. */
export function EventChip({ item, color, tag, zone, showTime, onSelect, onMenu }: Props) {
  const { timing } = item.occurrence;
  const title = item.event.title || "(No title)";
  return (
    <button
      type="button"
      className={(timing.allDay ? "chip chip-allday" : "chip") + (tag ? " tagged-event" : "")}
      style={
        {
          "--event-color": color,
          "--tag": tag?.color,
          "--event-ink": inkOn(tag?.color ?? color),
        } as React.CSSProperties
      }
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item);
      }}
      onContextMenu={(e) => onMenu(e, item)}
      title={title}
    >
      {!timing.allDay && showTime && <span className="chip-time">{formatTime(timingBounds(timing, zone).start)}</span>}
      <span className="chip-title">{title}</span>
    </button>
  );
}
