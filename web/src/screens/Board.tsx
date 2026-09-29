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
import { useEffect, useState } from 'react';
import { createCard, moveCard } from '../lib/actions';
import { columns, settled, takes, type Moves, type Ticket } from '../lib/board';
import { useDivanStore, type DivanView, type MergedProject } from '../lib/divan';
import { hasCardDrag, setCardDrag } from '../lib/dnd';
import { uptime } from '../lib/format';
import { useDock } from '../lib/sessions';
import { SUMMARY_MAX } from '../lib/ticket';
import { RADIUS, STATE_MARK, T } from '../lib/theme';
import type { DivanColumn } from '../lib/protocol';
import { Button, Card, ColumnTab, EmptyState, ExecutorBadge, Tag, Write } from '../ui/divan';
import { mono } from '../ui/kit';

/** The card in the air, as the columns need to know it: which one it came out
 *  of, so that the one it is already in does not offer to take it. */
interface Lift { id: string; host: string; from: DivanColumn }

export function Board({ view, project, drafting, onDraft, onCard }: {
  view: DivanView;
  project: MergedProject;
  /** A new ticket is being written at the top of Ice Box. Held above this screen
   *  because the button that opens one is in the page head, and because leaving
   *  the board must not leave a half-written card behind it. */
  drafting?: boolean;
  onDraft?: (open: boolean) => void;
  /** A card that is not being answered opens its own page (Web14 W8). */
  onCard?: (ticket: Ticket) => void;
}) {
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

  // `press N anywhere on the board`, which is the frame's own hint, and Escape
  // to put the card down again. Not while something is being typed into: N is a
  // letter first.
  useEffect(() => {
    if (!onDraft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const into = (e.target as HTMLElement | null)?.tagName;
      if (into === 'INPUT' || into === 'TEXTAREA') return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); onDraft(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDraft]);

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

  if (empty && !drafting) {
    return (
      <EmptyState
        title="Nothing on this board yet"
        body="A card is a line you wrote down or a brief an agent can pick up. Write one here, or
              tell Divan about it in the chat — either way it lands in the Ice Box, which starts
              nothing."
        actions={onDraft ? <Button label="New ticket" onClick={() => onDraft(true)} /> : undefined}
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
              {/* Web14 W9: a new ticket is written in place, as the first card of
                  Ice Box. No modal and no page of its own — the board stays
                  under it, which is the whole point of writing it here. */}
              {drafting && col.key === 'ice_box' && (
                <Draft view={view} project={project} onClose={() => onDraft?.(false)} />
              )}
              {col.tickets.map((t) => (
                <TicketCard
                  key={t.card.id} ticket={t} carried={lift?.id === t.card.id}
                  drag={pick(t, col.key)}
                  onOpen={onCard && (() => onCard(t))}
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
function TicketCard({ ticket: t, carried, drag, onAsk, onOpen }: {
  ticket: Ticket;
  carried: boolean;
  drag: React.ComponentProps<typeof Card>['drag'];
  onAsk?: () => void;
  /** …and a card that needs nobody opens its own page instead: the three faces
   *  of it, which is Web14 W8. */
  onOpen?: () => void;
}) {
  const desc = t.card.summary.trim();
  const press = onAsk ?? onOpen;
  return (
    <Card
      tight hollow={t.hollow} lifted={carried} drag={drag} onClick={press}
      title={onAsk ? `Answer ${t.who} on ${t.card.title}`
        : onOpen ? `Open ${t.card.title}` : undefined}
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

/** The card being written (Web14 W9): the title, up to three sentences, and the
 *  two keys under them.
 *
 *  It is a card in the column and not a form over it — `ring="amber"` and
 *  `raised`, which is how the frame draws the one being typed into — so the board
 *  it is landing on stays readable behind it. What it needs is a title; the
 *  executor and the brief are filled in later or never, which is what the footer
 *  says.
 *
 *  A card is created on **one** machine, and the merged product carries each
 *  machine's own id for itself (`project.ids`): the one it is written on is a
 *  machine that is answering, because a card filed against a computer that is not
 *  there would be a card nobody has. With none answering the card says so and
 *  keeps what was typed.
 */
function Draft({ view, project, onClose }: {
  view: DivanView;
  project: MergedProject;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Whichever of its computers is answering, and its own id for this product.
  // A machine that has gone quiet is still asked where it is the only one that
  // has this product: what came back from the last poll is a memory, and a card
  // refused on the strength of a memory is a card nobody wrote — the request
  // fails in words if the machine really is gone.
  const mine = view.hosts.filter((h) => project.ids[h.key]);
  const host = mine.find((h) => h.reachable && !h.stale) ?? mine.find((h) => h.reachable)
    ?? mine[0] ?? null;

  const add = async () => {
    const line = title.trim();
    if (!line || busy) return;
    if (!host) {
      setFailed('No computer of this product is paired, so there is nowhere to put it.');
      return;
    }
    setBusy(true);
    setFailed(null);
    try {
      await createCard(host.key, {
        project_id: project.ids[host.key],
        title: line,
        summary: summary.trim(),
        column: 'ice_box',
      });
      void useDivanStore.getState().load(host.key);
      onClose();
    } catch (e: any) {
      setFailed(e?.message ?? 'That did not reach the computer');
    } finally {
      setBusy(false);
    }
  };

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void add(); }
  };

  return (
    <Card ring="amber" raised radius={RADIUS.tile} style={{ flex: 'none', padding: 14, gap: 10 }}>
      <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>
        <Write
          autoFocus value={title} onChange={setTitle} onKeyDown={keys}
          label="Title" placeholder="What is it?"
        />
      </div>
      <div style={{ fontSize: 13.5, lineHeight: '20px', color: T.ink2 }}>
        <Write
          lines={3} value={summary} onChange={setSummary} onKeyDown={keys}
          label="What to do" placeholder="Two or three sentences, or none."
          style={{ height: 60, color: T.ink2 }}
        />
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', ...mono, fontSize: 10.5, color: T.ink3,
        borderTop: `1px solid ${T.line}`, paddingTop: 8,
      }}>
        <span>executor &amp; brief later</span>
        <span style={{ marginLeft: 'auto' }}>{summary.trim().length}/{SUMMARY_MAX}</span>
      </div>
      {!!failed && <div style={{ ...mono, fontSize: 10.5, color: T.red }}>{failed}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <Button label="Add · ↵" wide onClick={() => void add()} />
        <Button label="Esc" face="outline" wide onClick={onClose} />
      </div>
    </Card>
  );
}
