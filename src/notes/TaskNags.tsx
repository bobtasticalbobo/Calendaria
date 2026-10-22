import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useEffect, useState } from "react";
import type { OpenTask, TaskRepository } from "../db/tasks";
import { Temporal } from "../time/temporal";
import { formatDate, formatWeekday } from "../ui/dates";
import { pageTitle } from "./pages";
import { describeDue, shouldNag } from "./tasks";

const CHECK_EVERY_MS = 30_000;
const ASKED_KEY = "tasks.asked";

/** When each task last asked, kept on this device only. */
function readAsked(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(ASKED_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeAsked(asked: Record<string, string>) {
  try {
    localStorage.setItem(ASKED_KEY, JSON.stringify(asked));
  } catch {
    // Without storage it asks again after a restart, which is harmless.
  }
}

export function taskTitle(task: OpenTask): string {
  return task.table === "notes" ? pageTitle({ body: task.text }) : task.text;
}

interface Props {
  tasks: TaskRepository | null;
  zone: string;
  /** Bumped when data changes, so a task ticked elsewhere stops asking. */
  version: number;
  onDone: () => void;
  onOpen: (task: OpenTask) => void;
  onError: (e: unknown) => void;
}

/**
 * Asks whether each important task is done, from its deadline on, more often
 * the later it gets, until it is ticked. Each time it asks, a notification
 * goes out and a card waits in the corner for an answer.
 */
export function TaskNags({ tasks, zone, version, onDone, onOpen, onError }: Props) {
  const [asking, setAsking] = useState<OpenTask[]>([]);

  useEffect(() => {
    if (!tasks) return;
    let running = false;
    const check = async () => {
      if (running) return;
      running = true;
      try {
        const open = await tasks.openImportant();
        const now = Temporal.Now.zonedDateTimeISO(zone);
        const asked = readAsked();
        const due = open.filter((t) =>
          shouldNag(t.dueDay, asked[t.id] ? Temporal.Instant.from(asked[t.id]) : null, now),
        );
        // Ticked or deleted elsewhere: stop asking.
        setAsking((current) => {
          const still = current.filter((c) => open.some((t) => t.id === c.id));
          return [...still, ...due.filter((t) => !still.some((c) => c.id === t.id))];
        });
        if (!due.length) return;
        for (const t of due) asked[t.id] = now.toInstant().toString();
        writeAsked(asked);
        if (!(await isPermissionGranted()) && (await requestPermission()) !== "granted") return;
        for (const t of due) {
          sendNotification({
            title: `Is this done? ${taskTitle(t)}`,
            body: `${describeDue(t.dueDay, now.toPlainDate())}`,
          });
        }
      } catch (e) {
        console.error("Task check failed", e);
      } finally {
        running = false;
      }
    };
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [tasks, zone, version]);

  if (!asking.length || !tasks) return null;
  const today = Temporal.Now.plainDateISO(zone);
  const dismiss = (id: string) => setAsking((current) => current.filter((t) => t.id !== id));

  return (
    <div className="task-nags">
      {asking.map((t) => (
        <div key={t.id} className="task-nag" role="alertdialog" aria-label={`Is ${taskTitle(t)} done?`}>
          <p className="task-nag-q">Is this done?</p>
          <button type="button" className="link task-nag-title" onClick={() => onOpen(t)}>
            {taskTitle(t)}
          </button>
          <p className={today.until(t.dueDay).days < 0 ? "task-nag-due late" : "task-nag-due"}>
            Due {formatWeekday(t.dueDay)} {formatDate(t.dueDay)} · {describeDue(t.dueDay, today)}
          </p>
          <div className="task-nag-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                dismiss(t.id);
                tasks.set(t.table, t.id, { done: true }).then(onDone, onError);
              }}
            >
              Done
            </button>
            <button
              type="button"
              onClick={() => {
                dismiss(t.id);
                tasks.snoozed(t.table, t.id, taskTitle(t), t.dueDay).catch(onError);
              }}
            >
              Not yet
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
