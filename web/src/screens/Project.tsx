/** One product's page: where it is in its life, what is happening on it this
 *  minute, and what it has been through.
 *
 *  Top down: the rail of five stages with the three dates beside it, and under
 *  that two panels — **Right now** on the left and the **Timeline** on the
 *  right. The head above it — the monogram, the name, what it is for, the
 *  machines it is on and the tabs — is the page head in `screens/Overview.tsx`,
 *  which every tab of a product hangs under.
 *
 *  It used to be the branch grid, and the grid is now a tab of its own
 *  (`screens/Branches.tsx`). The reason is what the two answer: a grid of faces
 *  says how a product is *organised*, which is a thing you look up; this page
 *  answers what is going on and how it got here, which is what a person opens a
 *  product to find out.
 *
 *  What is on it and what is not:
 *
 *   · **Right now is the board read as events, not as columns.** A card sitting
 *     in Queued is not happening and is not on it; an agent that stopped at four
 *     in the morning is, however tidy its column looks. With nothing happening
 *     the panel says so in the two sentences the phone says it in — the same
 *     `nowLine` and `waitingLine` `scripts/test-overview.mjs` holds the two
 *     clients to.
 *   · **The timeline is written, not counted.** No table on this machine knows
 *     which Tuesday mattered, so a product's history is written down
 *     (`divan.project.milestones`, filled from the repositories by
 *     `scripts/divan_facts.py`) and a product nobody has written one for draws
 *     no line rather than a line of guesses.
 *   · **A stage nobody has said draws no rail.** Five empty steps would be a
 *     claim that the product has got nowhere.
 *
 *  The judgements are `lib/project.ts`. What is left here is the arrangement.
 */
import { uptime } from '../lib/format';
import {
  blank, blankBody, facts, nowLine, oldLine, processes, quiet, rail, since, timeline,
  waitingLine, type Moment, type Process, type Step,
} from '../lib/project';
import { RADIUS, T, toneColours } from '../lib/theme';
import type { DivanView, MergedCard, MergedProject } from '../lib/divan';
import { Card, EmptyState, SectionHeader } from '../ui/divan';
import { StillOpen } from '../components/StillOpen';
import { mono } from '../ui/kit';

export function Project({ view, project: p, onCard }: {
  view: DivanView;
  project: MergedProject;
  /** A line of Right now is a way in: the card's own page. */
  onCard?: (card: MergedCard) => void;
}) {
  const asleep = quiet(p, view.now, uptime);
  const old = oldLine(p, view.now, uptime);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
      {!!old && <div style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink2 }}>{old}</div>}
      <Life project={p} now={view.now} />
      {!!asleep && (
        <Card hollow style={{ gap: 6 }}>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-.01em' }}>{asleep.title}</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink2 }}>{asleep.body}</div>
        </Card>
      )}
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 420px', gap: 24, alignItems: 'start',
      }}>
        {/* One column for both, and not two rows of a grid. As rows, the
            first was as tall as the taller of its two cells — the timeline —
            so a product with one thing running and a long history drew a hole
            the height of that history between Right now and what is still
            open. What is happening and what is not are the same question
            asked twice, and a reader goes down one column for both. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
          {blank(p)
            // A board nobody has put a card on yet. It used to replace the whole
            // page, which is how a product with eight months of history behind it
            // came out reading as something nobody had started: the board is
            // empty, the *product* is not, and the two are different sentences.
            ? (
              <EmptyState
                title="A new board."
                body={blankBody(p)}
                foot="Nothing starts by itself: a card runs when it is moved into In Progress."
                style={{ padding: '8px 0 24px' }}
              />
            )
            : <RightNow view={view} project={p} onCard={onCard} />}
          <StillOpen project={p} now={view.now} />
        </div>
        <Timeline project={p} now={view.now} />
      </div>
    </div>
  );
}

// ── the block across the top ────────────────────────────────────────────────

/** Where the product is in its life, and the three dates that say it in
 *  numbers. One card and not two: the rail is a claim — somebody said this is
 *  live — and the dates beside it are what that claim is made of.
 *
 *  A product with neither draws nothing at all rather than an empty card. */
function Life({ project: p, now }: { project: MergedProject; now: number }) {
  const steps = rail(p);
  const dates = facts(p, now);
  const last = [...timeline(p, now)].find((m) => !m.future && !m.today);
  if (!steps && !dates.length) return null;
  return (
    <Card radius={RADIUS.tile} style={{
      flexDirection: 'row', alignItems: 'stretch', gap: 28, padding: '14px 18px',
      // The page is a column, and a card clips what overflows it — so the
      // moment the page grew taller than the window, this was the item a
      // column could squeeze: the rail kept its bars and lost every word under
      // them. It is as tall as what is in it and no shorter.
      flexShrink: 0,
    }}>
      {!!steps && (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {steps.map((s) => <Bar key={s.key} step={s} />)}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {steps.map((s) => (
              <span key={s.key} style={{
                flex: 1, minWidth: 0, fontSize: 12, fontWeight: s.here ? 600 : 400,
                color: s.here ? T.ink : T.ink3,
              }}>{s.label}</span>
            ))}
          </div>
          {!!last && (
            <div style={{ fontSize: 13, color: T.ink2, marginTop: 2 }}>
              {last.title}
              <span style={{ ...mono, fontSize: 11.5, color: T.ink3 }}>{`  ·  ${last.date}`}</span>
            </div>
          )}
        </div>
      )}
      {!!dates.length && (
        <div style={{
          flex: 'none', display: 'flex', gap: 28,
          borderLeft: steps ? `1px solid ${T.line}` : undefined, paddingLeft: steps ? 28 : 0,
        }}>
          {dates.map((f) => (
            <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ ...mono, fontSize: 10.5, color: T.ink3 }}>{f.label}</div>
              <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.01em', whiteSpace: 'nowrap' }}>
                {f.value}
              </div>
              {!!f.note && (
                <div style={{
                  ...mono, fontSize: 11, whiteSpace: 'nowrap',
                  color: f.tone ? toneColours(f.tone).fg : T.ink3,
                }}>{f.note}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** One step of the rail: a 4 pt bar, filled up to where the product is. The one
 *  it is on is the running green — the same colour work in progress is drawn in
 *  everywhere else on the panel — and the steps behind it are the strong
 *  hairline, which reads as done rather than as happening. */
function Bar({ step }: { step: Step }) {
  return (
    <span style={{
      flex: 1, height: 4, borderRadius: 2,
      background: step.here ? T.run : step.passed ? T.line2 : T.line,
    }} />
  );
}

// ── what is happening ───────────────────────────────────────────────────────

/** The left panel. Every row is a card something is happening to, worst first;
 *  with nothing happening it is the two sentences rather than an empty box,
 *  because "nothing is running" and "nothing is waiting on you" are answers. */
function RightNow({ view, project: p, onCard }: {
  view: DivanView; project: MergedProject; onCard?: (card: MergedCard) => void;
}) {
  const rows = processes(p, view.now, uptime);
  const now = nowLine(view, p);
  const wait = waitingLine(p);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <SectionHeader title="Right now"
        right={rows.length
          ? <span style={{ ...mono, fontSize: 11.5, color: T.ink3 }}>
              {`${rows.length} ${rows.length === 1 ? 'process' : 'processes'}`}
            </span>
          : null} />
      {rows.length
        ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((r) => <Happening key={r.key} row={r} onCard={onCard} />)}
          </div>
        )
        : (
          <Card style={{ gap: 6 }}>
            <div style={{ fontSize: 14, lineHeight: 1.45 }}>{now.text}</div>
            <div style={{ fontSize: 14, lineHeight: 1.45, color: T.ink2 }}>{wait.text}</div>
          </Card>
        )}
    </div>
  );
}

function Happening({ row, onCard }: { row: Process; onCard?: (card: MergedCard) => void }) {
  const c = toneColours(row.tone);
  return (
    <Card radius={RADIUS.tile} onClick={onCard && (() => onCard(row.card))}
      title={onCard ? `Open ${row.title}` : undefined}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14, padding: '10px 14px',
      }}>
      <span style={{
        flex: 'none', ...mono, fontSize: 10.5, fontWeight: 600, padding: '5px 8px',
        borderRadius: RADIUS.chip, background: c.bg, color: c.fg, whiteSpace: 'nowrap',
      }}>{row.label}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{
          fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>{row.title}</div>
        {/* One line, not two. What an agent last said is a paragraph, and two
            lines of it per row turned the panel into a wall of prose that had
            to be read to be skimmed — which is the opposite of what a panel
            called Right now is for. The rest of the sentence is on the card's
            own page, one press away. */}
        <div style={{
          fontSize: 13, lineHeight: 1.4, color: T.ink2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{row.body}</div>
      </div>
      {!!row.since && (
        <span style={{ flex: 'none', ...mono, fontSize: 11, color: T.ink3 }}>{row.since}</span>
      )}
    </Card>
  );
}

// ── …and what it has been through ───────────────────────────────────────────

/** The right panel: the product's own history, newest first, with today in its
 *  place among it. A product nobody has written a history for says so — and
 *  says where one comes from, because the answer is a sentence to the agent and
 *  not a form. */
function Timeline({ project: p, now }: { project: MergedProject; now: number }) {
  const rows = timeline(p, now);
  const head = since(p);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <SectionHeader title="Timeline"
        right={head ? <span style={{ ...mono, fontSize: 11.5, color: T.ink3 }}>{head}</span> : null} />
      <Card style={{ gap: 0 }}>
        {rows.length
          ? rows.map((m, i) => <Line key={m.key} moment={m} last={i === rows.length - 1} />)
          : (
            <div style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink2 }}>
              Nothing has been written down about this product yet. Ask the agent in a chat to
              set its milestones and they appear here.
            </div>
          )}
      </Card>
    </div>
  );
}

/** One line of it: the date in mono on the left, the dot on the rule, the thing
 *  on the right. A date that has not arrived is a ring rather than a fill and
 *  the whole line is grey — a promise and a fact drawn the same way would be the
 *  one lie on the page. */
function Line({ moment: m, last }: { moment: Moment; last: boolean }) {
  const colour = m.today ? T.run : m.future ? T.ink3 : T.ink;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '88px 16px minmax(0, 1fr)', gap: 8 }}>
      <span style={{
        ...mono, fontSize: 11, lineHeight: '20px', whiteSpace: 'nowrap',
        color: m.today ? T.run : T.ink3,
      }}>{m.date}</span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{
          marginTop: 6, width: 8, height: 8, borderRadius: 4, flex: 'none',
          background: m.future ? 'transparent' : colour,
          boxShadow: m.future ? `inset 0 0 0 1.5px ${T.ink3}` : undefined,
        }} />
        {!last && <span style={{ flex: 1, width: 1, background: T.line, marginTop: 2 }} />}
      </span>
      <div style={{ paddingBottom: last ? 0 : 12, minWidth: 0 }}>
        <div style={{
          fontSize: 13.5, fontWeight: m.today ? 600 : 500, lineHeight: '20px', color: colour,
        }}>{m.title}</div>
        {!!m.note && (
          <div style={{ fontSize: 12, lineHeight: 1.4, color: T.ink3, marginTop: 1 }}>{m.note}</div>
        )}
      </div>
    </div>
  );
}
