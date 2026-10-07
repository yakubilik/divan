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

/** Where a filed ticket opens on the phone: its card where a board has one,
 *  and the bare ticket where none does. */
export function ticketRoute(cards: { id: string; host: string; ustabasi_id: number | null }[], id: number): string {
  const card = cards.find((c) => c.ustabasi_id === id);
  return card ? `/card/${card.id}?host=${card.host}&from=chat` : `/ticket/${id}?from=chat`;
}

/** The product a chat is filed under, by the name the board gives it. */
export function filedUnder(projects: { name: string; ids: Record<string, string> }[],
                           host: string | null | undefined, projectId: string | null | undefined): string | null {
  if (!host || !projectId) return null;
  return projects.find((p) => p.ids[host] === projectId)?.name ?? null;
}
