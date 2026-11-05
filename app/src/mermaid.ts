/** A ```mermaid block in an answer is drawn as a diagram (flowchart, sequence,
 *  pie, xychart-beta, gantt…) instead of shown as code. This file is the part
 *  of that which needs no phone: which fences are drawn, what the page may
 *  load, and what it says back. The page itself is `mermaid-page.ts`, the view
 *  `components/diagram.tsx`.
 *
 *  A fence is only drawn once it is closed. While an answer streams, the last
 *  fence in it runs to the end of the text, and drawing that would throw a
 *  half-written diagram at mermaid on every token; it stays code until its
 *  closing ``` arrives, and then it is drawn once. */

/** How long a page may take to say it drew (or could not) before the block
 *  gives up on it and shows the code instead. */
export const DIAGRAM_TIMEOUT_MS = 5000;

/** The first word of a fence's info string: ```mermaid title → `mermaid`. */
export function fenceLang(info: unknown): string {
  return String(info ?? '').trim().split(/\s/)[0];
}

/** markdown-it's fence token, as much of it as this reads. */
type FenceToken = { type: string; info?: string; content?: string; map?: [number, number] | null; meta?: any; children?: FenceToken[] | null };

/** Whether markdown-it found the closing marker of a fence. It does not say
 *  so itself; a fence it had to run to the end of the text spans its opening
 *  line and its content, a closed one a line more. */
export function fenceClosed(t: FenceToken): boolean {
  if (t.type !== 'fence' || !t.map) return false;
  // A line is a line whether or not the text ends after it: a fence run to
  // the end has no newline after its last line.
  const content = t.content ?? '';
  const lines = content === '' ? 0 : content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
  return t.map[1] - t.map[0] === lines + 2;
}

/** Stamps every closed fence's `meta` with `{ closed: true }`, which the
 *  Markdown library carries onto its AST node as `sourceMeta`; the fence rule
 *  reads it there. Run on the tokens before they become the AST. */
export function markClosedFences<T extends FenceToken>(tokens: T[]): T[] {
  for (const t of tokens) {
    if (t.type === 'fence' && fenceClosed(t)) t.meta = { ...(t.meta ?? {}), closed: true };
    if (t.children?.length) markClosedFences(t.children);
  }
  return tokens;
}

/** What a fence node is drawn as: a diagram only when it is a closed
 *  ```mermaid fence with something in it; everything else is code. */
export function fenceView(node: { sourceInfo?: unknown; sourceMeta?: any; content?: unknown }): 'diagram' | 'code' {
  const code = String(node.content ?? '');
  if (fenceLang(node.sourceInfo).toLowerCase() !== 'mermaid') return 'code';
  if (!node.sourceMeta?.closed) return 'code';
  return code.trim() ? 'diagram' : 'code';
}

/** The WebView's whitelist: the page is a string, loaded as about:blank. */
export const DIAGRAM_ORIGINS = ['about:blank', 'data:*'];

/** The WebView's `onShouldStartLoadWithRequest`: the page's own first load and
 *  nothing after it. A diagram has no business going anywhere — not a link in
 *  it, not a script it was talked into adding. One per WebView. */
export function diagramNavGuard(): (req: { url?: string }) => boolean {
  let loaded = false;
  return (req) => {
    if (loaded) return false;
    const url = String(req?.url ?? '');
    if (url !== 'about:blank' && !url.startsWith('data:')) return false;
    loaded = true;
    return true;
  };
}

/** What the page says: its drawing's size, or that it could not draw. */
export type FromDiagram = { t: 'size'; w: number; h: number } | { t: 'error'; message: string };

export function readDiagramMessage(raw: string): FromDiagram | null {
  try {
    const m = JSON.parse(raw);
    if (m?.t === 'size' && Number.isFinite(m.w) && Number.isFinite(m.h) && m.w > 0 && m.h > 0) {
      return { t: 'size', w: Math.ceil(m.w), h: Math.ceil(m.h) };
    }
    if (m?.t === 'error') return { t: 'error', message: String(m.message ?? '') };
  } catch {}
  return null;
}
