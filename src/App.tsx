import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { type Calendar, CalendarRepository } from "./db/calendars";
import { type EventOccurrence, EventRepository } from "./db/events";
import { type Note, type NoteInput, NoteRepository } from "./db/notes";
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
import { useUpdate } from "./ui/useUpdate";
import { useReminders } from "./ui/useReminders";
import "./App.css";

interface Repos {
  calendars: CalendarRepository;
  events: EventRepository;
  notes: NoteRepository;
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
  const [openNote, setOpenNote] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [mode, setMode] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => Temporal.Now.plainDateISO(zone));
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [newName, setNewName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | { error: string } | null>(null);
  // Bumped after every change so the visible range reloads.
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!inTauri) {
      setError("Calendaria stores data on your device, so run it with `npm run tauri dev`.");
      return;
    }
    (async () => {
      const db = await openTauriDriver();
      const calendarRepo = new CalendarRepository(db);
      await calendarRepo.ensureDefault();
      setRepos({ calendars: calendarRepo, events: new EventRepository(db), notes: new NoteRepository(db) });
    })().catch((e) => setError(String(e)));
  }, []);

  const days = useMemo(() => visibleDays(mode, anchor), [mode, anchor]);

  useEffect(() => {
    if (!repos) return;
    const { start, end } = dayRange(days, zone);
    Promise.all([
      repos.calendars.list(),
      repos.events.occurrencesInRange(start, end, zone),
      repos.notes.listOnDays(days[0], days[days.length - 1]),
    ])
      .then(([cals, occurrences, dayNotes]) => {
        setCalendars(cals);
        setItems(occurrences);
        setNotes(dayNotes);
      })
      .catch((e) => setError(String(e)));
  }, [repos, days, zone, version]);

  useReminders(repos?.events ?? null, repos?.notes ?? null, zone);
  const appUpdate = useUpdate();

  const colorOf = useCallback(
    (calendarId: string) => calendars.find((c) => c.id === calendarId)?.color ?? "#888888",
    [calendars],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const noteHandlers = useMemo<NoteHandlers>(
    () => ({
      notesOn: (day) => notes.filter((n) => n.day.equals(day)),
      open: (note, anchor) => setOpenNote({ id: note.id, anchor: anchor.getBoundingClientRect() }),
      move: (id, day) => {
        setOpenNote(null);
        repos?.notes.moveToDay(id, day).then(changed, (e) => setError(String(e)));
      },
      menu: (e, day, time) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY, day, time });
      },
    }),
    [notes, repos],
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
    const note = await repos!.notes.create({ day: target.day });
    setNotes((current) => [...current, note]);
    setOpenNote({ id: note.id, anchor: new DOMRect(target.x, target.y, 0, 0) });
  }

  async function changeNote(id: string, patch: Partial<NoteInput>) {
    const updated = await repos!.notes.update(id, patch);
    setNotes((current) => current.map((n) => (n.id === id ? updated : n)));
  }

  async function removeNote(id: string) {
    setOpenNote(null);
    await repos!.notes.remove(id);
    setNotes((current) => current.filter((n) => n.id !== id));
  }

  const editingNote = openNote && notes.find((n) => n.id === openNote.id);

  const openDay = (day: Temporal.PlainDate) => {
    setAnchor(day);
    setMode("day");
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Calendaria</h1>
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
        {appUpdate.update && (
          <div className="update">
            <p>Version {appUpdate.update.version} is ready.</p>
            <button type="button" className="link" onClick={appUpdate.install}>
              {appUpdate.installing ? "Updating…" : "Update and restart"}
            </button>
            {appUpdate.error && <p className="error-text">{appUpdate.error}</p>}
          </div>
        )}
        <p className="zone-note">Times shown in {zone}</p>
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

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          items={[
            { label: "New event", onSelect: () => setDialog({ kind: "new", day: menu.day, time: menu.time }) },
            { label: "Note", onSelect: () => addNote(menu).catch((e) => setError(String(e))) },
          ]}
        />
      )}

      {editingNote && openNote && (
        <StickyNote
          key={editingNote.id}
          note={editingNote}
          anchor={openNote.anchor}
          zone={zone}
          onChange={(patch) => changeNote(editingNote.id, patch).catch((e) => setError(String(e)))}
          onDelete={() => removeNote(editingNote.id).catch((e) => setError(String(e)))}
          onClose={() => setOpenNote(null)}
        />
      )}

      {dialog && (
        <EventDialog
          target={dialog}
          calendars={calendars}
          zone={zone}
          onSave={save}
          onDelete={remove}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
