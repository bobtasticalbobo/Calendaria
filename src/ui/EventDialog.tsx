import { type FormEvent, useMemo, useState } from "react";
import type { Calendar } from "../db/calendars";
import type { EventInput, EventOccurrence } from "../db/events";
import { TAG_COLORS, type Tag } from "../db/tags";
import { REMINDER_OPTIONS } from "../time/reminders";
import {
  type RepeatChoice,
  type RepeatFrequency,
  buildRepeatRule,
  parseRepeatRule,
  repeatOptions,
} from "../time/repeat";
import { Temporal } from "../time/temporal";
import type { EventTiming } from "../time/timing";
import { DateInput, TimeInput } from "./fields";

export type EditScope = "this" | "all";

export type DialogTarget =
  | { kind: "new"; day: Temporal.PlainDate; time?: Temporal.PlainTime }
  | { kind: "edit"; item: EventOccurrence };

const plainDate = (text: string) => (text ? Temporal.PlainDate.from(text) : null);
const plainTime = (text: string) => (text ? Temporal.PlainTime.from(text) : null);

interface Props {
  target: DialogTarget;
  calendars: Calendar[];
  tags: Tag[];
  zone: string;
  onCreateTag: (name: string, color: string) => Promise<Tag>;
  onSave: (input: EventInput, scope: EditScope) => Promise<void>;
  onDelete: (scope: EditScope) => Promise<void>;
  onClose: () => void;
}

const REPEAT_LABELS: Record<RepeatFrequency, string> = {
  none: "Does not repeat",
  daily: "Every day",
  weekdays: "Every weekday (Mon–Fri)",
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Every month on this date",
  monthlyLast: "Every month on the last day",
  yearly: "Every year",
  custom: "Custom (from import)",
};

function reminderLabel(minutes: number): string {
  if (minutes === 0) return "At start time";
  if (minutes % 10080 === 0) return `${minutes / 10080} week${minutes > 10080 ? "s" : ""} before`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes > 1440 ? "s" : ""} before`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes > 60 ? "s" : ""} before`;
  return `${minutes} minutes before`;
}

let timeZones: string[] | null = null;
function allTimeZones(): string[] {
  timeZones ??= Intl.supportedValuesOf("timeZone");
  return timeZones;
}

interface FormState {
  title: string;
  calendarId: string;
  location: string;
  description: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timeZone: string;
  repeat: RepeatChoice;
  reminders: number[];
  tags: string[];
}

function hhmm(t: Temporal.PlainTime | Temporal.PlainDateTime): string {
  return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}

function initialState(target: DialogTarget, calendars: Calendar[], zone: string): FormState {
  if (target.kind === "new") {
    const start = target.day.toPlainDateTime(target.time ?? new Temporal.PlainTime(9));
    const end = start.add({ hours: 1 });
    return {
      title: "",
      calendarId: calendars[0]?.id ?? "",
      location: "",
      description: "",
      allDay: !target.time,
      startDate: start.toPlainDate().toString(),
      startTime: hhmm(start),
      endDate: end.toPlainDate().toString(),
      endTime: hhmm(end),
      timeZone: zone,
      repeat: { frequency: "none", end: { type: "never" } },
      reminders: [],
      tags: [],
    };
  }
  const { event, occurrence } = target.item;
  const t = occurrence.timing;
  const base = {
    title: event.title,
    calendarId: event.calendarId,
    location: event.location,
    description: event.description,
    repeat: parseRepeatRule(event.recurrence?.rule ?? null, event.timing.start instanceof Temporal.PlainDate ? event.timing.start : event.timing.start.toPlainDate()),
    reminders: event.reminders,
    tags: event.tags,
  };
  if (t.allDay) {
    return {
      ...base,
      allDay: true,
      startDate: t.start.toString(),
      startTime: "09:00",
      // The form shows the inclusive last day; storage uses the exclusive end.
      endDate: t.end.subtract({ days: 1 }).toString(),
      endTime: "10:00",
      timeZone: zone,
    };
  }
  return {
    ...base,
    allDay: false,
    startDate: t.start.toPlainDate().toString(),
    startTime: hhmm(t.start),
    endDate: t.end.toPlainDate().toString(),
    endTime: hhmm(t.end),
    timeZone: t.timeZone,
  };
}

function timingFromForm(f: FormState): EventTiming {
  if (f.allDay) {
    return {
      allDay: true,
      start: Temporal.PlainDate.from(f.startDate),
      end: Temporal.PlainDate.from(f.endDate).add({ days: 1 }),
    };
  }
  return {
    allDay: false,
    start: Temporal.PlainDateTime.from(`${f.startDate}T${f.startTime}`),
    end: Temporal.PlainDateTime.from(`${f.endDate}T${f.endTime}`),
    timeZone: f.timeZone,
  };
}

export function EventDialog({ target, calendars, tags, zone, onCreateTag, onSave, onDelete, onClose }: Props) {
  const [form, setForm] = useState(() => initialState(target, calendars, zone));
  const [newTag, setNewTag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<null | "save" | "delete">(null);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const editing = target.kind === "edit" ? target.item : null;
  const repeats = !!editing?.event.recurrence;
  const startDate = useMemo(() => {
    try {
      return Temporal.PlainDate.from(form.startDate);
    } catch {
      return null;
    }
  }, [form.startDate]);

  function buildInput(): EventInput {
    const timing = timingFromForm(form);
    const ruleStart = timing.allDay ? timing.start : timing.start.toPlainDate();
    return {
      calendarId: form.calendarId,
      title: form.title,
      location: form.location,
      description: form.description,
      timing,
      rule: buildRepeatRule(form.repeat, ruleStart, form.allDay, editing?.event.recurrence?.rule ?? null),
      reminders: form.reminders,
      tags: form.tags,
    };
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (repeats) setPending("save");
    else run(() => onSave(buildInput(), "all"));
  }

  function remove() {
    if (repeats) setPending("delete");
    else run(() => onDelete("all"));
  }

  function choose(scope: EditScope) {
    run(() => (pending === "delete" ? onDelete(scope) : onSave(buildInput(), scope)));
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form className="dialog" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="dialog-title"
          autoFocus
          placeholder="Title"
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
        />

        <label className="row">
          <input type="checkbox" checked={form.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
          All day
        </label>

        <div className="row">
          <DateInput
            aria-label="Start day"
            value={plainDate(form.startDate)}
            onChange={(d) => set({ startDate: d.toString() })}
          />
          {!form.allDay && (
            <TimeInput
              aria-label="Start time"
              value={plainTime(form.startTime)}
              onChange={(t) => set({ startTime: t.toString({ smallestUnit: "minute" }) })}
            />
          )}
          <span>to</span>
          <DateInput aria-label="End day" value={plainDate(form.endDate)} onChange={(d) => set({ endDate: d.toString() })} />
          {!form.allDay && (
            <TimeInput
              aria-label="End time"
              value={plainTime(form.endTime)}
              onChange={(t) => set({ endTime: t.toString({ smallestUnit: "minute" }) })}
            />
          )}
        </div>

        {!form.allDay && (
          <label className="field">
            Time zone
            <select value={form.timeZone} onChange={(e) => set({ timeZone: e.target.value })}>
              {allTimeZones().map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          Repeat
          <select
            value={form.repeat.frequency}
            onChange={(e) => set({ repeat: { ...form.repeat, frequency: e.target.value as RepeatFrequency } })}
          >
            {(startDate ? repeatOptions(startDate) : (["none"] as RepeatFrequency[]))
              .concat(form.repeat.frequency === "custom" ? ["custom"] : [])
              .map((f) => (
                <option key={f} value={f}>
                  {REPEAT_LABELS[f]}
                </option>
              ))}
          </select>
        </label>

        {form.repeat.frequency !== "none" && form.repeat.frequency !== "custom" && (
          <div className="row">
            <span>Ends</span>
            <select
              value={form.repeat.end.type}
              onChange={(e) => {
                const type = e.target.value;
                const end =
                  type === "on"
                    ? { type: "on" as const, date: (startDate ?? Temporal.Now.plainDateISO()).add({ months: 1 }) }
                    : type === "after"
                      ? { type: "after" as const, count: 10 }
                      : { type: "never" as const };
                set({ repeat: { ...form.repeat, end } });
              }}
            >
              <option value="never">Never</option>
              <option value="on">On date</option>
              <option value="after">After</option>
            </select>
            {form.repeat.end.type === "on" && (
              <DateInput
                aria-label="Repeat until"
                value={form.repeat.end.date}
                onChange={(date) => set({ repeat: { ...form.repeat, end: { type: "on", date } } })}
              />
            )}
            {form.repeat.end.type === "after" && (
              <>
                <input
                  type="number"
                  min={1}
                  required
                  value={form.repeat.end.count}
                  onChange={(e) =>
                    set({ repeat: { ...form.repeat, end: { type: "after", count: Number(e.target.value) } } })
                  }
                />
                <span>times</span>
              </>
            )}
          </div>
        )}

        <div className="field">
          Reminders
          {form.reminders.map((minutes, i) => (
            <div className="row" key={i}>
              <select
                value={minutes}
                onChange={(e) =>
                  set({ reminders: form.reminders.map((m, j) => (j === i ? Number(e.target.value) : m)) })
                }
              >
                {[...new Set([...REMINDER_OPTIONS, minutes])].sort((a, b) => a - b).map((m) => (
                  <option key={m} value={m}>
                    {reminderLabel(m)}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => set({ reminders: form.reminders.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="link"
            onClick={() => set({ reminders: [...form.reminders, 15] })}
          >
            + Add reminder
          </button>
        </div>

        <label className="field">
          Calendar
          <select value={form.calendarId} onChange={(e) => set({ calendarId: e.target.value })}>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          Tags
          <div className="event-tags">
            {tags.map((tag) => {
              const on = form.tags.includes(tag.id);
              return (
                <button
                  type="button"
                  key={tag.id}
                  className={on ? "event-tag on" : "event-tag"}
                  style={{ "--tag": tag.color } as React.CSSProperties}
                  onClick={() => set({ tags: on ? form.tags.filter((t) => t !== tag.id) : [...form.tags, tag.id] })}
                >
                  {tag.name}
                </button>
              );
            })}
            <input
              className="event-tag-new"
              placeholder="New tag"
              aria-label="New tag name"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                // Enter here makes the tag; it doesn't save the event.
                e.preventDefault();
                if (!newTag.trim()) return;
                onCreateTag(newTag, TAG_COLORS[tags.length % TAG_COLORS.length]).then((tag) => {
                  setForm((f) => ({ ...f, tags: [...f.tags, tag.id] }));
                  setNewTag("");
                });
              }}
            />
          </div>
        </div>

        <input placeholder="Location" value={form.location} onChange={(e) => set({ location: e.target.value })} />
        <textarea
          placeholder="Description"
          rows={3}
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
        />

        {error && <p className="error-text">{error}</p>}

        {pending ? (
          <div className="dialog-actions">
            <span>{pending === "delete" ? "Delete" : "Change"} which events?</span>
            <button type="button" onClick={() => choose("this")}>
              Only this one
            </button>
            <button type="button" onClick={() => choose("all")}>
              All in the series
            </button>
            <button type="button" onClick={() => setPending(null)}>
              Back
            </button>
          </div>
        ) : (
          <div className="dialog-actions">
            {editing && (
              <button type="button" className="danger" onClick={remove}>
                Delete
              </button>
            )}
            <span className="spacer" />
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Save
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
