import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C, R, type ToneFace } from '../lib/theme';
import { Dot, Icon, Label, P, Spinner, mono } from '../ui/kit';
import { uptime } from '../lib/format';
import { Bubble, Prose } from './Bubble';
import {
  answerable, conversation, hasDetails, noteHint, voiceOf, type Ticket,
} from '../lib/ustabasi';
import { current as currentStep, flow, STEP_MARK, stepNote, type Round, type Step } from '../lib/flow';
import { useRun } from '../lib/run';
import { RunLog } from './RunLog';
import { MicButton, MicNote, useMic } from './Mic';
import { appendSpeech } from '../lib/dictate';
import { cancelTicket, deleteTicket, editTicket, prioritiseTicket, restartTicket } from '../lib/actions';

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
      <span style={{ color: VOICE_COLOR[from] ?? C.faint }}>{from === 'you' ? 'You' : from}</span>
      <span>· {when(ts)}</span>
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
function Composer({ t, hostKey, busy, error, onSend }: {
  t: Ticket; hostKey: string | null; busy: boolean; error: string | null; onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const mic = useMic({ hostKey, onCommit: (chunk) => setText((prev) => appendSpeech(prev, chunk)) });
  // Words not yet committed are shown where they will land; typing takes them over.
  const shown = mic.interim ? appendSpeech(text, mic.interim) : text;

  // Grow with the text, up to a point. Measured from 0 rather than 'auto' so a
  // second pass cannot read back the height the first pass just set.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.max(36, Math.min(160, el.scrollHeight))}px`;
  }, [shown]);

  const submit = () => {
    // Send with the microphone open means "that was it": stop first, then send.
    if (mic.state !== 'idle') { mic.stop(); return; }
    const body = text.trim();
    if (!body || busy) return;
    onSend(body);
    setText('');
  };

  const ready = !!text.trim();
  // Armed while there is something to send and while it is being sent. The
  // white `onAccent` glyph belongs on the red disc; a resting disc is a quiet
  // fill and takes an ink, or it is white on off-white in the light theme.
  const armed = ready || busy || mic.state !== 'idle';
  return (
    <div style={{ padding: '8px 16px 14px', flexShrink: 0 }}>
      {error && <div style={{ fontSize: 12.5, color: C.danger, marginBottom: 6 }}>{error}</div>}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8, padding: 6,
        borderRadius: R.composer, background: C.surface, border: `1px solid ${C.border}`,
      }}>
        <textarea
          ref={ref} name={`ustabasi-note-${t.id}`} value={shown} rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={mic.state === 'listening' ? 'Listening…' : `Answer #${t.id}…`}
          style={{
            flex: 1, minWidth: 0, boxSizing: 'border-box', maxHeight: 160, resize: 'none',
            background: 'transparent', border: 'none', outline: 'none',
            fontSize: 15, lineHeight: '22px', padding: '7px 6px', color: C.text,
            overflowY: 'auto',
          }}
        />
        <MicButton mic={mic} />
        <button
          type="button" onClick={submit} disabled={busy || (!ready && mic.state === 'idle')} title="Send"
          style={{
            width: 36, height: 36, borderRadius: 18, flexShrink: 0,
            cursor: ready && !busy ? 'pointer' : 'default',
            background: armed ? C.accent : C.surface2, border: 'none',
            color: armed ? C.onAccent : C.mute,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {busy ? <Spinner size={14} color={armed ? C.onAccent : C.mute} />
            : <Icon path={P.send} size={16} color={armed ? C.onAccent : C.mute} width={2.4} />}
        </button>
      </div>
      <MicNote mic={mic} />
      <div style={{ ...mono, fontSize: 11, color: C.faint, marginTop: 6 }}>
        {noteHint(t.status)}
      </div>
    </div>
  );
}

/** The ticket as the steps it has to go through, ticking off.
 *
 *  What a person opening a ticket wants is what a build page gives them: the
 *  stages in order, the ones behind it ticked, the one it is on live, the ones
 *  ahead still open. Not the brief — the words an agent was handed are the one
 *  thing nobody reading a board wants to read, and they were the top half of
 *  this window until now.
 *
 *  A round the verifier turned down is a round of its own above the current
 *  one, whole and ticked, because "this is the third time round" is the most
 *  useful thing a stuck ticket can tell you.
 */
function Flow({ rounds, ago, under, children }: {
  rounds: Round[];
  ago: (s: number | null) => string;
  /** Which step the live run belongs under, as `round:stage`. */
  under: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginRight: 32 }}>
      {rounds.map((r) => (
        <div key={r.round} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rounds.length > 1 && (
            <div style={{ ...mono, fontSize: 11, color: C.faint }}>round {r.round}</div>
          )}
          {r.steps.map((s) => (
            <StepRow key={`${r.round}:${s.stage}`} step={s} ago={ago}>
              {under === `${r.round}:${s.stage}` ? children : null}
            </StepRow>
          ))}
        </div>
      ))}
    </div>
  );
}

const STEP_COLOUR: Record<Step['state'], string> = {
  done: C.ok, running: C.accent, stopped: C.danger, waiting: C.faint,
};

function StepRow({ step, ago, children }: {
  step: Step; ago: (s: number | null) => string; children?: React.ReactNode;
}) {
  const colour = STEP_COLOUR[step.state];
  const took = step.endedAt && step.at ? ago(step.endedAt - step.at)
    : step.at ? ago(Date.now() / 1000 - step.at) : '';
  const note = stepNote(step);
  return (
    <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
      <span style={{ ...mono, flex: 'none', width: 14, fontSize: 13, color: colour, lineHeight: '22px' }}>
        {step.state === 'running' ? <Spinner size={11} /> : STEP_MARK[step.state]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span style={{
            fontSize: 14, fontWeight: step.state === 'running' ? 600 : 500,
            color: step.state === 'waiting' ? C.mute : C.text,
          }}>{step.stage}</span>
          {!!note && <span style={{ ...mono, fontSize: 11, color: colour }}>{note}</span>}
          <span style={{ ...mono, flex: 1, textAlign: 'right', fontSize: 11, color: C.faint }}>
            {took}
          </span>
        </div>
        {!!children && <div style={{ marginTop: 8 }}>{children}</div>}
      </div>
    </div>
  );
}

/** A small button in the ticket's head. Not the design system's `Button` —
 *  this window is the chat's vocabulary (`lib/theme.ts`'s `C`/`R`), not the
 *  Dashboard's, and it sits beside the close button it is drawn to match. */
function Act({ label, danger, busy, onClick }: {
  label: string; danger?: boolean; busy?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={busy}
      style={{
        height: 26, padding: '0 10px', borderRadius: R.btn, flexShrink: 0,
        cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap',
        ...mono, fontSize: 11.5,
        background: C.surface2, border: `1px solid ${danger ? C.dangerLine : C.border}`,
        color: danger ? C.danger : C.text2,
      }}
    >{label}</button>
  );
}

/** What a ticket asks for, open for rewriting: the title, the goal, what done
 *  means and the command that proves it.
 *
 *  One criterion a line, because that is how they are read and how they are
 *  counted — a verifier answers them one by one, and a textarea of prose would
 *  be one criterion nobody can mark. */
function CardEditor({ t, busy, onSave, onClose }: {
  t: Ticket; busy: boolean;
  onSave: (card: { title: string; goal: string; done_criteria: string[]; verify_cmd: string }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(t.title);
  const [goal, setGoal] = useState(t.goal);
  const [criteria, setCriteria] = useState((t.done_criteria || []).join('\n'));
  const [verify, setVerify] = useState(t.verify_cmd || '');
  const field = {
    width: '100%', boxSizing: 'border-box' as const, padding: '8px 10px',
    background: C.bg, border: `1px solid ${C.border}`, borderRadius: R.input,
    color: C.text, fontSize: 13, lineHeight: '20px', fontFamily: 'inherit', outline: 'none',
  };
  const lines = criteria.split('\n').map((c) => c.trim()).filter(Boolean);
  return (
    <div style={{
      borderRadius: R.card, background: C.surface, border: `1px solid ${C.border}`,
      padding: 12, marginRight: 32, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <Label>what this ticket asks for</Label>
      <input value={title} onChange={(e) => setTitle(e.target.value)}
        aria-label="Ticket title" placeholder="title" style={field} />
      <textarea value={goal} onChange={(e) => setGoal(e.target.value)}
        aria-label="Goal" placeholder="goal" rows={3} style={{ ...field, resize: 'vertical' }} />
      <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)}
        aria-label="Done criteria" placeholder="done when… (one a line)" rows={4}
        style={{ ...field, resize: 'vertical' }} />
      <input value={verify} onChange={(e) => setVerify(e.target.value)}
        aria-label="Verify command" placeholder="the command that proves it" style={{ ...field, ...mono, fontSize: 12.5 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...mono, fontSize: 11, color: C.faint, flex: 1 }}>
          {lines.length} {lines.length === 1 ? 'criterion' : 'criteria'}
        </span>
        <Act label="Cancel" onClick={onClose} />
        <Act label={busy ? 'Saving…' : 'Save'} busy={busy}
          onClick={() => onSave({ title: title.trim(), goal: goal.trim(),
                                  done_criteria: lines, verify_cmd: verify.trim() })} />
      </div>
    </div>
  );
}

export function TicketChat({ t, tone, hostKey, onClose, onNote, onChanged }: {
  t: Ticket;
  /** the tile's own colour, so the ticket that was red stays red */
  tone: ToneFace;
  /** the computer whose queue this ticket is in — what the run is asked of,
   *  and what everything that changes it is asked of */
  hostKey: string | null;
  onClose: () => void;
  onNote: (text: string) => Promise<string>;
  /** the queue moved: re-read it rather than waiting out the poll */
  onChanged?: () => void;
}) {
  // What has been said from here but has not come back from the queue yet. The
  // wall re-reads every few seconds; until it does, a note that vanished on
  // being sent reads as a note that was not sent.
  const [pending, setPending] = useState<{ id: string; ts: number; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What the queue said about the last thing that was done to this ticket —
   *  its own sentence, not a word this screen made up. */
  const [said, setSaid] = useState<string | null>(null);
  const [doing, setDoing] = useState<string | null>(null);
  const [asking, setAsking] = useState<'delete' | null>(null);
  const [editing, setEditing] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  /** whether the end is what is being read. The wall re-reads the queue every
   *  few seconds, and a note arriving while somebody is halfway up a report
   *  must not drag them back down to the bottom of it. */
  const stick = useRef(true);

  // What the ticket is: the steps it has to go through, and where it has got
  // to. The brief that used to be the top half of this window is gone — it is
  // what an agent was handed, not what a person came here to read.
  const rounds = useMemo(() => flow(t), [t]);
  const at = currentStep(rounds);
  // …and what the agent on it is doing right now, drawn under the step it
  // belongs to rather than as a wall of its own.
  const run = useRun(hostKey, t.id);
  /** The question a stopped ticket ended on, which is the only thing here
   *  addressed to a person. */
  const asked = (t.ask || t.escalation || '').trim();
  /** …and the record behind it, when the question was written apart from it:
   *  the branch, the path, the command. Shut, because it is for whoever wants it. */
  const record = (t.ask || '').trim() ? (t.escalation || '').trim() : '';
  const sent = useMemo(() => new Set((t.notes || []).map((n) => (n.text || '').trim())), [t.notes]);
  const mine = pending.filter((p) => !sent.has(p.text));
  /** What was *said to* the ticket, oldest first: the notes a person typed and
   *  the ones the supervisor put on it.
   *
   *  Not the worker's reports. What an agent wrote back is the paperwork behind
   *  the steps and is why this window used to open as a wall of text; the steps
   *  say what the machine did, and this list is the part of it that is a
   *  conversation.
   *
   *  It is here because of what happens without it. A note shows the moment it
   *  is typed (`pending`), and it leaves that list as soon as the queue hands
   *  it back as part of the ticket — so with nothing drawing the queue's own
   *  notes, your sentence appeared, sat for one poll and then vanished, and a
   *  note the supervisor added never appeared at all. */
  const notes = useMemo(() => [...(t.notes || [])]
    .filter((n) => (n.text || '').trim())
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .map((n, i) => ({ id: `n${i}-${n.ts}`, ts: n.ts, from: voiceOf(n.from),
                      text: (n.text || '').trim() }))
    .filter((n) => n.from === 'you' || n.from === 'supervisor'), [t.notes]);
  /** …and where the ticket stands right now, in one line and in the voice of
   *  whoever is holding it. The steps above say what it has been through; this
   *  is the sentence a person reads last, and on a ticket nobody has written a
   *  note on it is the only thing in here. */
  const tail = useMemo(() => conversation(t).find((m) => m.tail) ?? null, [t]);

  /** One thing done to the ticket, and what the queue said about it.
   *
   *  Nothing here decides whether it was allowed: `running` refuses an edit,
   *  `done` refuses a priority, and those are the queue's rules and are
   *  enforced where the queue is. What this does is ask, and put the answer on
   *  screen — including the refusal, which is a sentence worth reading. */
  const act = useCallback(async (what: string, run: () => Promise<{ message?: string }>,
                                 after?: () => void) => {
    if (!hostKey || doing) return;
    setDoing(what);
    setError(null);
    setSaid(null);
    try {
      const r = await run();
      setSaid((r?.message || '').trim() || `${what} — done`);
      onChanged?.();
      after?.();
    } catch (e: any) {
      setError(e?.message || `the queue refused to ${what}`);
    } finally {
      setDoing(null);
    }
  }, [hostKey, doing, onChanged]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The end of the conversation is the part that matters, on opening and after
  // every answer — and the end is where the run is.
  //
  // Twice, a frame apart, and that is not belt and braces: what arrives here is
  // a page of the run, tens of rows of it, and the height those rows take is
  // not known in the tick that adds them. Scrolling to `scrollHeight` before
  // the browser has laid them out scrolls to where the bottom *was*, which on
  // a first open is the top of the page — which is exactly where the window sat
  // until somebody dragged it down by hand.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
    if (typeof requestAnimationFrame !== 'function') return;
    const frame = requestAnimationFrame(() => {
      const now = scroller.current;
      if (now && stick.current) now.scrollTop = now.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [rounds.length, at?.step.stage, mine.length, run.turns.length, run.live, run.loading]);

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
          {/* What a person can do to this ticket, in the head where the title
              is: watching one go the wrong way and not being able to stop it
              was the whole complaint. Which of them are drawn is the ticket's
              status — the queue refuses the rest anyway, and a button that is
              always refused is a button that lies. */}
          {!!hostKey && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {t.status === 'running' && (
                <Act label={doing === 'stop' ? 'Stopping…' : 'Stop'} danger busy={!!doing}
                  onClick={() => act('stop', () => cancelTicket(hostKey, t.id))} />
              )}
              {t.status === 'queued' && (
                <Act label={doing === 'run next' ? 'Moving…' : 'Run next'} busy={!!doing}
                  onClick={() => act('run next', () => prioritiseTicket(hostKey, t.id))} />
              )}
              {t.status !== 'running' && t.status !== 'queued' && (
                <Act label={doing === 'restart' ? 'Queueing…' : 'Restart'} busy={!!doing}
                  onClick={() => act('restart', () => restartTicket(hostKey, t.id))} />
              )}
              {t.status !== 'running' && (
                <Act label="Edit" busy={!!doing} onClick={() => { setAsking(null); setEditing((e) => !e); }} />
              )}
              <Act label="Delete" danger busy={!!doing}
                onClick={() => { setEditing(false); setAsking(asking ? null : 'delete'); }} />
            </div>
          )}
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
            <Flow
              rounds={rounds} ago={(s) => (s == null ? '' : uptime(Math.max(0, s)))}
              under={at ? `${at.round}:${at.step.stage}` : null}
            >
              <RunLog run={run} hostKey={hostKey} />
            </Flow>
            {/* A ticket whose steps that computer never sent — an older daemon,
                a run whose events were cleared — still has a run to read, and
                it goes under the flow rather than nowhere. */}
            {!at && <RunLog run={run} hostKey={hostKey} />}
            {/* The one thing on this screen that is addressed to a person: the
                question a stopped ticket ended on. Everything else the queue
                wrote down is behind Details. */}
            {!!asked && (
              <div style={{
                padding: '12px 14px', borderRadius: R.card, marginRight: 32,
                color: C.text, background: tone.wash, border: `1px solid ${tone.edge}`,
              }}>
                <Prose text={asked} />
                {!!record && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ ...mono, fontSize: 11, color: C.mute, cursor: 'pointer' }}>Details</summary>
                    <div style={{ marginTop: 6, fontSize: 13, color: C.text2 }}><Prose text={record} /></div>
                  </details>
                )}
              </div>
            )}
            {notes.map((n) => (
              <div key={n.id}>
                <Who from={n.from} ts={n.ts} right={n.from === 'you'} />
                <Bubble><Prose text={n.text} /></Bubble>
              </div>
            ))}
            {mine.map((p) => (
              <div key={p.id}>
                <Who from="you" ts={p.ts} right />
                <Bubble><Prose text={p.text} /></Bubble>
              </div>
            ))}
            {/* …and on a ticket that stopped on a question, that question is
                already drawn above in its own colour: the tail would be the
                same sentence twice. */}
            {!!tail && !answerable(t.status) && (
              <div>
                <Who from={tail.from} ts={tail.ts} right={tail.from === 'you'} />
                <Bubble><Prose text={tail.text} /></Bubble>
              </div>
            )}
            {editing && (
              <CardEditor
                t={t} busy={doing === 'edit'}
                onClose={() => setEditing(false)}
                onSave={(card) => act('edit',
                  () => editTicket(hostKey!, t.id, card), () => setEditing(false))}
              />
            )}
            {asking === 'delete' && (
              <div style={{
                borderRadius: R.card, background: C.dangerBg, border: `1px solid ${C.dangerLine}`,
                padding: 12, marginRight: 32, display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <span style={{ fontSize: 13.5, lineHeight: '20px', color: C.text }}>
                  Delete #{t.id} and everything the queue wrote down about it? A branch with
                  work nobody merged is kept — the queue says so when it does.
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Act label="Keep it" onClick={() => setAsking(null)} />
                  <Act label={doing === 'delete' ? 'Deleting…' : 'Delete it'} danger busy={!!doing}
                    onClick={() => act('delete', () => deleteTicket(hostKey!, t.id),
                      () => { setAsking(null); onClose(); })} />
                </div>
              </div>
            )}
            {!!said && (
              <div style={{ ...mono, fontSize: 11.5, color: C.mute, marginRight: 32 }}>
                {said}
              </div>
            )}
            {hasDetails(t) && <Details t={t} />}
          </div>
        </div>

        <Composer t={t} hostKey={hostKey} busy={busy} error={error} onSend={send} />
      </div>
    </div>
  );
}
