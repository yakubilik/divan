/** One step of a run as a row: a few plain words, and the file or command it
 *  was about. And the files a run of steps changed, each with its line counts.
 *
 *  No React in here: what a row says is decided once, and tested without a
 *  browser (`scripts/test-step-face.mjs`).
 */
import { toolSummary } from './format';
import type { Step } from './steps';

/** A cheap line diff: trim the shared head and tail, call the rest changed.
 *  Enough to show what an Edit touched without pretending to be a diff engine. */
export function lineDiff(oldText: string, newText: string) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return {
    context: a.slice(0, head),
    removed: a.slice(head, a.length - tail),
    added: b.slice(head, b.length - tail),
    after: a.slice(a.length - tail),
  };
}

export interface Counts { add: number; del: number }

export interface StepFace {
  /** What the step was, in a word or a short phrase. */
  label: string;
  /** What it was about: a file, a command, a pattern. Empty when there is nothing to name. */
  chip: string;
  /** The chip in full, when the chip is a shortened path. */
  title?: string;
  /** The chip is something typed — a path, a command — and is set in mono. */
  mono: boolean;
  /** Lines an edit added and took away. */
  counts: Counts | null;
}

const lines = (text: string) => (text ? text.replace(/\n$/, '').split('\n').length : 0);

/** The lines one edit added and removed, or null when the step is not one that
 *  says (a Read, a command, an edit whose input was cut off). */
export function countsOf(tool: string, input: any): Counts | null {
  if (!input || typeof input !== 'object') return null;
  if (tool === 'Write') return typeof input.content === 'string' ? { add: lines(input.content), del: 0 } : null;
  if (tool === 'Edit') {
    if (typeof input.new_string !== 'string') return null;
    const d = lineDiff(String(input.old_string ?? ''), input.new_string);
    return { add: d.added.length, del: d.removed.length };
  }
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    let add = 0;
    let del = 0;
    for (const e of input.edits) {
      if (typeof e?.new_string !== 'string') continue;
      const d = lineDiff(String(e.old_string ?? ''), e.new_string);
      add += d.added.length;
      del += d.removed.length;
    }
    return { add, del };
  }
  return null;
}

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'NotebookRead']);

/** A path as its last two parts: the file, and the folder that tells two
 *  `index.ts` apart. The whole path stays behind it as the title. */
export function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length <= 2 ? path : parts.slice(-2).join('/');
}

/** `mcp__server__take_screenshot` is "take screenshot": the server is in the
 *  icon's kind already, and the underscores are nobody's words. */
function toolName(name: string): string {
  if (!name.startsWith('mcp__')) return name;
  const last = name.split('__').pop() || name;
  const words = last.replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

export function stepFace(step: Step): StepFace {
  if (step.kind === 'thinking') {
    const first = step.text.trim().split('\n')[0] ?? '';
    return { label: 'Thinking', chip: first, mono: false, counts: null };
  }
  const input = step.input && typeof step.input === 'object' ? step.input : {};
  const summary = toolSummary(step.tool, input);
  if (FILE_TOOLS.has(step.tool) && typeof input.file_path === 'string') {
    return {
      label: step.tool, chip: shortPath(summary), title: summary, mono: true,
      counts: step.isError ? null : countsOf(step.tool, input),
    };
  }
  // A command the agent described is read by its description; the command is the chip.
  const said = typeof input.description === 'string' ? input.description.trim() : '';
  const typed = typeof input.command === 'string';
  if (typed && said) return { label: said, chip: summary, mono: true, counts: null };
  return { label: toolName(step.tool), chip: summary, mono: typed || /^(Grep|Glob)$/.test(step.tool), counts: null };
}

export interface ChangedFile {
  /** The whole path, as the tool was given it. */
  path: string;
  /** The file's own name. */
  name: string;
  add: number;
  del: number;
  /** The steps that changed it, in order. */
  ids: string[];
}

/** The files a run of steps changed, in the order each was first touched, with
 *  every edit to the same file added up. An edit that failed changed nothing. */
export function changedFiles(steps: Step[]): ChangedFile[] {
  const out = new Map<string, ChangedFile>();
  for (const s of steps) {
    if (s.kind !== 'tool' || s.isError || s.running) continue;
    const path = typeof s.input?.file_path === 'string' ? s.input.file_path : null;
    const counts = path ? countsOf(s.tool, s.input) : null;
    if (!path || !counts) continue;
    const seen = out.get(path);
    if (seen) {
      seen.add += counts.add;
      seen.del += counts.del;
      seen.ids.push(s.id);
    } else {
      out.set(path, { path, name: path.split('/').pop() || path, ...counts, ids: [s.id] });
    }
  }
  return [...out.values()];
}
