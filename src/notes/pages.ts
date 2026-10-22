import type { Chapter, Notebook } from "../db/notebooks";
import { DEFAULT_CHAPTER_ID, DEFAULT_NOTEBOOK_ID } from "../db/notebooks";
import type { NoteReminder } from "../db/noteReminders";
import type { Note } from "../db/notes";
import type { Tag } from "../db/tags";
import type { Temporal } from "../time/temporal";
import { findDateMentions } from "./mentions";

export interface ChapterNode {
  chapter: Chapter;
  pages: Note[];
}

export interface NotebookNode {
  notebook: Notebook;
  chapters: ChapterNode[];
}

const byPosition = (a: { position: number; id: string }, b: { position: number; id: string }) =>
  a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Notebooks with their chapters and pages, in order. A chapter whose notebook
 * is gone goes in the first notebook, and a page whose chapter is gone goes in
 * the day notes chapter, which can happen when two devices edit at once.
 */
export function buildTree(notebooks: Notebook[], chapters: Chapter[], pages: Note[]): NotebookNode[] {
  const nodes = [...notebooks].sort(byPosition).map((notebook) => ({ notebook, chapters: [] as ChapterNode[] }));
  const notebookNode = new Map(nodes.map((n) => [n.notebook.id, n]));
  const fallbackNotebook = notebookNode.get(DEFAULT_NOTEBOOK_ID) ?? nodes[0];
  const chapterNode = new Map<string, ChapterNode>();
  for (const chapter of [...chapters].sort(byPosition)) {
    const parent = notebookNode.get(chapter.notebookId) ?? fallbackNotebook;
    if (!parent) continue;
    const node = { chapter, pages: [] as Note[] };
    parent.chapters.push(node);
    chapterNode.set(chapter.id, node);
  }
  const fallbackChapter = chapterNode.get(DEFAULT_CHAPTER_ID) ?? nodes.flatMap((n) => n.chapters)[0];
  for (const page of [...pages].sort(byPosition))
    (chapterNode.get(page.chapterId) ?? fallbackChapter)?.pages.push(page);
  return nodes;
}

/** The chapter a page shows in: its own, or the day notes chapter if its own is gone. */
export function chapterOf(page: Note, chapters: Chapter[]): string {
  return chapters.some((c) => c.id === page.chapterId) ? page.chapterId : DEFAULT_CHAPTER_ID;
}

/** A page's title: its first line without markdown marks. */
export function pageTitle(page: Pick<Note, "body">): string {
  const first = page.body.split("\n").find((l) => l.trim()) ?? "";
  const title = first
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^([-*>]|\d+\.)\s+(\[[ xX]\]\s+)?/, "")
    .replace(/[*_`]|\[\[|\]\]/g, "")
    .trim();
  return title || "Untitled";
}

/** The text after the title, flattened to one line, for previews. */
export function pageExcerpt(page: Pick<Note, "body">, length = 90): string {
  const lines = page.body.split("\n");
  const titleAt = lines.findIndex((l) => l.trim());
  const rest = lines
    .slice(titleAt + 1)
    .join(" ")
    .replace(/^#+\s+|[*_`#>]|\[[ xX]\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return rest.length > length ? `${rest.slice(0, length - 1)}…` : rest;
}

/** Checklist progress, or null when the page has no checklist. */
export function taskCounts(body: string): { done: number; total: number } | null {
  const tasks = body.match(/^\s*([-*]|\d+\.)\s+\[[ xX]\]/gm) ?? [];
  if (!tasks.length) return null;
  return { done: tasks.filter((t) => /\[[xX]\]/.test(t)).length, total: tasks.length };
}

export function wordCount(body: string): number {
  return body.split(/\s+/).filter((w) => /\w/.test(w)).length;
}

/** Titles linked from a page with [[Title]]. */
export function wikiLinks(body: string): string[] {
  return [...body.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((m) => m[1].trim());
}

/** The page a [[link]] points to: the first one with that title, ignoring case. */
export function findByTitle(pages: Note[], title: string): Note | undefined {
  const wanted = title.trim().toLowerCase();
  return pages.find((p) => pageTitle(p).toLowerCase() === wanted);
}

/** Pages that link to `page` with [[its title]]. */
export function backlinks(pages: Note[], page: Note): Note[] {
  const title = pageTitle(page).toLowerCase();
  if (title === "untitled") return [];
  return pages.filter((p) => p.id !== page.id && wikiLinks(p.body).some((l) => l.toLowerCase() === title));
}

export interface SearchHit {
  page: Note;
  /** Text around the first match in the body, or the excerpt. */
  snippet: string;
}

/**
 * Pages containing every word of `query` in their text or tag names. Title
 * matches come first, then the most recently edited.
 */
export function searchPages(pages: Note[], query: string, tagName: (id: string) => string | undefined): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: { page: Note; inTitle: boolean; snippet: string }[] = [];
  for (const page of pages) {
    const tags = page.tags.map((id) => tagName(id) ?? "").join(" ");
    const haystack = `${page.body}\n${tags}`.toLowerCase();
    if (!words.every((w) => haystack.includes(w.replace(/^#/, "")))) continue;
    const title = pageTitle(page).toLowerCase();
    hits.push({ page, inTitle: words.some((w) => title.includes(w)), snippet: snippetAround(page.body, words[0]) });
  }
  hits.sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || (b.page.updatedAt > a.page.updatedAt ? 1 : -1));
  return hits.map(({ page, snippet }) => ({ page, snippet }));
}

function snippetAround(body: string, word: string): string {
  const flat = body.replace(/\s+/g, " ");
  const at = flat.toLowerCase().indexOf(word);
  if (at < 0) return pageExcerpt({ body });
  const start = Math.max(0, at - 30);
  return (start > 0 ? "…" : "") + flat.slice(start, start + 100).trim() + (start + 100 < flat.length ? "…" : "");
}

/** How a page relates to a day: linked to it, mentioning it, or reminding on it. */
export function pagesForDay(pages: Note[], reminders: NoteReminder[], day: Temporal.PlainDate): Note[] {
  const reminded = new Set(reminders.filter((r) => r.at.toPlainDate().equals(day)).map((r) => r.noteId));
  return pages.filter(
    (p) => p.day?.equals(day) || reminded.has(p.id) || findDateMentions(p.body).some((m) => m.date.equals(day)),
  );
}

/** A position that sorts between two neighbours, either of which may be missing. */
export function positionBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

export function tagLookup(tags: Tag[]): (id: string) => Tag | undefined {
  const byId = new Map(tags.map((t) => [t.id, t]));
  return (id) => byId.get(id);
}
