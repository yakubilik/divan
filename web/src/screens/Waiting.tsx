/** Waiting on you (HANDOVER §4.6).
 *
 *  The title says the counts (`2 answers, 1 task.`), and under it three groups,
 *  oldest first: An agent is asking · A decision · On your plate. Everything
 *  that can be answered in one press is: an answer the question offers in its
 *  own words is a button that sends the note the question window always sent
 *  (`ustabasi.note`); a card that is yours is `Mark done`, which moves it to
 *  Done; a Still open item is `Mark done` and `Comment`, the two calls the
 *  project page's Still open sends. A group with nothing in it is not drawn,
 *  and with nothing waiting at all the page is one sentence.
 *
 *  What is in which group, and the title, are `lib/waiting.ts`.
 */
import { useState } from 'react';
import { commentOpenItem, moveCard, setOpenItem, ticketNote } from '../lib/actions';
import { short } from '../lib/compose';
import { useDivanStore, type DivanView, type MergedCard } from '../lib/divan';
import type { Session } from '../lib/sessions';
import { headline, waitingOn, type Plate } from '../lib/waiting';

export function Waiting({ view, onCard }: { view: DivanView; onCard: (card: MergedCard) => void }) {
  /** What was answered from here: gone from the page the moment it was sent,
   *  and back only if the board stamps a new question on that card. */
  const [done, setDone] = useState<string[]>([]);
  const w = waitingOn(view);
  const keep = <T extends { id: string; age?: number | null }>(list: T[], at: (x: T) => string) =>
    list.filter((x) => !done.includes(at(x)));
  const stamp = (s: Session) => `${s.id}@${s.at ?? ''}`;
  const asking = keep(w.asking, stamp);
  const decision = keep(w.decision, stamp);
  const plate = keep(w.plate, (p) => (p.kind === 'card' ? stamp(p.session) : p.id));
  const shown = { asking, decision, plate };
  const title = headline(shown);
  const gone = (key: string) => setDone((had) => [...had, key]);
  const empty = !asking.length && !decision.length && !plate.length;

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      <div className="dv-page dv-page--narrow" data-waiting="">
        <section style={{ marginTop: 40 }}>
          <h1 className="dv-waiting-title">{title}</h1>
          {!empty && <p className="dv-summary" style={{ marginTop: 8 }}>Oldest first. Everything else is moving on its own.</p>}
        </section>

        {!!asking.length && (
          <Group id="w-asking" title="An agent is asking" count={String(asking.length)}>
            {asking.map((s) => (
              <Ask key={s.id} session={s} view={view} onOpen={() => onCard(s.card)} onGone={() => gone(stamp(s))} />
            ))}
          </Group>
        )}
        {!!decision.length && (
          <Group id="w-decision" title="A decision" count={String(decision.length)}>
            {decision.map((s) => (
              <Ask key={s.id} session={s} view={view} onOpen={() => onCard(s.card)} onGone={() => gone(stamp(s))} />
            ))}
          </Group>
        )}
        {!!plate.length && (
          <Group id="w-plate" title="On your plate" count="only you can do these">
            {plate.map((p) => (
              <PlateItem key={p.id} plate={p} view={view} onOpen={onCard}
                onGone={() => gone(p.kind === 'card' ? stamp(p.session) : p.id)} />
            ))}
          </Group>
        )}
      </div>
    </div>
  );
}

function Group({ id, title, count, children }: {
  id: string; title: string; count: string; children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 28 }} aria-labelledby={id} data-group={id}>
      <div className="dv-sec"><h3 id={id}>{title}</h3><span className="dv-meta">{count}</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </section>
  );
}

/** A request, its state while it is out, and what the machine said. */
function useSend(host: string, onGone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (go: () => Promise<unknown>, leaves = true) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await go();
      void useDivanStore.getState().load(host);
      if (leaves) onGone();
      return true;
    } catch (e: any) {
      setError(e?.message ?? 'That did not reach the computer');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, send };
}

function Head({ letter, where, age, status }: {
  letter: string; where: string; age: number | null; status?: React.ReactNode;
}) {
  return (
    <div className="dv-wait-head">
      <span className="dv-mono dv-mono--sm" aria-hidden="true">{(letter || '?').charAt(0).toUpperCase()}</span>
      <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)', minWidth: 0 }}>{where}</span>
      {status}
      {age != null && <span className="dv-meta" style={{ marginLeft: 'auto' }}>{short(age)}</span>}
    </div>
  );
}

/** A question or a decision: the answers it offers, first one amber, and the
 *  way into the ticket. */
function Ask({ session: s, view, onOpen, onGone }: {
  session: Session; view: DivanView; onOpen: () => void; onGone: () => void;
}) {
  const { busy, error, send } = useSend(s.host, onGone);
  const href = `/p/${encodeURIComponent(s.projectKey)}/c/${encodeURIComponent(s.card.id)}`;
  return (
    <article className="dv-glass dv-wait" data-wait={s.id}>
      <Head letter={view.projects[s.index]?.name ?? s.project} where={`${s.project} · ${s.card.title}`} age={s.age}
        status={s.kind === 'stuck' ? <span className="dv-status dv-status--stuck"><i />stuck</span> : undefined} />
      <p className="dv-wait-q">{s.said}</p>
      <div className="dv-wait-actions">
        {s.ticket != null && s.answers.map((words, i) => (
          <button key={words} type="button" disabled={busy}
            className={`dv-btn dv-hit${i === 0 ? ' dv-btn--amber' : ''}`}
            onClick={() => void send(() => ticketNote(s.host, s.ticket!, words))}>{words}</button>
        ))}
        <a className="dv-btn dv-btn--ghost dv-hit" href={href} style={{ textDecoration: 'none' }}
          onClick={(e) => { e.preventDefault(); onOpen(); }}>Open ticket</a>
      </div>
      {!!error && <span className="dv-meta" style={{ color: 'var(--red)' }}>not sent · {error}</span>}
    </article>
  );
}

/** Something only you can do: Mark done, and — on a Still open item — a
 *  comment in its thread. */
function PlateItem({ plate: p, view, onOpen, onGone }: {
  plate: Plate; view: DivanView; onOpen: (card: MergedCard) => void; onGone: () => void;
}) {
  const host = p.kind === 'card' ? p.session.host : (p.project.hosts[0] ?? '');
  const pid = p.kind === 'open' ? p.project.ids[host] : null;
  const { busy, error, send } = useSend(host, onGone);
  const [writing, setWriting] = useState(false);
  const [words, setWords] = useState('');
  const [said, setSaid] = useState<string | null>(null);

  if (p.kind === 'card') {
    const s = p.session;
    return (
      <article className="dv-glass dv-wait" data-plate={p.id}>
        <Head letter={view.projects[s.index]?.name ?? s.project} where={`${s.project} · ${s.card.branch || 'engineering'}`} age={p.age} />
        <p className="dv-wait-q">{s.card.title}</p>
        <div className="dv-wait-actions">
          <button type="button" className="dv-btn dv-btn--primary dv-hit" disabled={busy}
            onClick={() => void send(() => moveCard(s.host, s.card.id, 'done'))}>Mark done</button>
          <button type="button" className="dv-btn dv-btn--ghost dv-hit" onClick={() => onOpen(s.card)}>Open</button>
        </div>
        {!!error && <span className="dv-meta" style={{ color: 'var(--red)' }}>not sent · {error}</span>}
      </article>
    );
  }

  const item = p.item;
  return (
    <article className="dv-glass dv-wait" data-plate={p.id}>
      <Head letter={p.project.name} where={`${p.project.name} · Still open`} age={p.age} />
      <p className="dv-wait-q">{item.title}</p>
      {!!item.body && <p style={{ margin: 0, fontSize: 13, lineHeight: '19px', color: 'var(--ink-2)' }}>{item.body}</p>}
      {!!pid && (
        <div className="dv-wait-actions">
          <button type="button" className="dv-btn dv-btn--primary dv-hit" disabled={busy}
            onClick={() => void send(() => setOpenItem(host, pid, item.id, { state: 'done' }))}>Mark done</button>
          <button type="button" className="dv-btn dv-btn--ghost dv-hit" aria-expanded={writing}
            onClick={() => setWriting((o) => !o)}>Comment</button>
        </div>
      )}
      {writing && !!pid && (
        <form className="dv-say" onSubmit={async (e) => {
          e.preventDefault();
          const text = words.trim();
          if (!text) return;
          if (await send(() => commentOpenItem(host, pid, item.id, text, 'you'), false)) {
            setWords('');
            setWriting(false);
            setSaid(text);
          }
        }}>
          <label htmlFor={`c-${p.id}`} className="dv-hidden">Comment on {item.title}</label>
          <input id={`c-${p.id}`} value={words} autoFocus placeholder="Add a comment"
            onChange={(e) => setWords(e.target.value)} />
          <button type="submit" className="dv-send" aria-label="Send comment" disabled={busy || !words.trim()}
            style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
          </button>
        </form>
      )}
      {!!said && <span className="dv-meta">comment added · {said}</span>}
      {!!error && <span className="dv-meta" style={{ color: 'var(--red)' }}>not sent · {error}</span>}
    </article>
  );
}
