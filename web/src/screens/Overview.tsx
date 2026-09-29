/** The Dashboard place: every product on every machine, what is running on them,
 *  and — as conversations rather than as a list — whatever needs a person.
 *
 *  Web12 W1 and Web13 W3 are this page in the two themes, and the theme is the
 *  whole of what differs between them. Top down, both frames: the head with a
 *  mono aside saying how much of what is below is true, four counters, then the
 *  products two abreast on the left and the agent roster on the right, with the
 *  command bar across the bottom and the questions open over the corner.
 *
 *  Three things are true of everything on it:
 *
 *  **Nothing here is invented.** Every counter is counted, every project card
 *  carries the two figures that exist for a product today — what its board says
 *  and what git says about its repositories — and the third figure the frames put
 *  at the top of a card, what the product earns, has no source connected and so
 *  is not drawn at all. The frames draw a fourteen-bar sparkline beside that
 *  figure; nothing carries a day-by-day history, so the panel draws the two
 *  numbers it has and no chart of numbers it does not. A gap is honest; a
 *  placeholder is not.
 *
 *  **A machine that has gone quiet is said out loud.** Its cards still count
 *  towards what a person has to do, because a ticket that stopped to ask does not
 *  answer itself while a laptop is shut. What its *agents* are doing cannot be
 *  known, so that is a counter of its own, the head says how old the page is, and
 *  the products that live there say when they were last seen.
 *
 *  **The judgements are not in here.** Which the fourth counter is, what a
 *  product's corner says, which questions open as windows — all of it is
 *  `lib/overview.ts` and `lib/sessions.ts`, held to the phone's own answers by
 *  `scripts/test-overview.mjs`, because a panel and a phone that disagreed about
 *  how many things need you would be two products. What is left here is the
 *  arrangement.
 *
 *  Three states it has to survive, and all three are drawn rather than guarded
 *  against: no machine has answered yet, a machine answered and has since gone
 *  quiet, and a machine that cannot be reached at all.
 */
import { uptime } from '../lib/format';
import {
  COLUMN_LABEL, agentLine, agentRows, calm, calmWords, cardMarks, chip, clock, columnCounts,
  count, counters, figure, freshness, latest, line, marks, staleWords, staleness, summaryOf,
} from '../lib/overview';
import { T } from '../lib/theme';
import type { DivanView, MergedProject } from '../lib/divan';
import {
  Card, CommandBar, Counter, EmptyState, Monogram, Note, RosterRow, SectionHeader,
  StateMark, Tag,
} from '../ui/divan';
import { mono } from '../ui/kit';
import { Sessions } from '../components/Sessions';

export interface OverviewProps {
  view: DivanView;
  /** The product the bar is scoped to, or null for all of them. */
  project: MergedProject | null;
  onProject: (key: string | null) => void;
  /** The command bar across the bottom opens the panel's own palette, which is
   *  what ⌘K has always opened here. */
  onAsk?: () => void;
}

export function Overview({ view, project, onProject, onAsk }: OverviewProps) {
  const old = staleness(view);
  const agents = agentRows(view);
  const aside = project
    ? (project.machines.join(' · ') || 'no machine')
    : old
      ? `partly as of ${clock(old.asOf)}`
      : `${count(view.projects.length, 'project')} · ${count(agents.length, 'agent')}`;

  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20,
      padding: '24px 32px 96px', overflowY: 'auto', background: T.bg,
    }}>
      <SectionHeader
        kind="page"
        title={project ? project.name : 'Overview'}
        right={aside}
        tone={!project && old ? 'amber' : undefined}
      />
      {!!old && (
        <div style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink2 }}>
          {staleWords(old, uptime)}
        </div>
      )}
      {project ? <Product project={project} /> : <Everything view={view} onProject={onProject} />}
      {/* The bar and the windows are over the page rather than in it: the page
          scrolls, and a question that scrolled away with it would be a
          notification again. */}
      {!!onAsk && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 22, transform: 'translateX(-50%)', zIndex: 10,
        }}>
          <CommandBar placeholder="Tell Divan anything…" onClick={onAsk} />
        </div>
      )}
      <Sessions view={view} />
    </div>
  );
}

/** Everything, which is the page the frames draw: the counters, the products and
 *  the roster. */
function Everything({ view, onProject }: { view: DivanView; onProject: (key: string) => void }) {
  const quiet = calm(view);
  const words = calmWords(view);
  const rows = agentRows(view);
  if (!view.hosts.length || !view.projects.length) return <Nothing view={view} />;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        {counters(view).map((c) => (
          <Counter key={c.label} value={c.value} label={c.label} tone={c.tone} ring={c.ring} />
        ))}
      </div>
      {/* A morning where nothing needs anybody is a state this page is designed
          for, and not the busy one with its numbers at zero. The rule is
          `calm()` and not a copy of it: two spellings of one rule is how a
          screen comes to say "all clear" over a quiet machine's own amber
          sentence. */}
      {quiet && (
        <Note tone="run" dot title={words.title} foot={words.foot ? [words.foot] : undefined} />
      )}
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 24, alignItems: 'start',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <SectionHeader title="Projects" note="sorted by urgency" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {view.projects.map((p, i) => (
              <ProjectCard key={p.key} project={p} index={i} now={view.now}
                onClick={() => onProject(p.key)} />
            ))}
          </div>
        </div>
        {!!rows.length && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <SectionHeader title="Agents" count={rows.length} />
            <Card inset={false} style={{ padding: '2px 12px' }}>
              {rows.map((r, i) => (
                <RosterRow
                  key={`${r.agent.host}:${r.agent.card_id}`} first={i === 0}
                  mark={r.mark} tone={r.tone} who={r.who}
                  lead={<Monogram name={view.projects[r.index]?.name ?? r.agent.project}
                    index={r.index < 0 ? null : r.index} size={18} />}
                  text={agentLine(r, view.now, uptime)}
                />
              ))}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

/** One product's card (Web12 W1): its monogram and name, where its work is, the
 *  worst true thing about it in the corner, what git says, and the board's own
 *  marks with the worst card's line beside them. */
function ProjectCard({ project: p, index, now, onClick }: {
  project: MergedProject; index: number; now: number; onClick: () => void;
}) {
  const corner = chip(p, now, uptime);
  const fresh = freshness(p);
  const git = figure(p, now, uptime);
  const board = cardMarks(p);
  const said = latest(p);
  return (
    <Card onClick={onClick} title={`Everything on ${p.name}`} style={{ gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Monogram name={p.name} index={index} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>{p.name}</div>
          <div style={{
            ...mono, fontSize: 11.5, color: T.ink3, marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{line(p, now)}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          <Tag mark={corner.mark} label={corner.text} tone={corner.tone} />
          {!!fresh && <span style={{ ...mono, fontSize: 10.5, color: T.ink3 }}>{fresh}</span>}
        </div>
      </div>
      {!!git && (
        <div>
          <div style={{ ...mono, fontSize: 24, lineHeight: 1, fontWeight: 500, letterSpacing: '-.02em' }}>
            {git.value}
          </div>
          <div style={{ ...mono, fontSize: 11, color: T.ink3, marginTop: 6, whiteSpace: 'nowrap' }}>
            {git.label} · {git.moved}
          </div>
        </div>
      )}
      {(!!board.length || !!said) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
          borderTop: `1px solid ${T.line}`, paddingTop: 10,
        }}>
          <span style={{ display: 'flex', gap: 8, flex: 'none' }}>
            {board.map((m) => <StateMark key={m.mark} state={m.mark} label={m.n} size={11.5} />)}
          </span>
          {!!said && (
            <span style={{
              marginLeft: 'auto', fontSize: 12.5, color: T.ink2, minWidth: 0,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{said}</span>
          )}
        </div>
      )}
    </Card>
  );
}

/** One product, scoped to by the bar: what it is, where it is checked out, and
 *  what its board says. */
function Product({ project }: { project: MergedProject }) {
  const columns = columnCounts(project);
  return (
    <Card>
      <SectionHeader title={project.name} note={project.kind || undefined}>
        <Marks project={project} style={{ marginLeft: 12 }} />
      </SectionHeader>
      <div style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink2 }}>{summaryOf(project)}</div>
      <div style={{ ...mono, fontSize: 12, lineHeight: 1.6, color: T.ink3 }}>
        {COLUMN_LABEL.map((c) => `${c.label} ${columns[c.key]}`).join(' · ')}
        <br />
        {project.repos.length ? project.repos.join(' · ') : 'no repository attached'}
      </div>
    </Card>
  );
}

/** `? 1 asking · ■ 1 stuck · ● 2 running`, and nothing at all where none of the
 *  three is true — a calm product says so by being quiet. */
function Marks({ project, style }: { project: MergedProject; style?: React.CSSProperties }) {
  const list = marks(project);
  if (!list.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 12, flex: 'none', ...style }}>
      {list.map((m) => <StateMark key={m.state} state={m.state} label={m.label} />)}
    </span>
  );
}

/** Nothing to draw, in whichever of its four ways. A page with no products on
 *  it is not the same thing as a page whose machines have not answered. */
function Nothing({ view }: { view: DivanView }) {
  const answered = view.hosts.some((h) => !h.missing);
  const older = view.hosts.filter((h) => h.old);
  if (!view.hosts.length) {
    return (
      <EmptyState
        title="No computer paired yet"
        body="Pair one and its products appear here — every machine at once, not one at a time."
        foot="Machine › Settings › Computers"
      />
    );
  }
  if (!answered) {
    // A machine that has not answered *yet* is not a machine that would not:
    // nothing has failed until something says why, and the first poll of a
    // panel that has just opened is still out.
    const asking = view.hosts.every((h) => !h.error);
    if (asking) {
      return (
        <EmptyState
          title="Asking every computer…"
          body="The board is read from each of them at once. This is the moment before the
                first one answers."
          foot={view.hosts.map((h) => h.machine).join(' · ')}
        />
      );
    }
    return (
      <EmptyState
        title="No machine has answered"
        body={older.length
          ? 'The daemon on the other end is older than this panel and has never heard of the board.'
          : 'Nothing has come back from the computers this browser is paired with.'}
        foot={view.hosts.map((h) => `${h.machine} — ${h.error || 'no answer'}`).join(' · ')}
      />
    );
  }
  return (
    <EmptyState
      title="No products yet"
      body="A product is what you ship — a site, an app, a piece of client work — and it owns
            however many repositories it takes. Tell Divan about one in the chat and it appears
            here, on every machine it is checked out on."
      foot="Nothing appears here on its own."
    />
  );
}
