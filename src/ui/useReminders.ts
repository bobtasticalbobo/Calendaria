import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useEffect } from "react";
import type { EventRepository } from "../db/events";
import type { NoteReminderRepository } from "../db/noteReminders";
import type { NoteRepository } from "../db/notes";
import { lineMentioning } from "../notes/mentions";
import { MAX_REMINDER, dueReminders } from "../time/reminders";
import { Temporal } from "../time/temporal";
import { formatTime } from "./dates";
import { noteTitle } from "./notes";

const CHECK_EVERY_MS = 30_000;

function describe(minutesBefore: number): string {
  if (minutesBefore === 0) return "Starting now";
  if (minutesBefore % 1440 === 0) return `In ${minutesBefore / 1440} day${minutesBefore === 1440 ? "" : "s"}`;
  if (minutesBefore % 60 === 0) return `In ${minutesBefore / 60} hour${minutesBefore === 60 ? "" : "s"}`;
  return `In ${minutesBefore} minutes`;
}

/**
 * Shows a system notification for each reminder while the app is running.
 * Each check covers the time since the previous one, so a reminder that comes
 * due while the computer sleeps fires on wake instead of being lost.
 */
export function useReminders(
  events: EventRepository | null,
  notes: NoteRepository | null,
  noteReminders: NoteReminderRepository | null,
  zone: string,
) {
  useEffect(() => {
    if (!events || !notes || !noteReminders) return;
    let since = Temporal.Now.instant();
    let running = false;

    const check = async () => {
      if (running) return;
      running = true;
      try {
        const now = Temporal.Now.instant();
        const occurrences = await events.occurrencesInRange(since, now.add(MAX_REMINDER), zone);
        const due = dueReminders(occurrences, since, now, zone);
        const dueNotes = await noteReminders.due(since, now);
        since = now;
        if ((due.length || dueNotes.length) && !(await isPermissionGranted())) {
          if ((await requestPermission()) !== "granted") return;
        }
        for (const reminder of due) {
          sendNotification({
            title: reminder.title || "(No title)",
            body: `${describe(reminder.minutesBefore)} · ${formatTime(reminder.start)}`,
          });
        }
        for (const reminder of dueNotes) {
          const note = await notes.get(reminder.noteId);
          if (!note) continue;
          const line = lineMentioning(note.body, reminder.at.toPlainDate());
          const title = noteTitle(note);
          sendNotification({
            title,
            body: line && line !== title ? line : `Note · ${formatTime(reminder.at.toPlainTime())}`,
          });
        }
      } catch (e) {
        console.error("Reminder check failed", e);
      } finally {
        running = false;
      }
    };

    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [events, notes, noteReminders, zone]);
}
