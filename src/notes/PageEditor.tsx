import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NoteReminder } from "../db/noteReminders";
import type { Note, NoteInput } from "../db/notes";
import type { Tag } from "../db/tags";
import { Temporal } from "../time/temporal";
import { formatDate, formatTime, formatWeekday } from "../ui/dates";
import { BellIcon, CalendarIcon, CloseIcon, PinIcon } from "../ui/icons";
import { Popover, TagLabels, TagPicker } from "../ui/TagPicker";
import { type Edit, continueList, indentLines, insertText, toggleTaskAtCursor, toggleTaskLine } from "./editing";
import { Markdown } from "./Markdown";
import { type DateMention, expandShortcutBeforeCursor, findDateMentions, writeDate } from "./mentions";
import { backlinks, findByTitle, pageTitle, taskCounts, wordCount } from "./pages";

export type EditorMode = "edit" | "read";

interface Props {
  page: Note;
  path: string;
  pages: Note[];
  reminders: NoteReminder[];
  tags: Tag[];
  zone: string;
  mode: EditorMode;
  onMode: (mode: EditorMode) => void;
  onCreateTag: (name: string, color: string) => Promise<Tag>;
  onChange: (patch: NoteInput) => void;
  onAddReminder: (at: Temporal.PlainDateTime) => void;
  onMoveReminder: (id: string, at: Temporal.PlainDateTime) => void;
  onRemoveReminder: (id: string) => void;
  onOpenPage: (id: string) => void;
  onOpenLink: (title: string) => void;
  onShowDay: (day: Temporal.PlainDate) => void;
  onDelete: () => void;
}

const SAVE_DELAY_MS = 400;
const NINE = new Temporal.PlainTime(9);

function longDate(date: Temporal.PlainDate): string {
  return `${formatWeekday(date)} ${formatDate(date)}`;
}

function stamp(iso: string, zone: string): string {
  const at = Temporal.Instant.from(iso).toZonedDateTimeISO(zone);
  return `${formatDate(at.toPlainDate())} ${formatTime(at)}`;
}

/** A page open for writing or reading, with its dates, reminders and links beside it. */
export function PageEditor(props: Props) {
  const { page, pages, reminders, tags, zone, mode, onChange } = props;
  const [body, setBody] = useState(page.body);
  const [cursor, setCursor] = useState<number | null>(null);
  const [picking, setPicking] = useState<{ x: number; y: number } | null>(null);
  const [datePop, setDatePop] = useState<{ x: number; y: number; mention: DateMention } | null>(null);
  const [linkingDay, setLinkingDay] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<number | undefined>(undefined);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const latest = useRef({ body, onChange });
  latest.current = { body, onChange };

  const flush = () => {
    if (pending.current === undefined) return;
    clearTimeout(pending.current);
    pending.current = undefined;
    latest.current.onChange({ body: latest.current.body });
  };

  useEffect(() => flush, []);

  // Take changes that arrive from another device, unless this page is being typed in.
  useEffect(() => {
    if (pending.current === undefined && document.activeElement !== area.current) setBody(page.body);
  }, [page.body]);

  useEffect(() => {
    if (selection.current && area.current) {
      area.current.setSelectionRange(selection.current.start, selection.current.end);
      selection.current = null;
    }
  });

  const write = (next: string) => {
    setBody(next);
    clearTimeout(pending.current);
    pending.current = window.setTimeout(flush, SAVE_DELAY_MS);
  };

  const apply = (edit: Edit) => {
    selection.current = { start: edit.start, end: edit.end };
    write(edit.value);
    setCursor(edit.start);
  };

  const mentions = useMemo(() => findDateMentions(body), [body]);
  const reminderOn = (date: Temporal.PlainDate) => reminders.find((r) => r.at.toPlainDate().equals(date));
  const remindAt = (m: { date: Temporal.PlainDate; time: Temporal.PlainTime | null }) =>
    m.date.toPlainDateTime(m.time ?? NINE);

  const uniqueDates = useMemo(() => {
    const seen = new Set<string>();
    return mentions.filter((m) => {
      const key = `${m.date}${m.time ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [mentions]);

  const atCursor = cursor === null ? undefined : mentions.find((m) => cursor >= m.start && cursor <= m.end);
  const linked = useMemo(() => backlinks(pages, { ...page, body }), [pages, page, body]);
  const tasks = taskCounts(body);
  const pageTags = page.tags.flatMap((id) => tags.find((t) => t.id === id) ?? []);
  const today = Temporal.Now.plainDateISO(zone);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const { value, selectionStart: start, selectionEnd: end } = e.currentTarget;
    let edit: Edit | null = null;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) edit = toggleTaskAtCursor(value, start);
    else if (e.key === "Enter" && !e.shiftKey) {
      // An @shortcut right before the cursor becomes a date first, then the list carries on.
      const expanded = expandShortcutBeforeCursor(`${value.slice(0, start)}\n${value.slice(end)}`, start + 1, today);
      const text = expanded ? expanded.value.slice(0, expanded.cursor - 1) + value.slice(end) : value;
      const at = expanded ? expanded.cursor - 1 : start;
      edit = continueList(text, at, expanded ? at : end);
      if (!edit && expanded) edit = { value: expanded.value, start: expanded.cursor, end: expanded.cursor };
    } else if (e.key === "Tab") edit = indentLines(value, start, end, e.shiftKey);
    else if (e.key === "b" && (e.ctrlKey || e.metaKey)) edit = wrap(value, start, end, "**");
    else if (e.key === "i" && (e.ctrlKey || e.metaKey)) edit = wrap(value, start, end, "*");
    if (edit) {
      e.preventDefault();
      apply(edit);
    }
  }

  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const { value, selectionStart } = e.currentTarget;
    const expanded = expandShortcutBeforeCursor(value, selectionStart, today);
    if (expanded) apply({ value: expanded.value, start: expanded.cursor, end: expanded.cursor });
    else {
      write(value);
      setCursor(selectionStart);
    }
  }

  function insertDate(date: Temporal.PlainDate) {
    const el = area.current;
    if (!el) return;
    const start = el.selectionStart;
    const before = start > 0 && !/\s/.test(body[start - 1]) ? " " : "";
    apply(insertText(body, start, el.selectionEnd, `${before}${writeDate(date)} `));
    el.focus();
  }

  const handlers = {
    toggleTask: (line: number) => write(toggleTaskLine(body, line)),
    openLink: props.onOpenLink,
    linkExists: (title: string) => !!findByTitle(pages, title),
    openUrl: (url: string) => void openUrl(url).catch(() => window.open(url, "_blank")),
    date: (mention: DateMention, target: HTMLElement) => {
      const r = target.getBoundingClientRect();
      setDatePop({ x: r.left, y: r.bottom + 4, mention });
    },
    reminded: (date: Temporal.PlainDate) => !!reminderOn(date),
  };

  return (
    <div className="page">
      <div className="page-main">
        <header className="page-bar">
          <span className="page-path">{props.path}</span>
          <span className="spacer" />
          {page.day ? (
            <span className="page-day">
              <button type="button" title="Show in the calendar" onClick={() => props.onShowDay(page.day!)}>
                <CalendarIcon /> {longDate(page.day)}
              </button>
              <button
                type="button"
                aria-label="Unlink day"
                title="Unlink from this day"
                onClick={() => onChange({ day: null })}
              >
                <CloseIcon />
              </button>
            </span>
          ) : linkingDay ? (
            <input
              type="date"
              autoFocus
              aria-label="Day to link"
              onBlur={() => setLinkingDay(false)}
              onChange={(e) => {
                if (!e.target.value) return;
                onChange({ day: Temporal.PlainDate.from(e.target.value) });
                setLinkingDay(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="quiet"
              title="Show this page on a calendar day"
              onClick={() => setLinkingDay(true)}
            >
              <CalendarIcon /> Link to day
            </button>
          )}
          <button
            type="button"
            className={page.pinned ? "quiet on" : "quiet"}
            title={page.pinned ? "Unpin" : "Pin to the top"}
            aria-label={page.pinned ? "Unpin" : "Pin"}
            onClick={() => onChange({ pinned: !page.pinned })}
          >
            <PinIcon filled={page.pinned} />
          </button>
          <button
            type="button"
            className="quiet"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPicking({ x: r.left - 120, y: r.bottom + 4 });
            }}
          >
            Tags
          </button>
          <div className="segmented small">
            <button type="button" className={mode === "edit" ? "active" : ""} onClick={() => props.onMode("edit")}>
              Write
            </button>
            <button
              type="button"
              className={mode === "read" ? "active" : ""}
              onClick={() => {
                flush();
                props.onMode("read");
              }}
            >
              Read
            </button>
          </div>
        </header>
        {pageTags.length > 0 && (
          <div className="page-tags">
            <TagLabels tags={pageTags} />
          </div>
        )}

        {mode === "edit" && atCursor && (
          <RemindBar
            mention={atCursor}
            reminder={reminderOn(atCursor.date)}
            onAdd={(at) => props.onAddReminder(at)}
            onRemove={(id) => props.onRemoveReminder(id)}
            defaultAt={remindAt(atCursor)}
          />
        )}

        {mode === "edit" ? (
          <textarea
            ref={area}
            className="page-text"
            autoFocus={!body}
            value={body}
            spellCheck
            placeholder={
              "Title\n\nWrite here. Type a date like 24/10/2026, or @tomorrow, @fri, @+3, and you can get a reminder that day."
            }
            onChange={onInput}
            onKeyDown={onKeyDown}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
            onBlur={flush}
          />
        ) : (
          <div className="page-read" onDoubleClick={() => props.onMode("edit")}>
            {body.trim() ? <Markdown body={body} handlers={handlers} /> : <p className="muted">Empty page</p>}
          </div>
        )}
        <footer className="page-foot">
          {mode === "edit" ? (
            <span>
              # heading · - list · - [ ] checklist (Ctrl+Enter) · **bold** · [[Page]] link · @tomorrow for a date
            </span>
          ) : (
            <span>Double-click to write</span>
          )}
          <span className="spacer" />
          <input
            type="date"
            className="insert-date"
            title="Insert a date"
            aria-label="Insert a date"
            value=""
            onChange={(e) => e.target.value && insertDate(Temporal.PlainDate.from(e.target.value))}
            disabled={mode !== "edit"}
          />
        </footer>
      </div>

      <aside className="page-side">
        <section>
          <h3>Dates in this page</h3>
          {uniqueDates.length === 0 && <p className="muted">Dates you write, like {writeDate(today)}, show up here.</p>}
          {uniqueDates.map((m) => {
            const r = reminderOn(m.date);
            return (
              <div key={`${m.date}${m.time ?? ""}`} className="side-date">
                <button
                  type="button"
                  className="link"
                  title="Show in the calendar"
                  onClick={() => props.onShowDay(m.date)}
                >
                  {longDate(m.date)}
                  {m.time && ` ${formatTime(m.time)}`}
                </button>
                <span className="spacer" />
                <button
                  type="button"
                  className={r ? "bell on" : "bell"}
                  title={r ? `Reminder at ${formatTime(r.at.toPlainTime())}. Click to remove` : "Remind me that day"}
                  aria-label={r ? "Remove reminder" : "Add reminder"}
                  onClick={() => (r ? props.onRemoveReminder(r.id) : props.onAddReminder(remindAt(m)))}
                >
                  <BellIcon filled={!!r} />
                </button>
              </div>
            );
          })}
        </section>

        <section>
          <h3>Reminders</h3>
          {reminders.map((r) => (
            <div key={r.id} className="side-reminder">
              <input
                type="datetime-local"
                aria-label="Reminder time"
                value={r.at.toString({ smallestUnit: "minute" })}
                onChange={(e) =>
                  e.target.value && props.onMoveReminder(r.id, Temporal.PlainDateTime.from(e.target.value))
                }
              />
              <button type="button" aria-label="Remove reminder" onClick={() => props.onRemoveReminder(r.id)}>
                <CloseIcon />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="link"
            onClick={() =>
              props.onAddReminder(
                (page.day && Temporal.PlainDate.compare(page.day, today) >= 0
                  ? page.day
                  : today.add({ days: 1 })
                ).toPlainDateTime(NINE),
              )
            }
          >
            + Add reminder
          </button>
        </section>

        {linked.length > 0 && (
          <section>
            <h3>Linked from</h3>
            {linked.map((p) => (
              <button type="button" key={p.id} className="link side-link" onClick={() => props.onOpenPage(p.id)}>
                {pageTitle(p)}
              </button>
            ))}
          </section>
        )}

        <section className="side-info">
          <p>
            {wordCount(body)} words{tasks && ` · ${tasks.done}/${tasks.total} done`}
          </p>
          <p>Edited {stamp(page.updatedAt, zone)}</p>
          <p>Created {stamp(page.createdAt, zone)}</p>
          <button type="button" className="link danger" onClick={props.onDelete}>
            Move to trash
          </button>
        </section>
      </aside>

      {picking && (
        <Popover x={picking.x} y={picking.y} onClose={() => setPicking(null)}>
          <TagPicker
            tags={tags}
            selected={page.tags}
            onCreate={props.onCreateTag}
            onToggle={(id, on) => onChange({ tags: on ? [...page.tags, id] : page.tags.filter((t) => t !== id) })}
          />
        </Popover>
      )}

      {datePop && (
        <Popover x={datePop.x} y={datePop.y} onClose={() => setDatePop(null)}>
          <DateMenu
            mention={datePop.mention}
            reminder={reminderOn(datePop.mention.date)}
            linked={!!page.day?.equals(datePop.mention.date)}
            defaultAt={remindAt(datePop.mention)}
            onAdd={props.onAddReminder}
            onRemove={props.onRemoveReminder}
            onShowDay={() => props.onShowDay(datePop.mention.date)}
            onLink={() => onChange({ day: datePop.mention.date })}
            onDone={() => setDatePop(null)}
          />
        </Popover>
      )}
    </div>
  );
}

function wrap(value: string, start: number, end: number, mark: string): Edit {
  const inner = value.slice(start, end);
  const next = value.slice(0, start) + mark + inner + mark + value.slice(end);
  return { value: next, start: start + mark.length, end: end + mark.length };
}

interface RemindProps {
  mention: DateMention;
  reminder: NoteReminder | undefined;
  defaultAt: Temporal.PlainDateTime;
  onAdd: (at: Temporal.PlainDateTime) => void;
  onRemove: (id: string) => void;
}

/** Shown while the cursor is on a date: one click to be reminded that day. */
function RemindBar({ mention, reminder, defaultAt, onAdd, onRemove }: RemindProps) {
  const [time, setTime] = useState(defaultAt.toPlainTime());
  useEffect(() => setTime(defaultAt.toPlainTime()), [defaultAt.toString()]);
  return (
    <div className="remind-bar">
      <BellIcon filled={!!reminder} />
      {reminder ? (
        <>
          <span>
            Reminder on {longDate(reminder.at.toPlainDate())} at {formatTime(reminder.at.toPlainTime())}
          </span>
          <button
            type="button"
            className="link"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onRemove(reminder.id)}
          >
            Remove
          </button>
        </>
      ) : (
        <>
          <span>Remind me on {longDate(mention.date)} at</span>
          <input
            type="time"
            aria-label="Reminder time"
            value={time.toString({ smallestUnit: "minute" })}
            onChange={(e) => e.target.value && setTime(Temporal.PlainTime.from(e.target.value))}
          />
          <button
            type="button"
            className="link accent"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onAdd(mention.date.toPlainDateTime(time))}
          >
            Remind me
          </button>
        </>
      )}
    </div>
  );
}

interface DateMenuProps extends RemindProps {
  linked: boolean;
  onShowDay: () => void;
  onLink: () => void;
  onDone: () => void;
}

/** What a date in a page can do, opened by clicking it while reading. */
function DateMenu({ mention, reminder, linked, defaultAt, onAdd, onRemove, onShowDay, onLink, onDone }: DateMenuProps) {
  const [time, setTime] = useState(defaultAt.toPlainTime());
  return (
    <div className="date-menu">
      <strong>{longDate(mention.date)}</strong>
      {reminder ? (
        <div className="row">
          <span>Reminder at {formatTime(reminder.at.toPlainTime())}</span>
          <span className="spacer" />
          <button type="button" className="link" onClick={() => (onRemove(reminder.id), onDone())}>
            Remove
          </button>
        </div>
      ) : (
        <div className="row">
          <span>Remind me at</span>
          <input
            type="time"
            aria-label="Reminder time"
            value={time.toString({ smallestUnit: "minute" })}
            onChange={(e) => e.target.value && setTime(Temporal.PlainTime.from(e.target.value))}
          />
          <button
            type="button"
            className="link accent"
            onClick={() => (onAdd(mention.date.toPlainDateTime(time)), onDone())}
          >
            Add
          </button>
        </div>
      )}
      <button type="button" className="link" onClick={() => (onShowDay(), onDone())}>
        Show in the calendar
      </button>
      {!linked && (
        <button type="button" className="link" onClick={() => (onLink(), onDone())}>
          Link this page to the day
        </button>
      )}
    </div>
  );
}
