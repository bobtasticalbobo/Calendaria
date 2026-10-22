import type { ReactNode } from "react";
import type { Temporal } from "../time/temporal";
import { type DateMention, findDateMentions } from "./mentions";

export interface MarkdownHandlers {
  toggleTask: (line: number) => void;
  openLink: (title: string) => void;
  /** Whether a [[link]] points to an existing page. */
  linkExists: (title: string) => boolean;
  openUrl: (url: string) => void;
  date: (mention: DateMention, target: HTMLElement) => void;
  /** Whether a date has a reminder, to mark its chip. */
  reminded: (date: Temporal.PlainDate) => boolean;
}

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[\[[^\]\n]+\]\])|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(\*[^*\s][^*\n]*\*)|(~~[^~\n]+~~)/g;

function dates(text: string, h: MarkdownHandlers, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of findDateMentions(text)) {
    if (m.start > at) out.push(text.slice(at, m.start));
    out.push(
      <button
        type="button"
        key={`${key}d${m.start}`}
        className={h.reminded(m.date) ? "md-date reminded" : "md-date"}
        title="Remind me, or show this day in the calendar"
        onClick={(e) => h.date(m, e.currentTarget)}
      >
        {m.text}
      </button>,
    );
    at = m.end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function inline(text: string, h: MarkdownHandlers, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const k = `${key}-${n++}`;
    if (m.index > at) out.push(...dates(text.slice(at, m.index), h, k));
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(m[2].slice(2, -2), h, k)}</strong>);
    else if (m[3]) {
      const title = m[3].slice(2, -2).trim();
      out.push(
        <button
          type="button"
          key={k}
          className={h.linkExists(title) ? "md-link" : "md-link missing"}
          title={h.linkExists(title) ? `Open ${title}` : `Create a page called ${title}`}
          onClick={() => h.openLink(title)}
        >
          {title}
        </button>,
      );
    } else if (m[4]) {
      const url = m[5];
      out.push(
        <a key={k} href={url} onClick={(e) => (e.preventDefault(), h.openUrl(url))}>
          {m[4]}
        </a>,
      );
    } else if (m[6]) {
      const url = m[6];
      out.push(
        <a key={k} href={url} onClick={(e) => (e.preventDefault(), h.openUrl(url))}>
          {url}
        </a>,
      );
    } else if (m[7]) out.push(<em key={k}>{inline(m[7].slice(1, -1), h, k)}</em>);
    else if (m[8]) out.push(<s key={k}>{inline(m[8].slice(2, -2), h, k)}</s>);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(...dates(text.slice(at), h, `${key}-e`));
  return out;
}

/** Renders a page's markdown: headings, lists, checklists, quotes, code, links and dates. */
export function Markdown({ body, handlers: h }: { body: string; handlers: MarkdownHandlers }) {
  const lines = body.split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: { text: string; line: number }[] = [];

  const flush = () => {
    if (!paragraph.length) return;
    const first = paragraph[0].line;
    blocks.push(
      <p key={`p${first}`}>
        {paragraph.flatMap((l, i) => [...(i ? [<br key={`br${l.line}`} />] : []), ...inline(l.text, h, `p${l.line}`)])}
      </p>,
    );
    paragraph = [];
  };

  // The first line is the page's title, unless it is already a heading, list or code.
  const titleAt = lines.findIndex((l) => l.trim());
  if (titleAt >= 0 && !/^\s*(#|[-*>]\s|\d+\.\s|```)/.test(lines[titleAt])) {
    blocks.push(
      <h1 key="title" className="md-title">
        {inline(lines[titleAt], h, "t")}
      </h1>,
    );
  }

  for (let i = 0; i < lines.length; i++) {
    if (i === titleAt && blocks.length) continue;
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const start = i;
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push(
        <pre key={`c${start}`}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const Tag = `h${heading[1].length + 1}` as "h2" | "h3" | "h4";
      blocks.push(<Tag key={`h${i}`}>{inline(heading[2], h, `h${i}`)}</Tag>);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push(<hr key={`r${i}`} />);
      continue;
    }
    const item = /^(\s*)([-*]|\d+\.)\s+(?:\[([ xX])\]\s*)?(.*)$/.exec(line);
    if (item) {
      flush();
      const depth = Math.floor(item[1].replace(/\t/g, "  ").length / 2);
      const task = item[3] !== undefined;
      const done = task && item[3] !== " ";
      const index = i;
      blocks.push(
        <div
          key={`l${i}`}
          className={`md-item${task ? " md-task" : ""}${done ? " done" : ""}`}
          style={{ paddingLeft: `${depth * 1.4}em` }}
        >
          {task ? (
            <input type="checkbox" checked={done} onChange={() => h.toggleTask(index)} aria-label="Done" />
          ) : (
            <span className="md-bullet">{/\d/.test(item[2]) ? item[2] : "•"}</span>
          )}
          <span>{inline(item[4], h, `l${i}`)}</span>
        </div>,
      );
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      blocks.push(<blockquote key={`q${i}`}>{inline(quote[1], h, `q${i}`)}</blockquote>);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push({ text: line, line: i });
  }
  flush();
  return <div className="md">{blocks}</div>;
}
