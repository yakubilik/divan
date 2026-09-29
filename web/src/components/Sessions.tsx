/** What needs a person, arriving as conversations rather than as a list.
 *
 *  Web12 W1 and Web13 W3 draw the two of them: a window at the bottom right with
 *  a coding agent's question in it, a second one to the left with a decision
 *  Divan is asking for, the ones put away as tabs along the bottom, and `+1` for
 *  what there is no room to name. Nothing here is a notification and nothing is a
 *  row you have to go and open — the window is already there, with the numbers
 *  behind the question, and the answers the worker is proposing under it.
 *
 *  It is **not** the chat. The chat is a conversation with an agent you started;
 *  this is a ticket in a queue that stopped and asked something, and the whole of
 *  answering it is a note on that ticket (`ustabasi.note`), which is what re-opens
 *  it. So nothing in this file touches `ChatView` or anything under it, and the
 *  parts it is drawn out of are the design system's own (`ui/divan.tsx`).
 *
 *  Every judgement it makes is in `lib/sessions.ts`, where a check can reach it
 *  without a browser: which cards are sessions, what each says, which answers a
 *  question offers in its own words, and how many windows a desktop opens before
 *  the rest become tabs. What is here is the arrangement and the sending.
 */
import { useMemo, useState } from 'react';
import { ticketNote } from '../lib/actions';
import { useDivanStore, type DivanView } from '../lib/divan';
import { clock } from '../lib/overview';
import {
  KIND_STATE, arrange, sessions, source, useDock, at as stampOf, type Session,
} from '../lib/sessions';
import { SIZE, STATE_MARK, T } from '../lib/theme';
import { Composer, ExecutorBadge, Panel, PanelHead, Pill, Quoted, DockMore, DockTab } from '../ui/divan';
import { mono } from '../ui/kit';

/** Where the windows and the dock sit: over the page, in the corner the frames
 *  put them in. Fixed rather than absolute — the page under it scrolls, and a
 *  question that scrolled away with it would be a notification again. */
const DOCK_RIGHT = 24;
const DOCK_BOTTOM = 22;
/** The windows stand on the dock, and the second one to the left of the first. */
const PANEL_BOTTOM = DOCK_BOTTOM + SIZE.tabTall + 12;
const PANEL_GAP = 10;

export function Sessions({ view }: { view: DivanView }) {
  const list = useMemo(() => sessions(view), [view]);
  const dock = useDock();
  const { panels, tabs, more } = arrange(list, dock);
  if (!list.length) return null;
  return (
    <>
      {panels.map((s, i) => (
        <div key={s.id} style={{
          position: 'fixed', zIndex: 11,
          right: DOCK_RIGHT + i * (SIZE.panel + PANEL_GAP), bottom: PANEL_BOTTOM,
        }}>
          <Ask session={s} />
        </div>
      ))}
      {!!tabs.length && (
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
