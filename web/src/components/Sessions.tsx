/** What needs a person, arriving as conversations rather than as a list.
 *
 *  Web12 W1 and Web13 W3 draw the two of them: a window at the bottom right with
 *  a coding agent's question in it, a second one to the left with a decision
 *  Divan is asking for, the ones put away as tabs along the bottom, and `+1` for
 *  what there is no room to name. Nothing here is a notification and nothing is a
 *  row you have to go and open — the window is already there, with the numbers
 *  behind the question, and the answers the worker is proposing under it.
 *
 *  A question is **not** a chat. The chat is a conversation with an agent you
 *  started; a question is a ticket in a queue that stopped and asked something,
 *  and the whole of answering it is a note on that ticket (`ustabasi.note`),
 *  which is what re-opens it. `Ask` below is that, and only that.
 *
 *  Both kinds of window stand in the same corner, though, so this file owns the
 *  corner: the windows the board opens by itself, the chats the command bar
 *  started (`ChatPanel`, `lib/tell.ts`) — those nearest the corner, because a
 *  sentence you have just typed is the thing you are reading — and one row of
 *  tabs under them for all of it.
 *
 *  Every judgement it makes is in `lib/sessions.ts` and `lib/tell.ts`, where a
 *  check can reach it without a browser: which cards are sessions, what each
 *  says, which answers a question offers in its own words, and how many windows
 *  a desktop opens before the rest become tabs. What is here is the arrangement
 *  and the sending.
 */
import { useEffect, useMemo, useState } from 'react';
import { ticketNote } from '../lib/actions';
import { useDivanStore, type DivanView } from '../lib/divan';
import { useFleet } from '../lib/fleet';
import { clock } from '../lib/overview';
import {
  KIND_STATE, PANELS, arrange, sessions, source, useDock, at as stampOf, type Session,
} from '../lib/sessions';
import {
  arrangeTold, freeSlot, idOfTold, liveTold, slot as slotAt, useTold, type Place,
} from '../lib/tell';
import { SIZE, STATE_MARK, T } from '../lib/theme';
import { Composer, ExecutorBadge, Panel, PanelHead, Pill, Quoted, DockMore, DockTab } from '../ui/divan';
import { mono } from '../ui/kit';
import { ChatPanel } from './ChatPanel';

/** Where the windows and the dock sit: over the page, in the corner the frames
 *  put them in. Fixed rather than absolute — the page under it scrolls, and a
 *  question that scrolled away with it would be a notification again. */
const DOCK_RIGHT = 24;
const DOCK_BOTTOM = 22;
/** The windows stand on the dock, and the second one to the left of the first
 *  (`lib/tell.ts`, `slot`). */
const PANEL_BOTTOM = DOCK_BOTTOM + SIZE.tabTall + 12;

export function Sessions({ view }: { view: DivanView }) {
  const list = useMemo(() => sessions(view), [view]);
  const dock = useDock();
  /** The one window, if any, that has been opened out into the middle of the
   *  screen. One at a time on purpose: two of them centred is a pile. */
  const [big, setBig] = useState<string | null>(null);
  const told = useTold();
  const hosts = useFleet((s) => s.hosts);
  // A window whose chat has been deleted somewhere else is a window about
  // nothing, so what is drawn is what is still there.
  const started = useMemo(() => liveTold(told.chats, hosts), [told.chats, hosts]);
  const mine = arrangeTold(started, told.minimised);
  // The chats take their windows first and the questions have what is left:
  // one of them is a sentence typed a moment ago, the other has been waiting
  // since last night and can wait as a tab.
  const { panels, tabs, more } = arrange(list, dock, PANELS - mine.panels.length);
  if (!list.length && !started.length) return null;

  /** Where the nth window stands before anybody has put it anywhere: the
   *  corner the frames draw, and each one after that to the left of the last. */
  const slot = (i: number): Place => slotAt(i, { right: DOCK_RIGHT, bottom: PANEL_BOTTOM },
    { width: SIZE.panel, height: SIZE.panelTall });

  /** The windows. Every chat window has a place of its own from the moment it
   *  is drawn — the first slot nothing else is standing in — and keeps it
   *  until somebody drags it somewhere else.
   *
   *  That is the whole of why it is written down rather than worked out from a
   *  position in a list: a window whose place came from its index moved every
   *  time another one opened, was closed, or dropped out of the list for a
   *  poll, and a window that wanders because its neighbour did is not
   *  furniture. */
  const windows = mine.panels.map((t, i) => {
    const id = idOfTold(t);
    const place = told.places[id] ?? slot(i);
    return {
      id,
      place,
      node: (
        <ChatPanel
          told={t} place={place} onPlace={(next) => told.place(id, next)}
          big={big === id} onBig={(on) => setBig(on ? id : null)}
          onMinimise={() => told.minimise(id)}
          onClose={() => { setBig((b) => (b === id ? null : b)); told.close(id); }}
        />
      ),
    };
  }).concat(panels.map((s, i) => ({
    id: s.id, place: slot(mine.panels.length + i), node: <Ask session={s} />,
  })));

  // …and that place is written down the first time the window is drawn, so
  // nothing about where it stands depends on the list any more.
  const unplaced = mine.panels.filter((t) => !told.places[idOfTold(t)]);
  useEffect(() => {
    if (!unplaced.length) return;
    const taken = Object.values(useTold.getState().places);
    for (const t of unplaced) {
      const at = freeSlot(taken, { right: DOCK_RIGHT, bottom: PANEL_BOTTOM },
        { width: SIZE.panel, height: SIZE.panelTall });
      taken.push(at);
      useTold.getState().place(idOfTold(t), at);
    }
  }, [unplaced.map(idOfTold).join(' ')]);

  const open = windows.find((w) => w.id === big) ?? null;

  return (
    <>
      {windows.filter((w) => w.id !== big).map(({ id, place, node }) => (
        <div key={id} style={{
          position: 'fixed', zIndex: 11, right: place.right, bottom: place.bottom,
        }}>
          {node}
        </div>
      ))}
      {/* Opened out: the same window, in the middle of the screen, over a dim.
          Pressing the dim puts it back in the corner rather than closing the
          chat — closing is the × and is not something a stray click should
          do. */}
      {!!open && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setBig(null); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 30, background: T.scrim,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'min(32px, 4vw)', boxSizing: 'border-box',
          }}
        >
          {open.node}
        </div>
      )}
      {(!!tabs.length || !!mine.tabs.length) && (
        <div style={{
          position: 'fixed', zIndex: 10, right: DOCK_RIGHT, bottom: DOCK_BOTTOM,
          display: 'flex', gap: 8,
        }}>
          {tabs.map(({ session: s, open }) => (
            <DockTab
              key={s.id} open={open} label={s.card.title}
              lead={<ExecutorBadge executor={s.face} size={20} />}
              title={open ? `Put ${s.card.title} away` : `${s.who} ${s.says} — ${s.card.title}`}
              onClick={() => (open ? dock.minimise(s.id) : dock.restore(s.id))}
            />
          ))}
          {more > 0 && <DockMore n={more} title={`${more} more waiting on you`} />}
          {/* …and the chats, nearest the corner, in the order they were
              started: the tab is where one goes when it is put away, and the
              row is how the Dashboard holds more than two of them. */}
          {mine.tabs.map(({ told: t, open }) => (
            <DockTab
              key={idOfTold(t)} open={open} label={t.title}
              lead={<ExecutorBadge executor="divan" size={20} />}
              title={open ? `Put ${t.title} away` : `Open ${t.title}`}
              onClick={() => (open ? told.minimise(idOfTold(t)) : told.restore(idOfTold(t)))}
            />
          ))}
          {mine.more > 0 && <DockMore n={mine.more} title={`${mine.more} more chats on this page`} />}
        </div>
      )}
    </>
  );
}

/** One question, open. The sentence it was asked in, the figures behind it where
 *  the card carries any, the answers it offers in its own words, and a box.
 *
 *  What was sent from here is kept on screen until the board says otherwise: the
 *  boards are re-read on a slow timer, and an answer that vanished on being sent
 *  reads as an answer that was not sent. */
function Ask({ session: s }: { session: Session }) {
  const dock = useDock();
  const [text, setText] = useState('');
  const [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tone = KIND_STATE[s.kind] === 'quiet' ? 'ink3' : KIND_STATE[s.kind] === 'stuck' ? 'red' : 'amber';

  const answer = async (words: string) => {
    if (s.ticket == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await ticketNote(s.host, s.ticket, words);
      setSent((was) => [...was, words]);
      setText('');
      // The board is what decides this window is gone; ask the machine that
      // holds it rather than waiting out the poll.
      void useDivanStore.getState().load(s.host);
    } catch (e: any) {
      setError(e?.message ?? 'That did not reach the computer');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      tone={tone}
      head={(
        <PanelHead
          lead={<ExecutorBadge executor={s.face} />}
          title={s.who} badge={s.says} tone={tone}
          note={source(s, clock)}
          onMinimise={() => dock.minimise(s.id)}
          onClose={() => dock.close(s.id, stampOf(s))}
        />
      )}
      foot={s.ticket == null ? (
        <div style={{ ...mono, flex: 'none', padding: '0 14px 14px', fontSize: 11, color: T.ink3 }}>
          no queue behind this card on {s.machine} — nothing to send an answer to
        </div>
      ) : (
        <Composer
          placeholder={busy ? 'Sending…' : `Reply to ${s.who}…`} value={text}
          onChange={setText}
          onSend={() => { const words = text.trim(); if (words) void answer(words); }}
        />
      )}
    >
      {s.stale && (
        <div style={{ ...mono, fontSize: 11, color: T.ink3 }}>
          {s.machine} has gone quiet — this is what it last said
        </div>
      )}
      <div style={{ fontSize: 13.5, lineHeight: 1.45, maxWidth: '94%' }}>{s.said}</div>
      {!!s.card.summary.trim() && <Quoted>{s.card.summary.trim()}</Quoted>}
      {!!s.answers.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {s.answers.map((words, i) => (
            <Pill
              key={words} label={words} face={i === 0 ? 'amber' : 'outline'}
              title={`Answer ${s.who}: ${words}`}
              onClick={() => void answer(words)}
            />
          ))}
        </div>
      )}
      {sent.map((words) => (
        <div key={words} style={{ ...mono, fontSize: 11, color: T.ink3 }}>
          {STATE_MARK.done} sent · {words}
        </div>
      ))}
      {!!error && <div style={{ ...mono, fontSize: 11, color: T.red }}>{error}</div>}
    </Panel>
  );
}
