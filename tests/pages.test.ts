import { describe, expect, it } from "vitest";
import { type Chapter, DEFAULT_CHAPTER_ID, DEFAULT_NOTEBOOK_ID, type Notebook } from "../src/db/notebooks";
import type { NoteReminder } from "../src/db/noteReminders";
import type { Note } from "../src/db/notes";
import { continueList, indentLines, toggleTaskAtCursor, toggleTaskLine } from "../src/notes/editing";
import {
  expandDateShortcut,
  expandShortcutBeforeCursor,
  findDateMentions,
  lineMentioning,
} from "../src/notes/mentions";
import {
  backlinks,
  buildTree,
  findByTitle,
  pageTitle,
  pagesForDay,
  positionBetween,
  searchPages,
  taskCounts,
} from "../src/notes/pages";
import { Temporal } from "../src/time/temporal";

const date = Temporal.PlainDate.from;
const synced = { createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z", deletedAt: null };

function page(id: string, body: string, extra: Partial<Note> = {}): Note {
  return {
    id,
    chapterId: DEFAULT_CHAPTER_ID,
    day: null,
    body,
    color: "yellow",
    pinned: false,
    position: 0,
    tags: [],
    ...synced,
    ...extra,
  };
}

describe("date mentions", () => {
  it("finds day-first and ISO dates, with times", () => {
    const text = "Dentist 24/10/2026 at 14:30, call 1.11.2026 and 2026-12-05T08:15. Then 03-01-2027.";
    expect(findDateMentions(text).map((m) => [m.text, m.date.toString(), m.time?.toString() ?? null])).toEqual([
      ["24/10/2026 at 14:30", "2026-10-24", "14:30:00"],
      ["1.11.2026", "2026-11-01", null],
      ["2026-12-05T08:15", "2026-12-05", "08:15:00"],
      ["03-01-2027", "2027-01-03", null],
    ]);
  });

  it("leaves out impossible dates and other numbers", () => {
    expect(findDateMentions("31/02/2026, 1/2 cup, version 1.2.3, 12/13/2026, 123/10/2026")).toEqual([]);
  });

  it("ignores a time that doesn't exist", () => {
    const [m] = findDateMentions("24/10/2026 25:00");
    expect(m.text).toBe("24/10/2026");
    expect(m.time).toBeNull();
  });

  it("finds the line a reminder is about", () => {
    expect(lineMentioning("Trip\n- [ ] Pack 24/10/2026\n- Fly 26/10/2026", date("2026-10-24"))).toBe("Pack 24/10/2026");
    expect(lineMentioning("Trip", date("2026-10-24"))).toBeNull();
  });
});

describe("date shortcuts", () => {
  // A Thursday.
  const today = date("2026-10-22");
  const cases: [string, string | null][] = [
    ["today", "2026-10-22"],
    ["tomorrow", "2026-10-23"],
    ["tom", "2026-10-23"],
    ["yesterday", "2026-10-21"],
    ["fri", "2026-10-23"],
    ["thursday", "2026-10-29"],
    ["mon", "2026-10-26"],
    ["+3", "2026-10-25"],
    ["3d", "2026-10-25"],
    ["2w", "2026-11-05"],
    ["1m", "2026-11-22"],
    ["24/12", "2026-12-24"],
    ["1/3", "2027-03-01"],
    ["30/2", null],
    ["3", null],
    ["someone", null],
  ];
  it.each(cases)("@%s", (word, expected) => {
    expect(expandDateShortcut(word, today)?.toString() ?? null).toBe(expected);
  });

  it("expands the shortcut before a typed space", () => {
    const value = "Call mum @tomorrow ";
    expect(expandShortcutBeforeCursor(value, value.length, today)).toEqual({
      value: "Call mum 23/10/2026 ",
      cursor: "Call mum 23/10/2026 ".length,
    });
    expect(expandShortcutBeforeCursor("mail a@b.com ", 13, today)).toBeNull();
    expect(expandShortcutBeforeCursor("@nothing ", 9, today)).toBeNull();
  });
});

describe("editing", () => {
  it("continues lists and checklists on Enter", () => {
    const value = "- [x] milk";
    expect(continueList(value, value.length, value.length)).toEqual({
      value: "- [x] milk\n- [ ] ",
      start: 17,
      end: 17,
    });
    expect(continueList("  3. three", 10, 10)!.value).toBe("  3. three\n  4. ");
    expect(continueList("plain", 5, 5)).toBeNull();
  });

  it("ends a list on Enter in an empty item", () => {
    expect(continueList("- a\n- ", 6, 6)).toEqual({ value: "- a\n", start: 4, end: 4 });
  });

  it("ticks checklist items", () => {
    expect(toggleTaskLine("a\n- [ ] b", 1)).toBe("a\n- [x] b");
    expect(toggleTaskLine("- [x] b", 0)).toBe("- [ ] b");
    expect(toggleTaskAtCursor("buy milk", 3).value).toBe("- [ ] buy milk");
    expect(toggleTaskAtCursor("- buy milk", 3).value).toBe("- [ ] buy milk");
    expect(toggleTaskAtCursor("- [ ] buy milk", 3).value).toBe("- [x] buy milk");
  });

  it("indents and outdents the selected lines", () => {
    expect(indentLines("a\nb\nc", 0, 3, false)).toEqual({ value: "  a\n  b\nc", start: 2, end: 7 });
    expect(indentLines("  a\n b", 0, 6, true).value).toBe("a\nb");
  });
});

describe("pages", () => {
  it("titles a page by its first line without markdown", () => {
    expect(pageTitle({ body: "\n# Trip to **Oslo**\nmore" })).toBe("Trip to Oslo");
    expect(pageTitle({ body: "- [ ] [[Groceries]]" })).toBe("Groceries");
    expect(pageTitle({ body: "  " })).toBe("Untitled");
  });

  it("counts checklist items", () => {
    expect(taskCounts("- [x] a\n- [ ] b\n  * [X] c")).toEqual({ done: 2, total: 3 });
    expect(taskCounts("- a")).toBeNull();
  });

  it("follows [[links]] both ways, ignoring case", () => {
    const oslo = page("1", "Oslo\nhotel");
    const plan = page("2", "Plan\nSee [[oslo]] and [[Bergen]]");
    expect(findByTitle([oslo, plan], "OSLO")).toBe(oslo);
    expect(backlinks([oslo, plan], oslo)).toEqual([plan]);
    expect(backlinks([oslo, plan], plan)).toEqual([]);
  });

  it("searches every word, title matches first", () => {
    const a = page("a", "Shopping\nmilk and bread", { updatedAt: "2026-10-22T10:00:00.000Z" });
    const b = page("b", "Milk run\nfrom the shop", { updatedAt: "2026-10-21T10:00:00.000Z" });
    const c = page("c", "Other", { tags: ["t1"] });
    const tagName = (id: string) => (id === "t1" ? "urgent" : undefined);
    expect(searchPages([a, b, c], "milk", tagName).map((h) => h.page.id)).toEqual(["b", "a"]);
    expect(searchPages([a, b, c], "milk bread", tagName).map((h) => h.page.id)).toEqual(["a"]);
    expect(searchPages([a, b, c], "#urgent", tagName).map((h) => h.page.id)).toEqual(["c"]);
    expect(searchPages([a, b, c], "  ", tagName)).toEqual([]);
  });

  it("finds pages linked to, mentioning or reminding on a day", () => {
    const day = date("2026-10-24");
    const linked = page("1", "x", { day });
    const mentions = page("2", "Party 24/10/2026");
    const reminds = page("3", "y");
    const neither = page("4", "25/10/2026");
    const reminder = { noteId: "3", at: Temporal.PlainDateTime.from("2026-10-24T09:00") } as NoteReminder;
    expect(pagesForDay([linked, mentions, reminds, neither], [reminder], day).map((p) => p.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("places pages between neighbours", () => {
    expect(positionBetween(1, 2)).toBe(1.5);
    expect(positionBetween(undefined, 2)).toBe(1);
    expect(positionBetween(3, undefined)).toBe(4);
    expect(positionBetween()).toBe(1);
  });

  it("builds the tree, keeping orphans visible", () => {
    const notebooks: Notebook[] = [
      { id: "nb2", name: "Work", color: "#7aa2f7", position: 2, ...synced },
      { id: DEFAULT_NOTEBOOK_ID, name: "Notebook", color: "#7aa2f7", position: 0, ...synced },
    ];
    const chapters: Chapter[] = [
      { id: DEFAULT_CHAPTER_ID, notebookId: DEFAULT_NOTEBOOK_ID, name: "Day notes", position: 0, ...synced },
      { id: "ch2", notebookId: "nb2", name: "Meetings", position: 1, ...synced },
      { id: "ch3", notebookId: "gone", name: "Lost", position: 2, ...synced },
    ];
    const pages = [
      page("p2", "second", { chapterId: "ch2", position: 2 }),
      page("p1", "first", { chapterId: "ch2", position: 1 }),
      page("p3", "orphan", { chapterId: "deleted" }),
    ];
    const tree = buildTree(notebooks, chapters, pages);
    expect(tree.map((n) => [n.notebook.id, n.chapters.map((c) => c.chapter.id)])).toEqual([
      [DEFAULT_NOTEBOOK_ID, [DEFAULT_CHAPTER_ID, "ch3"]],
      ["nb2", ["ch2"]],
    ]);
    expect(tree[1].chapters[0].pages.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(tree[0].chapters[0].pages.map((p) => p.id)).toEqual(["p3"]);
  });
});
