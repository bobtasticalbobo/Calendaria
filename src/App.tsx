import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { type Calendar, CalendarRepository } from "./db/calendars";
import { type EventOccurrence, EventRepository } from "./db/events";
import { openTauriDriver } from "./db/tauriDriver";
import { type ImportSummary, importIcs } from "./import/importCalendar";
import { Temporal } from "./time/temporal";
import { systemTimeZone } from "./time/timing";
import { type DialogTarget, type EditScope, EventDialog } from "./ui/EventDialog";
import { MonthView } from "./ui/MonthView";
import { TimeGridView } from "./ui/TimeGridView";
import { type ViewMode, dayRange, stepAnchor, viewTitle, visibleDays } from "./ui/dates";
import { seriesTimingFromOccurrenceEdit } from "./ui/edit";
import { useLocalUpdate } from "./ui/useLocalUpdate";
import { useReminders } from "./ui/useReminders";
import "./App.css";

interface Repos {
  calendars: CalendarRepository;
  events: EventRepository;
}

const inTauri = "__TAURI_INTERNALS__" in window;

export default function App() {
  const zone = useMemo(systemTimeZone, []);
  const [repos, setRepos] = useState<Repos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [items, setItems] = useState<EventOccurrence[]>([]);
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
      setRepos({ calendars: calendarRepo, events: new EventRepository(db) });
    })().catch((e) => setError(String(e)));
  }, []);

  const days = useMemo(() => visibleDays(mode, anchor), [mode, anchor]);

  useEffect(() => {
    if (!repos) return;
    const { start, end } = dayRange(days, zone);
    Promise.all([repos.calendars.list(), repos.events.occurrencesInRange(start, end, zone)])
      .then(([cals, occurrences]) => {
        setCalendars(cals);
        setItems(occurrences);
      })
      .catch((e) => setError(String(e)));
  }, [repos, days, zone, version]);

  useReminders(repos?.events ?? null, zone);
  const localUpdate = useLocalUpdate();

  const colorOf = useCallback(
    (calendarId: string) => calendars.find((c) => c.id === calendarId)?.color ?? "#888888",
    [calendars],
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
        {localUpdate.update && (
          <div className="update">
            <p>Version {localUpdate.update.version} is ready.</p>
            <button type="button" className="link" onClick={localUpdate.install}>
              Update and restart
            </button>
            {localUpdate.error && <p className="error-text">{localUpdate.error}</p>}
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
          />
        ) : (
          <TimeGridView
            days={days}
            items={items}
            zone={zone}
            colorOf={colorOf}
            onSelect={(item) => setDialog({ kind: "edit", item })}
            onCreate={(day, time) => setDialog({ kind: "new", day, time })}
          />
        )}
      </main>

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
