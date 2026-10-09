/** A ticket's end, as the queue tells the chat that filed it.
 *
 *  The daemon sends it into that chat as an ordinary `message.user`, so the
 *  agent there wakes up and tells the person; the stored text is the only
 *  marker. The format and the rules for reading it are docs/ticket-notices.md,
 *  and this is the web's reader (`web/src/lib/notice.ts`) on the phone, line
 *  for line: `scripts/test-notice.cjs` holds the two to the same answers on the
 *  web's own fixtures.
 *
 *  A message is a notice only when the head and the agent-instruction paragraph
 *  are both there and name the same ticket. The stored text is never changed —
 *  this only decides how it is drawn. */

export type NoticeState = 'done' | 'blocked' | 'failed';

export interface TicketNotice {
  ticket: number;
  state: NoticeState;
  title: string;
  /** What the person is told: the result, the question or the error. */
  report: string;
  /** The queue's own status lines under the report: merge, branch, build. */
  facts: string[];
  /** Words the person added to the same message; drawn as theirs. */
  after: string;
}

const STATES: Record<string, NoticeState> = {
  'is done': 'done', 'is asking something': 'blocked', failed: 'failed',
};

const HEAD = /^🔔 ustabasi #(\d+) (is done|is asking something|failed): ([^\n]+)(?:\n\n|$)/;
/** The agent's instruction. Older notices said "Yakup is waiting … Tell him";
 *  the sentence it opens and closes with has not changed. */
const TAIL = /(?:^|\n\n)You filed this ticket from this chat and [^\n]*?`ustabasi show (\d+)` has the details\.[ \t]*(?:\n|$)/;
/** A status line the queue appends to a report: merge, wait, conflict, branch. */
const FACT = /^(?:🔀 |⏳ |🤝 |branch \S+ · )/u;

/** The notice a message is, or null for anything a person wrote. */
export function ticketNotice(text: string | null | undefined): TicketNotice | null {
  const s = String(text ?? '');
  const head = HEAD.exec(s);
  if (!head) return null;
  const rest = s.slice(head[0].length);
  const tail = TAIL.exec(rest);
  if (!tail || tail[1] !== head[1]) return null;
  const said = rest.slice(0, tail.index).trim();
  const lines = said.split('\n');
  const facts: string[] = [];
  while (lines.length && FACT.test(lines[lines.length - 1].trim())) facts.unshift(lines.pop()!.trim());
  return {
    ticket: Number(head[1]),
    state: STATES[head[2]],
    title: head[3].trim(),
    report: lines.join('\n').trim(),
    facts,
    after: rest.slice(tail.index + tail[0].length).trim(),
  };
}
