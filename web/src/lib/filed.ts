/** What a conversation filed, read off what its agent ran (HANDOVER §4.8).
 *
 *  Hermes files work by running the queue's own command, and the command
 *  answers in one fixed line — `#127 queued: Refund policy page  (worker …)`.
 *  That line is the record that a card came out of this conversation, so it is
 *  read from the tool's own output and nowhere else: no number is guessed and
 *  nothing is filed by the panel. */

/** One ticket a tool call filed: its number and the title it was given. */
export interface Filed { id: number; title: string }

const QUEUED = /^#(\d+) queued: (.+?)(?:\s{2,}\(.*)?$/m;

/** The ticket a tool's output says it filed, or null. */
export function filedBy(output: string | null | undefined): Filed | null {
  const m = QUEUED.exec(String(output ?? ''));
  if (!m) return null;
  const title = m[2].trim();
  return title ? { id: Number(m[1]), title } : null;
}
