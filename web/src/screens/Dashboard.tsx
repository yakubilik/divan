/** The Dashboard (HANDOVER §4.1): a greeting and one line of what is going on,
 *  the Composer, what needs you, and then a card per product that says where it
 *  stands and which tickets are open on it.
 *
 *  Every figure on it is counted off the merged boards (`lib/divan.ts`); a
 *  section with nothing in it is not drawn at all — "Needs you" is absent from
 *  the page rather than empty — and a zero is said in words.
 */
import { useState } from 'react';
import type { DivanView, MergedCard, MergedProject } from '../lib/divan';
import { useDivanStore } from '../lib/divan';
import { moveCard, ticketNote } from '../lib/actions';
import { dormant, freshness, staleWords, staleness } from '../lib/overview';
import { progress, SHOWN, STAGE_WORD } from '../lib/progress';
import { useFleet } from '../lib/fleet';
import { sessions, type Session } from '../lib/sessions';
import { greeting, short, summary } from '../lib/compose';
import { uptime } from '../lib/format';
import { pending, useAsking } from '../lib/asking';
import { Asking } from '../components/Asking';

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
              {waiting.map((s) => (s.kind === 'question' || s.kind === 'decision'
                ? <AskRow key={s.id} session={s} view={view} />
                : <Wait key={s.id} session={s} onOpen={() => onCard(s.card)} />))}
            </div>
          </section>
        )}

        <Projects view={view} onProject={onProject} onCard={onCard} onChat={onChat} empty={empty} />
      </div>
      <Asking view={view} />
    </div>
  );
}

/** A question that is a conversation in the floating chat: one line here, so
 *  the page does not say the question a second time, and one press to bring
 *  its window back when it was put away or closed. */
function AskRow({ session: s, view }: { session: Session; view: DivanView }) {
  const hosts = useFleet((x) => x.hosts);
  const selected = useAsking((x) => x.selected);
  const minimised = useAsking((x) => x.minimised);
  const open = selected === s.id && !minimised.includes(s.id);
  const st = STATUS[s.kind];
  return (
    <article className="dv-glass dv-wait" data-asking-row={s.id}>
      <div className="dv-wait-head">
        <span className="dv-mono dv-mono--sm" aria-hidden="true">{(s.project || '?').charAt(0).toUpperCase()}</span>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)', minWidth: 0,
                       overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[s.project, s.card.branch].filter(Boolean).join(' · ')}
        </span>
        <span className={`dv-status ${st.cls}`} style={{ marginLeft: 'auto' }}><i />{st.word}</span>
      </div>
      <p className="dv-meta" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={s.card.title}>{s.who} · {s.card.title}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button type="button" className={`dv-btn dv-hit${open ? ' dv-btn--ghost' : ' dv-btn--amber'}`} disabled={open}
          onClick={() => {
            const p = pending(view, hosts).find((x) => x.id === s.id);
            if (p) useAsking.getState().raise(p);
          }}>{open ? 'Open in chat' : 'Reply'}</button>
        <span className="dv-meta" style={{ marginLeft: 'auto' }}>
          {[s.age == null ? '' : short(s.age), s.machine].filter(Boolean).join(' · ')}
        </span>
      </div>
    </article>
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

/** A card per product, in a grid that is one column on a phone: where it is in
 *  its life, what it is for, the tickets open on it at the stage each is at,
 *  and what it is blocked on. The dormant ones come last and dimmed.
 *
 *  What used to be a Running row of its own is on these cards now: an agent at
 *  work is a ticket line on its product's card, and a chat in the middle of a
 *  turn is a line on the card of the product it is filed under. */
function Projects({ view, onProject, onCard, onChat, empty }: {
  view: DivanView; onProject: (key: string) => void; onCard: (card: MergedCard) => void;
  onChat?: (host: string, chatId: string) => void; empty?: React.ReactNode;
}) {
  const hosts = useFleet((s) => s.hosts);
  if (!view.projects.length) return empty ? <section style={{ marginTop: 40 }}>{empty}</section> : null;
  const awake = view.projects.filter((p) => !dormant(p, view.now));
  const asleep = view.projects.filter((p) => dormant(p, view.now));
  const chatsOf = (p: MergedProject) => Object.entries(hosts).flatMap(([host, slot]) =>
    (slot?.chats ?? []).filter((c) => c.status !== 'idle' && !c.archived
      && !!c.project_id && p.ids[host] === c.project_id).map((chat) => ({ host, chat })));
  return (
    <section style={{ marginTop: 40 }} aria-labelledby="projects">
      <div className="dv-sec">
        <h3 id="projects">Projects</h3>
        <span className="dv-meta">{view.projects.length}{asleep.length ? ` · ${asleep.length} quiet` : ''}</span>
      </div>
      <div className="dv-pcards">
        {[...awake, ...asleep].map((p) => (
          <ProjectCard key={p.key} project={p} now={view.now} dim={asleep.includes(p)} chats={chatsOf(p)}
            onOpen={() => onProject(p.key)} onCard={onCard} onChat={onChat} />
        ))}
      </div>
    </section>
  );
}

function ProjectCard({ project: p, now, dim, chats, onOpen, onCard, onChat }: {
  project: MergedProject; now: number; dim: boolean;
  chats: { host: string; chat: { id: string; title: string; status: string; updated_at: number } }[];
  onOpen: () => void; onCard: (card: MergedCard) => void; onChat?: (host: string, chatId: string) => void;
}) {
  const [all, setAll] = useState(false);
  const pr = progress(p, now);
  const shown = all ? pr.tickets : pr.tickets.slice(0, SHOWN);
  const more = pr.tickets.length - shown.length;
  const fresh = freshness(p);
  const dot = pr.needs ? (pr.tickets.some((t) => t.stage === 'stuck') ? 'dv-dot--stuck' : 'dv-dot--ask')
    : pr.working ? 'dv-dot--run' : '';
  return (
    <article className={`dv-glass dv-tile dv-pcard${dim ? ' dv-tile--dormant' : ''}`} data-project-card={p.key}
      onClick={(e) => { if (!(e.target as Element).closest('a,button')) onOpen(); }}>
      <div className="dv-tile-head">
        <span className="dv-mono dv-mono--sm" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
        <a className="dv-tile-name dv-pcard-name" href={`/p/${encodeURIComponent(p.key)}`} data-tile={p.key}
          onClick={(e) => { e.preventDefault(); onOpen(); }}>{p.name}</a>
        <span className="dv-tile-stage" data-stage={pr.stage ?? ''}>{pr.stage ?? 'stage not set'}</span>
      </div>
      {pr.summary
        ? <p className="dv-tile-now" data-project-summary="">{pr.summary}</p>
        : <p className="dv-meta" style={{ margin: 0 }} data-project-summary="">No summary written yet.</p>}
      <p className="dv-pcard-status" data-project-status="">
        {!!dot && <i className={`dv-dot ${dot}`} aria-hidden="true" />}
        <span>{pr.status}</span>
        {!!fresh && <span className="dv-meta" data-stale="">{fresh}</span>}
      </p>
      {shown.length > 0 && (
        <ul className="dv-pcard-list" aria-label={`Active tickets on ${p.name}`}>
          {shown.map((t) => (
            <li key={`${t.card.host}:${t.card.id}`} data-active-ticket={t.card.id} data-ticket-stage={t.stage}>
              <a href={`/p/${encodeURIComponent(p.key)}/c/${encodeURIComponent(t.card.id)}`} data-ticket-link={t.card.id}
                title={t.card.title}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCard(t.card); }}>
                {!!t.number && <span className="n">{t.number}</span>}
                <span className="t">{t.card.title}</span>
              </a>
              <span className={`dv-status ${STAGE_WORD[t.stage].pill}`}><i />{t.word}</span>
            </li>
          ))}
        </ul>
      )}
      {(more > 0 || all) && pr.tickets.length > SHOWN && (
        <button type="button" className="dv-btn dv-btn--ghost dv-hit dv-pcard-more" aria-expanded={all}
          onClick={(e) => { e.stopPropagation(); setAll(!all); }}>
          {all ? 'Show fewer' : `+${more} more`}
        </button>
      )}
      {chats.length > 0 && (
        <ul className="dv-pcard-list" aria-label={`Chats working on ${p.name}`}>
          {chats.map(({ host, chat }) => (
            <li key={`${host}:${chat.id}`} data-project-chat={`${host}:${chat.id}`}>
              <button type="button" onClick={(e) => { e.stopPropagation(); onChat?.(host, chat.id); }}>
                <span className="n">chat</span><span className="t">{chat.title || 'Chat'}</span>
              </button>
              <span className={`dv-status ${chat.status === 'awaiting_approval' ? 'dv-status--ask' : 'dv-status--run'}`}>
                <i />{chat.status === 'awaiting_approval' ? 'asks' : 'working'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {pr.blockers.length > 0 && (
        <ul className="dv-pcard-blockers" data-blockers="">
          {pr.blockers.slice(0, 2).map((o) => (
            <li key={o.id} data-blocker={o.id}>
              <span className={`dv-status ${o.state === 'blocked' ? 'dv-status--stuck' : 'dv-status--ask'}`}>
                <i />{o.state === 'blocked' ? 'blocked' : 'waiting'}
              </span>
              <span className="t">{o.title}</span>
            </li>
          ))}
          {pr.blockers.length > 2 && <li className="dv-meta">+{pr.blockers.length - 2} more open items</li>}
        </ul>
      )}
    </article>
  );
}
