/** One ticket (HANDOVER §4.4).
 *
 *  Two columns. The main one is the human face in a ~560px column — the status,
 *  `#no · column`, the title and the two or three sentences a person wrote —
 *  then, when the agent is asking, its question in an amber-edged card with the
 *  answers it offers; then Live, the latest steps of the run as a mono time and
 *  a sentence, with the one line you can say into it; then the Agent face, shut
 *  (`<details>`): Goal, Done when, Test, Files. The side column is Column,
 *  Executor, Machine, Branch, Runs alone and Opened, and under it what can be
 *  done to the queue's ticket — the buttons the wall's ticket window has.
 *
 *  **No agent text on the human face.** The title and the sentences are
 *  `human()`, which reads those two fields and nothing else; the brief is
 *  `brief()` and lives behind the Agent face. The agent's question is the one
 *  thing an agent wrote that is on the page open, because it is addressed to
 *  the reader and the page exists to answer it. Live is the run's own steps.
 *
 *  The brief and the queue's ticket come from the machine that holds the card,
 *  asked for when the page opens and again when the board says the card has
 *  changed. Until they come the page is what the board already holds.
 *
 *  `Runs alone` is drawn as `off` with no switch: the daemon keeps no such
 *  setting on a card or a ticket yet, so there is nothing a switch could send.
 */
import { useEffect, useRef, useState } from 'react';
import {
  cancelTicket, cardGet, deleteTicket, editTicket, moveCard, prioritiseTicket, restartTicket, setExecutor,
  ticketNote, updateCard,
} from '../lib/actions';
import { clock, executorWord } from '../lib/overview';
import { status as statusOf } from '../lib/board';
import { short } from '../lib/compose';
import { uptime } from '../lib/format';
import {
  QUEUE_WORD, STEPS_SHOWN, brief, human, question, queueActs, side, steps,
  type QueueAct, type Said,
} from '../lib/ticket';
import { useRun } from '../lib/run';
import { RunLog } from '../components/RunLog';
import { Report } from '../components/Report';
import { MicButton, MicNote, useMic } from '../components/Mic';
import { appendSpeech } from '../lib/dictate';
import { useDivanStore, type MergedCard, type MergedProject } from '../lib/divan';
import type { DivanCardFull, DivanExecutor } from '../lib/protocol';
import type { Ticket as QueueTicket } from '../lib/ustabasi';

/** What came back from the machine that holds the card, and nothing invented
 *  while it is on its way. */
export interface Opened {
  full: DivanCardFull | null;
  ticket: QueueTicket | null;
  error: string | null;
}

const NOTHING: Opened = { full: null, ticket: null, error: null };

/** How much of the sentences under the title a page opens on. */
const SUMMARY_LINES = 7;

const FAILED = 'That did not reach the computer';

export interface TicketProps {
  card: MergedCard;
  project: MergedProject | null;
  index: number;
  now: number;
  onProject: () => void;
  onBranch: (kind: string) => void;
}

/** The page, and the one request it makes. Asked for when the page opens,
 *  again when the board says the card has moved on, and after anything this
 *  page did to the queue. */
export function Ticket(props: TicketProps) {
  const { card } = props;
  const [got, setGot] = useState<Opened>(NOTHING);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let mine = true;
    setGot((was) => ({ ...was, error: null }));
    cardGet(card.host, card.id)
      .then((answer) => {
        if (!mine) return;
        setGot({ full: answer?.card ?? null, ticket: answer?.ticket ?? null, error: null });
      })
      .catch((e) => {
        if (!mine) return;
        setGot({ full: null, ticket: null, error: e?.message ?? FAILED });
      });
    return () => { mine = false; };
  }, [card.host, card.id, card.updated_at, tick]);

  return <TicketPage {...props} opened={got} onChanged={() => setTick((n) => n + 1)} />;
}

/** …and the page itself: a render of what is in hand and nothing else. */
export function TicketPage({
  card, project, now, onProject, onBranch, opened: got = NOTHING, onChanged,
}: TicketProps & { opened?: Opened; onChanged?: () => void }) {
  const [wrote, setWrote] = useState<{ title?: string; summary?: string }>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [whole, setWhole] = useState(false);
  const [long, setLong] = useState(false);
  /** What was said into the run from this page, in its place among the steps. */
  const [said, setSaid] = useState<Said[]>([]);
  const [sayError, setSayError] = useState<string | null>(null);
  /** The question that was answered from here, by the moment it was asked: the
   *  card leaves the asking state the moment the answer has gone, and comes
   *  back only if the board stamps a new question. */
  const [answered, setAnswered] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const say = useRef<HTMLInputElement | null>(null);
  const run = useRun(card.host, card.ustabasi_id);

  const refresh = () => {
    void useDivanStore.getState().load(card.host);
    onChanged?.();
  };

  const write = async (fields: { title?: string; summary?: string }) => {
    setFailed(null);
    setWrote((was) => ({ ...was, ...fields }));
    try {
      await updateCard(card.host, card.id, fields);
      void useDivanStore.getState().load(card.host);
    } catch (e: any) {
      setWrote({});
      setFailed(e?.message ?? FAILED);
    }
  };

  const hand = async (executor: DivanExecutor | null) => {
    setFailed(null);
    try {
      await setExecutor(card.host, card.id, executor);
      void useDivanStore.getState().load(card.host);
    } catch (e: any) {
      setFailed(e?.message ?? FAILED);
    }
  };

  /** The frame's one move off this page: the same drop the board makes into
   *  Queued, for a card that is in progress. */
  const requeue = async () => {
    setFailed(null);
    try {
      await moveCard(card.host, card.id, 'queued');
      refresh();
    } catch (e: any) {
      setFailed(e?.message ?? FAILED);
    }
  };

  /** One sentence into the run: the queue's note, which is the live channel the
   *  ticket chat has always used. It is on Live the moment it is sent, and off
   *  it again if the machine would not take it. */
  const tell = async (words: string): Promise<boolean> => {
    if (card.ustabasi_id == null) return false;
    const mine: Said = { id: `said-${Date.now()}`, at: Date.now() / 1000, text: words };
    setSaid((list) => [...list, mine]);
    setSayError(null);
    setSending(true);
    try {
      await ticketNote(card.host, card.ustabasi_id, words);
      refresh();
      return true;
    } catch (e: any) {
      setSaid((list) => list.filter((s) => s.id !== mine.id));
      setSayError(e?.message ?? FAILED);
      return false;
    } finally {
      setSending(false);
    }
  };

  const face = human(card);
  const ask = question(card, got.ticket);
  const askedAt = `${card.agent_status}:${card.agent_status_at ?? ''}`;
  const asking = !!ask && answered !== askedAt;
  const st = statusOf(card);
  const lines = steps(run.turns, said, run.stamps, run.live, got.ticket);
  const rows = side(card, now, uptime);
  const label = project?.name ?? card.machine;

  return (
    <div className="dv-cols2 dv-ticket" data-ticket={card.id}>
      <main>
        <section data-human="">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* An answer sent from here is the end of the asking, whatever the
                board says until it is read again. */}
            {ask && !asking
              ? <span className="dv-status dv-status--idle" data-status="answered"><i />answered</span>
              : !!st && <span className={`dv-status dv-status--${st.kind}`} data-status={st.word}><i />{st.word}</span>}
            <span className="dv-meta">
              <a href={project ? `/p/${encodeURIComponent(project.key)}` : '#'} className="dv-link"
                onClick={(e) => { e.preventDefault(); onProject(); }}>{label}</a>
              {card.ustabasi_id != null ? ` · #${card.ustabasi_id}` : ''}
              {` · ${rows[0].value}`}
            </span>
          </div>
          <h1 className="dv-ticket-title">
            <Writable value={wrote.title ?? face.title} label="the card's title"
              onSave={(text) => void write({ title: text })} />
          </h1>
          <div className="dv-ticket-body">
            <Writable
              value={wrote.summary ?? (face.bare ? '' : face.summary)}
              placeholder="Nobody has written the sentences for this one yet."
              label="what this card is about" multiline
              onSave={(text) => void write({ summary: text })}
              clamp={whole ? null : SUMMARY_LINES} onOverflow={setLong}
            />
            {long && (
              <button type="button" className="dv-btn dv-btn--ghost dv-hit" style={{ marginTop: 4, paddingLeft: 0 }}
                onClick={() => setWhole((w) => !w)}>{whole ? 'Show less' : 'Read all'}</button>
            )}
          </div>
          {!!failed && <p className="dv-meta" style={{ margin: '8px 0 0', color: 'var(--red)' }}>not saved · {failed}</p>}
        </section>

        {asking && ask && (
          <article className={`dv-glass dv-wait dv-ask${ask.stuck ? ' dv-ask--stuck' : ''}`} data-asking="">
            <div className="dv-wait-head">
              <span style={{ fontSize: 12.5, fontWeight: 500, color: ask.stuck ? 'var(--red)' : 'var(--amber)' }}>
                {ask.stuck ? 'The agent stopped' : 'The agent is asking'}
              </span>
              {card.agent_status_at != null && (
                <span className="dv-meta" style={{ marginLeft: 'auto' }}>{short(now - card.agent_status_at)}</span>
              )}
            </div>
            <p className="dv-wait-q">{ask.text}</p>
            {card.ustabasi_id != null && (
              <div className="dv-wait-actions">
                {ask.answers.map((words, i) => (
                  <button key={words} type="button" disabled={sending}
                    className={`dv-btn dv-hit${i === 0 ? ' dv-btn--amber' : ''}`}
                    onClick={async () => { if (await tell(words)) setAnswered(askedAt); }}>{words}</button>
                ))}
                <button type="button" className={`dv-btn dv-hit${ask.answers.length ? ' dv-btn--ghost' : ''}`}
                  onClick={() => say.current?.focus()}>Reply</button>
              </div>
            )}
          </article>
        )}

        <section aria-labelledby="t-live" data-live="">
          <div className="dv-sec">
            <h3 id="t-live">Live</h3>
            <span className="dv-meta">{[executorWord(card.executor), card.machine].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="dv-glass dv-livebox">
            {lines.length ? lines.slice(-STEPS_SHOWN).map((l) => (
              <div key={l.id} className="dv-live" data-step={l.mine ? 'mine' : l.now ? 'now' : ''}>
                <span className="dv-meta dv-step-at">{l.at == null ? '' : clock(l.at)}</span>
                <span className="t" style={{ color: l.now || l.mine ? 'var(--ink)' : 'var(--ink-2)' }}>
                  {l.text}{l.now ? ' · now' : ''}
                </span>
              </div>
            )) : (
              <p className="dv-livebox-quiet">
                {card.ustabasi_id == null
                  ? 'Nothing runs on this card yet. Moving it into In Progress with a coding agent on it is what starts a worker.'
                  : run.loading ? 'Reading the run…' : `Nothing has come back from ${card.machine} about this run yet.`}
              </p>
            )}
            {card.ustabasi_id != null ? (
              <SayBox inputRef={say} hostKey={card.host} busy={sending}
                onSend={(text) => tell(text)} />
            ) : (
              <p className="dv-meta" style={{ margin: '10px 4px 0' }}>
                no ticket behind this card, so there is nothing to send a sentence to
              </p>
            )}
            {!!sayError && <p className="dv-meta" style={{ margin: '8px 4px 0', color: 'var(--red)' }}>not sent · {sayError}</p>}
          </div>
          {card.ustabasi_id != null && run.turns.length > 0 && (
            <details className="dv-run" style={{ marginTop: 10 }}>
              <summary className="dv-btn dv-btn--ghost dv-hit">The whole run</summary>
              <div style={{ marginTop: 10 }}><RunLog run={run} hostKey={card.host} /></div>
            </details>
          )}
        </section>

        {/* What the ticket came back with — the documents it wrote, read. */}
        {card.ustabasi_id != null && (
          <Report host={card.host} ticket={card.ustabasi_id} status={card.agent_status ?? ''} />
        )}

        <AgentFace got={got} machine={card.machine} />
      </main>

      <aside>
        <Side card={card} rows={rows} onHand={(x) => void hand(x)} onBranch={() => onBranch(card.branch)} />
        {(card.column === 'in_progress' || card.column === 'review') && (
          <button type="button" className="dv-btn dv-btn--ghost dv-hit" onClick={() => void requeue()}>Move back to Queued</button>
        )}
        {card.ustabasi_id != null && (
          <Queue host={card.host} id={card.ustabasi_id} ticket={got.ticket} onChanged={refresh} />
        )}
      </aside>
    </div>
  );
}

/** The one line you can say into a run: a labelled field, the microphone and
 *  the send button, in the pill the frame draws. */
function SayBox({ inputRef, hostKey, busy, onSend }: {
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  hostKey: string;
  busy: boolean;
  onSend: (text: string) => Promise<boolean>;
}) {
  const [words, setWords] = useState('');
  const latest = useRef(words);
  latest.current = words;
  const mic = useMic({ hostKey, onCommit: (chunk) => setWords(appendSpeech(latest.current, chunk)) });
  const shown = mic.interim ? appendSpeech(words, mic.interim) : words;
  const send = async () => {
    if (mic.state !== 'idle') { mic.stop(); return; }
    const text = words.trim();
    if (!text || busy) return;
    setWords('');
    if (!(await onSend(text))) setWords(text);
  };
  return (
    <>
      <form className="dv-say" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label htmlFor="t-say" className="dv-hidden">Say one sentence to the agent</label>
        <input id="t-say" ref={inputRef} value={shown} autoComplete="off"
          placeholder={mic.state === 'listening' ? 'Listening…' : 'Say one sentence to the agent'}
          onChange={(e) => setWords(e.target.value)} />
        <MicButton mic={mic} size={34} />
        <button type="submit" className="dv-send" aria-label="Send" disabled={busy || (!words.trim() && mic.state === 'idle')}
          style={{ width: 34, height: 34 }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
        </button>
      </form>
      <MicNote mic={mic} />
    </>
  );
}

/** The brief, shut: Goal, Done when, Test, Files — and the constraints and
 *  notes where the card has any. A machine that would not hand it over and a
 *  card with none both say so inside it. */
function AgentFace({ got, machine }: { got: Opened; machine: string }) {
  const said = brief(got.full, got.ticket);
  const loading = !got.full && !got.error;
  return (
    <details className="dv-glass dv-agent" data-agent-face="">
      <summary className="dv-hit">
        <span>Agent face</span>
        <span className="dv-meta" style={{ marginLeft: 'auto' }}>goal, done when, tests, files</span>
      </summary>
      {got.error ? (
        <p className="dv-agent-quiet">{machine} did not hand the agent face over: {got.error}</p>
      ) : loading ? (
        <p className="dv-agent-quiet">Asking {machine} for it…</p>
      ) : said.empty ? (
        <p className="dv-agent-quiet">Nobody has written an agent face for this one yet.</p>
      ) : (
        <dl>
          <dt>Goal</dt><dd>{said.goal || '—'}</dd>
          <dt>Done when{said.passed ? ` · ${said.passed}` : ''}</dt>
          <dd>
            {said.criteria.length ? (
              <ul>
                {said.criteria.map((c, i) => (
                  <li key={i}>
                    {c.met != null && (
                      <span className="dv-meta" style={{ color: c.met ? 'var(--run)' : 'var(--red)', marginRight: 6 }}>
                        {c.met ? 'met' : 'not met'}
                      </span>
                    )}
                    {c.text}
                  </li>
                ))}
              </ul>
            ) : '—'}
          </dd>
          <dt>Test</dt><dd className="mono">{said.verify || '—'}</dd>
          <dt>Files</dt>
          <dd className="mono">{said.paths.length ? said.paths.map((f) => <div key={f}>{f}</div>) : '—'}</dd>
          {!!said.constraints.length && (
            <><dt>Constraints</dt><dd>{said.constraints.map((c, i) => <div key={i}>{c}</div>)}</dd></>
          )}
          {!!said.notes && <><dt>Notes</dt><dd>{said.notes}</dd></>}
        </dl>
      )}
    </details>
  );
}

/** Who a card can be handed to: the three a board offers, and Nobody, which
 *  is a value rather than the absence of one. A branch agent is named by its
 *  branch and is handed from the branch page. */
const HANDS: { executor: DivanExecutor | null }[] = [
  { executor: 'coding_agent' }, { executor: 'assistant' }, { executor: 'human' }, { executor: null },
];

/** The side column: six rows, and Executor and Branch can be pressed. */
function Side({ card, rows, onHand, onBranch }: {
  card: MergedCard;
  rows: ReturnType<typeof side>;
  onHand: (executor: DivanExecutor | null) => void;
  onBranch: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="dv-glass dv-side" data-side="">
      {rows.map((r) => {
        const value = (
          <>
            <span className={r.mono ? 'dv-meta v' : 'v'}>{r.value}</span>
            {!!r.note && <span className="dv-meta n">{r.note}</span>}
          </>
        );
        if (r.key === 'executor') {
          return (
            <div key={r.key} className="dv-side-row" style={{ position: 'relative' }}>
              <span className="l" id="t-executor">{r.label}</span>
              <button type="button" className="dv-side-press dv-hit" aria-haspopup="menu" aria-expanded={open}
                aria-labelledby="t-executor t-executor-v" title="Hand this card to somebody else"
                onClick={() => setOpen((o) => !o)}>
                <span id="t-executor-v" className="v">{r.value}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {open && (
                <div className="dv-menu" role="menu" aria-label="Who does this one" style={{ left: 'auto', right: 0 }}>
                  {HANDS.map((h) => (
                    <button key={h.executor ?? 'nobody'} type="button" role="menuitemradio"
                      aria-checked={h.executor === card.executor}
                      onClick={() => { setOpen(false); onHand(h.executor); }}>
                      <span>{executorWord(h.executor)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        }
        if (r.key === 'branch') {
          return (
            <div key={r.key} className="dv-side-row">
              <span className="l">{r.label}</span>
              <button type="button" className="dv-side-press dv-hit" onClick={onBranch}
                title={`Everything on ${r.value}`}>{value}</button>
            </div>
          );
        }
        if (r.key === 'alone') {
          return (
            <div key={r.key} className="dv-side-row" data-row="alone">
              <span className="l">{r.label}</span>
              <span className="v">{r.value}</span>
              <span className="dv-meta n">not settable yet</span>
            </div>
          );
        }
        return (
          <div key={r.key} className="dv-side-row" data-row={r.key}>
            <span className="l">{r.label}</span>
            {value}
          </div>
        );
      })}
    </div>
  );
}

/** What can be done to the queue's ticket behind the card: the wall's ticket
 *  window's own buttons (`components/TicketChat.tsx`), by the same rule. Each
 *  asks the queue and puts its sentence on the page, the refusal included.
 *  Deleting asks first, on the page. */
function Queue({ host, id, ticket, onChanged }: {
  host: string; id: number; ticket: QueueTicket | null; onChanged: () => void;
}) {
  const [doing, setDoing] = useState<QueueAct | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const acts = queueActs(ticket?.status);
  if (!ticket) return null;

  const act = async (what: QueueAct, go: () => Promise<{ message?: string }>, after?: () => void) => {
    if (doing) return;
    setDoing(what);
    setError(null);
    setSaid(null);
    try {
      const r = await go();
      setSaid((r?.message || '').trim() || `${QUEUE_WORD[what]} — done`);
      after?.();
      onChanged();
    } catch (e: any) {
      setError(e?.message || `the queue refused to ${QUEUE_WORD[what].toLowerCase()}`);
    } finally {
      setDoing(null);
    }
  };

  const press = (what: QueueAct) => {
    if (what === 'edit') { setDeleting(false); setEditing((e) => !e); return; }
    if (what === 'delete') { setEditing(false); setDeleting((d) => !d); return; }
    const go = what === 'stop' ? () => cancelTicket(host, id)
      : what === 'next' ? () => prioritiseTicket(host, id)
      : () => restartTicket(host, id);
    void act(what, go);
  };

  return (
    <section aria-labelledby="t-queue" data-queue="">
      <div className="dv-sec"><h3 id="t-queue">The queue's ticket</h3><span className="dv-meta">#{id} · {ticket.status}</span></div>
      <div className="dv-wait-actions">
        {acts.map((a) => (
          <button key={a} type="button" disabled={!!doing}
            className={`dv-btn dv-hit${a === 'stop' || a === 'delete' ? ' dv-btn--ghost dv-btn--danger' : ''}`}
            aria-expanded={a === 'edit' ? editing : a === 'delete' ? deleting : undefined}
            onClick={() => press(a)}>{doing === a ? `${QUEUE_WORD[a]}…` : QUEUE_WORD[a]}</button>
        ))}
      </div>
      {editing && (
        <Editor ticket={ticket} busy={doing === 'edit'} onClose={() => setEditing(false)}
          onSave={(card) => void act('edit', () => editTicket(host, id, card), () => setEditing(false))} />
      )}
      {deleting && (
        <div className="dv-glass dv-confirm" role="group" aria-label={`Delete #${id}`}>
          <p>Delete #{id} and everything the queue wrote down about it? A branch with work nobody merged is kept — the queue says so when it does.</p>
          <div className="dv-wait-actions">
            <button type="button" className="dv-btn dv-hit" onClick={() => setDeleting(false)}>Keep it</button>
            <button type="button" className="dv-btn dv-btn--ghost dv-btn--danger dv-hit" disabled={!!doing}
              onClick={() => void act('delete', () => deleteTicket(host, id), () => setDeleting(false))}>
              {doing === 'delete' ? 'Deleting…' : 'Delete it'}
            </button>
          </div>
        </div>
      )}
      {!!said && <p className="dv-meta" style={{ margin: '10px 4px 0' }}>{said}</p>}
      {!!error && <p className="dv-meta" style={{ margin: '10px 4px 0', color: 'var(--red)' }}>{error}</p>}
    </section>
  );
}

/** What a ticket asks for, open for rewriting: one criterion a line, because a
 *  verifier answers them one by one. */
function Editor({ ticket, busy, onSave, onClose }: {
  ticket: QueueTicket; busy: boolean;
  onSave: (card: { title: string; goal: string; done_criteria: string[]; verify_cmd: string }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(ticket.title);
  const [goal, setGoal] = useState(ticket.goal);
  const [criteria, setCriteria] = useState((ticket.done_criteria || []).join('\n'));
  const [verify, setVerify] = useState(ticket.verify_cmd || '');
  const lines = criteria.split('\n').map((c) => c.trim()).filter(Boolean);
  return (
    <form className="dv-glass dv-editor" onSubmit={(e) => {
      e.preventDefault();
      onSave({ title: title.trim(), goal: goal.trim(), done_criteria: lines, verify_cmd: verify.trim() });
    }}>
      <div className="dv-field"><label htmlFor="q-title">Ticket title</label>
        <input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="dv-field"><label htmlFor="q-goal">Goal</label>
        <textarea id="q-goal" rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} /></div>
      <div className="dv-field"><label htmlFor="q-done">Done criteria, one a line</label>
        <textarea id="q-done" rows={4} value={criteria} onChange={(e) => setCriteria(e.target.value)} /></div>
      <div className="dv-field"><label htmlFor="q-verify">Verify command</label>
        <input id="q-verify" value={verify} onChange={(e) => setVerify(e.target.value)} /></div>
      <div className="dv-wait-actions" style={{ alignItems: 'center' }}>
        <span className="dv-meta" style={{ marginRight: 'auto' }}>
          {lines.length} {lines.length === 1 ? 'criterion' : 'criteria'}
        </span>
        <button type="button" className="dv-btn dv-btn--ghost dv-hit" onClick={onClose}>Cancel</button>
        <button type="submit" className="dv-btn dv-btn--primary dv-hit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

/** Make a field exactly as tall as what is in it, so pressing the text to
 *  correct it does not move the page. */
function fit(el: HTMLTextAreaElement | HTMLInputElement | null): void {
  if (!el || !(el instanceof HTMLTextAreaElement)) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/** A card's face, written in place: press, type, Enter — or ⌘Enter where there
 *  are several lines — and Escape puts back what was there. It reads as text
 *  until it is pressed. */
function Writable({ value, placeholder, label, multiline, onSave, clamp, onOverflow }: {
  value: string;
  placeholder?: string;
  label: string;
  multiline?: boolean;
  onSave: (text: string) => void;
  clamp?: number | null;
  onOverflow?: (over: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const field = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const view = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { if (!editing) setText(value); }, [value, editing]);
  useEffect(() => {
    if (!editing) return;
    field.current?.focus();
    fit(field.current);
  }, [editing]);
  useEffect(() => {
    if (!onOverflow || !clamp) return;
    const el = view.current;
    onOverflow(!!el && el.scrollHeight - el.clientHeight > 1);
  }, [value, clamp, editing, onOverflow]);

  const done = () => {
    const words = text.trim();
    setEditing(false);
    if (words === value.trim()) return;
    onSave(words);
  };
  const stop = () => { setText(value); setEditing(false); };

  if (editing) {
    return multiline ? (
      <textarea
        ref={field as any} value={text} aria-label={label} className="dv-writing" rows={1}
        onChange={(e) => { setText(e.target.value); fit(e.currentTarget); }}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); stop(); }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); done(); }
        }}
      />
    ) : (
      <input
        ref={field as any} type="text" value={text} aria-label={label} className="dv-writing"
        onChange={(e) => setText(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); stop(); }
          if (e.key === 'Enter') { e.preventDefault(); done(); }
        }}
      />
    );
  }

  return (
    <button
      ref={view} type="button" className="dv-writable" onClick={() => setEditing(true)} title={`Write ${label}`}
      data-empty={value ? undefined : 'true'}
      style={clamp ? { display: '-webkit-box', WebkitLineClamp: clamp, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}
    >{value || placeholder || `Write ${label}`}</button>
  );
}
