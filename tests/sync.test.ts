import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CalendarRepository } from "../src/db/calendars";
import type { SqlDriver } from "../src/db/driver";
import { EventRepository } from "../src/db/events";
import { NotebookRepository } from "../src/db/notebooks";
import { NoteReminderRepository } from "../src/db/noteReminders";
import { NoteRepository } from "../src/db/notes";
import { TaskRepository } from "../src/db/tasks";
import { SettingsRepository } from "../src/db/settings";
import { TagRepository } from "../src/db/tags";
import { importIcs } from "../src/import/importCalendar";
import { GIST_DESCRIPTION, GistStore } from "../src/sync/gist";
import { DEFAULT_PORT, type Found, LanSync, PAIRING_MS, type Transport, parsePairing } from "../src/sync/lan";
import { retireGist } from "../src/sync/sync";
import { Temporal } from "../src/time/temporal";
import { createTestDriver } from "./sqliteDriver";

const ZONE = "Europe/Stockholm";
const outlook = readFileSync(join(import.meta.dirname, "fixtures/outlook.ics"), "utf8");

/** Stands in for the home network: who answers at which address, and who announces themselves. */
class FakeNetwork {
  hosts = new Map<string, Device>();
  /** Everything sent over the network, to check it's unreadable. */
  wire: string[] = [];

  transport(): Transport {
    return {
      post: async (url, body) => {
        const { hostname, port } = new URL(url);
        const device = this.hosts.get(hostname);
        if (!device || device.port !== Number(port) || !device.online) throw new Error("unreachable");
        this.wire.push(body);
        const answer = await device.lan.handle(body);
        this.wire.push(answer.body);
        return answer;
      },
      browse: async () => {
        const found: Found[] = [];
        for (const [address, device] of this.hosts) {
          const group = await device.lan.group();
          if (device.online && device.port !== null && group && device.onWifi) {
            found.push({ id: device.lan.id, name: device.name, group, port: device.port, addresses: [address] });
          }
        }
        return found;
      },
    };
  }
}

/** Shared time across devices, moved forward a second at each read. */
let now = Date.parse("2026-10-20T12:00:00Z");
const clock = () => new Date((now += 1000));
/** The time pairing codes are checked against, moved by hand. */
let pairingNow = 0;

class Device {
  db: SqlDriver = createTestDriver();
  settings = new SettingsRepository(this.db);
  calendars = new CalendarRepository(this.db, clock);
  events = new EventRepository(this.db, clock);
  notes = new NoteRepository(this.db, clock);
  notebooks = new NotebookRepository(this.db, clock);
  reminders = new NoteReminderRepository(this.db, clock);
  tasks = new TaskRepository(this.db, clock);
  tags = new TagRepository(this.db, clock);
  lan: LanSync;
  online = true;
  /** Announces itself on the network (mDNS); off for a PC only reachable by address. */
  onWifi = true;

  constructor(
    network: FakeNetwork,
    readonly name: string,
    readonly address: string | null,
    readonly port: number | null = address ? DEFAULT_PORT : null,
  ) {
    if (address) network.hosts.set(address, this);
    this.lan = new LanSync(
      this.db,
      this.settings,
      network.transport(),
      async () => ({ name, port: this.port, addresses: address ? [address] : [] }),
      clock,
      () => pairingNow,
    );
  }

  async start() {
    await this.calendars.ensureDefault();
    await this.lan.load();
    return this;
  }

  async sync() {
    return (await this.lan.syncAll()).localChanged;
  }

  /** Pairs with `pc` the way a person would: `pc` shows a code, this device types it. */
  async pairWith(pc: Device) {
    const { code } = await pc.lan.startPairing();
    await this.lan.join(code);
  }

  async eventTitles() {
    const range = await this.events.occurrencesInRange(
      Temporal.Instant.from("2026-01-01T00:00Z"),
      Temporal.Instant.from("2027-12-31T00:00Z"),
      ZONE,
    );
    return [...new Set(range.map((o) => o.event.title))].sort();
  }
}

function meeting(calendarId: string, title: string) {
  return {
    calendarId,
    title,
    timing: {
      allDay: false as const,
      start: Temporal.PlainDateTime.from("2026-10-21T10:00"),
      end: Temporal.PlainDateTime.from("2026-10-21T11:00"),
      timeZone: ZONE,
    },
  };
}

describe("sync between devices", () => {
  let network: FakeNetwork;
  let laptop: Device;
  let pc: Device;

  beforeEach(async () => {
    network = new FakeNetwork();
    pairingNow = 0;
    // The laptop's Personal calendar is the older one, so it is the one both keep.
    laptop = await new Device(network, "Laptop", "192.168.1.11").start();
    pc = await new Device(network, "PC", "192.168.1.10").start();
    await laptop.pairWith(pc);
  });

  it("brings the laptop's calendar to the PC", async () => {
    const [personal] = await laptop.calendars.list();
    await laptop.events.create(meeting(personal.id, "Dentist"));
    await laptop.notes.create({ day: Temporal.PlainDate.from("2026-10-21"), body: "Bring card" });

    await laptop.sync();

    expect(await pc.eventTitles()).toEqual(["Dentist"]);
    const notes = await pc.notes.listOnDays(Temporal.PlainDate.from("2026-10-21"), Temporal.PlainDate.from("2026-10-21"));
    expect(notes.map((n) => n.body)).toEqual(["Bring card"]);
  });

  it("brings notebooks, pages and their reminders across, encrypted, with one default notebook", async () => {
    const { notebook, chapter } = await laptop.notebooks.createNotebook("Travel");
    const page = await laptop.notes.create({ chapterId: chapter.id, body: "Oslo trip\nFly 24/10/2026", pinned: true });
    await laptop.reminders.create(page.id, Temporal.PlainDateTime.from("2026-10-24T06:00"), ZONE);

    await laptop.sync();
    await pc.sync();

    expect((await pc.notebooks.listNotebooks()).map((n) => n.name)).toEqual(["Notebook", "Travel"]);
    expect((await pc.notebooks.listChapters()).find((c) => c.id === chapter.id)?.notebookId).toBe(notebook.id);
    const [synced] = (await pc.notes.list()).filter((n) => n.id === page.id);
    expect(synced).toMatchObject({ body: "Oslo trip\nFly 24/10/2026", pinned: true, chapterId: chapter.id });
    expect((await pc.reminders.list()).map((r) => r.at.toString())).toEqual(["2026-10-24T06:00:00"]);
    expect(network.wire.join("\n")).not.toContain("Oslo");

    await pc.notebooks.removeNotebook(notebook.id);
    await pc.sync();
    await laptop.sync();
    expect((await laptop.notebooks.listNotebooks()).map((n) => n.name)).toEqual(["Notebook"]);
    expect(await laptop.reminders.list()).toEqual([]);
  });

  it("brings tasks, deadlines and ticks across", async () => {
    const page = await laptop.notes.create({ body: "Tankhead" });
    await laptop.tasks.set("notes", page.id, { dueDay: Temporal.PlainDate.from("2026-10-30") });
    await laptop.sync();
    await pc.sync();
    expect((await pc.tasks.openImportant()).map((t) => t.id)).toEqual([page.id]);

    await pc.tasks.set("notes", page.id, { done: true });
    await pc.sync();
    await laptop.sync();
    expect(await laptop.tasks.openImportant()).toEqual([]);
    expect((await laptop.notes.get(page.id))!.doneAt).not.toBeNull();
  });

  it("merges each device's own Personal calendar into one", async () => {
    await laptop.events.create(meeting((await laptop.calendars.list())[0].id, "From laptop"));
    await pc.events.create(meeting((await pc.calendars.list())[0].id, "From PC"));

    await laptop.sync();
    await pc.sync();
    await laptop.sync();

    for (const device of [laptop, pc]) {
      expect((await device.calendars.list()).map((c) => c.name)).toEqual(["Personal"]);
      expect(await device.eventTitles()).toEqual(["From PC", "From laptop"]);
    }
  });

  it("keeps one copy of events both devices imported from Outlook", async () => {
    await importIcs(outlook, laptop, ZONE);
    await importIcs(outlook, pc, ZONE);
    const titles = await laptop.eventTitles();

    await laptop.sync();
    await pc.sync();
    await laptop.sync();

    for (const device of [laptop, pc]) {
      const calendars = await device.calendars.list();
      expect(calendars.map((c) => c.name).sort()).toEqual(["Outlook", "Personal"]);
      const outlookEvents = await device.db.select<{ n: number }>(
        "SELECT COUNT(*) AS n FROM events WHERE deleted_at IS NULL AND calendar_id = $1",
        [calendars.find((c) => c.name === "Outlook")!.id],
      );
      expect(outlookEvents[0].n).toBe(6);
      expect(await device.eventTitles()).toEqual(titles);
    }
    // Importing again afterwards still updates rather than duplicating.
    const again = await importIcs(outlook, pc, ZONE);
    expect(again.created).toBe(0);
  });

  it("spreads edits and deletions, newest change winning", async () => {
    const [personal] = await laptop.calendars.list();
    const event = await laptop.events.create(meeting(personal.id, "Lunch"));
    await laptop.sync();
    await pc.sync();

    await pc.events.update(event.id, meeting(personal.id, "Lunch with Sam"));
    await pc.sync();
    await laptop.sync();
    expect(await laptop.eventTitles()).toEqual(["Lunch with Sam"]);

    // A deletion followed by a later edit elsewhere: the edit is newer, so it stays.
    await laptop.events.remove(event.id);
    await pc.events.update(event.id, meeting(personal.id, "Later edit"));
    await laptop.sync();
    await pc.sync();
    await laptop.sync();
    expect(await laptop.eventTitles()).toEqual(["Later edit"]);
    expect(await pc.eventTitles()).toEqual(["Later edit"]);
  });

  it("deletes on one device reach the other", async () => {
    const [personal] = await laptop.calendars.list();
    const event = await laptop.events.create(meeting(personal.id, "Cancelled"));
    await laptop.sync();
    await pc.sync();
    await laptop.events.remove(event.id);
    await laptop.sync();
    await pc.sync();
    expect(await pc.eventTitles()).toEqual([]);
  });

  it("syncs tags on days and notes", async () => {
    const exam = await laptop.tags.create({ name: "Exam", color: "#e06c75" });
    const day = Temporal.PlainDate.from("2026-10-21");
    await laptop.tags.setOnDay(day, exam.id, true);
    await laptop.notes.create({ day, body: "Revise", tags: [exam.id] });
    await laptop.sync();
    await pc.sync();

    expect(await pc.tags.onDays(day, day)).toEqual(new Map([["2026-10-21", [exam.id]]]));
    const [note] = await pc.notes.listOnDays(day, day);
    expect(note.tags).toEqual([exam.id]);

    // Untagging on the PC reaches the laptop.
    await pc.tags.setOnDay(day, exam.id, false);
    await pc.sync();
    await laptop.sync();
    expect(await laptop.tags.onDays(day, day)).toEqual(new Map());
  });

  it("sends only encrypted data over the network", async () => {
    const [personal] = await laptop.calendars.list();
    await laptop.events.create(meeting(personal.id, "Dentist"));
    await laptop.notes.create({ day: Temporal.PlainDate.from("2026-10-21"), body: "Bring card" });
    await laptop.sync();

    const text = network.wire.join("\n");
    expect(network.wire.length).toBeGreaterThan(0);
    expect(text).not.toContain("Dentist");
    expect(text).not.toContain("Bring card");
    expect(text).not.toContain("Personal");
  });

  it("brings the phone up to date with both PCs, which also sync with each other", async () => {
    const phone = await new Device(network, "Phone", null).start();
    await phone.pairWith(pc);
    await laptop.events.create(meeting((await laptop.calendars.list())[0].id, "From laptop"));
    await phone.events.create(meeting((await phone.calendars.list())[0].id, "From phone"));

    await phone.sync();
    await laptop.sync();
    await phone.sync();
    for (const device of [phone, pc, laptop]) {
      expect(await device.eventTitles()).toEqual(["From laptop", "From phone"]);
    }
    // The phone found the laptop on the Wi-Fi through the shared group, without pairing with it.
    expect(phone.lan.peerList().map((p) => p.name)).toEqual(["Laptop", "PC"]);
    // The PCs don't try to reach the phone, which serves nothing.
    expect(pc.lan.peerList().find((p) => p.name === "Phone")?.port).toBeNull();
  });

  it("syncs only when the PC can be reached, e.g. at home", async () => {
    const phone = await new Device(network, "Phone", null).start();
    await phone.pairWith(pc);
    laptop.online = false;
    await phone.events.create(meeting((await phone.calendars.list())[0].id, "Written on the bus"));
    pc.online = false;
    expect(await phone.lan.syncAll()).toEqual({ localChanged: false, reached: [] });

    pc.online = true;
    expect((await phone.lan.syncAll()).reached).toEqual([pc.lan.id]);
    expect(await pc.eventTitles()).toEqual(["Written on the bus"]);
  });

  it("reaches a PC by its remembered address when it isn't announced, as over Tailscale", async () => {
    const away = await new Device(network, "Phone", null).start();
    const { link } = await pc.lan.startPairing();
    pc.onWifi = false;
    laptop.onWifi = false;
    await away.lan.join(link);
    await away.events.create(meeting((await away.calendars.list())[0].id, "From afar"));
    expect((await away.lan.syncAll()).reached).toEqual([pc.lan.id]);
    expect(await pc.eventTitles()).toEqual(["From afar"]);
  });

  it("joins with a typed code, found on the network, or with the QR link", async () => {
    const { code, link } = await pc.lan.startPairing();
    expect(code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    expect(parsePairing(link)).toEqual({ code, addresses: ["192.168.1.10"], port: DEFAULT_PORT });
    expect(parsePairing(code.toLowerCase().replaceAll("-", " ")).code).toBe(code);

    const phone = await new Device(network, "Phone", null).start();
    await phone.lan.join(code.toLowerCase());
    expect(await phone.lan.group()).toBe(await pc.lan.group());
  });

  it("accepts a code once, for ten minutes, and gives up after a few wrong guesses", async () => {
    const phone = await new Device(network, "Phone", null).start();
    const tablet = await new Device(network, "Tablet", null).start();
    const { code } = await pc.lan.startPairing();
    await phone.lan.join(code);
    await expect(tablet.lan.join(code)).rejects.toThrow("didn't accept");

    const late = await pc.lan.startPairing();
    pairingNow += PAIRING_MS;
    await expect(tablet.lan.join(late.code)).rejects.toThrow("didn't accept");

    const guarded = await pc.lan.startPairing();
    for (let i = 0; i < 5; i++) await expect(tablet.lan.join("AAAA-AAAA-AAAA")).rejects.toThrow();
    await expect(tablet.lan.join(guarded.code)).rejects.toThrow("didn't accept");
    expect(await tablet.lan.group()).toBeNull();
  });

  it("ignores devices from another group, and they can't read or change anything", async () => {
    await laptop.events.create(meeting((await laptop.calendars.list())[0].id, "Private"));
    await laptop.sync();
    // A neighbour's setup on the same network.
    const stranger = await new Device(network, "Stranger", "192.168.1.66").start();
    const strangerPhone = await new Device(network, "Stranger's phone", null).start();
    await strangerPhone.pairWith(stranger);
    await strangerPhone.events.create(meeting((await strangerPhone.calendars.list())[0].id, "Theirs"));

    // With its own PC away, the stranger's phone finds only devices it has no key for.
    await strangerPhone.lan.forget(stranger.lan.id);
    stranger.online = false;
    expect(await strangerPhone.lan.syncAll()).toEqual({ localChanged: false, reached: [] });
    const forged = await pc.lan.handle(
      JSON.stringify({ v: 1, kind: "sync", g: await pc.lan.group(), iv: "AAAAAAAAAAAAAAAA", data: "AAAA" }),
    );
    expect(forged.status).toBe(403);

    await laptop.sync();
    expect(await pc.eventTitles()).toEqual(["Private"]);
    expect(await strangerPhone.eventTitles()).toEqual(["Theirs"]);
  });

  it("stops syncing after leaving, keeping its data", async () => {
    await laptop.events.create(meeting((await laptop.calendars.list())[0].id, "Kept"));
    await laptop.sync();
    await laptop.lan.leave();
    await pc.events.create(meeting((await pc.calendars.list())[0].id, "Not sent"));
    expect(await laptop.lan.syncAll()).toEqual({ localChanged: false, reached: [] });
    expect(await laptop.eventTitles()).toEqual(["Kept"]);
  });
});

describe("retiring the GitHub gist sync", () => {
  it("deletes the old gists and forgets the GitHub key", async () => {
    const db = createTestDriver();
    const settings = new SettingsRepository(db);
    await settings.set("sync.token", "key");
    await settings.set("sync.passphrase", "secret");
    const removed: string[] = [];
    const store = (token: string) => {
      expect(token).toBe("key");
      return {
        list: async () => [
          { id: "a", encrypted: true },
          { id: "b", encrypted: false },
        ],
        remove: async (id: string) => {
          removed.push(id);
        },
      } as unknown as GistStore;
    };
    await retireGist(settings, store);
    expect(removed).toEqual(["a", "b"]);
    expect(await settings.get("sync.token")).toBeNull();
    expect(await settings.get("sync.passphrase")).toBeNull();
    expect(GIST_DESCRIPTION).toBe("Calendaria sync");
  });

  it("does nothing without a key", async () => {
    const settings = new SettingsRepository(createTestDriver());
    await retireGist(settings, () => {
      throw new Error("shouldn't call GitHub");
    });
  });
});
