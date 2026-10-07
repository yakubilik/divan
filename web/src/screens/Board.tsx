/** One product's board (HANDOVER §4.3): four columns — Ice Box, Queued, In
 *  Progress, Done — each a `dv-sec` head and its cards, scrolled sideways on a
 *  narrow window.
 *
 *  Three things are true of it:
 *
 *  **The column is the intent and the status is what is true.** A card carries
 *  its title, the one sentence an agent asked or stopped on, the `dv-status`
 *  word and the machine with how long. A card that is asking has an amber edge
 *  as well as the word. Pressing it raises that conversation beside the board
 *  (`useDock`); any other card opens its own page.
 *
 *  **Moving a card is the person's.** Dropping one into In Progress starts the
 *  work and asks nothing first; the only thing that keeps a card out is the
 *  threshold set on Machine › Quota thresholds, which says so under the
 *  columns. Inside Queued the order is the priority, and a card dropped on
 *  another card takes its place. A card that was dropped stays where it was
 *  dropped until the machine has answered.
 *
 *  **The judgements are not in here.** What a column holds and what a card says
 *  are `lib/board.ts`, held without a browser by `scripts/test-board.mjs`; the
 *  pressing and the dragging are driven by `scripts/test-drive.mjs`.
 */
import { useEffect, useState } from 'react';
import { moveCard } from '../lib/actions';
import { DONE_SHOWN, columns, settled, shown, takes, type Moves, type Ticket } from '../lib/board';
import { useDivanStore, type DivanView, type MergedProject } from '../lib/divan';
import { hasCardDrag, setCardDrag } from '../lib/dnd';
import { uptime } from '../lib/format';
import { refusedWords, startsWork, useThresholds } from '../lib/machine';
import { useDock } from '../lib/sessions';
import type { DivanColumn } from '../lib/protocol';
import { EmptyState } from '../ui/divan';

/** The card in the air: which column it came out of, so that the one it is
 *  already in does not offer to take it. */
interface Lift { id: string; host: string; from: DivanColumn }

export function Board({ view, project, onCard, onNew }: {
  view: DivanView;
  project: MergedProject;
  /** A card that is not being answered opens its own page. */
  onCard?: (ticket: Ticket) => void;
  /** `+ New ticket`, and the N key on the board. */
  onNew?: () => void;
}) {
  const raise = useDock((s) => s.raise);
  const { thresholds } = useThresholds();
  const [lift, setLift] = useState<Lift | null>(null);
  const [over, setOver] = useState<DivanColumn | null>(null);
  const [overCard, setOverCard] = useState<string | null>(null);
  const [moved, setMoved] = useState<Moves>({});
  const [refused, setRefused] = useState<string | null>(null);
  const [allDone, setAllDone] = useState(false);

  const pending = settled(moved, project.cards);
  const cols = columns(project, view.now, uptime, pending);
  const empty = cols.every((c) => !c.count);

  // N anywhere on the board writes a new card; not while something is being
  // typed into, where N is a letter.
  useEffect(() => {
    if (!onNew) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const into = (e.target as HTMLElement | null)?.tagName;
      if (into === 'INPUT' || into === 'TEXTAREA') return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); onNew(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNew]);

  const clear = () => { setLift(null); setOver(null); setOverCard(null); };

  /** Put the card in the air down in `column`, at `position` where a card was
   *  aimed at, otherwise at the bottom. */
  const drop = async (column: DivanColumn, position?: number) => {
    const carried = lift;
    clear();
    if (!carried) return;
    if (position == null && !takes(column, carried.from)) return;
    setRefused(null);
    // Dropping into In Progress is what starts a worker, so it is where the
    // threshold on Machine › Quota thresholds is kept (`lib/machine.ts`).
    const on = view.hosts.find((h) => h.key === carried.host) ?? null;
    if (column === 'in_progress' && carried.from !== 'in_progress' && on && !startsWork(on, thresholds)) {
      setRefused(refusedWords(on, thresholds));
      return;
    }
    if (column !== carried.from) setMoved((was) => ({ ...was, [carried.id]: column }));
    try {
      const answer = await moveCard(carried.host, carried.id, column, position);
      // The move happened whatever this says: what can still fail is the queue
      // being asked to pick the card up.
      if (answer?.error) setRefused(answer.error);
      void useDivanStore.getState().load(carried.host);
    } catch (e: any) {
      setMoved((was) => { const next = { ...was }; delete next[carried.id]; return next; });
      setRefused(e?.message ?? 'That did not reach the computer');
    }
  };

  if (empty) {
    return (
      <EmptyState
        title="Nothing on this board yet"
        body="A card is a line you wrote down or a brief an agent can pick up. Write one here, or
              tell Divan about it in the chat — either way it lands in the Ice Box, which starts
              nothing."
        actions={onNew
          ? <button type="button" className="dv-btn dv-btn--primary dv-hit" onClick={onNew}>New ticket</button>
          : undefined}
        foot={project.machines.join(' · ') || 'no machine'}
      />
    );
  }

  return (
    <div className="dv-board">
      <div className="dv-board-cols">
        {cols.map((col) => {
          const offered = takes(col.key, lift ? shown(lift.from) : null);
          const done = col.key === 'done';
          const list = done && !allDone ? col.tickets.slice(0, DONE_SHOWN) : col.tickets;
          const rest = col.tickets.length - list.length;
          // Cards in Queued, without the one in the air: where a drop on one of
          // them lands, counted the way the machine counts it.
          const order = col.tickets.map((t) => t.card.id).filter((id) => id !== lift?.id);
          return (
            <section
              key={col.key} className="dv-col" aria-label={col.label} data-column={col.key}
              data-takes={offered ? 'true' : undefined}
              data-dropping={over === col.key ? 'true' : undefined}
              onDragOver={(e) => {
                if (!hasCardDrag(e.dataTransfer) || !offered) return;
                // Without this the browser refuses the drop.
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setOver(col.key);
              }}
              onDragLeave={() => setOver((c) => (c === col.key ? null : c))}
              onDrop={(e) => { e.preventDefault(); void drop(col.key); }}
            >
              <div className="dv-sec" style={{ margin: 0, padding: '0 4px' }}>
                <h3>{col.label}</h3>
                <span className="dv-meta" style={{ marginLeft: 0 }}>{col.count}</span>
                <span className="dv-meta">{col.sub}</span>
              </div>
              {list.map((t) => (
                <TicketCard
                  key={t.card.id} ticket={t} carried={lift?.id === t.card.id}
                  aimed={overCard === t.card.id}
                  onLift={(e) => {
                    setCardDrag(e.dataTransfer, { hostKey: t.card.host, cardId: t.card.id });
                    setLift({ id: t.card.id, host: t.card.host, from: t.card.column });
                  }}
                  onEnd={clear}
                  // The order of Queued is the priority: a card dropped on one
                  // there takes its place.
                  aim={col.key === 'queued' && !!lift && lift.id !== t.card.id ? {
                    over: (e) => {
                      if (!hasCardDrag(e.dataTransfer)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = 'move';
                      setOver(null);
                      setOverCard(t.card.id);
                    },
                    drop: (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void drop('queued', Math.max(0, order.indexOf(t.card.id)));
                    },
                  } : undefined}
                  onPress={t.waiting ? () => raise(t.session) : onCard && (() => onCard(t))}
                />
              ))}
              {!!col.more && <p className="dv-meta" style={{ margin: '0 4px' }}>{col.more}</p>}
              {done && rest > 0 && (
                <button type="button" className="dv-btn dv-btn--ghost dv-hit" style={{ alignSelf: 'flex-start' }}
                  onClick={() => setAllDone(true)}>{`Show ${rest} more`}</button>
              )}
            </section>
          );
        })}
      </div>
      {!!refused && <p className="dv-meta" role="status" style={{ margin: '12px 4px 0', color: 'var(--red)' }}>{refused}</p>}
    </div>
  );
}

/** One card: the title (the press), one sentence where there is one, the
 *  status word and the mono corner. */
function TicketCard({ ticket: t, carried, aimed, onLift, onEnd, aim, onPress }: {
  ticket: Ticket;
  carried: boolean;
  aimed: boolean;
  onLift: (e: React.DragEvent) => void;
  onEnd: () => void;
  aim?: { over: (e: React.DragEvent) => void; drop: (e: React.DragEvent) => void };
  onPress?: () => void;
}) {
  const st = t.status;
  return (
    <article
      className="dv-glass dv-card" draggable data-card={t.card.id}
      data-status={st?.kind} data-lifted={carried ? 'true' : undefined}
      data-aimed={aimed ? 'true' : undefined}
      onDragStart={onLift} onDragEnd={onEnd}
      onDragOver={aim?.over} onDrop={aim?.drop}
    >
      <button type="button" className="dv-card-title dv-hit" onClick={onPress}
        title={t.waiting ? `Answer ${t.who} on ${t.card.title}` : `Open ${t.card.title}`}>
        {t.card.title}
      </button>
      {!!t.line && <p className="dv-card-line">{t.line}</p>}
      {(!!st || !!t.meta) && (
        <div className="dv-card-foot">
          {!!st && <span className={`dv-status dv-status--${st.kind}`}><i />{st.word}</span>}
          {!!t.meta && <span className="dv-meta">{t.meta}</span>}
        </div>
      )}
    </article>
  );
}
