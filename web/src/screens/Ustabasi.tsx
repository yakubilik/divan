import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C, R } from '../lib/theme';
import { Btn, Dot, Empty, Icon, P, Spinner, mono } from '../ui/kit';
import { Modal, ModalHead } from '../components/Modal';
import { useFleet } from '../lib/fleet';
import { ago, duration } from '../lib/format';
import type { Group } from '../lib/ustabasi';
import { commitCount, groupByProject, roundAge, stageLine, totalAge } from '../lib/ustabasi';

/** The ustabasi wall: the same question terminal mode asks of chats — what is
 *  happening — asked of the work that runs without anyone watching.
 *
 *  A ticket queue on the computer hands its tickets to a worker, a check and an
 *  independent verifier, and the loop runs for hours with nobody in the room.
 *  That is the point of it, and also its one failure: when a worker stops to
 *  ask something only a person can answer, the ticket goes red and stays red
 *  until someone notices. This screen is the noticing. Red sorts to the top,
 *  and a red tile is the only one you can type into.
 *
 *  The cards are grouped by project, one column each, because "what is
 *  happening" is asked about a project and not about a queue. And each card
 *  answers it with counted things only — how long it has been open, how long
 *  this round has been going, whose hands it is in, what is on the branch. No
 *  percentage: nothing in the queue knows how far along a ticket is, so a bar
 *  would be a drawing of a guess.
 *
 *  Nothing here is a second source of truth. The daemon reads the queue's own
 *  database, and the one write — answering a ticket — is that queue's CLI run
 *  by the daemon, so a note from this screen and a note from a terminal are
 *  the same note.
 */

type Status = 'queued' | 'running' | 'done' | 'blocked' | 'failed' | 'cancelled';

/** The phase colours are terminal mode's, deliberately: the two warm ones mean
 *  the same thing on both walls. Amber wants an answer from you — an approval
 *  there, a blocked ticket here. Red went wrong on its own. Everything working
 *  is the cool blue, so that on a wall of twenty tiles the eye still goes to
 *  the two that need a person. */
const STATUS: Record<Status, { label: string; color: string; rgb: string }> = {
  running: { label: 'running', color: C.info, rgb: '125,154,209' },
  blocked: { label: 'needs an answer', color: C.warn, rgb: '216,166,87' },
  failed: { label: 'failed', color: C.danger, rgb: '224,83,63' },
  done: { label: 'done', color: C.ok, rgb: '92,126,79' },
  queued: { label: 'queued', color: C.faint, rgb: '110,104,96' },
  cancelled: { label: 'cancelled', color: C.faint, rgb: '110,104,96' },
};

const FILTERS: { key: Status | 'all'; label: string; color: string }[] = [
  { key: 'all', label: 'All', color: C.text2 },
  { key: 'blocked', label: 'Needs an answer', color: STATUS.blocked.color },
  { key: 'failed', label: 'Failed', color: STATUS.failed.color },
  { key: 'running', label: 'Running', color: STATUS.running.color },
  { key: 'queued', label: 'Queued', color: STATUS.queued.color },
  { key: 'done', label: 'Done', color: STATUS.done.color },
];

/** A ticket you can talk to. The queue re-opens a blocked or failed ticket the
 *  moment a note lands; a running one takes the note at its next stage
 *  boundary, which is useful but not urgent, so the box is offered only where
 *  the ticket is actually stopped waiting for it. */
function answerable(s: Status): boolean {
  return s === 'blocked' || s === 'failed';
}

interface Criterion { criterion: string; status: string; detail?: string }
interface Verdict { verdict?: string; findings?: Criterion[] }

export interface Ticket {
  id: number;
  title: string;
  status: Status;
  stage: string;
  round: number;
  repo: string;
  /** the project this is work on, by name: a ticket in babysee/app is babysee */
  project: string | null;
  branch: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  /** when the round it is in began, which the queue's tickets table does not hold */
  round_started_at: number | null;
  finished_at: number | null;
  /** what the worker has committed on the branch; null when there is nothing to say */
  git: { commits: number; subject: string } | null;
  goal: string;
  done_criteria: string[];
  escalation: string;
  verdict: Verdict | null;
  notes: { ts: number; from: string; text: string }[];
  note_count: number;
  last_event: { ts: number; kind: string; msg: string } | null;
}

interface Snapshot {
  available: boolean;
  tickets: Ticket[];
  queue: { last_tick?: number | null; paused_until?: number | null };
}

/** How often the wall re-reads the queue. The supervisor ticks every five
 *  minutes, so a second would be pointless; a minute would mean answering a
 *  ticket and watching a stale tile insist it is still red. */
const POLL_MS = 8000;

/** The supervisor stamps a heartbeat at the start of every tick. Older than
 *  this and the queue is not ticking, whatever the tiles say. */
const TICK_STALE_S = 10 * 60;

function first(text: string, n: number): string {
  const t = text.trim();
  if (t.length <= n) return t;
  return t.slice(0, n).replace(/\s+\S*$/, '') + '…';
}

// ── one tile ─────────────────────────────────────────────────────────────────

function Tile({ t, now, onOpen }: { t: Ticket; now: number; onOpen: () => void }) {
  const [hot, setHot] = useState(false);
  const ph = STATUS[t.status] || STATUS.queued;
  const round = roundAge(t, now);
  const commits = commitCount(t);
  const wants = answerable(t.status);

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      style={{
        display: 'flex', flexDirection: 'column', minWidth: 0, cursor: 'pointer',
        borderRadius: R.card, overflow: 'hidden', background: C.surface,
        border: `1px solid ${wants ? `rgba(${ph.rgb},0.45)` : hot ? C.borderStrong : C.border}`,
        boxShadow: wants ? `0 0 0 1px rgba(${ph.rgb},0.18)` : 'none',
        transition: 'border-color 120ms, box-shadow 120ms',
      }}
    >
      {/* The title bar of the window this ticket would be, washed in its
          colour — the wall is read by hue from across the room. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
        background: `rgba(${ph.rgb},0.10)`, borderBottom: `1px solid rgba(${ph.rgb},0.20)`,
      }}>
        <Dot color={ph.color} live={t.status === 'running'} size={7} />
        <span style={{ ...mono, fontSize: 12, color: ph.color, fontWeight: 600 }}>#{t.id}</span>
        <span style={{
          flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{t.title}</span>
        <span style={{ ...mono, fontSize: 11, color: C.mute, flexShrink: 0 }}>{ph.label}</span>
      </div>

      <div style={{ padding: '11px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        {wants && t.escalation ? (
          <div style={{
            fontSize: 12.5, lineHeight: '18px', color: C.text2, whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>{first(t.escalation, 260)}</div>
        ) : (
          <div style={{ fontSize: 12.5, lineHeight: '18px', color: C.mute, wordBreak: 'break-word' }}>
            {first(t.last_event?.msg || t.goal || '', 200) || 'no events yet'}
          </div>
        )}

        {/* How long it has been a ticket, first and on its own: it is the
            figure anybody means by "how long has this been going", and the
            smaller one underneath used to be read as it. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <div style={{ ...mono, fontSize: 12, color: C.text2 }}>{totalAge(t, now)}</div>
          <div style={{
            ...mono, fontSize: 11, color: C.faint, display: 'flex', gap: 6,
            flexWrap: 'wrap', alignItems: 'center',
          }}>
            <span>{stageLine(t)}</span>
            {round && <span>· {round}</span>}
            {commits && <span>· {commits}</span>}
            {t.note_count > 0 && <span>· {t.note_count} {t.note_count === 1 ? 'note' : 'notes'}</span>}
          </div>
          {t.git?.subject && (
            <div style={{ display: 'flex', gap: 6, minWidth: 0, alignItems: 'baseline' }}>
              <span style={{ ...mono, fontSize: 11, color: C.faint, flexShrink: 0 }}>last</span>
              <span style={{
                fontSize: 12, color: C.mute, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{t.git.subject}</span>
            </div>
          )}
        </div>

        {wants && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
            height: 24, padding: '0 10px', borderRadius: R.chip, fontSize: 12, fontWeight: 600,
            background: `rgba(${ph.rgb},0.16)`, color: ph.color,
          }}>
            <Icon path={P.chevronRight} size={13} color={ph.color} />
            Answer it
          </div>
        )}
      </div>
    </div>
  );
}

// ── the wall's columns ───────────────────────────────────────────────────────

/** One column per project, the reddest first.
 *
 *  The columns are a wrapping grid rather than a row of fixed ones, so the same
 *  wall is four columns on a desk and a single column on a phone held upright,
 *  with nothing to scroll sideways. A column is as narrow as the screen when the
 *  screen is narrow — that is what `min(100%, 340px)` is for — and every box in
 *  here can shrink (`minWidth: 0`), which is what keeps a long branch name or a
 *  long commit subject from pushing the page wider than the phone.
 */
export function Wall({ groups, now, onOpen }: {
  groups: Group<Ticket>[]; now: number; onOpen: (id: number) => void;
}) {
  return (
    <div style={{
      display: 'grid', gap: 18, alignItems: 'start',
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))',
    }}>
      {groups.map((g) => (
        <section key={g.project} style={{
          display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
        }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0,
            paddingBottom: 7, borderBottom: `1px solid ${C.border}`,
          }}>
            <span style={{
              fontSize: 13.5, fontWeight: 600, color: C.text, minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{g.project}</span>
            <span style={{ ...mono, fontSize: 11, color: C.faint, flexShrink: 0 }}>
              {g.tickets.length}
            </span>
          </div>
          {g.tickets.map((t) => (
            <Tile key={t.id} t={t} now={now} onOpen={() => onOpen(t.id)} />
          ))}
        </section>
      ))}
    </div>
  );
}

// ── the opened ticket ────────────────────────────────────────────────────────

function Detail({ t, onClose, onNote }: {
  t: Ticket; onClose: () => void; onNote: (text: string) => Promise<string>;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const ph = STATUS[t.status] || STATUS.queued;
  const wants = answerable(t.status);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(null);
    try {
      setSent(await onNote(text));
      setDraft('');
    } catch (e: any) {
      setErr(e?.message || 'the queue refused that note');
    } finally {
      setBusy(false);
    }
  }, [draft, busy, onNote]);

  return (
    <Modal onClose={onClose} width={720}>
      <ModalHead title={`#${t.id} ${t.title}`} onClose={onClose} />
      <div style={{ padding: '4px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <div style={{ ...mono, fontSize: 11.5, color: C.faint, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ color: ph.color, fontWeight: 600 }}>{ph.label}</span>
          <span>· {t.stage} r{t.round}</span>
          <span>· {t.repo.split('/').slice(-1)[0]}</span>
          {t.branch && <span>· {t.branch}</span>}
          <span>· {ago(t.updated_at)}</span>
        </div>

        {/* The question first. On a red ticket nothing else on this screen
            matters until it is answered. */}
        {wants && t.escalation && (
          <section style={{
            padding: 14, borderRadius: R.card, background: `rgba(${ph.rgb},0.08)`,
            border: `1px solid rgba(${ph.rgb},0.28)`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: ph.color, marginBottom: 8, letterSpacing: 0.3 }}>
              WHAT IT IS WAITING FOR
            </div>
            <div style={{
              fontSize: 13, lineHeight: '20px', color: C.text2,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>{t.escalation}</div>
          </section>
        )}

        {wants && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea
              name={`ustabasi-note-${t.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
              placeholder="Answer the worker. This is the same as `ustabasi note` — the ticket goes back in the queue with it."
              rows={5}
              style={{
                width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: R.input,
                background: C.surface2, border: `1px solid ${C.border}`, color: C.text,
                fontSize: 13, lineHeight: '20px', outline: 'none', resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Btn kind="primary" onClick={send} disabled={busy || !draft.trim()}>
                {busy ? 'Sending…' : 'Send and re-queue'}
              </Btn>
              <span style={{ ...mono, fontSize: 11, color: C.faint }}>⌘↵</span>
              {err && <span style={{ fontSize: 12.5, color: C.danger }}>{err}</span>}
              {sent && !err && <span style={{ fontSize: 12.5, color: C.ok }}>{sent}</span>}
            </div>
          </section>
        )}

        {t.goal && (
          <section>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.mute, marginBottom: 8, letterSpacing: 0.3 }}>
              GOAL
            </div>
            <div style={{ fontSize: 13, lineHeight: '20px', color: C.text2, whiteSpace: 'pre-wrap' }}>
              {t.goal}
            </div>
          </section>
        )}

        {t.done_criteria.length > 0 && (
          <section>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.mute, marginBottom: 8, letterSpacing: 0.3 }}>
              DONE WHEN
            </div>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {t.done_criteria.map((c, i) => {
                // The verifier answers the criteria in order but writes its own
                // wording for each, so the mark comes from its list by position.
                const f = t.verdict?.findings?.[i];
                const met = f?.status === 'met';
                return (
                  <li key={i} style={{ fontSize: 13, lineHeight: '20px', color: C.text2 }}>
                    {f && (
                      <span style={{
                        ...mono, fontSize: 11, marginRight: 6,
                        color: met ? C.ok : C.warn,
                      }}>{met ? '✓' : '✗'}</span>
                    )}
                    {c}
                    {f && !met && f.detail && (
                      <div style={{ fontSize: 12, lineHeight: '18px', color: C.mute, marginTop: 4 }}>
                        {first(f.detail, 400)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {!wants && t.escalation && (
          <section>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.mute, marginBottom: 8, letterSpacing: 0.3 }}>
              LAST REPORT
            </div>
            <div style={{ fontSize: 13, lineHeight: '20px', color: C.text2, whiteSpace: 'pre-wrap' }}>
              {t.escalation}
            </div>
          </section>
        )}

        {t.notes.length > 0 && (
          <section>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.mute, marginBottom: 8, letterSpacing: 0.3 }}>
              NOTES
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {t.notes.map((n, i) => (
                <div key={i} style={{
                  padding: 10, borderRadius: R.btn, background: C.surface2,
                  fontSize: 12.5, lineHeight: '19px', color: C.text2, whiteSpace: 'pre-wrap',
                }}>
                  <span style={{ ...mono, fontSize: 11, color: C.faint, marginRight: 8 }}>
                    {n.from} · {ago(n.ts)}
                  </span>
                  {first(n.text, 600)}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}

// ── the wall ─────────────────────────────────────────────────────────────────

export function Ustabasi({ header }: { header?: React.ReactNode }) {
  const { hosts, focus, call } = useFleet();
  const slot = focus ? hosts[focus] : null;
  const online = slot?.status === 'online';

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [openId, setOpenId] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now() / 1000);
  const loading = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!focus || !online || loading.current) return;
    loading.current = true;
    try {
      setSnap(await call(focus, 'ustabasi.list', {}) as Snapshot);
      setError(null);
    } catch (e: any) {
      // An older daemon has no such handler; say so once and stop guessing.
      setError(e?.message || 'that computer did not answer');
    } finally {
      loading.current = false;
    }
  }, [focus, online, call]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const groups = useMemo(() => {
    const all = snap?.tickets || [];
    return groupByProject(filter === 'all' ? all : all.filter((t) => t.status === filter));
  }, [snap, filter]);
  const shown = useMemo(() => groups.reduce((n, g) => n + g.tickets.length, 0), [groups]);

  const open = openId != null ? (snap?.tickets || []).find((t) => t.id === openId) || null : null;
  const counts = useMemo(() => {
    const c: Partial<Record<Status, number>> = {};
    for (const t of snap?.tickets || []) c[t.status] = (c[t.status] || 0) + 1;
    return c;
  }, [snap]);

  const tickAge = snap?.queue?.last_tick ? now - snap.queue.last_tick : null;
  const stale = tickAge != null && tickAge > TICK_STALE_S;
  const paused = snap?.queue?.paused_until && snap.queue.paused_until > now
    ? new Date(snap.queue.paused_until * 1000) : null;

  const sendNote = useCallback(async (id: number, text: string) => {
    if (!focus) throw new Error('no computer');
    const r = await call(focus, 'ustabasi.note', { id, text }) as { message?: string };
    await load();
    return r?.message || 'note added';
  }, [focus, call, load]);

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: C.bg }}>
      <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.border}`, background: C.bg }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px 10px', flexWrap: 'wrap',
        }}>
          {header}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Ustabasi</span>
            <span style={{ ...mono, fontSize: 12, color: C.faint }}>
              {counts.running || 0} running · {(counts.blocked || 0) + (counts.failed || 0)} red
            </span>
          </div>

          {/* Whether the queue is alive at all. Tiles cannot tell you this:
              a supervisor that died leaves every tile exactly as it was. */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, height: 26, padding: '0 11px',
            borderRadius: R.chip, fontSize: 12.5, whiteSpace: 'nowrap',
            background: C.surface, border: `1px solid ${stale ? C.danger : C.border}`,
            color: stale ? C.danger : C.mute,
          }}>
            <Dot color={stale ? C.danger : C.ok} live={!stale} size={6} />
            {tickAge == null ? 'never ticked'
              : stale ? `silent for ${duration(tickAge * 1000)}`
              : `ticked ${duration(tickAge * 1000)} ago`}
          </span>

          {paused && (
            <span style={{ ...mono, fontSize: 12, color: C.warn }}>
              paused until {paused.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '0 24px 12px', flexWrap: 'wrap' }}>
          {FILTERS.map((f) => {
            const on = filter === f.key;
            const n = f.key === 'all' ? (snap?.tickets || []).length : (counts[f.key] || 0);
            return (
              <button
                key={f.key} type="button" onClick={() => setFilter(f.key)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, height: 26, padding: '0 11px',
                  borderRadius: R.chip, cursor: 'pointer', fontSize: 12.5, fontWeight: 500,
                  background: on ? C.text : 'transparent',
                  border: `1px solid ${on ? C.text : C.border}`,
                  color: on ? C.bg : C.mute,
                }}
              >
                {f.key !== 'all' && <Dot color={on ? C.bg : f.color} size={6} />}
                {f.label}
                <span style={{ ...mono, fontSize: 11, opacity: 0.7 }}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24 }}>
        {!online ? (
          <Empty title="That computer is not connected" hint="The queue lives on the Mac, not in this browser." />
        ) : error ? (
          <Empty title="The queue did not answer" hint={error} />
        ) : !snap ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}><Spinner /></div>
        ) : !snap.available ? (
          <Empty title="No ustabasi queue here" hint="This computer does not run the ticket queue." />
        ) : shown === 0 ? (
          <Empty title="Nothing to show" hint="No ticket in this state." />
        ) : (
          <Wall groups={groups} now={now} onOpen={setOpenId} />
        )}
      </div>

      {open && (
        <Detail
          t={open}
          onClose={() => setOpenId(null)}
          onNote={(text) => sendNote(open.id, text)}
        />
      )}
    </div>
  );
}
