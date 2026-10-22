import { useEffect, useMemo, useState } from "react";
import type { Chapter, Notebook } from "../db/notebooks";
import type { Note } from "../db/notes";
import type { TaskEvent, TaskRepository } from "../db/tasks";
import { Temporal } from "../time/temporal";
import { formatDate, formatTime } from "../ui/dates";
import { pageTitle } from "./pages";
import { type StatsRange, computeStats, describeDays } from "./stats";

interface Props {
  tasks: TaskRepository;
  notebooks: Notebook[];
  chapters: Chapter[];
  pages: Note[];
  zone: string;
  version: number;
  onOpen: (table: TaskEvent["table"], id: string) => void;
}

const RANGES: [StatsRange, string][] = [
  ["week", "7 days"],
  ["month", "30 days"],
  ["year", "12 months"],
  ["all", "All time"],
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function readRange(): StatsRange {
  try {
    const r = localStorage.getItem("stats.range");
    return r === "week" || r === "month" || r === "year" || r === "all" ? r : "month";
  } catch {
    return "month";
  }
}

/** When tasks get done, which ones, how quickly, and which keep being put off. */
export function StatsView({ tasks, notebooks, chapters, pages, zone, version, onOpen }: Props) {
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  const [range, setRangeState] = useState<StatsRange>(readRange);

  useEffect(() => {
    tasks.events().then(setEvents, (e) => console.error("Loading task history failed", e));
  }, [tasks, version]);

  const setRange = (r: StatsRange) => {
    setRangeState(r);
    try {
      localStorage.setItem("stats.range", r);
    } catch {
      // Only remembers the choice.
    }
  };

  const notebookOf = useMemo(() => {
    const chapterNotebook = new Map(chapters.map((c) => [c.id, c.notebookId]));
    const map = new Map<string, string>();
    for (const n of notebooks) map.set(n.id, n.id);
    for (const c of chapters) map.set(c.id, c.notebookId);
    for (const p of pages) {
      const nb = chapterNotebook.get(p.chapterId);
      if (nb) map.set(p.id, nb);
    }
    return (id: string) => map.get(id) ?? null;
  }, [notebooks, chapters, pages]);

  const stats = useMemo(
    () =>
      events &&
      computeStats({
        events,
        items: [...notebooks, ...chapters, ...pages],
        notebookOf,
        now: Temporal.Now.zonedDateTimeISO(zone),
        range,
      }),
    [events, notebooks, chapters, pages, notebookOf, zone, range],
  );

  if (!stats) return null;
  const maxPeriod = Math.max(1, ...stats.perPeriod.map((b) => b.count));
  const maxHeat = Math.max(1, ...stats.heat.flat());
  const maxNotebook = Math.max(1, ...stats.byNotebook.map((b) => b.count));
  const withDeadline = stats.onTime + stats.late;
  const notebook = (id: string | null) => notebooks.find((n) => n.id === id);
  const live = new Set([...notebooks, ...chapters, ...pages].map((i) => i.id));
  const title = (e: { table?: TaskEvent["table"]; title: string }) =>
    e.table === "notes" ? pageTitle({ body: e.title }) : e.title || "Untitled";

  return (
    <div className="notes-list stats">
      <div className="stats-head">
        <h2>Task statistics</h2>
        <span className="spacer" />
        <div className="segmented small">
          {RANGES.map(([r, label]) => (
            <button type="button" key={r} className={r === range ? "active" : ""} onClick={() => setRange(r)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="stat-tiles">
        <Tile value={stats.done} label="done" />
        <Tile value={stats.made} label="new tasks" />
        <Tile value={stats.openNow} label="open now" />
        <Tile value={stats.overdueNow} label="overdue now" warn={stats.overdueNow > 0} />
        <Tile
          value={withDeadline ? `${Math.round((stats.onTime / withDeadline) * 100)}%` : "–"}
          label={withDeadline ? `on time (${stats.onTime} of ${withDeadline})` : "on time"}
        />
        <Tile
          value={stats.averageDays === null ? "–" : describeDays(stats.averageDays)}
          label="average time to finish"
        />
        <Tile value={stats.streak} label={`day streak (best ${stats.bestStreak})`} />
      </div>

      <section>
        <h3>Done {range === "week" || range === "month" ? "per day" : "per month"}</h3>
        <div className="bars" role="img" aria-label="Tasks done per period">
          {stats.perPeriod.map((b, i) => (
            <div key={i} className="bar" title={`${b.label}: ${b.count}`}>
              <span className="bar-count">{b.count || ""}</span>
              <span className="bar-fill" style={{ height: `${(b.count / maxPeriod) * 100}%` }} />
              <span className="bar-label">{stats.perPeriod.length > 14 && i % 3 ? "" : b.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>When you get things done</h3>
        <div className="heat" role="img" aria-label="Tasks done by weekday and hour">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="heat-hour">
              {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
            </span>
          ))}
          {stats.heat.map((row, d) => [
            <span key={`d${d}`} className="heat-day">
              {WEEKDAYS[d]}
            </span>,
            ...row.map((n, h) => (
              <span
                key={`${d}-${h}`}
                className="heat-cell"
                title={`${WEEKDAYS[d]} ${String(h).padStart(2, "0")}:00 · ${n} done`}
                style={{
                  opacity: n ? 0.25 + 0.75 * (n / maxHeat) : undefined,
                  background: n ? undefined : "var(--line)",
                }}
              />
            )),
          ])}
        </div>
      </section>

      <div className="stats-columns">
        <section>
          <h3>By notebook</h3>
          {stats.byNotebook.length === 0 && <p className="muted">Nothing ticked in this period.</p>}
          {stats.byNotebook.map(({ notebookId, count }) => {
            const nb = notebook(notebookId);
            return (
              <div key={notebookId ?? "gone"} className="hbar">
                <span className="hbar-name">
                  <span className="swatch" style={{ background: nb?.color ?? "var(--faint)" }} />
                  {nb?.name ?? "Deleted"}
                </span>
                <span className="hbar-track">
                  <span
                    className="hbar-fill"
                    style={{ width: `${(count / maxNotebook) * 100}%`, background: nb?.color ?? "var(--faint)" }}
                  />
                </span>
                <span className="hbar-count">{count}</span>
              </div>
            );
          })}
        </section>

        <section>
          <h3>Most put off</h3>
          {stats.putOff.length === 0 && <p className="muted">No "Not yet" answers in this period.</p>}
          {stats.putOff.map((p) => {
            const event = events!.find((e) => e.itemId === p.itemId)!;
            return (
              <div key={p.itemId} className="hbar">
                <button
                  type="button"
                  className="link hbar-name"
                  disabled={!live.has(p.itemId)}
                  onClick={() => onOpen(event.table, p.itemId)}
                >
                  {title({ table: event.table, title: p.title })}
                </button>
                <span className="hbar-count">{p.count}×</span>
              </div>
            );
          })}
        </section>
      </div>

      <section>
        <h3>Recently done</h3>
        {stats.recent.length === 0 && <p className="muted">Tick a task and it shows up here.</p>}
        {stats.recent.map(({ event, late }) => {
          const at = event.at.toZonedDateTimeISO(zone);
          return (
            <div key={event.id} className="list-row recent-row">
              <button
                type="button"
                className="link"
                disabled={!live.has(event.itemId)}
                onClick={() => onOpen(event.table, event.itemId)}
              >
                {title(event)}
              </button>
              <span className="spacer" />
              {event.dueDay && (
                <span className={late ? "tree-due late" : "tree-due"}>
                  {late ? "late" : "on time"} · due {formatDate(event.dueDay, false)}
                </span>
              )}
              <span className="muted">
                {formatDate(at.toPlainDate())} {formatTime(at)}
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function Tile({ value, label, warn = false }: { value: number | string; label: string; warn?: boolean }) {
  return (
    <div className={warn ? "stat-tile warn" : "stat-tile"}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
