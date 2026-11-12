/** The words of an answer cut into the pieces the panel draws differently:
 *  fenced code (a closed ```mermaid fence among them, drawn as a diagram), a
 *  Markdown pipe table, and everything else as written.
 *
 *  The phone draws these with a full Markdown renderer
 *  (`app/src/components/chat.tsx`); the panel draws only these two and leaves
 *  headings and lists as text, which reads well enough in a wide column. A
 *  table left as text does not: a row of pipes is unreadable, which is why an
 *  answer that sent one looked broken here and right on the phone.
 *
 *  A fence counts as closed only once its closing ``` has arrived. While an
 *  answer streams the last fence runs to the end of the text, and a diagram
 *  is drawn once, from the finished source, not on every token. */

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'code'; lang: string; code: string; closed: boolean }
  | { kind: 'table'; head: string[]; align: Align[]; rows: string[][] };

export type Align = 'left' | 'center' | 'right' | null;

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;

/** The cells of one table row: outer pipes dropped, `\|` kept as a pipe, and a
 *  pipe inside `inline code` not a cell edge. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '`') code = !code;
    if (ch === '|' && !code) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** `|---|:--:|--:|`, the line under a table's head; null when it is not one. */
export function delimiterRow(line: string): Align[] | null {
  if (!line.includes('-') || !/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) return null;
  const cells = splitRow(line);
  if (!cells.every((c) => /^:?-+:?$/.test(c))) return null;
  return cells.map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
}

const isRow = (line: string) => line.includes('|') && line.trim() !== '';

export function blocks(text: string): Block[] {
  const lines = text.split('\n');
  const out: Block[] = [];
  let buf: string[] = [];
  // A text block keeps its own blank lines but not the ones at its edges: the
  // code block or table beside it brings its own margin.
  const flush = () => {
    const t = buf.join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '');
    if (t.trim()) out.push({ kind: 'text', text: t });
    buf = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const open = line.match(FENCE);
    if (open) {
      const marker = open[1];
      const lang = open[2] ?? '';
      const closeRe = marker[0] === '`' ? /^`{3,}$/ : /^~{3,}$/;
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      for (; j < lines.length; j++) {
        const t = lines[j].trim();
        if (closeRe.test(t) && t.length >= marker.length) { closed = true; break; }
        body.push(lines[j]);
      }
      flush();
      out.push({ kind: 'code', lang, code: body.join('\n'), closed });
      i = closed ? j + 1 : j;
      continue;
    }
    // A table: a row, then the delimiter row with as many cells, then rows
    // until a line that is not one.
    if (isRow(line) && i + 1 < lines.length) {
      const align = delimiterRow(lines[i + 1]);
      const head = splitRow(line);
      if (align && align.length === head.length) {
        const rows: string[][] = [];
        let j = i + 2;
        for (; j < lines.length && isRow(lines[j]) && !FENCE.test(lines[j]); j++) {
          const cells = splitRow(lines[j]);
          // Short rows are padded, long ones cut: the head says how wide it is.
          rows.push(head.map((_, k) => cells[k] ?? ''));
        }
        flush();
        out.push({ kind: 'table', head, align, rows });
        i = j;
        continue;
      }
    }
    buf.push(line);
    i++;
  }
  flush();
  return out;
}

/** Whether a code block is drawn as a diagram rather than shown as code. */
export const isDiagram = (b: Block): boolean => (
  b.kind === 'code' && b.closed && b.lang.toLowerCase() === 'mermaid' && b.code.trim() !== ''
);
