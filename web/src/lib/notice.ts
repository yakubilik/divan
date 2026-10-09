/** A ticket's end, as the queue tells the chat that filed it.
 *
 *  The daemon (`daemon/remote_ai_chat/ustabasi.py` `follow_message`) sends it
 *  into that chat as an ordinary `message.user`, so the agent there wakes up
 *  and tells the person. There is no other marker on the event: the text is
 *  the record, and it has one fixed shape —
 *
 *      🔔 ustabasi #157 is done: Match mobile chat grouping to the web
 *
 *      <the report: what the verifier said, the question, or the error;
 *       then lines like "🔀 merged into main (1664073)" and "branch … · 1 commit">
 *
 *      You filed this ticket from this chat and … `ustabasi show 157` has the details.
 *
 *  The last paragraph is an instruction to the agent, not news for the person.
 *  A message is read as a notice only when the head and that paragraph are
 *  both there and name the same ticket; anything else stays a plain message.
 *  The stored text is never changed — this only decides how it is drawn.
 *
 *  The native client reads the same contract (see docs/ticket-notices.md). */

export type NoticeState = 'done' | 'blocked' | 'failed';

export interface TicketNotice {
  ticket: number;
  state: NoticeState;
  title: string;
  /** What the person is told: the result, the question or the error. */
  report: string;
  /** The queue's own status lines under the report: merge, branch, build. */
  facts: string[];
  /** Words the person added to the same message (a note steered into the
   *  turn lands after the notice); drawn as theirs, never hidden. */
  after: string;
}

const STATES: Record<string, NoticeState> = {
  'is done': 'done', 'is asking something': 'blocked', failed: 'failed',
};

const HEAD = /^🔔 ustabasi #(\d+) (is done|is asking something|failed): ([^\n]+)(?:\n\n|$)/;
/** The agent's instruction. Older notices said "Yakup is waiting … Tell him";
 *  the sentence it opens and closes with has not changed. */
const TAIL = /(?:^|\n\n)You filed this ticket from this chat and [^\n]*?`ustabasi show (\d+)` has the details\.[ \t]*(?:\n|$)/;
/** A status line the queue appends to a report (ustabasi `supervisor.py`):
 *  the merge, a wait or a conflict it settled, and the branch. */
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

/** The word a notice's row says it is. */
export const NOTICE_WORD: Record<NoticeState, string> = {
  done: 'Done', blocked: 'Needs an answer', failed: 'Failed',
};
