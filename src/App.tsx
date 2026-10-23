import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { type Calendar, CalendarRepository } from "./db/calendars";
import { type EventOccurrence, EventRepository } from "./db/events";
import { NotebookRepository } from "./db/notebooks";
import { type NoteReminder, NoteReminderRepository } from "./db/noteReminders";
import { type Note, type NoteInput, NoteRepository } from "./db/notes";
import type { SqlDriver } from "./db/driver";
import { SettingsRepository } from "./db/settings";
import { type Tag, type TagInput, TagRepository } from "./db/tags";
import { openTauriDriver } from "./db/tauriDriver";
import { type ImportSummary, importIcs } from "./import/importCalendar";
import { Temporal } from "./time/temporal";
import { systemTimeZone } from "./time/timing";
import { type DialogTarget, type EditScope, EventDialog } from "./ui/EventDialog";
import { MonthView } from "./ui/MonthView";
import { TimeGridView } from "./ui/TimeGridView";
import { ContextMenu } from "./ui/ContextMenu";
import { StickyNote } from "./ui/StickyNote";
import type { NoteHandlers } from "./ui/notes";
import { type ViewMode, dayRange, stepAnchor, viewTitle, visibleDays } from "./ui/dates";
import { seriesTimingFromOccurrenceEdit } from "./ui/edit";
import { displayVersion, useUpdate } from "./ui/useUpdate";
import { useSync } from "./ui/useSync";
import { SettingsDialog } from "./ui/SettingsDialog";
import { Popover, TagPicker } from "./ui/TagPicker";
import { useReminders } from "./ui/useReminders";
import { type NotesFocus, NotesView } from "./notes/NotesView";
import { TaskNags } from "./notes/TaskNags";
import { TaskRepository } from "./db/tasks";
import "./App.css";

/** Phone-sized screens, where the sidebar becomes a drawer (matches App.css). */
const NARROW = window.matchMedia("(max-width: 720px)");

/** Sidebar items that show something in the main area, so the drawer gets out of the way. */
const CLOSES_DRAWER = ".new-event, .new-page, .tree-page, .search-hit, .tree-new, .settings-open";

interface Repos {
  db: SqlDriver;
  settings: SettingsRepository;
  calendars: CalendarRepository;
  events: EventRepository;
  notes: NoteRepository;
  notebooks: NotebookRepository;
  reminders: NoteReminderRepository;
  tasks: TaskRepository;
  tags: TagRepository;
}

type Section = "calendar" | "notes";

function storedSection(): Section {
  try {
    return localStorage.getItem("section") === "notes" ? "notes" : "calendar";
  } catch {
    return "calendar";
  }
}

interface MenuTarget {
  x: number;
  y: number;
  day: Temporal.PlainDate;
  time?: Temporal.PlainTime;
}

const inTauri = "__TAURI_INTERNALS__" in window;

export default function App() {
  const zone = useMemo(systemTimeZone, []);
  const [repos, setRepos] = useState<Repos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [items, setItems] = useState<EventOccurrence[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteReminders, setNoteReminders] = useState<NoteReminder[]>([]);
  const [section, setSectionState] = useState<Section>(storedSection);
  const [notesFocus, setNotesFocus] = useState<NotesFocus | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [dayTags, setDayTags] = useState<Map<string, string[]>>(new Map());
  const [tagMenu, setTagMenu] = useState<
    | { x: number; y: number; kind: "day"; day: Temporal.PlainDate }
    | { x: number; y: number; kind: "event"; eventId: string; tags: string[] }
    | null
  >(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openNote, setOpenNote] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  // A phone screen is too narrow for a readable week, so it opens on the day.
  const [mode, setMode] = useState<ViewMode>(() => (NARROW.matches ? "day" : "month"));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [anchor, setAnchor] = useState(() => Temporal.Now.plainDateISO(zone));
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [newName, setNewName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | { error: string } | null>(null);
  // Bumped after every change so the visible range reloads.
  const [version, setVersion] = useState(0);
  // Bumped after every change made here, so sync sends it to other devices.
  const [edits, setEdits] = useState(0);
  const edited = () => setEdits((n) => n + 1);
  const changed = () => {
    setVersion((v) => v + 1);
    edited();
  };

  useEffect(() => {
    if (!inTauri) {
      setError("Calendaria stores data on your device, so run it with `npm run tauri dev`.");
      return;
    }
    (async () => {
      const db = await openTauriDriver();
      const calendarRepo = new CalendarRepository(db);
      await calendarRepo.ensureDefault();
      setRepos({
        db,
        settings: new SettingsRepository(db),
        calendars: calendarRepo,
        events: new EventRepository(db),
        notes: new NoteRepository(db),
        notebooks: new NotebookRepository(db),
        reminders: new NoteReminderRepository(db),
        tasks: new TaskRepository(db),
        tags: new TagRepository(db),
      });
    })().catch((e) => setError(String(e)));
  }, []);

  const days = useMemo(() => visibleDays(mode, anchor), [mode, anchor]);

  useEffect(() => {
    if (!repos) return;
    const { start, end } = dayRange(days, zone);
    Promise.all([
      repos.calendars.list(),
      repos.events.occurrencesInRange(start, end, zone),
      repos.notes.list(),
      repos.reminders.onDays(days[0], days[days.length - 1]),
      repos.tags.list(),
      repos.tags.onDays(days[0], days[days.length - 1]),
    ])
      .then(([cals, occurrences, allNotes, reminders, allTags, tagsByDay]) => {
        setCalendars(cals);
        setItems(occurrences);
        setNotes(allNotes);
        setNoteReminders(reminders);
        setTags(allTags);
        setDayTags(tagsByDay);
      })
      .catch((e) => setError(String(e)));
  }, [repos, days, zone, version]);

  useReminders(repos?.events ?? null, repos?.notes ?? null, repos?.reminders ?? null, zone);
  const appUpdate = useUpdate();
  const sync = useSync(repos?.db ?? null, repos?.settings ?? null, edits, () => setVersion((v) => v + 1));

  const colorOf = useCallback(
    (calendarId: string) => calendars.find((c) => c.id === calendarId)?.color ?? "#888888",
    [calendars],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  const setSection = useCallback((next: Section) => {
    setSectionState(next);
    setOpenNote(null);
    setVersion((v) => v + 1);
    try {
      localStorage.setItem("section", next);
    } catch {
      // Only remembers the last view.
    }
  }, []);

  const openInNotes = useCallback(
    (focus: NotesFocus) => {
      setNotesFocus(focus);
      setSection("notes");
    },
    [setSection],
  );

  const noteHandlers = useMemo<NoteHandlers>(
    () => ({
      notesOn: (day) => notes.filter((n) => n.day?.equals(day)),
      remindersOn: (day) =>
        noteReminders.flatMap((r) => {
          const note = noteById.get(r.noteId);
          return note && r.at.toPlainDate().equals(day) ? [{ reminder: r, note }] : [];
        }),
      hasReminder: (note) => noteReminders.some((r) => r.noteId === note.id),
      openPage: (id) => openInNotes({ pageId: id }),
      tagsOn: (day) => (dayTags.get(day.toString()) ?? []).flatMap((id) => tagById.get(id) ?? []),
      tag: (id) => tagById.get(id),
      open: (note, anchor) => setOpenNote({ id: note.id, anchor: anchor.getBoundingClientRect() }),
      move: (id, day, boardTime) => {
        setOpenNote(null);
        repos?.notes.moveToDay(id, day, boardTime).then(changed, (e) => setError(String(e)));
      },
      eventMenu: (e, item) => {
        e.preventDefault();
        e.stopPropagation();
        setTagMenu({ x: e.clientX, y: e.clientY, kind: "event", eventId: item.event.id, tags: item.event.tags });
      },
      menu: (e, day, time) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY, day, time });
      },
    }),
    [notes, noteReminders, noteById, dayTags, tagById, repos, openInNotes],
  );

  if (error) return <main className="centered error">{error}</main>;
  if (!repos) return <main className="centered">Loading…</main>;

  async function addCalendar(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    await repos!.calendars.create({ name: newName });
    setNewName("");
    changed();
  }

  async function save(input: Parameters<EventRepository["create"]>[0], scope: EditScope) {
    const { events } = repos!;
    if (dialog?.kind === "new") {
      await events.create(input);
    } else if (dialog?.kind === "edit") {
      const { event, occurrence } = dialog.item;
      if (!event.recurrence) await events.update(event.id, input);
      else if (scope === "this") await events.detachOccurrence(event.id, occurrence.key, input);
      else {
        const timing = seriesTimingFromOccurrenceEdit(event.timing, occurrence.timing, input.timing);
        await events.update(event.id, { ...input, timing });
      }
    }
    setDialog(null);
    changed();
  }

  async function remove(scope: EditScope) {
    if (dialog?.kind !== "edit") return;
    const { event, occurrence } = dialog.item;
    if (event.recurrence && scope === "this") await repos!.events.removeOccurrence(event.id, occurrence.key);
    else await repos!.events.remove(event.id);
    setDialog(null);
    changed();
  }

  async function importFile(file: File) {
    setImporting(true);
    setImportResult(null);
    try {
      setImportResult(await importIcs(await file.text(), repos!, zone));
    } catch (e) {
      setImportResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setImporting(false);
      changed();
    }
  }

  async function addNote(target: MenuTarget) {
    // Made from the board, the note sits where it was asked for.
    const note = await repos!.notes.create({ day: target.day, boardTime: target.time ?? null });
    setNotes((current) => [...current, note]);
    edited();
    setOpenNote({ id: note.id, anchor: new DOMRect(target.x, target.y, 0, 0) });
  }

  async function addNoteReminder(noteId: string, at: Temporal.PlainDateTime) {
    const reminder = await repos!.reminders.create(noteId, at, zone);
    setNoteReminders((current) => [...current, reminder]);
    edited();
  }

  async function moveNoteReminder(id: string, at: Temporal.PlainDateTime) {
    const reminder = await repos!.reminders.move(id, at);
    setNoteReminders((current) => current.map((r) => (r.id === id ? reminder : r)));
    edited();
  }

  async function removeNoteReminders(ids: string[]) {
    for (const id of ids) await repos!.reminders.remove(id);
    setNoteReminders((current) => current.filter((r) => !ids.includes(r.id)));
    edited();
  }

  async function changeNote(id: string, patch: NoteInput) {
    const updated = await repos!.notes.update(id, patch);
    setNotes((current) => current.map((n) => (n.id === id ? updated : n)));
    edited();
  }

  async function removeNote(id: string) {
    setOpenNote(null);
    await repos!.notes.remove(id);
    setNotes((current) => current.filter((n) => n.id !== id));
    edited();
  }

  async function createTag(name: string, color: string): Promise<Tag> {
    const tag = await repos!.tags.create({ name, color });
    setTags((current) => [...current, tag]);
    edited();
    return tag;
  }

  function changeTag(id: string, patch: Partial<TagInput>) {
    repos!.tags.update(id, patch).then(changed, (e) => setError(String(e)));
  }

  function deleteTag(id: string) {
    repos!.tags.remove(id).then(changed, (e) => setError(String(e)));
  }

  function setDayTag(day: Temporal.PlainDate, tagId: string, on: boolean) {
    const key = day.toString();
    setDayTags((current) => {
      const ids = (current.get(key) ?? []).filter((id) => id !== tagId);
      return new Map(current).set(key, on ? [...ids, tagId] : ids);
    });
    repos!.tags.setOnDay(day, tagId, on).then(edited, (e) => setError(String(e)));
  }

  function setEventTag(eventId: string, current: string[], tagId: string, on: boolean) {
    const tags = on ? [...current.filter((id) => id !== tagId), tagId] : current.filter((id) => id !== tagId);
    setTagMenu((menu) => (menu?.kind === "event" ? { ...menu, tags } : menu));
    repos!.events.setTags(eventId, tags).then(changed, (e) => setError(String(e)));
  }

  const editingNote = openNote && notes.find((n) => n.id === openNote.id);

  const openDay = (day: Temporal.PlainDate) => {
    setAnchor(day);
    setMode("day");
  };

  const sidebarTop = (
    <>
      <h1>Calendaria</h1>
      <div className="segmented section-nav">
        <button type="button" className={section === "calendar" ? "active" : ""} onClick={() => setSection("calendar")}>
          Calendar
        </button>
        <button type="button" className={section === "notes" ? "active" : ""} onClick={() => setSection("notes")}>
          Notes
        </button>
      </div>
    </>
  );

  const sidebarFooter = (
    <>
      {appUpdate.update && (
        <div className="update">
          <p>Version {displayVersion(appUpdate.update.version)} is ready.</p>
          <button type="button" className="link" onClick={appUpdate.install}>
            {appUpdate.installing ? "Updating…" : appUpdate.installLabel}
          </button>
          {appUpdate.error && <p className="error-text">{appUpdate.error}</p>}
        </div>
      )}
      <p className="zone-note">
        Times shown in {zone}
        <br />
        Version {displayVersion(__APP_VERSION__)}
        <br />
        <button type="button" className="link settings-open" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </p>
    </>
  );

  return (
    <div
      className={drawerOpen ? "layout drawer-open" : "layout"}
      onClickCapture={(e) => {
        const target = e.target as HTMLElement;
        if (drawerOpen && !target.closest("input") && target.closest(CLOSES_DRAWER)) setDrawerOpen(false);
      }}
    >
      <button type="button" className="drawer-toggle" aria-label="Menu" onClick={() => setDrawerOpen((o) => !o)}>
        {drawerOpen ? "×" : "☰"}
      </button>
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
      {section === "notes" ? (
        <NotesView
          repos={repos}
          tags={tags}
          zone={zone}
          version={version}
          focus={notesFocus}
          onCreateTag={createTag}
          onEdited={edited}
          onError={(e) => setError(String(e))}
          onShowDay={(day) => {
            setAnchor(day);
            if (mode === "month" && day.month !== anchor.month) setMode("month");
            setSection("calendar");
          }}
          sidebarTop={sidebarTop}
          sidebarFooter={sidebarFooter}
        />
      ) : (
        <>
          <aside className="sidebar">
            {sidebarTop}
            <button
              type="button"
              className="primary new-event"
              onClick={() => setDialog({ kind: "new", day: anchor, time: new Temporal.PlainTime(9) })}
            >
              New event
            </button>
            <h2>Calendars</h2>
            <ul className="calendar-list">
              {calendars.map((cal) => (
                <li key={cal.id}>
                  <span className="swatch" style={{ background: cal.color }} />
                  {cal.name}
                </li>
              ))}
            </ul>
            <form onSubmit={addCalendar} className="add-calendar">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New calendar"
                aria-label="New calendar name"
              />
              <button type="submit">Add</button>
            </form>
            <label className="link import">
              {importing ? "Importing…" : "Import .ics file"}
              <input
                type="file"
                accept=".ics,text/calendar"
                hidden
                disabled={importing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) importFile(file);
                }}
              />
            </label>
            {importResult && (
              <div className="import-result">
                {"error" in importResult ? (
                  <p className="error-text">{importResult.error}</p>
                ) : (
                  <>
                    <p>
                      {importResult.created} added, {importResult.updated} updated
                      {importResult.skipped > 0 && `, ${importResult.skipped} you'd deleted left out`} in{" "}
                      {importResult.calendarName}.
                    </p>
                    {importResult.warnings.map((w) => (
                      <p key={w} className="muted">
                        {w}
                      </p>
                    ))}
                  </>
                )}
                <button type="button" className="link" onClick={() => setImportResult(null)}>
                  Dismiss
                </button>
              </div>
            )}
            {sidebarFooter}
          </aside>

          <main className="content">
            <header className="toolbar">
              <button type="button" onClick={() => setAnchor(Temporal.Now.plainDateISO(zone))}>
                Today
              </button>
              <button type="button" aria-label="Previous" onClick={() => setAnchor(stepAnchor(mode, anchor, -1))}>
                ‹
              </button>
              <button type="button" aria-label="Next" onClick={() => setAnchor(stepAnchor(mode, anchor, 1))}>
                ›
              </button>
              <h2>{viewTitle(mode, anchor)}</h2>
              <span className="spacer" />
              <div className="segmented">
                {(["day", "week", "month"] as const).map((m) => (
                  <button type="button" key={m} className={m === mode ? "active" : ""} onClick={() => setMode(m)}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            </header>

            {mode === "month" ? (
              <MonthView
                days={days}
                month={anchor.month}
                items={items}
                zone={zone}
                colorOf={colorOf}
                onSelect={(item) => setDialog({ kind: "edit", item })}
                onCreate={(day) => setDialog({ kind: "new", day })}
                onOpenDay={openDay}
                notes={noteHandlers}
              />
            ) : (
              <TimeGridView
                days={days}
                items={items}
                zone={zone}
                colorOf={colorOf}
                onSelect={(item) => setDialog({ kind: "edit", item })}
                onCreate={(day, time) => setDialog({ kind: "new", day, time })}
                notes={noteHandlers}
              />
            )}
          </main>
        </>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          items={[
            { label: "New event", onSelect: () => setDialog({ kind: "new", day: menu.day, time: menu.time }) },
            { label: "Note", onSelect: () => addNote(menu).catch((e) => setError(String(e))) },
            { label: "Notes for this day", onSelect: () => openInNotes({ day: menu.day }) },
            { label: "Tags", onSelect: () => setTagMenu({ x: menu.x, y: menu.y, kind: "day", day: menu.day }) },
          ]}
        />
      )}

      {tagMenu && (
        <Popover x={tagMenu.x} y={tagMenu.y} onClose={() => setTagMenu(null)}>
          {tagMenu.kind === "day" ? (
            <TagPicker
              tags={tags}
              selected={dayTags.get(tagMenu.day.toString()) ?? []}
              onCreate={createTag}
              onToggle={(id, on) => setDayTag(tagMenu.day, id, on)}
            />
          ) : (
            <TagPicker
              tags={tags}
              selected={tagMenu.tags}
              onCreate={createTag}
              onToggle={(id, on) => setEventTag(tagMenu.eventId, tagMenu.tags, id, on)}
            />
          )}
        </Popover>
      )}

      {settingsOpen && (
        <SettingsDialog
          appUpdate={appUpdate}
          sync={sync}
          tags={tags}
          onCreateTag={createTag}
          onChangeTag={changeTag}
          onDeleteTag={deleteTag}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {editingNote && openNote && (
        <StickyNote
          key={editingNote.id}
          note={editingNote}
          reminders={noteReminders.filter((r) => r.noteId === editingNote.id)}
          anchor={openNote.anchor}
          zone={zone}
          tags={tags}
          onCreateTag={createTag}
          onChange={(patch) => changeNote(editingNote.id, patch).catch((e) => setError(String(e)))}
          onDelete={() => removeNote(editingNote.id).catch((e) => setError(String(e)))}
          onAddReminder={(at) => addNoteReminder(editingNote.id, at).catch((e) => setError(String(e)))}
          onMoveReminder={(id, at) => moveNoteReminder(id, at).catch((e) => setError(String(e)))}
          onRemoveReminders={(ids) => removeNoteReminders(ids).catch((e) => setError(String(e)))}
          onOpenInNotes={() => openInNotes({ pageId: editingNote.id })}
          onClose={() => setOpenNote(null)}
        />
      )}

      <TaskNags
        tasks={repos.tasks}
        zone={zone}
        version={version}
        onDone={changed}
        onOpen={(task) => openInNotes(task.table === "notes" ? { pageId: task.id } : {})}
        onError={(e) => setError(String(e))}
      />

      {dialog && (
        <EventDialog
          target={dialog}
          calendars={calendars}
          tags={tags}
          zone={zone}
          onCreateTag={createTag}
          onSave={save}
          onDelete={remove}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
