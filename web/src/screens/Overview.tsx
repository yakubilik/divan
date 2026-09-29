/** The Dashboard place: every product on every machine, and one product when the
 *  bar is scoped to it.
 *
 *  This is the page the project bar scopes, which is the whole reason it is here
 *  in the shell's ticket: selecting a chip does not open a second screen, it
 *  narrows this one — the way the phone's Dashboard is also the project page
 *  until the project page exists. What it draws is what the merged snapshot
 *  actually carries: the products, which machines each is checked out on, how
 *  many of its cards want a person and how many agents are running on it. The
 *  counters, the questions arriving as chat panels and the boards are the screens
 *  that follow; nothing is drawn here as a stand-in for them, and nothing on this
 *  page is a number nobody measured.
 *
 *  Three states it has to survive, and all three are drawn rather than guarded
 *  against: no machine has answered yet, a machine answered and has since gone
 *  quiet, and a machine that cannot be reached at all. A silent machine's
 *  products stay on the page with the age of what they say written next to them,
 *  because five agents disappearing because a lid closed is the failure nobody
 *  would notice.
 */
import { uptime } from '../lib/format';
import { COLUMN_LABEL, columnCounts, marks, staleWords, staleness, summaryOf } from '../lib/overview';
import { T } from '../lib/theme';
import type { DivanView, MergedProject } from '../lib/divan';
import { Card, EmptyState, Monogram, Row, SectionHeader, StateMark } from '../ui/divan';
import { mono } from '../ui/kit';

export interface OverviewProps {
  view: DivanView;
  /** The product the bar is scoped to, or null for all of them. */
  project: MergedProject | null;
  onProject: (key: string | null) => void;
}

export function Overview({ view, project, onProject }: OverviewProps) {
  const old = staleness(view);
  const aside = project
    ? (project.machines.join(' · ') || 'no machine')
    : old
      ? `partly as of ${clock(old.asOf)}`
      : `${count(view.projects.length, 'product')} · ${count(view.totals.machines, 'machine')}`;

  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20,
      padding: '24px 32px 32px', overflowY: 'auto', background: T.bg,
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
      {project ? <Product project={project} /> : <Products view={view} onProject={onProject} />}
    </div>
  );
}

/** Every product, worst first, one row each. The row goes into the product,
 *  which is the same thing the chip above it does. */
function Products({ view, onProject }: { view: DivanView; onProject: (key: string) => void }) {
  if (!view.projects.length) return <Nothing view={view} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionHeader title="Products" count={view.projects.length} note="worst first" />
      <Card inset={false}>
        {view.projects.map((p, i) => (
          <Row
            key={p.key} first={i === 0}
            lead={<Monogram name={p.name} index={i} size={32} />}
            title={p.name}
            note={summaryOf(p)}
            meta={p.stale ? `${uptime(view.now - (p.lastSeen ?? view.now))} old` : null}
            tone={p.stale ? 'ink3' : undefined}
            right={<Marks project={p} />}
            chevron
            onClick={() => onProject(p.key)}
          />
        ))}
      </Card>
    </div>
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

/** Nothing to draw, in whichever of its three ways. A page with no products on
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

/** `4 products`, `1 machine`. */
function count(n: number, what: string): string {
  return `${n} ${what}${n === 1 ? '' : 's'}`;
}

function clock(ts: number | null): string {
  if (ts == null) return 'never';
  return new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
