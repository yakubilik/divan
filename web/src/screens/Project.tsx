/** One product's page: what is happening on it, what it is waiting for, and the
 *  faces it has beside its code.
 *
 *  Web14 W6 is this page. Top down, the frame's own arrangement: the now/waiting
 *  block, the branches in a three-column grid that grows by rows, and on the
 *  right what the product's history says. The head above it — the monogram, the
 *  name, what it is for, the machines it is on and the tabs — is the page head in
 *  `screens/Overview.tsx`, which both tabs of a product hang under.
 *
 *  What the frame draws and this page does not, and why:
 *
 *   · **the conversations filed under a product.** A chat carries a folder and
 *     nothing else on this daemon — there is no filing to read — and the same
 *     gap is why the head offers two tabs where the frame has three. What stands
 *     in that column instead is the two things that do exist: what git says about
 *     the repositories the product owns, and what its agents last said.
 *   · **`+ Add branch`.** Nothing creates a branch from a client: a product and
 *     its faces are made by saying so to the agent in a chat, which is the
 *     entrance `docs/PROTOCOL.md` describes for `divan.project.create`. A dashed
 *     card that led nowhere would be worse than the gap.
 *
 *  The judgements are `lib/project.ts`, held to the phone's own answers by
 *  `scripts/test-overview.mjs`: a panel and a phone that disagreed about what a
 *  branch is waiting for would be two products. What is left here is the
 *  arrangement.
 */
import { uptime } from '../lib/format';
import { clock, figure } from '../lib/overview';
import {
  blank, blankBody, branchCards, happened, nowLine, oldLine, quiet, waitingLine,
} from '../lib/project';
import { RADIUS, T, toneColours } from '../lib/theme';
import type { DivanView, MergedProject } from '../lib/divan';
import { Card, EmptyState, Figures, SectionHeader, StampRow, StatusDot } from '../ui/divan';
import { mono } from '../ui/kit';

export function Project({ view, project: p, onBranch }: {
  view: DivanView;
  project: MergedProject;
  /** A branch card is a way in: its own page is Web14 W7. */
  onBranch: (kind: string) => void;
}) {
  const asleep = quiet(p, view.now, uptime);
  const old = oldLine(p, view.now, uptime);
  const branches = branchCards(p, view.now);

  if (blank(p)) {
    return (
      <EmptyState
        title="A new board."
        body={blankBody(p)}
        foot="Nothing starts by itself: a card runs when it is moved into In Progress."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
      {!!old && <div style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink2 }}>{old}</div>}
      {asleep
        ? (
          <Card hollow style={{ gap: 6 }}>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-.01em' }}>{asleep.title}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink2 }}>{asleep.body}</div>
          </Card>
        )
        : <States view={view} project={p} />}
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 24, alignItems: 'start',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <SectionHeader title="Branches" count={branches.length} />
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10,
          }}>
            {branches.map((b) => (
              <Card key={b.key} onClick={() => onBranch(b.kind)} title={`Everything on ${b.name}`}
                style={{ gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {/* A branch with nothing on it is the frame's unfilled dot: the
                      hairline, which is quieter than a state's grey. */}
                  <StatusDot state={b.state === 'quiet' ? T.line2 : b.state} size={8} />
                  <span style={{
                    fontSize: 15, fontWeight: 600, minWidth: 0,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{b.name}</span>
                  {!!b.refreshed && (
                    <span style={{
                      ...mono, fontSize: 11, marginLeft: 'auto', flex: 'none', whiteSpace: 'nowrap',
                      color: b.refreshed.tone === 'amber' ? T.amber : T.ink3,
                    }}>{b.refreshed.text}</span>
                  )}
                </div>
                <div style={{
                  fontSize: 13.5, lineHeight: 1.4, color: T.ink2, minHeight: 38,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>{b.line}</div>
                {!!b.figures.length && <Figures figures={b.figures} />}
              </Card>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <History project={p} now={view.now} />
        </div>
      </div>
    </div>
  );
}

/** The two rows at the top (Web14 W6): a mono label in the colour of the worst
 *  thing it is about, and the sentence beside it. Always two, because "nothing
 *  is running" and "nothing is waiting on you" are answers — a block that
 *  dropped a row when the answer was calm would make the reader work out which
 *  of the two was missing. */
function States({ view, project: p }: { view: DivanView; project: MergedProject }) {
  const now = nowLine(view, p);
  const wait = waitingLine(p);
  return (
    <Card radius={RADIUS.tile} style={{ padding: '12px 16px', gap: 6 }}>
      {[{ label: 'now', line: now, quiet: false }, { label: 'waiting', line: wait, quiet: true }]
        .map((row) => (
          <div key={row.label} style={{
            display: 'grid', gridTemplateColumns: '70px minmax(0, 1fr)', gap: 10,
          }}>
            <span style={{
              ...mono, fontSize: 11, lineHeight: '20px', fontWeight: 600,
              color: row.line.tone ? toneColours(row.line.tone).fg : T.ink3,
            }}>{row.label}</span>
            <span style={{
              fontSize: 14, lineHeight: 1.4, color: row.quiet ? T.ink2 : T.ink,
            }}>{row.line.text}</span>
          </div>
        ))}
    </Card>
  );
}

/** The right-hand column: the repositories the product owns with what git said
 *  about them, and the last things its agents said. Both are counted or quoted —
 *  a product with no repository to read says so, and one nothing has been said
 *  about draws no list rather than an empty card. */
function History({ project: p, now }: { project: MergedProject; now: number }) {
  const git = figure(p, now, uptime);
  // Everything said on the product, whichever face it was said on: a branch page
  // asks the same question of one face.
  const said = happened(p, null).slice(0, 4);
  return (
    <>
      <SectionHeader title="Repositories" count={p.repos.length || null} />
      <Card>
        {p.repos.length ? (
          <div style={{ ...mono, fontSize: 12.5, lineHeight: 1.7, color: T.ink2 }}>
            {p.repos.map((r) => (
              <div key={r} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.split(/[/\\]/).filter(Boolean).pop()}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13.5, color: T.ink2 }}>No repository attached yet.</div>
        )}
        {git
          ? (
            <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 10 }}>
              <div style={{ ...mono, fontSize: 17, fontWeight: 500, letterSpacing: '-.01em' }}>
                {git.value}
              </div>
              <div style={{ ...mono, fontSize: 10.5, color: T.ink3, marginTop: 2 }}>
                {git.label} · {git.moved}
              </div>
            </div>
          )
          : (
            <div style={{
              ...mono, fontSize: 11, color: T.ink3, borderTop: `1px solid ${T.line}`, paddingTop: 10,
            }}>no machine could read its history</div>
          )}
      </Card>
      {!!said.length && (
        <>
          <SectionHeader title="Recent activity" />
          <Card>
            {said.map((h) => (
              <StampRow key={h.card.id} at={clock(h.at)} text={h.text} />
            ))}
          </Card>
        </>
      )}
    </>
  );
}

