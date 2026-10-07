/** Waiting on you (HANDOVER §4.6), decided away from the page that draws it.
 *
 *  Three groups, oldest first in each: **An agent is asking** — a coding agent
 *  standing still until it is answered, and one that stopped and needs a
 *  sentence to go on; **A decision** — any other agent asking which way to go;
 *  **On your plate** — the cards whose executor is you, and the things a product
 *  is still waiting on that nobody else has been named for (`Still open`).
 *
 *  The cards are `sessions()`'s set — the daemon's own `waiting()` rule — so
 *  this page, the Dashboard's Needs you and the windows in the corner count the
 *  same things. The title says the counts in words: `2 answers, 1 task.`
 */
import type { DivanView, MergedProject } from './divan';
import type { DivanOpenItem } from './protocol';
import { sessions, type Session } from './sessions';

/** One thing on your plate: a card that is yours, or a Still open item. */
export type Plate =
  | { kind: 'card'; id: string; session: Session; age: number | null }
  | { kind: 'open'; id: string; project: MergedProject; item: DivanOpenItem; age: number | null };

export interface Waiting {
  asking: Session[];
  decision: Session[];
  plate: Plate[];
}

/** Whose a Still open item is. Done is nobody's; one with a person named on it
 *  is that person's, and on this page only when that person is you; one with
 *  nobody named is yours unless it is waiting on somebody. */
export function mine(item: DivanOpenItem): boolean {
  if (item.state === 'done') return false;
  const owner = (item.owner || '').trim();
  if (owner) return /^(yakup|you|me)$/i.test(owner);
  return item.state !== 'waiting';
}

/** Oldest first; a thing nothing stamped goes last, because not knowing when
 *  is not the same as just now. */
const oldest = (a: { age: number | null }, b: { age: number | null }) => (b.age ?? -1) - (a.age ?? -1);

export function waitingOn(view: DivanView): Waiting {
  const all = sessions(view);
  const asking = all.filter((s) => s.kind === 'question' || s.kind === 'stuck').sort(oldest);
  const decision = all.filter((s) => s.kind === 'decision').sort(oldest);
  const plate: Plate[] = [
    ...all.filter((s) => s.kind === 'yours')
      .map((s) => ({ kind: 'card' as const, id: s.id, session: s, age: s.age })),
    ...view.projects.flatMap((p) => (p.open ?? []).filter(mine).map((item) => ({
      kind: 'open' as const, id: `${p.key}:${item.id}`, project: p, item,
      age: item.created_at ? Math.max(0, view.now - item.created_at) : null,
    }))),
  ].sort(oldest);
  return { asking, decision, plate };
}

/** `2 answers, 1 task.` — or the one sentence the page is when nothing waits. */
export function headline(w: Waiting): string {
  const answers = w.asking.length + w.decision.length;
  const tasks = w.plate.length;
  if (!answers && !tasks) return 'Nothing is waiting on you.';
  const parts = [
    answers ? `${answers} ${answers === 1 ? 'answer' : 'answers'}` : '',
    tasks ? `${tasks} ${tasks === 1 ? 'task' : 'tasks'}` : '',
  ].filter(Boolean);
  return `${parts.join(', ')}.`;
}
