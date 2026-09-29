import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C, R, type ToneFace } from '../lib/theme';
import { Dot, Icon, P, Spinner, mono } from '../ui/kit';
import { Bubble, Prose } from './Bubble';
import { answerable, conversation, hasDetails, noteHint, VOICE, type Msg, type Ticket } from '../lib/ustabasi';

/** One ticket, opened.
 *
 *  It used to open as a report: the goal under a heading, the criteria under
 *  another, what it was waiting for under a third. Everything was there and
 *  none of it asked anything, so the answer never came. This is the same
 *  ticket as the conversation it always was — what was asked for, what came
 *  back, and at the bottom the question, in the words a person would use.
 *
 *  The paperwork is still here. It is behind `Details`, closed, where a thing
 *  nobody is answering belongs.
 */

const VOICE_COLOR: Record<string, string> = {
  you: C.text2,
  worker: C.info,
  verifier: C.ok,
  triage: C.warn,
  supervisor: C.mute,
};

/** When a message was said. The day is in it because a ticket runs for days,
 *  and "14:02" on its own is a lie by omission on the second morning. */
function when(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (new Date().toDateString() === d.toDateString()) return `Today ${time}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
}

function Who({ from, ts, right }: { from: string; ts: number; right?: boolean }) {
  return (
    <div style={{
      ...mono, fontSize: 11, color: C.faint, display: 'flex', gap: 6,
      justifyContent: right ? 'flex-end' : 'flex-start', marginBottom: 4,
    }}>
      <span style={{ color: VOICE_COLOR[from] ?? C.faint }}>{VOICE[from as keyof typeof VOICE] ?? from}</span>
      <span>· {when(ts)}</span>
    </div>
  );
}

/** The rest of a report, which starts folded. */
function More({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: open ? 8 : 6 }}>
      {open && (
        <div style={{ fontSize: 14, lineHeight: '21px', color: C.mute, marginBottom: 8 }}>
          <Prose text={text} />
        </div>
      )}
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px',
          borderRadius: R.chip, cursor: 'pointer', fontSize: 12, fontWeight: 600,
          background: 'transparent', border: `1px solid ${C.border}`, color: C.mute,
        }}
      >
        <Icon path={open ? P.chevronDown : P.chevronRight} size={12} color={C.mute} />
        {open ? 'Less' : 'The rest of this report'}
      </button>
    </div>
  );
}

/** One message. What a person said is a bubble on the right, the way it is in
 *  a chat; everything the machinery said is plain words on the left. */
function Row({ m, tone, asking }: {
  m: Msg;
  tone: { color: string; wash: string; edge: string };
  /** the last message is the ticket's question, not a line about its state */
  asking: boolean;
}) {
  const mine = m.from === 'you';
  if (mine) {
    return (
      <div>
        <Who from={m.from} ts={m.ts} right />
        <Bubble><Prose text={m.text} /></Bubble>
      </div>
    );
  }
  return (
    <div>
      <Who from={m.from} ts={m.ts} />
      <div style={{
        paddingRight: 32, fontSize: 15, lineHeight: '23px', color: C.text2,
        wordBreak: 'break-word',
      }}>
        {/* The question at the end of a stopped ticket is the only thing on
            this screen that wants an answer, and it is washed in the colour
            the tile used to say so with on the wall. */}
        {m.tail && asking ? (
          <div style={{
            padding: '12px 14px', borderRadius: R.card, color: C.text,
            background: tone.wash, border: `1px solid ${tone.edge}`,
          }}>
            <Prose text={m.text} />
          </div>
        ) : <Prose text={m.text} />}
        {m.more && <More text={m.more} />}
      </div>
    </div>
  );
}

/** The card's criteria and what the verifier made of them. Not a message —
 *  nobody said it to anybody — so it sits at the end, closed. */
function Details({ t }: { t: Ticket }) {
  const [open, setOpen] = useState(false);
  const findings = t.verdict?.findings ?? [];
  return (
    <div style={{
      borderRadius: R.card, background: C.surface, border: `1px solid ${C.border}`,
      overflow: 'hidden', marginRight: 32,
    }}>
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 38,
          padding: '0 12px', background: 'transparent', border: 'none', cursor: 'pointer',
        }}
      >
        <Icon path={open ? P.chevronDown : P.chevronRight} size={13} color={C.faint} />
        <span style={{ ...mono, fontSize: 12.5, color: C.mute, flex: 1, textAlign: 'left' }}>
          Details
        </span>
        <span style={{ ...mono, fontSize: 11, color: C.faint }}>
          {t.done_criteria.length} {t.done_criteria.length === 1 ? 'criterion' : 'criteria'}
          {t.verdict?.verdict ? ` · ${t.verdict.verdict}` : ''}
        </span>
      </button>
      {open && (
        <ol style={{
          margin: 0, padding: '10px 12px 12px 32px', borderTop: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {t.done_criteria.map((c, i) => {
            // The verifier answers the criteria in order but writes its own
            // wording for each, so the mark comes from its list by position.
            const f = findings[i];
            const met = f?.status === 'met';
            return (
              <li key={i} style={{ fontSize: 13, lineHeight: '20px', color: C.text2, wordBreak: 'break-word' }}>
                {f && (
                  <span style={{ ...mono, fontSize: 11, marginRight: 6, color: met ? C.ok : C.warn }}>
                    {met ? '✓' : '✗'}
                  </span>
                )}
                {c}
                {f && !met && f.detail && (
                  <div style={{ fontSize: 12, lineHeight: '18px', color: C.mute, marginTop: 4 }}>
                    {f.detail}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** The box at the bottom, and the one line saying what sending it will do. */
function Composer({ t, busy, error, onSend }: {
  t: Ticket; busy: boolean; error: string | null; onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to a point. Measured from 0 rather than 'auto' so a
  // second pass cannot read back the height the first pass just set.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.max(36, Math.min(160, el.scrollHeight))}px`;
  }, [text]);

  const submit = () => {
    const body = text.trim();
    if (!body || busy) return;
    onSend(body);
    setText('');
  };

  const ready = !!text.trim();
  return (
    <div style={{ padding: '8px 16px 14px', flexShrink: 0 }}>
      {error && <div style={{ fontSize: 12.5, color: C.danger, marginBottom: 6 }}>{error}</div>}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8, padding: 6,
        borderRadius: R.composer, background: C.surface, border: `1px solid ${C.border}`,
      }}>
        <textarea
          ref={ref} name={`ustabasi-note-${t.id}`} value={text} rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={`Answer #${t.id}…`}
          style={{
            flex: 1, minWidth: 0, boxSizing: 'border-box', maxHeight: 160, resize: 'none',
            background: 'transparent', border: 'none', outline: 'none',
            fontSize: 15, lineHeight: '22px', padding: '7px 6px', color: C.text,
            overflowY: 'auto',
          }}
        />
        <button
          type="button" onClick={submit} disabled={!ready || busy} title="Send"
          style={{
            width: 36, height: 36, borderRadius: 18, flexShrink: 0,
            cursor: ready && !busy ? 'pointer' : 'default',
            background: ready ? C.accent : C.surface2, border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: ready ? 1 : 0.5,
          }}
        >
          {busy ? <Spinner size={14} color={C.onAccent} />
            : <Icon path={P.send} size={16} color={C.onAccent} width={2.4} />}
        </button>
      </div>
      <div style={{ ...mono, fontSize: 11, color: C.faint, marginTop: 6 }}>
        {noteHint(t.status)}
      </div>
    </div>
  );
}

export function TicketChat({ t, tone, onClose, onNote }: {
  t: Ticket;
  /** the tile's own colour, so the ticket that was red stays red */
  tone: ToneFace;
  onClose: () => void;
  onNote: (text: string) => Promise<string>;
}) {
  // What has been said from here but has not come back from the queue yet. The
  // wall re-reads every few seconds; until it does, a note that vanished on
  // being sent reads as a note that was not sent.
  const [pending, setPending] = useState<{ id: string; ts: number; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /** whether the end is what is being read. The wall re-reads the queue every
   *  few seconds, and a note arriving while somebody is halfway up a report
   *  must not drag them back down to the bottom of it. */
  const stick = useRef(true);

  const msgs = useMemo(() => conversation(t), [t]);
  const said = useMemo(() => new Set((t.notes || []).map((n) => (n.text || '').trim())), [t.notes]);
  const mine = pending.filter((p) => !said.has(p.text));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The end of the conversation is the part that matters, on opening and after
  // every answer.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs.length, mine.length]);

  const send = useCallback(async (text: string) => {
    const mark = { id: `local-${Date.now()}`, ts: Date.now() / 1000, text };
    // Answering is asking to be shown the answer, wherever the reading had
    // got to.
    stick.current = true;
    setPending((p) => [...p, mark]);
    setBusy(true);
    setError(null);
    try {
      await onNote(text);
    } catch (e: any) {
      // A note the queue refused is not in the conversation, whatever the
      // screen said for a second.
      setPending((p) => p.filter((x) => x.id !== mark.id));
      setError(e?.message || 'the queue refused that note');
    } finally {
      setBusy(false);
    }
  }, [onNote]);

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 40, background: C.scrim,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // Room to see the wall behind it on a desktop; on a phone the ticket
        // gets the whole window, because there is no room to spare.
        padding: 'min(24px, 2.5vw)', boxSizing: 'border-box',
      }}
    >
      <div style={{
        width: '100%', maxWidth: 860, height: 'min(880px, 100%)', minHeight: 0,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: C.bg, border: `1px solid ${C.borderStrong}`, borderRadius: R.media,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, minWidth: 0,
          padding: '10px 10px 10px 16px', background: C.surface,
          borderBottom: `1px solid ${C.border}`,
        }}>
          <Dot color={tone.color} live={t.status === 'running'} size={7} />
          <span style={{ ...mono, fontSize: 12, color: tone.color, fontWeight: 600, flexShrink: 0 }}>
            #{t.id}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{t.title}</div>
            <div style={{
              ...mono, fontSize: 11, color: C.faint, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {tone.label} · {t.stage} r{t.round}
              {t.branch ? ` · ${t.branch}` : ''}
            </div>
          </div>
          <button
            type="button" onClick={onClose} title="Back to the wall (Esc)"
            style={{
              width: 28, height: 28, borderRadius: R.btn, cursor: 'pointer', flexShrink: 0,
              background: C.surface2, border: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon path={P.x} size={13} color={C.mute} />
          </button>
        </div>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '16px' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            {msgs.map((m) => (
              <Row key={m.id} m={m} tone={tone} asking={answerable(t.status)} />
            ))}
            {mine.map((p) => (
              <div key={p.id}>
                <Who from="you" ts={p.ts} right />
                <Bubble><Prose text={p.text} /></Bubble>
              </div>
            ))}
            {hasDetails(t) && <Details t={t} />}
          </div>
        </div>

        <Composer t={t} busy={busy} error={error} onSend={send} />
      </div>
    </div>
  );
}
