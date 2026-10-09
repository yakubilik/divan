/** The Dashboard's floating chat for whatever an agent is asking.
 *
 *  One window at a time over the bottom right of the page, and a tab under it
 *  for every conversation that is open — the selected one filled, the others a
 *  press away. A ticket's window is a conversation drawn here (its questions,
 *  the answers sent, what the ticket is doing now); a chat's window is the chat
 *  itself (`ChatPanel`), so its approvals and structured questions answer
 *  through the handlers they always had.
 *
 *  The rules — what is asking, when a follow-up is a new line, when a window
 *  closes by itself — are `lib/asking.ts`. What is here is the arrangement and
 *  the sending.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ticketNote } from '../lib/actions';
import {
  PHASE_WORD, pending, phase, points, useAsking, type Pending, type Phase, type Thread,
} from '../lib/asking';
import { useDivanStore, type DivanView } from '../lib/divan';
import { useFleet } from '../lib/fleet';
import { clock } from '../lib/overview';
import { executorFace } from '../lib/sessions';
import type { Place } from '../lib/tell';
import { RADIUS, SIZE, STATE_MARK, T, type Tone } from '../lib/theme';
import { ExecutorBadge, Panel, PanelHead, Pill, DockTab } from '../ui/divan';
import { mono } from '../ui/kit';
import { ChatPanel } from './ChatPanel';
import { DictatingComposer } from './Mic';

/** Narrower than this and the window takes the width of the screen. */
const NARROW = 640;
const GAP = 8;

const TONE: Record<Phase, Tone> = {
  asking: 'amber', working: 'run', stopped: 'red', withdrawn: 'ink3', quiet: 'ink3',
};

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

export function Asking({ view }: { view: DivanView }) {
  const hosts = useFleet((s) => s.hosts);
  const asking = useMemo(() => pending(view, hosts), [view, hosts]);
  const state = useAsking();
  const vp = useViewport();

  // What is asking now, folded into what is open. The same answer twice is the
  // same state (`sync`), so a poll that changed nothing does nothing.
  useEffect(() => { useAsking.getState().sync(asking, view); }, [asking, view]);

  if (!state.threads.length) return null;

  const narrow = vp.width < NARROW;
  const tabsTall = SIZE.tabTall + GAP;
  const place: Place = narrow
    ? { right: GAP, bottom: GAP + tabsTall, width: vp.width - 2 * GAP,
        height: Math.max(260, Math.min(560, vp.height - 2 * GAP - tabsTall - 64)) }
    : { right: 24, bottom: 22 + tabsTall, width: SIZE.panel + 30,
        height: Math.max(300, Math.min(SIZE.panelTall + 40, vp.height - 22 - tabsTall - 80)) };
  const shown = state.threads.find((t) => t.id === state.selected && !state.minimised.includes(t.id)) ?? null;
  const now = new Map(asking.map((p) => [p.id, p]));

  return (
    <>
      {!!shown && (
        <div data-asking-window={shown.id} style={{
          position: 'fixed', zIndex: 12, right: place.right, bottom: place.bottom,
          maxWidth: `calc(100vw - ${2 * GAP}px)`,
        }}>
          {shown.kind === 'chat' ? (
            <ChatPanel
              told={{ host: shown.host, chatId: shown.chatId!, title: shown.title, at: shown.opened }}
              place={place} onPlace={() => {}}
              onMinimise={() => state.minimise(shown.id)}
              onClose={() => state.close(shown.id)}
            />
          ) : (
            <TicketThread key={shown.id} thread={shown} place={place} view={view} live={now.get(shown.id) ?? null} />
          )}
        </div>
      )}
      <div role="tablist" aria-label="Questions waiting on you" data-asking-tabs="" style={{
        position: 'fixed', zIndex: 11, right: narrow ? GAP : 24, bottom: narrow ? GAP : 22,
        left: narrow ? GAP : undefined, display: 'flex', gap: GAP, justifyContent: 'flex-end',
        overflowX: 'auto', maxWidth: `calc(100vw - ${2 * GAP}px)`,
      }}>
        {state.threads.map((t) => {
          const open = shown?.id === t.id;
          const p = phase(t, view, hosts);
          return (
            <span key={t.id} data-asking-tab={t.id} data-phase={p} role="tab" aria-selected={open}>
              <DockTab
                open={open} label={t.title}
                lead={<ExecutorBadge executor={t.kind === 'chat' ? 'divan' : face(t, view)} size={20} />}
                title={open ? `Put ${t.title} away` : `${t.project} — ${t.title} (${PHASE_WORD[p]})`}
                onClick={() => (open ? state.minimise(t.id) : state.select(t.id))}
              />
            </span>
          );
        })}
      </div>
    </>
  );
}

function face(t: Thread, view: DivanView): string {
  const card = view.cards.find((c) => c.host === t.host && c.id === t.cardId);
  return card ? executorFace(card) : 'coder';
}

/** A ticket's question, as a conversation: every question it asked, every
 *  answer sent from here, and — at the end — what the ticket is doing now. */
function TicketThread({ thread: t, place, view, live }: {
  thread: Thread; place: Place; view: DivanView; live: Pending | null;
}) {
  const hosts = useFleet((s) => s.hosts);
  const state = useAsking();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  const p = phase(t, view, hosts);
  const tone = TONE[p];
  const card = view.cards.find((c) => c.host === t.host && c.id === t.cardId);
  const machine = card?.machine ?? view.hosts.find((h) => h.key === t.host)?.machine ?? t.host;
  // A pill is one answer to one question. A question that makes several points
  // has no single answer to put on a button, so it gets the box alone.
  const offered = p === 'asking' && points(t.asked).length <= 1 ? live?.session?.answers ?? [] : [];

  // What is being read is the end of the conversation. Scrolled after a frame,
  // when the lines have their height, and on the window's own body only.
  useEffect(() => {
    const go = () => {
      const body = end.current?.closest('[data-panel-body]') as HTMLElement | null;
      if (body) body.scrollTop = body.scrollHeight;
    };
    go();
    if (typeof requestAnimationFrame === 'undefined') return;
    const f = requestAnimationFrame(go);
    return () => cancelAnimationFrame(f);
  }, [t.lines.length, p, place.height, place.width]);

  const answer = async (words: string) => {
    if (t.ticket == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await ticketNote(t.host, t.ticket, words);
      useAsking.getState().said(t.id, words);
      setText('');
      // The board is what says the ticket has taken it; ask the machine that
      // holds it rather than waiting out the poll. The window stays.
      void useDivanStore.getState().load(t.host);
    } catch (e: any) {
      setError(e?.message ?? 'That did not reach the computer');
    } finally {
      setBusy(false);
    }
  };

  const last = t.lines[t.lines.length - 1];
  return (
    <Panel
      tone={tone} width={place.width} height={place.height}
      head={(
        <PanelHead
          lead={<ExecutorBadge executor={face(t, view)} />}
          title={t.project} badge={PHASE_WORD[p]} tone={tone}
          note={[t.who, t.title, machine].filter(Boolean).join(' · ')}
          onMinimise={() => state.minimise(t.id)}
          onClose={() => state.close(t.id)}
        />
      )}
      foot={t.ticket == null ? (
        <div style={{ ...mono, flex: 'none', padding: '0 14px 14px', fontSize: 11, color: T.ink3 }}>
          no queue behind this card on {machine} — nothing to send an answer to
        </div>
      ) : p === 'withdrawn' ? null : (
        <DictatingComposer
          hostKey={t.host}
          placeholder={busy ? 'Sending…' : `Reply to ${t.who}…`} value={text}
          onChange={setText}
          onSend={() => { const words = text.trim(); if (words) void answer(words); }}
        />
      )}
    >
      {t.lines.map((l, i) => <Said key={`${i}:${l.at}`} line={l} />)}
      {!!offered.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {offered.map((words, i) => (
            <Pill key={words} label={words} face={i === 0 ? 'amber' : 'outline'}
              title={`Answer ${t.who}: ${words}`} onClick={() => void answer(words)} />
          ))}
        </div>
      )}
      {p !== 'asking' && last?.from === 'you' && p !== 'withdrawn' && (
        <div data-asking-status="" style={{ ...mono, fontSize: 11, color: T.ink3 }}>
          {STATE_MARK.done} sent · {p === 'stopped'
            ? 'it stopped — say more here and it goes back in the queue'
            : 'it is working with your answer; a follow-up lands here'}
        </div>
      )}
      {p === 'withdrawn' && (
        <div data-asking-status="" style={{ ...mono, fontSize: 11, color: T.ink3 }}>
          this request was withdrawn — nothing is waiting on an answer
        </div>
      )}
      {!!error && <div style={{ ...mono, fontSize: 11, color: T.red }}>not sent · {error}</div>}
      <div ref={end} />
    </Panel>
  );
}

/** One thing said: the agent's question as the points it makes, or an answer. */
function Said({ line: l }: { line: { from: 'agent' | 'you'; text: string; at: number } }) {
  const mine = l.from === 'you';
  const parts = mine ? [l.text] : points(l.text);
  return (
    <div data-asking-line={l.from} style={{
      alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: mine ? '86%' : '100%',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{ ...mono, fontSize: 10.5, color: T.ink3, textAlign: mine ? 'right' : 'left' }}>
        {[mine ? 'you' : 'asked', l.at ? clock(l.at) : ''].filter(Boolean).join(' · ')}
      </span>
      <div style={{
        background: mine ? T.s2 : 'transparent', borderRadius: RADIUS.quote,
        padding: mine ? '7px 10px' : 0, fontSize: 13.5, lineHeight: 1.45,
        overflowWrap: 'anywhere', whiteSpace: mine ? 'pre-wrap' : undefined,
      }}>
        {parts.length > 1 ? (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {parts.map((x) => <li key={x}>{x}</li>)}
          </ul>
        ) : parts[0] ?? l.text}
      </div>
    </div>
  );
}
