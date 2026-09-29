/** One product's board, and the question one of its workers stopped to ask open
 *  beside it.
 *
 *  Web12 W2 and Web13 W4 are this page in the two themes, and the theme is the
 *  whole of what differs between them: four columns abreast under the product's
 *  head, a ticket in each carrying the square of whoever is on it, what the
 *  mirror last wrote about it and the line the card was written as — and, over
 *  the bottom right corner, the chat of the agent that is asking.
 *
 *  Three things are true of it:
 *
 *  **The mark on a card and the window beside it are one thing seen twice.**
 *  Pressing a card that needs a person raises that conversation (`useDock`),
 *  answering it there sends a note to the queue the card is a ticket in, and
 *  the mark clears when the board says it has. Nothing navigates: the board is
 *  still under the window, which is the point of a desktop.
 *
 *  **A card that was dragged stays where it was dropped.** The move is the
 *  machine's to make and the board is re-read on a slow timer; in between, the
 *  card is where the cursor put it. A queue that refuses to pick the card up
 *  leaves a line under the columns and the card where it is, because a card
 *  that springs back under a cursor is worse than one saying why nothing
 *  started.
 *
 *  **The judgements are not in here.** What a column holds, what a ticket says
 *  about itself and which columns would take the card in the air are
 *  `lib/board.ts`, held without a browser by `scripts/test-board.mjs`; the
 *  pressing and the dragging are driven in one by `scripts/test-drive.mjs`.
 *  What is left here is the arrangement.
 */
import { useState } from 'react';
import { moveCard } from '../lib/actions';
import { columns, settled, takes, type Moves, type Ticket } from '../lib/board';
import { useDivanStore, type DivanView, type MergedProject } from '../lib/divan';
import { hasCardDrag, setCardDrag } from '../lib/dnd';
import { uptime } from '../lib/format';
import { useDock } from '../lib/sessions';
import { STATE_MARK, T } from '../lib/theme';
import type { DivanColumn } from '../lib/protocol';
import { Card, ColumnTab, EmptyState, ExecutorBadge, Tag } from '../ui/divan';
import { mono } from '../ui/kit';

/** The card in the air, as the columns need to know it: which one it came out
 *  of, so that the one it is already in does not offer to take it. */
interface Lift { id: string; host: string; from: DivanColumn }

export function Board({ view, project }: { view: DivanView; project: MergedProject }) {
  const raise = useDock((s) => s.raise);
  const [lift, setLift] = useState<Lift | null>(null);
  const [over, setOver] = useState<DivanColumn | null>(null);
  const [moved, setMoved] = useState<Moves>({});
  const [refused, setRefused] = useState<string | null>(null);

  // The overlay is dropped the moment the machine agrees, and it is worked out
  // from the board rather than remembered: nothing has to be told that a poll
  // came back.
  const pending = settled(moved, project.cards);
  const cols = columns(project, view.now, uptime, pending);
  const empty = cols.every((c) => !c.count);

  const pick = (t: Ticket, from: DivanColumn) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setCardDrag(e.dataTransfer, { hostKey: t.card.host, cardId: t.card.id });
      setLift({ id: t.card.id, host: t.card.host, from });
    },
    onDragEnd: () => { setLift(null); setOver(null); },
  });

  const drop = async (column: DivanColumn) => {
    const carried = lift;
    setLift(null);
    setOver(null);
    if (!carried || !takes(column, carried.from)) return;
    setRefused(null);
    setMoved((was) => ({ ...was, [carried.id]: column }));
    try {
      const answer = await moveCard(carried.host, carried.id, column);
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
        body="A card is a line you wrote down or a brief an agent can pick up. Tell Divan
              about one in the chat and it appears in the Ice Box, which starts nothing."
        foot={project.machines.join(' · ') || 'no machine'}
      />
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        flex: 1, minHeight: 0, display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12,
      }}>
        {cols.map((col) => (
          <ColumnTab
            key={col.key} label={col.label} count={col.count} sub={col.sub || null}
            live={col.live}
            dragging={takes(col.key, lift?.from ?? null)}
            dropping={over === col.key}
            drag={{
              onDragOver: (e) => {
                if (!hasCardDrag(e.dataTransfer) || !takes(col.key, lift?.from ?? null)) return;
                // Without this the browser refuses the drop, and a column that
                // lit up and then would not take the card is worse than one
                // that never offered.
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setOver(col.key);
              },
              onDragLeave: () => setOver((c) => (c === col.key ? null : c)),
              onDrop: (e) => { e.preventDefault(); void drop(col.key); },
            }}
          >
            <div style={{
              flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex',
              flexDirection: 'column', gap: 10,
            }}>
              {col.tickets.map((t) => (
                <TicketCard
                  key={t.card.id} ticket={t} carried={lift?.id === t.card.id}
                  drag={pick(t, col.key)}
                  onAsk={t.waiting ? () => raise(t.session) : undefined}
                />
              ))}
              {!!col.more && (
                <div style={{ ...mono, fontSize: 12, color: T.ink3, padding: '4px 4px 0' }}>
                  {col.more}
                </div>
              )}
            </div>
          </ColumnTab>
        ))}
      </div>
      {!!refused && (
        <div style={{ ...mono, flex: 'none', fontSize: 11, color: T.red, padding: '0 4px' }}>
          {refused}
        </div>
      )}
    </div>
  );
}

/** One ticket (Web12 W2): the square of whoever is on it over what that kind of
 *  worker does, the mark the mirror last wrote in the corner, the card's own
 *  line, and the two sentences it was written as. */
function TicketCard({ ticket: t, carried, drag, onAsk }: {
  ticket: Ticket;
  carried: boolean;
  drag: React.ComponentProps<typeof Card>['drag'];
  onAsk?: () => void;
}) {
  const desc = t.card.summary.trim();
  return (
    <Card
      tight hollow={t.hollow} lifted={carried} drag={drag} onClick={onAsk}
      title={onAsk ? `Answer ${t.who} on ${t.card.title}` : undefined}
      style={{ flex: 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minHeight: 28 }}>
        <ExecutorBadge executor={t.face} />
        <div style={{ minWidth: 0, lineHeight: 1.2 }}>
          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{t.who}</div>
          <div style={{ ...mono, fontSize: 10.5, color: T.ink3, whiteSpace: 'nowrap' }}>{t.kind}</div>
        </div>
        {!!t.mark && (
          <Tag label={t.mark.label} mark={STATE_MARK[t.mark.state]} tone={t.mark.tone}
            style={{ marginLeft: 'auto' }} />
        )}
      </div>
      <div style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.3, letterSpacing: '-.005em' }}>
        {t.card.title}
      </div>
      {!!desc && (
        <div style={{
          fontSize: 13.5, lineHeight: 1.45, color: T.ink2, display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', maxHeight: 39,
        }}>{desc}</div>
      )}
    </Card>
  );
}
