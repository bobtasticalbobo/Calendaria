import type { CalendarRepository } from "../db/calendars";
import type { EventRepository } from "../db/events";
import { parseIcs } from "./ics";

export interface ImportSummary {
  calendarName: string;
  created: number;
  updated: number;
  /** Events you had deleted since an earlier import of the same file. */
  skipped: number;
  warnings: string[];
}

const DEFAULT_NAME = "Outlook";
const IMPORT_COLOR = "#a36bff";

/**
 * Imports an .ics file into a calendar named after it (or "Outlook"),
 * creating that calendar on first import. Safe to repeat: events are matched
 * to earlier imports by their UID.
 */
export async function importIcs(
  text: string,
  repos: { calendars: CalendarRepository; events: EventRepository },
  zone: string,
): Promise<ImportSummary> {
  const parsed = parseIcs(text, zone);
  // Outlook names every export "Calendar", which says nothing next to your own calendars.
  const fileName = parsed.name?.trim();
  const name = fileName && fileName !== "Calendar" ? fileName : DEFAULT_NAME;
  const calendar =
    (await repos.calendars.list()).find((c) => c.name === name) ??
    (await repos.calendars.create({ name, color: IMPORT_COLOR }));

  const summary: ImportSummary = { calendarName: name, created: 0, updated: 0, skipped: 0, warnings: parsed.warnings };
  let failed = 0;
  for (const event of parsed.events) {
    try {
      const outcome = await repos.events.importEvent(
        event.sourceUid,
        {
          calendarId: calendar.id,
          title: event.title,
          description: event.description,
          location: event.location,
          timing: event.timing,
          rule: event.rule,
          reminders: event.reminders,
        },
        event.exdates,
      );
      summary[outcome]++;
    } catch (e) {
      failed++;
      console.warn(`Couldn't import "${event.title}"`, e);
    }
  }
  if (failed) summary.warnings.push(`${failed} event${failed === 1 ? "" : "s"} couldn't be saved and were skipped.`);
  return summary;
}
