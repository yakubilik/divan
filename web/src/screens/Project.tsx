/** One product's page.
 *
 *  One screen, with nothing to switch between: the product's chats down the
 *  left (`components/Sidebar.tsx`, handed in by `screens/Overview.tsx`) and
 *  this in the middle until one of them is opened. The head is the monogram,
 *  the name, what it is for in one sentence and a meta line with its stage as
 *  a word.
 *
 *  Under it: what was done on the product today, a chat at a time
 *  (`lib/today.ts`); what needs you; the board in four numbers with the In
 *  Progress cards under them; and beside those what the product is still
 *  waiting on (`components/StillOpen.tsx`). At the foot, the Composer, locked
 *  to this product — the one way to start anything here, a ticket included.
 *
 *  Every figure is counted off the board (`lib/board.ts`) and every sentence is
 *  decided in `lib/project.ts`; what is left here is the arrangement.
 */
import { uptime } from '../lib/format';
import { counts, inProgress } from '../lib/board';
import { blank, blankBody, metaLine, oldLine, quiet } from '../lib/project';
import { STATUS_WORD, type ChatDay } from '../lib/today';
import { summaryOf } from '../lib/overview';
import { sessions } from '../lib/sessions';
import type { DivanView, MergedCard, MergedProject } from '../lib/divan';
import { StillOpen } from '../components/StillOpen';
import { Wait } from './Dashboard';

/** The head over a product. Compact over its board. */
export function ProjectHead({ project: p, now, compact }: {
  project: MergedProject;
  now: number;
  compact?: boolean;
}) {
  if (compact) {
    const open = counts(p, now, uptime);
    const live = open.slice(0, 3).reduce((n, c) => n + c.n, 0);
    return (
      <section className="dv-phead dv-phead--compact">
        <span className="dv-mono" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
        <h1 data-project-head="">{p.name}</h1>
        <span className="dv-meta">{`${live} open · ${open[3].n} done this month`}</span>
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
    </section>
  );
}

export function Project({ view, project: p, today, onChat, onCard, onBoard, onBranches, composer }: {
  view: DivanView;
  project: MergedProject;
  /** The chats that are part of today on this product, newest first. */
  today: ChatDay[];
  /** One of them, opened where this page is. */
  onChat?: (hostKey: string, chatId: string) => void;
  /** A card's own page. */
  onCard?: (card: MergedCard) => void;
  /** The board, from its summary. */
  onBoard?: () => void;
  /** The branches with their repositories. */
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
          <Today rows={today} onChat={onChat} />
          {waiting.length > 0 && (
            <section aria-labelledby="p-needs-you">
              <div className="dv-sec"><h3 id="p-needs-you">Needs you</h3><span className="dv-meta">{waiting.length}</span></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {waiting.map((s) => <Wait key={s.id} session={s} onOpen={() => onCard?.(s.card)} />)}
              </div>
            </section>
          )}
          <BoardSummary view={view} project={p} onCard={onCard} onBoard={onBoard} onBranches={onBranches} />
        </main>
        <aside>
          <StillOpen project={p} now={view.now} />
        </aside>
      </div>
      {!!composer && <div style={{ marginTop: 40 }}>{composer}</div>}
    </>
  );
}

/** Four numbers off the real columns, and the In Progress cards under them. */
function BoardSummary({ view, project: p, onCard, onBoard, onBranches }: {
  view: DivanView; project: MergedProject;
  onCard?: (card: MergedCard) => void; onBoard?: () => void; onBranches?: () => void;
}) {
  const href = `/p/${encodeURIComponent(p.key)}/board`;
  const go = (e: React.MouseEvent) => { if (onBoard) { e.preventDefault(); onBoard(); } };
  const rows = inProgress(p, view.now, uptime);
  return (
    <section aria-labelledby="p-board">
      <div className="dv-sec">
        <h3 id="p-board">Board</h3>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 16, fontSize: 12.5, fontWeight: 500 }}>
          {!!onBranches && (
            <a href={`/p/${encodeURIComponent(p.key)}/branches`} style={{ color: 'var(--ink-2)' }}
              onClick={(e) => { e.preventDefault(); onBranches(); }}>Repositories</a>
          )}
          <a href={href} onClick={go} style={{ color: 'var(--ink-2)' }}>Open board</a>
        </span>
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

/** What was done on the product today: each chat that moved, what it is
 *  working on, and under that what came of it. */
function Today({ rows, onChat }: {
  rows: ChatDay[];
  onChat?: (hostKey: string, chatId: string) => void;
}) {
  return (
    <section aria-labelledby="p-today">
      <div className="dv-sec">
        <h3 id="p-today">Today</h3>
        {rows.length > 0 && <span className="dv-meta">{rows.length === 1 ? '1 chat' : `${rows.length} chats`}</span>}
      </div>
      {rows.length ? (
        <div className="dv-glass" data-today="" style={{ borderRadius: 'var(--radius-md)', padding: '4px 14px' }}>
          {rows.map((r) => (
            <button key={r.id} type="button" className="dv-live press" data-today-chat={r.id}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, padding: '12px 4px' }}
              onClick={() => onChat?.(r.hostKey, r.id)}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span className="t" style={{ flex: 1, minWidth: 0 }}>{r.task}</span>
                {r.status !== 'idle' && (
                  <span className={`dv-status dv-status--${r.status === 'running' ? 'run' : 'ask'}`}><i />{STATUS_WORD[r.status]}</span>
                )}
                <span className="dv-meta">{r.at}</span>
              </span>
              {r.done.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: '20px', color: 'var(--ink-2)' }}>
                  {r.done.map((d) => <li key={d}>{d}</li>)}
                </ul>
              )}
            </button>
          ))}
        </div>
      ) : (
        <p style={{ margin: '0 4px', fontSize: 13.5, lineHeight: '20px', color: 'var(--ink-2)' }}>
          Nothing yet today. What a chat on this product gets done is written here as it happens.
        </p>
      )}
    </section>
  );
}
