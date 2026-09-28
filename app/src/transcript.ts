// What the agent on a ticket is saying, as a chat.
//
// A run writes the model's stream-json to a file: an object a line, one per
// block — what it said, what it thought, every tool it called and everything
// those answered, and in between them several hundred lines nobody wants to
// read. The daemon hands that out a page at a time (`ustabasi.run`) without
// deciding what is worth showing, which is right: what a screen draws is the
// screen's end of the problem, not the file's.
//
// So this is that decision, and it is a function rather than a screen — a page
// of records in, a run of turns out — so it can be checked against a real
// recording without a phone (app/scripts/fixtures/run.log, the same one the
// daemon's own reading is checked against).
//
// The reading itself is the one a chat already uses: a sentence is a sentence,
// a tool call is its name and the one thing it was called on, what the tool
// answered is folded away behind it, and everything else is dropped.
import type { RunEvent } from './protocol';

/** A turn, in the shapes the chat screen already draws.
 *
 *  `say` is the agent talking and `thought` is it thinking, both plain text.
 *  `did` is a tool call with what it answered attached, which is one card with
 *  a disclosure on it — the call is a line, the answer is behind it. `ended` is
 *  the run's own last line. */
export type Turn =
  | { kind: 'say'; id: string; text: string; clipped?: boolean }
  | { kind: 'thought'; id: string; text: string; clipped?: boolean }
  | { kind: 'did'; id: string; tool: string; summary: string; input: Record<string, any>;
      output?: string; failed?: boolean; clipped?: boolean }
  | { kind: 'ended'; id: string; failed?: boolean; durationMs?: number | null;
      cost?: number | null; tokens?: number | null };

/** A home directory eats the half of a one-line summary that carried meaning,
 *  and the account name is nobody's business on a screen held up to a room. The
 *  daemon scrubs nothing — it is reading a file, not writing one — so the
 *  scrubbing is here, where the words are drawn. The chat screen does the same
 *  to a tool line (components/chat.tsx). */
const HOME = /\/Users\/[^/\s'"]+|\/home\/[^/\s'"]+|C:\\Users\\[^\\\s'"]+/gi;

function tilde(text: string): string {
  return text.replace(HOME, '~');
}

/** `~/…/webhooks/handler.ts`: a path is identified by its tail. */
function shortPath(p: string): string {
  const t = tilde(p);
  const parts = t.split('/');
  return parts.length > 3 ? `${parts[0]}/…/${parts.slice(-2).join('/')}` : t;
}

/** How long a tool line is allowed to be. It sits on one line beside the tool's
 *  name and is cut with an ellipsis rather than wrapped: a four-line `git log`
 *  invocation is four lines of a screen for no gain. */
const SUMMARY_CHARS = 120;

/** The one thing a call was made on, in a line.
 *
 *  Every tool names it differently and none of them names it the same as the
 *  next: a command, a path, a pattern, an address. The order here is the order
 *  they are worth reading in — a `Read` has a path and a line range, and the
 *  path is the answer to "what was that call". Unknown tools fall through to
 *  whichever of the usual names they happen to use, and a tool with none of
 *  them says nothing rather than printing its arguments as JSON. */
export function summarise(tool: string, input: Record<string, any> | null | undefined): string {
  const a: Record<string, any> = input || {};
  const pick = tool === 'Bash' || tool === 'Monitor'
    ? a.command
    : a.file_path ?? a.path ?? a.pattern ?? a.url ?? a.query ?? a.command ?? a.description ?? a.prompt;
  if (pick == null) return '';
  const text = String(pick);
  const short = /^(?:\/|~|[A-Za-z]:\\)/.test(text) ? shortPath(text) : tilde(text);
  const oneLine = short.split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
  return oneLine.length > SUMMARY_CHARS ? `${oneLine.slice(0, SUMMARY_CHARS).trimEnd()}…` : oneLine;
}

/** The records that are not for reading.
 *
 *  A hook firing, the token counter ticking, a rate-limit warning, a line the
 *  CLI wrote that was not JSON: every one of these is in the file and none of
 *  them is anything a person opened the ticket to see. They cross the wire
 *  because dropping them is this end's decision — which is this line. */
function noise(e: RunEvent): boolean {
  return e.k === 'system' || e.k === 'other';
}

/** A page of records, as turns to append.
 *
 *  `from` numbers the turns so that appending a page to the one before it gives
 *  every turn a key of its own — the records carry no id and two identical
 *  sentences an hour apart are two turns.
 *
 *  A tool's answer arrives as its own record, usually in the very next page, so
 *  a call with nothing attached is a call still running. `attach` joins the two
 *  up across that gap: the page carrying the answer hands it back rather than
 *  drawing it, and the screen puts it on the card that is already there. */
export function turns(events: RunEvent[], from = 0): { turns: Turn[]; answers: Record<string, { text: string; failed: boolean; clipped?: boolean }> } {
  const out: Turn[] = [];
  const answers: Record<string, { text: string; failed: boolean; clipped?: boolean }> = {};
  let n = from;

  for (const e of events) {
    if (noise(e)) continue;
    const id = `r${n++}`;
    if (e.k === 'text') {
      const text = (e.text || '').trim();
      if (!text) continue;
      out.push({ kind: 'say', id, text, ...(e.clipped ? { clipped: true } : {}) });
    } else if (e.k === 'thinking') {
      // Almost always empty: the block is a signature and nothing else. An
      // empty thought is not a thought, and drawn it is a blank line that
      // arrives every few seconds.
      const text = (e.text || '').trim();
      if (!text) continue;
      out.push({ kind: 'thought', id, text, ...(e.clipped ? { clipped: true } : {}) });
    } else if (e.k === 'tool') {
      out.push({ kind: 'did', id: e.id || id, tool: e.name || '', summary: summarise(e.name, e.input),
                 input: e.input || {}, ...(e.clipped ? { clipped: true } : {}) });
    } else if (e.k === 'result') {
      // The answer belongs to the call, wherever that is — on this page, on the
      // one before it, or on a page this reader never saw.
      const answer = { text: e.text || '', failed: !!e.error, ...(e.clipped ? { clipped: true } : {}) };
      const call = e.id ? out.find((t) => t.kind === 'did' && t.id === e.id) : undefined;
      if (call && call.kind === 'did') {
        call.output = answer.text;
        call.failed = answer.failed;
        if (answer.clipped) call.clipped = true;
      } else if (e.id) {
        answers[e.id] = answer;
      }
    } else if (e.k === 'done') {
      out.push({ kind: 'ended', id, failed: !!e.error, durationMs: e.duration_ms,
                 cost: e.cost, tokens: e.output_tokens });
    }
  }
  return { turns: out, answers };
}

/** Join a page's answers onto calls drawn from an earlier page. Returns the
 *  same array where nothing matched, so a screen can keep its state. */
export function attach(existing: Turn[], answers: Record<string, { text: string; failed: boolean; clipped?: boolean }>): Turn[] {
  const ids = Object.keys(answers);
  if (!ids.length) return existing;
  let touched = false;
  const out = existing.map((t) => {
    if (t.kind !== 'did') return t;
    const a = answers[t.id];
    if (!a || t.output != null) return t;
    touched = true;
    return { ...t, output: a.text, failed: a.failed, ...(a.clipped ? { clipped: true } : {}) };
  });
  return touched ? out : existing;
}

/** How much of the log a screen keeps. A run that goes on for three hours is
 *  tens of thousands of turns, and nobody scrolls to the top of one — what the
 *  page is for is the end. Dropping from the front keeps a long read cheap
 *  without ever interrupting the part being read.
 *
 *  Two hundred because the page these are drawn on is a scroll view rather than
 *  a windowed list: every turn on it is mounted. A first open is twenty or
 *  thirty of them, and it takes ten minutes of watching a worker to reach this. */
export const MAX_TURNS = 200;

export function trim(list: Turn[], max = MAX_TURNS): Turn[] {
  return list.length <= max ? list : list.slice(list.length - max);
}

/** Why there is nothing to show, in the words of the thing that is missing.
 *  Every one of these has been a spinner that never stopped somewhere. */
export type RunSilence = 'noQueue' | 'noTicket' | 'neverRun' | 'noLog' | 'oldHost' | 'offline' | null;

export function silence(reason: string | null | undefined): RunSilence {
  switch (reason) {
    case 'no_queue': return 'noQueue';
    case 'no_ticket': return 'noTicket';
    case 'never_run': return 'neverRun';
    case 'no_log': return 'noLog';
    default: return null;
  }
}
