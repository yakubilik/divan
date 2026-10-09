/** One product's page.
 *
 *  One screen, with nothing to switch between: the product's chats down the
 *  left (`components/Sidebar.tsx`, handed in by `screens/Overview.tsx`) and
 *  this in the middle until one of them is opened. The head is the monogram,
 *  the name, what it is for in one sentence and a meta line with its stage as
 *  a word.
 *
 *  Under it, first, the Composer, locked to this product — the one way to
 *  start anything here, a ticket included, and so the first thing in reach.
 *  Then the stage card: the five-step rail of where the product is in its life
 *  (`lib/project.ts STAGES`, the daemon's own), the dates that back it, and an
 *  honest line where nobody has given it a stage. Then what was done on the product today, as a short list of work
 *  (`lib/today.ts`); what needs you; the board in four numbers with the In
 *  Progress cards under them; and beside those what the product is still
 *  waiting on (`components/StillOpen.tsx`) and the repositories it owns.
 *
 *  A product's branches are not drawn here, or anywhere else in the panel: they
 *  had a tab and a page each, and both went. The repositories, which used to be
 *  read off the branches tab, are in the side column instead.
 *
 *  Every figure is counted off the board (`lib/board.ts`) and every sentence is
 *  decided in `lib/project.ts`; what is left here is the arrangement.
 */
import { uptime } from '../lib/format';
import { counts, inProgress } from '../lib/board';
import {
  blank, blankBody, facts, metaLine, oldLine, quiet, standing, timeline, STAGES, type Step,
} from '../lib/project';
import { useState } from 'react';
import { TODAY_SHOWN, type Did } from '../lib/today';
import { figure, summaryOf } from '../lib/overview';
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

export function Project({ view, project: p, today, onCard, onBoard, composer }: {
  view: DivanView;
  project: MergedProject;
  /** What was done on this product today, latest first. */
  today: Did[];
  /** A card's own page. */
  onCard?: (card: MergedCard) => void;
  /** The board, from its summary. */
  onBoard?: () => void;
  /** The Composer, locked to this product. */
  composer?: React.ReactNode;
}) {
  const asleep = quiet(p, view.now, uptime);
  const old = oldLine(p, view.now, uptime);
  const waiting = sessions(view).filter((s) => s.projectKey === p.key);
  return (
    <>
      {!!composer && <div style={{ marginTop: 28 }}>{composer}</div>}
      <StageCard project={p} now={view.now} />
      {!!old && <p className="dv-meta" style={{ margin: '16px 0 0' }}>{old}</p>}
      {!!asleep && (
        <p style={{ margin: '16px 0 0', fontSize: 15, lineHeight: '22px', color: 'var(--ink-2)' }}>
          <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{asleep.title}</b> {asleep.body}
        </p>
      )}
      <div className="dv-cols2">
        <main>
          <Today rows={today} />
          {waiting.length > 0 && (
            <section aria-labelledby="p-needs-you">
              <div className="dv-sec"><h3 id="p-needs-you">Needs you</h3><span className="dv-meta">{waiting.length}</span></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {waiting.map((s) => <Wait key={s.id} session={s} onOpen={() => onCard?.(s.card)} />)}
              </div>
            </section>
          )}
          <BoardSummary view={view} project={p} onCard={onCard} onBoard={onBoard} />
        </main>
        <aside>
          <StillOpen project={p} now={view.now} />
          <Repositories project={p} now={view.now} />
        </aside>
      </div>
    </>
  );
}

/** Where the product is in its life: the stage the daemon keeps for it
 *  (`divan.project.update --stage`), drawn as the rail it always was — the
 *  steps behind it filled, the one it is on darkest, the ones ahead empty — with
 *  the dates that say it in numbers beside it.
 *
 *  This is the product's stage and nothing else. Which tickets are running or
 *  being tested is the board below; nothing on it moves the rail, and the rail
 *  is no percentage: `step 3 of 5` is which step, not how much is finished. A
 *  product nobody has given a stage, or one with a word the rail does not have,
 *  says so instead of drawing bars. */
function StageCard({ project: p, now }: { project: MergedProject; now: number }) {
  const at = standing(p);
  const dates = facts(p, now);
  const last = timeline(p, now).find((m) => !m.future && !m.today);
  return (
    <section aria-labelledby="p-stage" data-stage-card="" data-stage={at.kind === 'set' ? at.stage : at.kind}
      style={{ marginTop: 28 }}>
      <div className="dv-sec">
        <h3 id="p-stage">Stage</h3>
        {at.kind === 'set' && <span className="dv-meta" data-stage-position="">{at.position}</span>}
      </div>
      <div className="dv-glass dv-life">
        <div className="dv-life-rail">
          {at.kind === 'set' ? (
            <>
              <p className="dv-life-now" data-stage-now="">
                <b>{at.label}</b> <span>{at.means}</span>
              </p>
              <ol className="dv-life-steps" aria-label={`Stage: ${at.label}, ${at.position}`}>
                {at.steps.map((s) => <Bar key={s.key} step={s} />)}
              </ol>
            </>
          ) : (
            <p className="dv-life-now" data-stage-now="">
              {at.kind === 'unset'
                ? <><b>No stage set</b> <span>Nobody has said where this product is yet. Tell an agent in a chat, for example “set its stage to build”.</span></>
                : <><b>{`“${at.word}”`}</b> <span>{`is not a stage on the rail (${STAGES.join(', ')}), so none is drawn.`}</span></>}
            </p>
          )}
          {!!last && (
            <p className="dv-meta" data-stage-last="" style={{ margin: 0 }}>{`${last.title} · ${last.date}`}</p>
          )}
        </div>
        {dates.length > 0 && (
          <dl className="dv-life-facts">
            {dates.map((f) => (
              <div key={f.key} data-fact={f.key}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
                {!!f.note && <dd className={`n${f.tone === 'amber' ? ' dv-said--amber' : ''}`}>{f.note}</dd>}
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}

/** One step of the rail: a bar, filled up to where the product is, and its
 *  name under it. */
function Bar({ step }: { step: Step }) {
  const state = step.here ? 'now' : step.passed ? 'on' : 'ahead';
  return (
    <li data-step={step.key} data-state={state} aria-current={step.here ? 'step' : undefined}>
      <i aria-hidden="true" />
      <span>{step.label}</span>
    </li>
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
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 16, fontSize: 12.5, fontWeight: 500 }}>
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
          A new board. {blankBody()}
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

/** The repositories the product owns, by folder name, and what git says about
 *  them. A product with no repository says so; one whose history no machine
 *  could read says that rather than a zero. */
function Repositories({ project: p, now }: { project: MergedProject; now: number }) {
  const git = figure(p, now, uptime);
  return (
    <section aria-labelledby="p-repos" data-repos="" style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, marginTop: 24 }}>
      <div className="dv-sec" style={{ margin: 0 }}>
        <h3 id="p-repos">Repositories</h3>
        {p.repos.length > 0 && <span className="dv-meta">{p.repos.length}</span>}
      </div>
      <div className="dv-glass" style={{ borderRadius: 'var(--radius-md)', padding: '12px 16px' }}>
        {p.repos.length ? (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', font: '400 12.5px/1.7 var(--font-mono)', color: 'var(--ink-2)' }}>
            {p.repos.map((r) => (
              <li key={r} title={r} data-repo={r} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.split(/[/\\]/).filter(Boolean).pop()}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-2)' }}>No repository attached yet.</p>
        )}
        <p className="dv-meta" style={{ margin: '10px 0 0', paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
          {git ? `${git.value} ${git.label} · ${git.moved}` : 'no machine could read its history'}
        </p>
      </div>
    </section>
  );
}

/** What was done on the product today: the latest few things, and the rest
 *  behind one word. */
function Today({ rows }: { rows: Did[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, TODAY_SHOWN);
  const more = rows.length - TODAY_SHOWN;
  return (
    <section aria-labelledby="p-today">
      <div className="dv-sec">
        <h3 id="p-today">Today</h3>
        {rows.length > 0 && <span className="dv-meta">{rows.length} done</span>}
      </div>
      {rows.length ? (
        <div className="dv-glass" data-today="" style={{ borderRadius: 'var(--radius-md)', padding: '14px 18px' }}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: '22px', color: 'var(--ink)' }}>
            {shown.map((d) => <li key={d.key}>{d.text}</li>)}
          </ul>
          {more > 0 && (
            <button type="button" className="dv-btn dv-btn--ghost dv-hit" aria-expanded={all}
              style={{ height: 28, marginTop: 8, marginLeft: -6 }} onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      ) : (
        <p style={{ margin: '0 4px', fontSize: 13.5, lineHeight: '20px', color: 'var(--ink-2)' }}>
          Nothing finished yet today. What the chats on this product get done is written here.
        </p>
      )}
    </section>
  );
}
