/** Text edits for the page editor, kept apart from the DOM so they can be tested. */

export interface Edit {
  value: string;
  start: number;
  end: number;
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s(\[[ xX]\]\s)?/;

function lineBounds(value: string, at: number): { start: number; end: number } {
  const start = value.lastIndexOf("\n", at - 1) + 1;
  const nl = value.indexOf("\n", at);
  return { start, end: nl < 0 ? value.length : nl };
}

/**
 * Enter inside a list item starts the next item, with an empty box for a
 * checklist and the next number for a numbered list. Enter on an empty item
 * ends the list. Returns null when the cursor isn't in a list item.
 */
export function continueList(value: string, start: number, end: number): Edit | null {
  if (start !== end) return null;
  const line = lineBounds(value, start);
  const text = value.slice(line.start, line.end);
  const m = LIST_ITEM.exec(text);
  if (!m || start < line.start + m[0].length) return null;
  if (!text.slice(m[0].length).trim() && start === line.end) {
    const cleared = value.slice(0, line.start) + value.slice(line.end);
    return { value: cleared, start: line.start, end: line.start };
  }
  const marker = /^\d+\.$/.test(m[2]) ? `${Number.parseInt(m[2], 10) + 1}.` : m[2];
  const prefix = `\n${m[1]}${marker} ${m[3] ? "[ ] " : ""}`;
  const next = value.slice(0, start) + prefix + value.slice(start);
  const cursor = start + prefix.length;
  return { value: next, start: cursor, end: cursor };
}

/** Ticks or unticks the checklist item on line `index`. */
export function toggleTaskLine(value: string, index: number): string {
  const lines = value.split("\n");
  const line = lines[index];
  if (line === undefined) return value;
  lines[index] = line.replace(
    /^(\s*(?:[-*]|\d+\.)\s)\[([ xX])\]/,
    (_, lead, mark) => `${lead}[${mark === " " ? "x" : " "}]`,
  );
  return lines.join("\n");
}

/**
 * Ctrl+Enter: ticks or unticks the checklist item under the cursor, or makes
 * the line a checklist item if it isn't one.
 */
export function toggleTaskAtCursor(value: string, cursor: number): Edit {
  const line = lineBounds(value, cursor);
  const text = value.slice(line.start, line.end);
  let replaced: string;
  if (/^\s*(?:[-*]|\d+\.)\s\[[ xX]\]/.test(text)) {
    replaced = toggleTaskLine(text, 0);
  } else {
    const m = /^(\s*)(?:([-*]|\d+\.)\s)?/.exec(text)!;
    replaced = `${m[1]}${m[2] ?? "-"} [ ] ${text.slice(m[0].length)}`;
  }
  const shift = replaced.length - text.length;
  const next = value.slice(0, line.start) + replaced + value.slice(line.end);
  return { value: next, start: cursor + shift, end: cursor + shift };
}

/** Tab and Shift+Tab: indent or outdent every line the selection touches by two spaces. */
export function indentLines(value: string, start: number, end: number, outdent: boolean): Edit {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const to = lineBounds(value, end).end;
  const lines = value.slice(from, to).split("\n");
  let firstShift = 0;
  let total = 0;
  const changed = lines.map((line, i) => {
    let shift: number;
    let out: string;
    if (outdent) {
      const remove = line.startsWith("  ") ? 2 : line.startsWith(" ") || line.startsWith("\t") ? 1 : 0;
      out = line.slice(remove);
      shift = -remove;
    } else {
      out = `  ${line}`;
      shift = 2;
    }
    if (i === 0) firstShift = shift;
    total += shift;
    return out;
  });
  const next = value.slice(0, from) + changed.join("\n") + value.slice(to);
  return { value: next, start: Math.max(from, start + firstShift), end: Math.max(from, end + total) };
}

/** Puts `text` in place of the selection, as typing it would. */
export function insertText(value: string, start: number, end: number, text: string): Edit {
  const cursor = start + text.length;
  return { value: value.slice(0, start) + text + value.slice(end), start: cursor, end: cursor };
}
