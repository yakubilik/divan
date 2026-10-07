/** The Dashboard (HANDOVER §4.1): a greeting and one line of what is going on,
 *  the Composer, what needs you, and then two rows of badges side by side: the
 *  products, and what is running now.
 *
 *  Every figure on it is counted off the merged boards (`lib/divan.ts`); a
 *  section with nothing in it is not drawn at all — "Needs you" is absent from
 *  the page rather than empty — and a zero is said in words.
 */
import { useState } from 'react';
import type { DivanView, MergedCard, MergedProject } from '../lib/divan';
import { useDivanStore } from '../lib/divan';
import { moveCard, ticketNote } from '../lib/actions';
import { agentRows, age, dormant, freshness, latest, line, staleWords, staleness } from '../lib/overview';
import { useFleet } from '../lib/fleet';
import { sessions, type Session } from '../lib/sessions';
import { greeting, quietFor, short, summary } from '../lib/compose';
import { uptime } from '../lib/format';

export function Dashboard({ view, onProject, onCard, onChat, onWaiting, composer, empty }: {
  view: DivanView;
  /** Everything waiting on you, on a page of its own (HANDOVER §4.6). */
  onWaiting?: () => void;
  onProject: (key: string) => void;
  /** Open a card's own page — the ticket. */
  onCard: (card: MergedCard) => void;
  /** Open a chat that is in the middle of a turn. */
  onChat?: (host: string, chatId: string) => void;
  composer: React.ReactNode;
  /** What to say where there are no products to draw. */
  empty?: React.ReactNode;
}) {
  const said = summary(view);
  const old = staleness(view);
  const waiting = sessions(view);
  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      <div className="dv-page">
        <section style={{ marginTop: 28 }}>
          <h1 className="dv-greet">{greeting(new Date().getHours())}</h1>
          <p className="dv-summary" data-summary="">
            {said.map((s) => (
              <span key={s.key} data-said={s.key}>
                {s.key === 'working' && s.n > 0 && <i className="dv-dot dv-dot--run" aria-hidden="true" />}
                {s.key === 'stuck' && s.n > 0 && <i className="dv-dot dv-dot--stuck" aria-hidden="true" />}
                {s.n > 0 ? <><b>{s.n}</b>{s.text.slice(String(s.n).length)}</> : s.text}
              </span>
            ))}
          </p>
          {!!old && <p className="dv-meta" style={{ margin: '8px 0 0' }}>{staleWords(old, uptime)}</p>}
        </section>

        <div style={{ marginTop: 32 }}>{composer}</div>

        {waiting.length > 0 && (
          <section style={{ marginTop: 40 }} aria-labelledby="needs-you">
            <div className="dv-sec">
              <h3 id="needs-you">Needs you</h3>
              <span className="dv-meta">{waiting.length}</span>
              {!!onWaiting && (
                <a href="/waiting" className="dv-btn dv-btn--ghost dv-hit" style={{ height: 28, textDecoration: 'none' }}
                  onClick={(e) => { e.preventDefault(); onWaiting(); }}>See all</a>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {waiting.map((s) => <Wait key={s.id} session={s} onOpen={() => onCard(s.card)} />)}
            </div>
          </section>
        )}

        <div className="dv-rows">
          <Projects view={view} onProject={onProject} empty={empty} />
          <Running view={view} onCard={onCard} onChat={onChat} />
        </div>
      </div>
    </div>
  );
}

const STATUS: Record<Session['kind'], { cls: string; word: string }> = {
  question: { cls: 'dv-status--ask', word: 'asking' },
  decision: { cls: 'dv-status--ask', word: 'your call' },
  stuck: { cls: 'dv-status--stuck', word: 'stuck' },
  yours: { cls: 'dv-status--idle', word: 'yours' },
};

/** One thing waiting, answered with one press: the answer the worker proposed
 *  first is amber and sends the note the question window always sent
 *  (`ustabasi.note`); Open goes to the ticket. */
export function Wait({ session: s, onOpen }: { session: Session; onOpen: () => void }) {
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = STATUS[s.kind];
  const act = async (what: () => Promise<unknown>, words: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await what();
      setSent(words);
      void useDivanStore.getState().load(s.host);
    } catch (e: any) {
      setError(e?.message ?? 'That did not reach the computer');
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="dv-glass dv-wait" data-wait={s.id}>
      <div className="dv-wait-head">
        <span className="dv-mono dv-mono--sm" aria-hidden="true">{(s.project || '?').charAt(0).toUpperCase()}</span>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)' }}>
          {[s.project, s.card.branch].filter(Boolean).join(' · ')}
        </span>
        <span className={`dv-status ${st.cls}`} style={{ marginLeft: 'auto' }}><i />{st.word}</span>
      </div>
      <p className="dv-wait-q">{s.said}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <div className="dv-wait-actions">
          {s.ticket != null && s.answers.map((words, i) => (
            <button key={words} type="button" className={`dv-btn dv-hit${i === 0 ? ' dv-btn--amber' : ''}`}
              disabled={busy} onClick={() => void act(() => ticketNote(s.host, s.ticket!, words), words)}>
              {words}
            </button>
          ))}
          {s.kind === 'yours' && (
            <button type="button" className="dv-btn dv-hit" disabled={busy}
              onClick={() => void act(() => moveCard(s.host, s.card.id, 'done'), 'marked done')}>Mark done</button>
          )}
          <button type="button" className="dv-btn dv-btn--ghost dv-hit" onClick={onOpen}>Open</button>
        </div>
        <span className="dv-meta" style={{ marginLeft: 'auto' }}>
          {[s.age == null ? '' : short(s.age), s.machine].filter(Boolean).join(' · ')}
        </span>
      </div>
      {!!sent && <span className="dv-meta">sent · {sent}</span>}
      {!!error && <span className="dv-meta" style={{ color: 'var(--red)' }}>not sent · {error}</span>}
    </article>
  );
}

/** A badge per product, in a row that wraps; the dormant ones last and dimmed.
 *  The line a tile used to carry is the badge's tooltip. */
function Projects({ view, onProject, empty }: {
  view: DivanView; onProject: (key: string) => void; empty?: React.ReactNode;
}) {
  if (!view.projects.length) return empty ? <section>{empty}</section> : null;
  const awake = view.projects.filter((p) => !dormant(p, view.now));
  const asleep = view.projects.filter((p) => dormant(p, view.now));
  return (
    <section aria-labelledby="projects">
      <div className="dv-sec">
        <h3 id="projects">Projects</h3>
        <span className="dv-meta">{view.projects.length}{asleep.length ? ` · ${asleep.length} quiet` : ''}</span>
      </div>
      <div className="dv-chips">
        {[...awake, ...asleep].map((p) => (
          <Badge key={p.key} project={p} now={view.now} dim={asleep.includes(p)} onOpen={() => onProject(p.key)} />
        ))}
      </div>
    </section>
  );
}

function Badge({ project: p, now, dim, onOpen }: {
  project: MergedProject; now: number; dim: boolean; onOpen: () => void;
}) {
  const asking = Math.max(0, p.waiting - p.stuck);
  const said = dim ? quietFor(age(p, now) ?? 0, p.counts.queued ?? 0)
    : latest(p.cards) || p.summary || line(p, now);
  return (
    <a className={`dv-glass dv-chip dv-hit${dim ? ' dv-tile--dormant' : ''}`} href={`/p/${encodeURIComponent(p.key)}`}
      title={said} data-tile={p.key} onClick={(e) => { e.preventDefault(); onOpen(); }}>
      <span className="dv-mono dv-mono--sm" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
      <span className="t">{p.name}</span>
      {!!p.stage && <span className="dv-chip-meta">{p.stage}</span>}
      {!!freshness(p) && <span className="dv-chip-meta">{freshness(p)}</span>}
      {p.running > 0 && <span className="count"><i className="dv-dot dv-dot--run" aria-hidden="true" />{p.running}<span className="dv-hidden"> working</span></span>}
      {asking > 0 && <span className="count"><i className="dv-dot dv-dot--ask" aria-hidden="true" />{asking}<span className="dv-hidden"> need you</span></span>}
      {p.stuck > 0 && <span className="count"><i className="dv-dot dv-dot--stuck" aria-hidden="true" />{p.stuck}<span className="dv-hidden"> stuck</span></span>}
    </a>
  );
}

/** Everything in the middle of work, a badge each: the agents on tickets, and
 *  the chats with a turn running. A badge opens the thing it names. Absent when
 *  nothing is running. */
function Running({ view, onCard, onChat }: {
  view: DivanView; onCard: (card: MergedCard) => void; onChat?: (host: string, chatId: string) => void;
}) {
  const hosts = useFleet((s) => s.hosts);
  const rows = agentRows(view);
  const chats = Object.entries(hosts).flatMap(([host, slot]) =>
    (slot?.chats ?? []).filter((c) => c.status !== 'idle' && !c.archived).map((chat) => ({ host, chat })));
  if (!rows.length && !chats.length) return null;
  return (
    <section aria-labelledby="running-now">
      <div className="dv-sec">
        <h3 id="running-now">Running</h3>
        <span className="dv-meta">{rows.length + chats.length}</span>
      </div>
      <div className="dv-chips">
        {rows.map((r) => {
          const card = view.cards.find((c) => c.host === r.agent.host && c.id === r.agent.card_id);
          const name = view.projects[r.index]?.name ?? r.agent.project;
          const when = r.agent.unknown ? 'state unknown'
            : r.agent.since == null ? '' : short(view.now - r.agent.since);
          const dot = r.agent.unknown ? 'dv-dot--ask' : r.tone === 'red' ? 'dv-dot--stuck' : 'dv-dot--run';
          return (
            <a key={`${r.agent.host}:${r.agent.card_id}`} className="dv-glass dv-chip dv-hit"
              title={[name, r.who, r.agent.machine || r.agent.hostName, when].filter(Boolean).join(' · ')}
              data-running={`${r.agent.host}:${r.agent.card_id}`}
              href={card ? `/p/${encodeURIComponent(card.projectKey)}/c/${encodeURIComponent(card.id)}` : undefined}
              onClick={(e) => { e.preventDefault(); if (card) onCard(card); }}>
              <i className={`dv-dot ${dot}`} aria-hidden="true" />
              <span className="t">{r.agent.title}</span>
              <span className="dv-chip-meta">{[name, when].filter(Boolean).join(' · ')}</span>
            </a>
          );
        })}
        {chats.map(({ host, chat }) => (
          <button key={`${host}:${chat.id}`} type="button" className="dv-glass dv-chip dv-hit"
            title={chat.task || chat.last_preview || chat.title} data-running-chat={`${host}:${chat.id}`}
            onClick={() => onChat?.(host, chat.id)}>
            <i className={`dv-dot ${chat.status === 'awaiting_approval' ? 'dv-dot--ask' : 'dv-dot--run'}`} aria-hidden="true" />
            <span className="t">{chat.title || 'Chat'}</span>
            <span className="dv-chip-meta">
              {[chat.project, chat.status === 'awaiting_approval' ? 'asks' : short(view.now - chat.updated_at)].filter(Boolean).join(' · ')}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
