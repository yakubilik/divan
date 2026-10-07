/** One face of a product — Quire / Engineering — and the same layout for every
 *  other branch (HANDOVER §4.7).
 *
 *  The title, one sentence about what the branch is doing and when that was
 *  last true (`updated 14m ago`), two or three figures, and then two columns:
 *  the branch's own list and its tickets in the main one, "What the agent did"
 *  in the side one.
 *
 *  **A branch with no source connected says so and nothing else.** `summary` is
 *  empty until something writes one, and every branch but engineering is in
 *  that state today (`docs/PROTOCOL.md`). Such a branch shows no figure and no
 *  list — one sentence, `Source not connected yet.` Its cards are still on the
 *  board, which is one press back.
 *
 *  What the frame draws and nothing carries — open pull requests, red checks —
 *  is not drawn: engineering's own list is its repositories, which the board
 *  does know. Every figure is a count off the board. The judgements are
 *  `lib/project.ts` and `lib/board.ts`.
 */
import { uptime } from '../lib/format';
import {
  NOT_CONNECTED, branchCards, cardsOn, connected, figures, happened, repoRows,
} from '../lib/project';
import { BOARD, status } from '../lib/board';
import type { MergedBranch, MergedCard, MergedProject } from '../lib/divan';

/** The words a figure is drawn under. */
const FIGURE_LABEL: Record<string, string> = {
  open: 'Open tickets', 'in progress': 'In progress', done: 'Done',
};

/** `today`, `yesterday`, `5 Oct` — the side column's mono date. */
export function dayWord(at: number | null | undefined, now: number): string {
  if (at == null) return '';
  const d = new Date(at * 1000);
  const n = new Date(now * 1000);
  if (d.toDateString() === n.toDateString()) return 'today';
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** When anything on this branch was last true: its own summary, or the newest
 *  card on it. Null where nothing has ever been said. */
export function updatedAt(b: MergedBranch, cards: MergedCard[]): number | null {
  const times = [b.summary_at, ...cards.map((c) => c.agent_status_at ?? c.updated_at)]
    .filter((t): t is number => typeof t === 'number' && t > 0);
  return times.length ? Math.max(...times) : null;
}

export function Branch({ project: p, branch: b, now, onCard, onBoard }: {
  project: MergedProject;
  branch: MergedBranch;
  /** Kept for the callers that pass it; the monogram is not on this page. */
  index?: number;
  now: number;
  /** Kept for the callers that pass it; the way back is the line's own. */
  onProject?: () => void;
  onCard: (card: MergedCard) => void;
  /** The board this branch's tickets are on. */
  onBoard?: () => void;
}) {
  const name = b.name || b.kind;
  const fed = connected(p, b);
  const cards = cardsOn(p, b.kind);

  const head = (
    <section>
      <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-0.025em' }}>
        {name}
      </h1>
    </section>
  );

  if (!fed) {
    return (
      <div data-branch={b.kind} data-connected="false">
        {head}
        <p style={{ margin: '8px 0 0', fontSize: 15, lineHeight: '22px', color: 'var(--dv-ink2)' }}>{NOT_CONNECTED}</p>
      </div>
    );
  }

  const line = branchCards(p, now).find((x) => x.kind === b.kind)?.line ?? '';
  const at = updatedAt(b, cards);
  const repos = repoRows(p, b.kind);
  const did = happened(p, b.kind).slice(0, 8);
  const figs = figures(b).slice(0, 3);
  const column = (c: MergedCard) => BOARD.find((x) => x.key === c.column)?.label
    ?? (c.column === 'review' ? 'In Progress' : c.column);

  return (
    <div data-branch={b.kind} data-connected="true">
      <section>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-0.025em' }}>
          {name}
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 15, lineHeight: '22px', color: 'var(--dv-ink2)' }} data-branch-line>
          {line ? `${line.replace(/[.\s]+$/, '')}.` : ''}
          {at != null && <> Updated {Math.max(0, now - at) < 60 ? 'just now' : `${uptime(Math.max(0, now - at))} ago`}.</>}
        </p>
      </section>

      {figs.length > 0 && (
        <section data-figures style={{
          marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12,
        }}>
          {figs.map((f) => (
            <div key={f.label} className="dv-glass dv-count">
              <span className="l">{FIGURE_LABEL[f.label] ?? f.label}</span>
              <span className="n">{f.value}</span>
            </div>
          ))}
        </section>
      )}

      <div className="dv-cols2">
        <main style={{ gap: 28 }}>
          {b.kind.toLowerCase() === 'engineering' && (
            <section>
              <div className="dv-sec"><h3>Repositories</h3><span className="dv-meta">{repos.length}</span></div>
              <div className="dv-glass" style={{ borderRadius: 'var(--radius-md)', padding: '4px 14px' }}>
                {repos.length ? repos.map((r) => (
                  <div key={r.path} className="dv-live" style={{ padding: '12px 4px' }}>
                    <span className="t" style={{ fontFamily: 'var(--font-mono)' }}>{r.name}</span>
                    <span className="dv-meta">{r.machines.join(' · ')}</span>
                  </div>
                )) : (
                  <p className="dv-live" style={{ margin: 0, padding: '12px 4px', color: 'var(--dv-ink2)' }}>
                    Nothing on this branch names a repository.
                  </p>
                )}
              </div>
            </section>
          )}
          <section>
            <div className="dv-sec">
              <h3>Tickets</h3>
              {!!onBoard && (
                <a href="#board" className="dv-link" style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 500 }}
                  onClick={(e) => { e.preventDefault(); onBoard(); }}>On the board</a>
              )}
            </div>
            <div className="dv-glass" style={{ borderRadius: 'var(--radius-md)', padding: '4px 14px' }} data-branch-tickets>
              {cards.length ? cards.map((c) => {
                const st = status(c);
                return (
                  <button key={c.id} type="button" className="dv-live press" style={{ padding: '12px 4px' }}
                    onClick={() => onCard(c)}>
                    {st
                      ? <span className={`dv-status dv-status--${st.kind}`}><i />{st.word}</span>
                      : <i className="dv-dot" aria-hidden="true" />}
                    <span className="t">{c.title}</span>
                    <span className="dv-meta">{column(c)}</span>
                  </button>
                );
              }) : (
                <p className="dv-live" style={{ margin: 0, padding: '12px 4px', color: 'var(--dv-ink2)' }}>
                  No ticket on the board names this branch.
                </p>
              )}
            </div>
          </section>
        </main>

        <aside>
          <section>
            <div className="dv-sec"><h3>What the agent did</h3></div>
            <div className="dv-glass" style={{ borderRadius: 'var(--radius-lg)', padding: '16px 18px 4px' }} data-agent-did>
              {did.length ? (
                <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', gap: '0 12px' }}>
                  {did.map((h) => (
                    <div key={h.card.id} style={{ display: 'contents' }}>
                      <span className="dv-meta">{dayWord(h.at, now)}</span>
                      <div style={{ paddingBottom: 16, fontSize: 13, lineHeight: '19px' }}>{h.text}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: '19px', color: 'var(--dv-ink2)' }}>
                  Nothing done here yet.
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
