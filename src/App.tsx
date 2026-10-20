import { type FormEvent, useEffect, useState } from "react";
import { type Calendar, CalendarRepository } from "./db/calendars";
import { openTauriDriver } from "./db/tauriDriver";
import "./App.css";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; repo: CalendarRepository; calendars: Calendar[] };

const inTauri = "__TAURI_INTERNALS__" in window;

export default function App() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!inTauri) {
      setState({
        status: "error",
        message: "Calendaria stores data on your device, so run it with `npm run tauri dev`.",
      });
      return;
    }
    (async () => {
      const repo = new CalendarRepository(await openTauriDriver());
      await repo.ensureDefault();
      setState({ status: "ready", repo, calendars: await repo.list() });
    })().catch((e) => setState({ status: "error", message: String(e) }));
  }, []);

  if (state.status === "loading") return <main className="centered">Loading…</main>;
  if (state.status === "error") return <main className="centered error">{state.message}</main>;

  const { repo, calendars } = state;
  const refresh = async () => setState({ ...state, calendars: await repo.list() });

  async function addCalendar(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    await repo.create({ name: newName });
    setNewName("");
    await refresh();
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Calendaria</h1>
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
      </aside>
      <main className="content centered">
        <p>Calendar views are coming in the next step.</p>
      </main>
    </div>
  );
}
