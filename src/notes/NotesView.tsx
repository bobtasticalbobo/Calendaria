import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Chapter,
  DEFAULT_CHAPTER_ID,
  DEFAULT_NOTEBOOK_ID,
  type Notebook,
  type NotebookRepository,
} from "../db/notebooks";
import type { NoteReminder, NoteReminderRepository } from "../db/noteReminders";
import type { Note, NoteInput, NoteRepository } from "../db/notes";
import type { Tag } from "../db/tags";
import { Temporal } from "../time/temporal";
import { ContextMenu, type MenuItem } from "../ui/ContextMenu";
import { formatDate, formatTime, formatWeekday } from "../ui/dates";
import { BellIcon, ChevronIcon, PinIcon, PlusIcon } from "../ui/icons";
import { type EditorMode, PageEditor } from "./PageEditor";
import {
  buildTree,
  chapterOf,
  findByTitle,
  pageExcerpt,
  pageTitle,
  pagesForDay,
  positionBetween,
  searchPages,
  tagLookup,
} from "./pages";

export interface NotesRepos {
  notes: NoteRepository;
  notebooks: NotebookRepository;
  reminders: NoteReminderRepository;
}

/** Where the notes view should go when opened from the calendar. */
export interface NotesFocus {
  pageId?: string;
  day?: Temporal.PlainDate;
}

interface Props {
  repos: NotesRepos;
  tags: Tag[];
  zone: string;
  /** Bumped when data changed elsewhere, such as by sync. */
  version: number;
  focus: NotesFocus | null;
  onCreateTag: (name: string, color: string) => Promise<Tag>;
  /** Called after every change made here, so sync sends it. */
  onEdited: () => void;
  onError: (e: unknown) => void;
  onShowDay: (day: Temporal.PlainDate) => void;
  sidebarTop: ReactNode;
  sidebarFooter: ReactNode;
}

type View = { kind: "page" } | { kind: "trash" } | { kind: "day"; day: Temporal.PlainDate };

const PAGE_DRAG = "application/x-calendaria-page";
const CHAPTER_DRAG = "application/x-calendaria-chapter";

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Only a convenience; nothing is lost.
  }
}

/** Notebooks, chapters and pages on the left, the open page on the right. */
export function NotesView(props: Props) {
  const { repos, tags, zone, onEdited, onError } = props;
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [pages, setPages] = useState<Note[]>([]);
  const [reminders, setReminders] = useState<NoteReminder[]>([]);
  const [trash, setTrash] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => readStored("notes.open", null));
  const [view, setView] = useState<View>({ kind: "page" });
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>(() => readStored("notes.collapsed", []));
  const [mode, setModeState] = useState<EditorMode>(() => readStored("notes.mode", "edit"));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [reloads, setReloads] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const fail = useCallback((e: unknown) => onError(e), [onError]);
  const reload = () => setReloads((n) => n + 1);
  const changed = () => {
    onEdited();
    reload();
  };

  useEffect(() => {
    Promise.all([
      repos.notebooks.listNotebooks(),
      repos.notebooks.listChapters(),
      repos.notes.list(),
      repos.reminders.list(),
      repos.notes.listTrash(),
    ])
      .then(([nbs, chs, ps, rs, tr]) => {
        setNotebooks(nbs);
        setChapters(chs);
        setPages(ps);
        setReminders(rs);
        setTrash(tr.filter((p) => p.body.trim()));
        setLoaded(true);
      })
      .catch(fail);
  }, [repos, props.version, reloads, fail]);

  useEffect(() => {
    if (!props.focus) return;
    setQuery("");
    if (props.focus.pageId) {
      setSelected(props.focus.pageId);
      setView({ kind: "page" });
    } else if (props.focus.day) setView({ kind: "day", day: props.focus.day });
  }, [props.focus]);

  useEffect(() => store("notes.open", selected), [selected]);
  useEffect(() => store("notes.collapsed", collapsed), [collapsed]);

  const setMode = (m: EditorMode) => {
    setModeState(m);
    store("notes.mode", m);
  };

  const tree = useMemo(() => buildTree(notebooks, chapters, pages), [notebooks, chapters, pages]);
  const tag = useMemo(() => tagLookup(tags), [tags]);
  const page = pages.find((p) => p.id === selected) ?? null;
  const pinned = pages.filter((p) => p.pinned);
  const hits = useMemo(() => searchPages(pages, query, (id) => tag(id)?.name), [pages, query, tag]);
  const reminded = useMemo(() => new Set(reminders.map((r) => r.noteId)), [reminders]);

  const pathOf = (p: Note) => {
    const chapter = chapters.find((c) => c.id === chapterOf(p, chapters));
    const notebook = notebooks.find((n) => n.id === chapter?.notebookId) ?? notebooks[0];
    return [notebook?.name, chapter?.name].filter(Boolean).join(" › ");
  };

  /** The chapter new pages go in: the open page's, or the day notes chapter. */
  const currentChapter = () => (page ? chapterOf(page, chapters) : DEFAULT_CHAPTER_ID);

  async function newPage(chapterId = currentChapter(), body = "") {
    const created = await repos.notes.create({ chapterId, body });
    setPages((current) => [...current, created]);
    setSelected(created.id);
    setView({ kind: "page" });
    setQuery("");
    setMode("edit");
    setCollapsed((c) => c.filter((id) => id !== chapterId));
    onEdited();
  }

  async function changePage(id: string, patch: NoteInput) {
    const updated = await repos.notes.update(id, patch);
    setPages((current) => current.map((p) => (p.id === id ? updated : p)));
    onEdited();
  }

  async function trashPage(id: string) {
    await repos.notes.remove(id);
    if (selected === id) setSelected(null);
    changed();
  }

  /** Leaving a page that was never written in throws it away. */
  function open(id: string | null) {
    if (page && page.id !== id && !page.body.trim() && !page.day && !reminded.has(page.id)) {
      repos.notes.remove(page.id).then(changed, fail);
    }
    setSelected(id);
    setView({ kind: "page" });
  }

  function openLink(title: string) {
    const target = findByTitle(pages, title);
    if (target) open(target.id);
    else newPage(currentChapter(), `${title}\n\n`).catch(fail);
  }

  async function addReminder(noteId: string, at: Temporal.PlainDateTime) {
    const r = await repos.reminders.create(noteId, at, zone);
    setReminders((current) => [...current, r]);
    onEdited();
  }

  async function moveReminder(id: string, at: Temporal.PlainDateTime) {
    const r = await repos.reminders.move(id, at);
    setReminders((current) => current.map((x) => (x.id === id ? r : x)));
    onEdited();
  }

  async function removeReminder(id: string) {
    await repos.reminders.remove(id);
    setReminders((current) => current.filter((x) => x.id !== id));
    onEdited();
  }

  async function newNotebook() {
    const { notebook } = await repos.notebooks.createNotebook("New notebook");
    setRenaming(notebook.id);
    changed();
  }

  async function newChapter(notebookId: string) {
    const chapter = await repos.notebooks.createChapter(notebookId, "New chapter");
    setCollapsed((c) => c.filter((id) => id !== notebookId));
    setRenaming(chapter.id);
    changed();
  }

  function rename(id: string, kind: "notebook" | "chapter", name: string) {
    setRenaming(null);
    if (!name.trim()) return;
    const done =
      kind === "notebook" ? repos.notebooks.updateNotebook(id, { name }) : repos.notebooks.updateChapter(id, { name });
    done.then(changed, fail);
  }

  function confirmDelete(what: string, count: number, action: () => Promise<void>) {
    const pagesNote = count ? ` Its ${count} page${count === 1 ? "" : "s"} go to the trash.` : "";
    if (window.confirm(`Delete ${what}?${pagesNote}`)) action().then(changed, fail);
  }

  /** Drops a page before `beforeId` in `chapterId`, or at the end. */
  function dropPage(pageId: string, chapterId: string, beforeId?: string) {
    const siblings =
      tree
        .flatMap((n) => n.chapters)
        .find((c) => c.chapter.id === chapterId)
        ?.pages.filter((p) => p.id !== pageId) ?? [];
    const at = beforeId ? siblings.findIndex((p) => p.id === beforeId) : siblings.length;
    const position = positionBetween(siblings[at - 1]?.position, at >= 0 ? siblings[at]?.position : undefined);
    changePage(pageId, { chapterId, position }).catch(fail);
  }

  function dropChapter(chapterId: string, notebookId: string, beforeId?: string) {
    const siblings =
      tree
        .find((n) => n.notebook.id === notebookId)
        ?.chapters.map((c) => c.chapter)
        .filter((c) => c.id !== chapterId) ?? [];
    const at = beforeId ? siblings.findIndex((c) => c.id === beforeId) : siblings.length;
    const position = positionBetween(siblings[at - 1]?.position, siblings[at]?.position);
    repos.notebooks.updateChapter(chapterId, { notebookId, position }).then(changed, fail);
  }

  const dropProps = (accept: string[], onDrop: (type: string, id: string) => void) => ({
    onDragOver(e: React.DragEvent<HTMLElement>) {
      if (!accept.some((t) => e.dataTransfer.types.includes(t))) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.classList.add("drop-target");
    },
    onDragLeave(e: React.DragEvent<HTMLElement>) {
      e.currentTarget.classList.remove("drop-target");
    },
    onDrop(e: React.DragEvent<HTMLElement>) {
      e.currentTarget.classList.remove("drop-target");
      for (const type of accept) {
        const id = e.dataTransfer.getData(type);
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          onDrop(type, id);
          return;
        }
      }
    },
  });

  // Ctrl+N new page, Ctrl+K search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "k" || e.key === "f") {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      } else if (e.key === "n") {
        e.preventDefault();
        newPage().catch(fail);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const toggle = (id: string) => setCollapsed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const pageRow = (p: Note, chapterId?: string) => (
    <button
      type="button"
      key={p.id}
      className={p.id === selected && view.kind === "page" ? "tree-page active" : "tree-page"}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PAGE_DRAG, p.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      {...(chapterId ? dropProps([PAGE_DRAG], (_, id) => id !== p.id && dropPage(id, chapterId, p.id)) : {})}
      onClick={() => open(p.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            { label: p.pinned ? "Unpin" : "Pin", onSelect: () => changePage(p.id, { pinned: !p.pinned }).catch(fail) },
            ...(p.day ? [{ label: "Show in calendar", onSelect: () => props.onShowDay(p.day!) }] : []),
            { label: "Move to trash", onSelect: () => trashPage(p.id).catch(fail) },
          ],
        });
      }}
      title={pageTitle(p)}
    >
      <span className="tree-title">{pageTitle(p)}</span>
      {reminded.has(p.id) && <BellIcon />}
      {p.pinned && !chapterId && <PinIcon filled />}
    </button>
  );

  const nameInput = (id: string, kind: "notebook" | "chapter", name: string) => (
    <input
      className="tree-rename"
      autoFocus
      defaultValue={name}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => rename(id, kind, e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setRenaming(null);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );

  const dayPages = view.kind === "day" ? pagesForDay(pages, reminders, view.day) : [];

  return (
    <>
      <aside className="sidebar notes-sidebar">
        {props.sidebarTop}
        <input
          ref={search}
          className="notes-search"
          type="search"
          placeholder="Search notes"
          title="Search notes (Ctrl+K)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
            if (e.key === "Enter" && hits[0]) open(hits[0].page.id);
          }}
        />
        <button
          type="button"
          className="primary new-page"
          title="New page (Ctrl+N)"
          onClick={() => newPage().catch(fail)}
        >
          New page
        </button>

        <div className="tree">
          {query.trim() ? (
            <>
              {hits.length === 0 && <p className="muted">Nothing found.</p>}
              {hits.map(({ page: p, snippet }) => (
                <button type="button" key={p.id} className="search-hit" onClick={() => open(p.id)}>
                  <span className="tree-title">{pageTitle(p)}</span>
                  <span className="hit-path">{pathOf(p)}</span>
                  {snippet && <span className="hit-snippet">{snippet}</span>}
                </button>
              ))}
            </>
          ) : (
            <>
              {pinned.length > 0 && (
                <div className="tree-group">
                  <h2>Pinned</h2>
                  {pinned.map((p) => pageRow(p))}
                </div>
              )}
              {tree.map(({ notebook, chapters: chs }) => {
                const nbOpen = !collapsed.includes(notebook.id);
                return (
                  <div key={notebook.id} className="tree-notebook">
                    <div
                      className="tree-row notebook-row"
                      onClick={() => toggle(notebook.id)}
                      onDoubleClick={() => setRenaming(notebook.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenu({
                          x: e.clientX,
                          y: e.clientY,
                          items: [
                            { label: "New chapter", onSelect: () => newChapter(notebook.id).catch(fail) },
                            { label: "Rename", onSelect: () => setRenaming(notebook.id) },
                            ...(notebook.id === DEFAULT_NOTEBOOK_ID
                              ? []
                              : [
                                  {
                                    label: "Delete notebook",
                                    onSelect: () =>
                                      confirmDelete(
                                        `the notebook "${notebook.name}"`,
                                        chs.reduce((n, c) => n + c.pages.length, 0),
                                        () => repos.notebooks.removeNotebook(notebook.id),
                                      ),
                                  },
                                ]),
                          ],
                        });
                      }}
                      {...dropProps([CHAPTER_DRAG], (_, id) => dropChapter(id, notebook.id))}
                    >
                      <ChevronIcon open={nbOpen} />
                      <span className="swatch" style={{ background: notebook.color }} />
                      {renaming === notebook.id ? (
                        nameInput(notebook.id, "notebook", notebook.name)
                      ) : (
                        <span className="tree-title">{notebook.name}</span>
                      )}
                      <button
                        type="button"
                        className="tree-add"
                        title="New chapter"
                        aria-label="New chapter"
                        onClick={(e) => {
                          e.stopPropagation();
                          newChapter(notebook.id).catch(fail);
                        }}
                      >
                        <PlusIcon />
                      </button>
                    </div>
                    {nbOpen &&
                      chs.map(({ chapter, pages: chPages }) => {
                        const chOpen = !collapsed.includes(chapter.id);
                        return (
                          <div key={chapter.id} className="tree-chapter">
                            <div
                              className="tree-row chapter-row"
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData(CHAPTER_DRAG, chapter.id);
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onClick={() => toggle(chapter.id)}
                              onDoubleClick={() => setRenaming(chapter.id)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  items: [
                                    { label: "New page", onSelect: () => newPage(chapter.id).catch(fail) },
                                    { label: "Rename", onSelect: () => setRenaming(chapter.id) },
                                    ...(chapter.id === DEFAULT_CHAPTER_ID
                                      ? []
                                      : [
                                          {
                                            label: "Delete chapter",
                                            onSelect: () =>
                                              confirmDelete(`the chapter "${chapter.name}"`, chPages.length, () =>
                                                repos.notebooks.removeChapter(chapter.id),
                                              ),
                                          },
                                        ]),
                                  ],
                                });
                              }}
                              {...dropProps([PAGE_DRAG, CHAPTER_DRAG], (type, id) =>
                                type === PAGE_DRAG
                                  ? dropPage(id, chapter.id)
                                  : id !== chapter.id && dropChapter(id, notebook.id, chapter.id),
                              )}
                            >
                              <ChevronIcon open={chOpen} />
                              {renaming === chapter.id ? (
                                nameInput(chapter.id, "chapter", chapter.name)
                              ) : (
                                <span className="tree-title">{chapter.name}</span>
                              )}
                              <span className="tree-count">{chPages.length || ""}</span>
                              <button
                                type="button"
                                className="tree-add"
                                title="New page"
                                aria-label="New page"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  newPage(chapter.id).catch(fail);
                                }}
                              >
                                <PlusIcon />
                              </button>
                            </div>
                            {chOpen && chPages.map((p) => pageRow(p, chapter.id))}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
              <button type="button" className="link tree-new" onClick={() => newNotebook().catch(fail)}>
                + New notebook
              </button>
              <button
                type="button"
                className={view.kind === "trash" ? "link tree-new active" : "link tree-new"}
                onClick={() => setView({ kind: "trash" })}
              >
                Trash{trash.length ? ` (${trash.length})` : ""}
              </button>
            </>
          )}
        </div>
        {props.sidebarFooter}
      </aside>

      <main className="content notes-main">
        {view.kind === "trash" ? (
          <div className="notes-list">
            <h2>Trash</h2>
            <p className="muted">Deleted pages stay here for 30 days.</p>
            {trash.map((p) => (
              <div key={p.id} className="list-row">
                <div>
                  <strong>{pageTitle(p)}</strong>
                  <span className="hit-snippet">{pageExcerpt(p)}</span>
                </div>
                <span className="spacer" />
                <button
                  type="button"
                  className="link accent"
                  onClick={() =>
                    repos.notes
                      .restore(p.id, chapters.some((c) => c.id === p.chapterId) ? undefined : DEFAULT_CHAPTER_ID)
                      .then((restored) => {
                        changed();
                        open(restored.id);
                      }, fail)
                  }
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        ) : view.kind === "day" ? (
          <div className="notes-list">
            <h2>
              {formatWeekday(view.day, "long")} {formatDate(view.day)}
            </h2>
            <p className="muted">Pages linked to this day, mentioning it, or reminding you on it.</p>
            {dayPages.map((p) => (
              <button type="button" key={p.id} className="list-row" onClick={() => open(p.id)}>
                <div>
                  <strong>{pageTitle(p)}</strong>
                  <span className="hit-snippet">
                    {pathOf(p)}
                    {reminders
                      .filter((r) => r.noteId === p.id && r.at.toPlainDate().equals(view.day))
                      .map((r) => ` · reminder ${formatTime(r.at.toPlainTime())}`)}
                  </span>
                </div>
              </button>
            ))}
            <div className="row">
              <button
                type="button"
                className="link accent"
                onClick={() =>
                  repos.notes.create({ day: view.day, body: `${formatDate(view.day)}\n\n` }).then((p) => {
                    changed();
                    setSelected(p.id);
                    setView({ kind: "page" });
                    setMode("edit");
                  }, fail)
                }
              >
                + New page for this day
              </button>
              <button type="button" className="link" onClick={() => props.onShowDay(view.day)}>
                Show in the calendar
              </button>
            </div>
          </div>
        ) : page ? (
          <PageEditor
            key={page.id}
            page={page}
            path={pathOf(page)}
            pages={pages}
            reminders={reminders.filter((r) => r.noteId === page.id)}
            tags={tags}
            zone={zone}
            mode={mode}
            onMode={setMode}
            onCreateTag={props.onCreateTag}
            onChange={(patch) => changePage(page.id, patch).catch(fail)}
            onAddReminder={(at) => addReminder(page.id, at).catch(fail)}
            onMoveReminder={(id, at) => moveReminder(id, at).catch(fail)}
            onRemoveReminder={(id) => removeReminder(id).catch(fail)}
            onOpenPage={open}
            onOpenLink={openLink}
            onShowDay={props.onShowDay}
            onDelete={() => trashPage(page.id).catch(fail)}
          />
        ) : (
          loaded && (
            <div className="notes-empty">
              <p>Pick a page, or start a new one.</p>
              <button type="button" className="primary" onClick={() => newPage().catch(fail)}>
                New page
              </button>
              <p className="muted">Ctrl+N new page · Ctrl+K search</p>
            </div>
          )
        )}
      </main>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </>
  );
}
