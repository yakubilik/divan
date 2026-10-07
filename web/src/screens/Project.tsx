/** One product's page (HANDOVER §4.2).
 *
 *  The head is the monogram, the name, what it is for in one sentence and a
 *  meta line with its stage as a word; at the far end the Overview / Board /
 *  Chats segment and `+ New ticket`. There is no stage rail: where a product is
 *  in its life is the one word in the meta line.
 *
 *  Under it, two columns. The main one: what in this product needs you, the
 *  board in four numbers with the In Progress cards under them by their real
 *  status, and the branches — a branch nothing feeds says so in a sentence and
 *  shows no number. The side one: the timeline, and what the product is still
 *  waiting on (`components/StillOpen.tsx`). At the foot, the Composer, locked
 *  to this product.
 *
 *  Every figure is counted off the board (`lib/board.ts`) and every sentence is
 *  decided in `lib/project.ts`; what is left here is the arrangement.
 */
import { uptime } from '../lib/format';
import { counts, inProgress } from '../lib/board';
import {
  NOT_CONNECTED, blank, blankBody, branchCards, connected, metaLine, oldLine, quiet, since,
  timeline, type Moment,
} from '../lib/project';
import { summaryOf } from '../lib/overview';
import { sessions } from '../lib/sessions';
import type { DivanView, MergedCard, MergedProject } from '../lib/divan';
import { StillOpen } from '../components/StillOpen';
import { Wait } from './Dashboard';

/** The segment over a product, and the path each one is written at. */
export const PROJECT_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'board', label: 'Board' },
  { key: 'chat', label: 'Chats' },
] as const;

/** The head over every view of a product. Compact over the board and the
 *  chats, the way the Board frame draws it. */
export function ProjectHead({ project: p, now, tab, onTab, onNew, compact }: {
  project: MergedProject;
  now: number;
  tab: string;
  onTab: (tab: string) => void;
  onNew: () => void;
  compact?: boolean;
}) {
  const open = counts(p, now, uptime);
  const tools = (
    <div className="dv-phead-tools">
      <div className="dv-seg" role="group" aria-label="View">
        {PROJECT_TABS.map((t) => (
          <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => onTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <button type="button" className="dv-btn dv-btn--primary dv-hit" onClick={onNew}>+ New ticket</button>
    </div>
  );
  if (compact) {
    const live = open.slice(0, 3).reduce((n, c) => n + c.n, 0);
    return (
      <section className="dv-phead dv-phead--compact">
        <span className="dv-mono" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
        <h1 data-project-head="">{p.name}</h1>
        <span className="dv-meta">{`${live} open · ${open[3].n} done this month`}</span>
        {tools}
      </section>
    );
  }
  const meta = metaLine(p);
  return (
    <section className="dv-phead">
      <span className="dv-mono" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
      <div style={{ flex: '1 1 420px', minWidth: 0 }}>
        <h1 data-project-head="">{p.name}</h1>
        <p data-description="" style={{ margin: '6px 0 0', fontSize: 15, lineHeight: '22px', color: 'var(--ink-2)' }}>{summaryOf(p)}</p>
        {!!meta && <p className="dv-meta" data-meta="" style={{ margin: '6px 0 0' }}>{meta}</p>}
      </div>
      {tools}
    </section>
  );
}

export function Project({ view, project: p, onCard, onBoard, onBranch, onBranches, composer }: {
  view: DivanView;
  project: MergedProject;
  /** A card's own page. */
  onCard?: (card: MergedCard) => void;
  /** The board, from its summary. */
  onBoard?: () => void;
  /** A branch's own page, by kind. */
  onBranch?: (kind: string) => void;
  /** The branches with their repositories and recent activity. */
  onBranches?: () => void;
  /** The Composer, locked to this product. */
  composer?: React.ReactNode;
}) {
  const asleep = quiet(p, view.now, uptime);
  const old = oldLine(p, view.now, uptime);
  const waiting = sessions(view).filter((s) => s.projectKey === p.key);
  return (
    <>
      {!!old && <p className="dv-meta" style={{ margin: '16px 0 0' }}>{old}</p>}
      {!!asleep && (
        <p style={{ margin: '16px 0 0', fontSize: 15, lineHeight: '22px', color: 'var(--ink-2)' }}>
          <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{asleep.title}</b> {asleep.body}
        </p>
      )}
      <div className="dv-cols2">
        <main>
          {waiting.length > 0 && (
            <section aria-labelledby="p-needs-you">
              <div className="dv-sec"><h3 id="p-needs-you">Needs you</h3><span className="dv-meta">{waiting.length}</span></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {waiting.map((s) => <Wait key={s.id} session={s} onOpen={() => onCard?.(s.card)} />)}
              </div>
            </section>
          )}
          <BoardSummary view={view} project={p} onCard={onCard} onBoard={onBoard} />
          <Branches project={p} now={view.now} onBranch={onBranch} onBranches={onBranches} />
        </main>
        <aside>
          <Timeline project={p} now={view.now} />
          <StillOpen project={p} now={view.now} />
        </aside>
      </div>
      {!!composer && <div style={{ marginTop: 40 }}>{composer}</div>}
    </>
  );
}

/** Four numbers off the real columns, and the In Progress cards under them. */
function BoardSummary({ view, project: p, onCard, onBoard }: {
  view: DivanView; project: MergedProject;
  onCard?: (card: MergedCard) => void; onBoard?: () => void;
}) {
  const href = `/p/${encodeURIComponent(p.key)}/board`;
  const go = (e: React.MouseEvent) => { if (onBoard) { e.preventDefault(); onBoard(); } };
  const rows = inProgress(p, view.now, uptime);
  return (
    <section aria-labelledby="p-board">
      <div className="dv-sec">
        <h3 id="p-board">Board</h3>
        <a href={href} onClick={go} style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)' }}>Open board</a>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }} data-counts="">
        {counts(p, view.now, uptime).map((c) => (
          <a key={c.key} href={href} onClick={go} data-count={c.key}
            className={`dv-count ${c.key === 'in_progress' ? 'dv-glass-raised dv-count--hot' : 'dv-glass'}`}>
            <span className="l">{c.label}</span>
            <span className="n">{c.n}</span>
            <span className="dv-meta">{c.sub}</span>
          </a>
        ))}
      </div>
      {blank(p) ? (
        <p style={{ margin: '16px 4px 0', fontSize: 13.5, lineHeight: '20px', color: 'var(--ink-2)' }}>
          A new board. {blankBody(p)}
        </p>
      ) : rows.length > 0 && (
        <>
          <div className="dv-sec" style={{ marginTop: 24 }}><h3>In progress now</h3><span className="dv-meta">{rows.length}</span></div>
          <div className="dv-glass" data-in-progress="" style={{ borderRadius: 'var(--radius-md)', padding: '4px 14px' }}>
            {rows.map((t) => (
              <button key={t.card.id} type="button" className="dv-live press" style={{ flexWrap: 'wrap', padding: '12px 4px' }}
                onClick={() => onCard?.(t.card)} data-row={t.card.id}>
                {!!t.status && (
                  <span className={`dv-status dv-status--${t.status.kind}`} style={{ minWidth: 84 }}><i />{t.status.word}</span>
                )}
                <span className="t">{t.card.title}</span>
                {!!t.meta && <span className="dv-meta">{t.meta}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** The branches as tiles. One nothing feeds says so, and shows no number. */
function Branches({ project: p, now, onBranch, onBranches }: {
  project: MergedProject; now: number;
  onBranch?: (kind: string) => void; onBranches?: () => void;
}) {
  const cards = branchCards(p, now);
  if (!cards.length) return null;
  return (
    <section aria-labelledby="p-branches">
      <div className="dv-sec">
        <h3 id="p-branches">Branches</h3>
        <span className="dv-meta">{cards.length}</span>
        {!!onBranches && (
          <button type="button" className="dv-btn dv-btn--ghost dv-hit" style={{ height: 28 }} onClick={onBranches}>Repositories</button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {cards.map((b) => {
          const branch = p.branches.find((x) => x.kind === b.kind)!;
          const fed = connected(p, branch);
          return (
            <a key={b.key} className="dv-glass dv-tile dv-branch" data-branch={b.kind}
              data-connected={fed ? 'true' : 'false'}
              href={`/p/${encodeURIComponent(p.key)}/b/${encodeURIComponent(b.kind)}`}
              onClick={(e) => { e.preventDefault(); onBranch?.(b.kind); }}>
              <div className="dv-tile-head">
                <span className="dv-tile-name">{b.name}</span>
                {fed && !!b.refreshed && <span className="dv-tile-stage">{b.refreshed.text}</span>}
              </div>
              {fed ? (
                <>
                  {!b.sourceless && <p className="dv-tile-now">{b.line}</p>}
                  {!!b.figures.length && (
                    <div className="dv-tile-foot">
                      {b.figures.map((f) => <span key={f.label} className="count">{f.value} <span className="w">{f.label}</span></span>)}
                    </div>
                  )}
                </>
              ) : (
                <p className="dv-tile-now" style={{ color: 'var(--ink-3)' }}>{NOT_CONNECTED}</p>
              )}
            </a>
          );
        })}
      </div>
    </section>
  );
}

/** The product's own history, newest first, with today in its place. */
function Timeline({ project: p, now }: { project: MergedProject; now: number }) {
  const rows = timeline(p, now);
  const head = since(p);
  return (
    <section aria-labelledby="p-timeline">
      <div className="dv-sec"><h3 id="p-timeline">Timeline</h3>{!!head && <span className="dv-meta">{head}</span>}</div>
      <div className="dv-glass" style={{ borderRadius: 'var(--radius-lg)', padding: '18px 18px 6px' }}>
        {rows.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: '92px 14px minmax(0, 1fr)', gap: '0 10px' }}>
            {rows.map((m) => <Line key={m.key} moment={m} />)}
          </div>
        ) : (
          <p style={{ margin: '0 0 12px', fontSize: 13.5, lineHeight: '20px', color: 'var(--ink-2)' }}>
            Nothing has been written down about this product yet. Ask the agent in a chat to set its
            milestones and they appear here.
          </p>
        )}
      </div>
    </section>
  );
}

/** One line of it. A date that has not arrived is a ring rather than a dot. */
function Line({ moment: m }: { moment: Moment }) {
  return (
    <>
      <span className="dv-meta" style={{ color: m.today ? 'var(--ink-2)' : undefined }}>{m.date}</span>
      <i className={`dv-dot${m.today ? ' dv-dot--run' : ''}`} aria-hidden="true"
        style={{ marginTop: 5, ...(m.today ? {} : m.future
          ? { background: 'transparent', boxShadow: 'inset 0 0 0 1.5px var(--ink-3)' }
          : { background: 'var(--ink-2)' }) }} />
      <div style={{ paddingBottom: 18, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: m.future ? 'var(--ink-3)' : 'var(--ink)' }}>{m.title}</div>
        {!!m.note && <div style={{ fontSize: 13, lineHeight: '19px', color: 'var(--ink-2)' }}>{m.note}</div>}
      </div>
    </>
  );
}
