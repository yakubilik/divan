/** A Work card's ticket, open as a floating chat over the board.
 *
 *  Pressing a card on the Work page used to leave it for the ticket's own page.
 *  The board is the point of that page, so the ticket is opened over it
 *  instead, at the bottom right, as the same window the Dashboard opens for a
 *  question (`Sessions.tsx`'s `Ask`): the agent in the head and what it is
 *  doing, the conversation — what was asked for, every note, where it stands
 *  now — and, for a ticket stopped on a question, the question with the
 *  answers it offers in its own words and a box to reply in.
 *
 *  An answer is a note on the ticket (`ustabasi.note`), the same call the
 *  Dashboard's window makes; what was sent stays on screen until the queue
 *  hands it back as one of the ticket's notes. What the window says is read
 *  off the newest snapshot of the queue, so it follows the card as it moves.
 */
import { useEffect, useRef, useState } from 'react';
import { ticketNote } from '../lib/actions';
import { clock } from '../lib/overview';
import { RADIUS, SIZE, STATE_MARK, T } from '../lib/theme';
import { conversation, VOICE } from '../lib/ustabasi';
import { talkOf, type Flight } from '../lib/work';
import { ExecutorBadge, Panel, PanelHead, Pill } from '../ui/divan';
import { mono } from '../ui/kit';
import { DictatingComposer } from './Mic';

const RIGHT = 24;
const BOTTOM = 22;
const GAP = 8;
/** Narrower than this and the window takes the width of the screen. */
const NARROW = 640;

/** The size of the browser, followed. */
function useViewport() {
  const read = () => ({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const on = () => setSize(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

export function WorkChat({ f, machine, onClose, onSent }: {
  f: Flight;
  /** The computer's own name, which is where an answer goes back to. */
  machine: string;
  onClose: () => void;
  /** An answer reached the queue: read it again rather than wait for the poll. */
  onSent?: (host: string) => void;
}) {
  const t = f.ticket;
  const talk = talkOf(f);
  const vp = useViewport();
  const [text, setText] = useState('');
  const [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement | null>(null);

  // Another card pressed is another conversation: nothing typed or sent here
  // belongs to it.
  useEffect(() => { setText(''); setSent([]); setError(null); }, [f.key]);

  const msgs = conversation(t);
  const noted = new Set((t.notes || []).map((n) => (n.text || '').trim()));
  const mine = sent.filter((w) => !noted.has(w));

  // What is being read is the end of the conversation, on the window's own body.
  useEffect(() => {
    const body = end.current?.closest('[data-panel-body]') as HTMLElement | null;
    if (body) body.scrollTop = body.scrollHeight;
  }, [f.key, msgs.length, mine.length]);

  const answer = async (words: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await ticketNote(f.host, t.id, words);
      setSent((was) => [...was, words]);
      setText('');
      onSent?.(f.host);
    } catch (e: any) {
      setError(e?.message ?? 'That did not reach the computer');
    } finally {
      setBusy(false);
    }
  };

  const narrow = vp.width < NARROW;
  const width = narrow ? vp.width - 2 * GAP : SIZE.panel + 30;
  const height = narrow ? Math.max(260, Math.min(560, vp.height - 2 * GAP - 64))
    : Math.max(300, Math.min(SIZE.panelTall + 40, vp.height - BOTTOM - 80));

  return (
    <div data-work-chat={f.key} style={{
      position: 'fixed', zIndex: 12, right: narrow ? GAP : RIGHT, bottom: narrow ? GAP : BOTTOM,
      maxWidth: `calc(100vw - ${2 * GAP}px)`,
    }}>
      <Panel
        tone={talk.tone} width={width} height={height}
        head={(
          <PanelHead
            lead={<ExecutorBadge executor="coder" />}
            title={talk.who} badge={talk.says} tone={talk.tone}
            note={[f.project, `#${t.id} ${t.title}`, machine].filter(Boolean).join(' · ')}
            onClose={onClose}
          />
        )}
        foot={(
          <DictatingComposer
            hostKey={f.host}
            placeholder={busy ? 'Sending…' : `Reply to ${talk.who}…`} value={text}
            onChange={setText}
            onSend={() => { const words = text.trim(); if (words) void answer(words); }}
          />
        )}
      >
        {msgs.map((m) => (
          <Line key={m.id} from={m.from} at={m.ts} text={m.text} asking={!!m.tail && !!talk.question} />
        ))}
        {!!talk.answers.length && !mine.length && (
          <div data-work-answers="" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {talk.answers.map((words, i) => (
              <Pill key={words} label={words} face={i === 0 ? 'amber' : 'outline'}
                title={`Answer ${talk.who}: ${words}`} onClick={() => void answer(words)} />
            ))}
          </div>
        )}
        {mine.map((words) => (
          <div key={words} data-work-sent="" style={{ ...mono, fontSize: 11, color: T.ink3 }}>
            {STATE_MARK.done} sent · {words}
          </div>
        ))}
        {!!error && <div style={{ ...mono, fontSize: 11, color: T.red }}>not sent · {error}</div>}
        <div ref={end} />
      </Panel>
    </div>
  );
}

/** One thing said: who, when, and the words. The question a ticket is stopped
 *  on is marked so it can be found. */
function Line({ from, at, text, asking }: { from: keyof typeof VOICE; at: number; text: string; asking: boolean }) {
  const you = from === 'you';
  return (
    <div data-work-line={from} data-work-question={asking ? '' : undefined} style={{
      alignSelf: you ? 'flex-end' : 'flex-start', maxWidth: you ? '86%' : '100%',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{ ...mono, fontSize: 10.5, color: T.ink3, textAlign: you ? 'right' : 'left' }}>
        {[VOICE[from], at ? clock(at) : ''].filter(Boolean).join(' · ')}
      </span>
      <div style={{
        background: you ? T.s2 : 'transparent', borderRadius: RADIUS.quote, padding: you ? '7px 10px' : 0,
        fontSize: 13.5, lineHeight: 1.45, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
      }}>{text}</div>
    </div>
  );
}
