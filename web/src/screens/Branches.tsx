/** The faces a product has beside its code, as a grid — and where its code
 *  actually is.
 *
 *  This was the top half of the product page (Web14 W6) until the page became
 *  about what is happening on the product and how it got there. It is a tab of
 *  its own now, for the reason the two are different questions: this one says
 *  how a product is *organised* — engineering, SEO, analytics, marketing,
 *  customers — and that is something a person looks up rather than something
 *  they open a product to find out.
 *
 *  Unchanged in the move, deliberately: the three fixed number slots, the amber
 *  age on a branch whose source has gone quiet, and the sentence a branch with
 *  no source connected says instead of a number. The judgements are still
 *  `lib/project.ts`, which the phone is held to as well.
 *
 *  What the frame draws and this does not is `+ Add branch`: nothing creates a
 *  branch from a client — a product and its faces are made by saying so to the
 *  agent in a chat (`docs/PROTOCOL.md`, `divan.project.create`) — and a dashed
 *  card that led nowhere would be worse than the gap.
 */
import { uptime } from '../lib/format';
import { clock, figure } from '../lib/overview';
import { branchCards, happened } from '../lib/project';
import { T } from '../lib/theme';
import type { MergedProject } from '../lib/divan';
import { Card, Figures, SectionHeader, StampRow, StatusDot } from '../ui/divan';
import { mono } from '../ui/kit';

export function Branches({ project: p, now, onBranch }: {
  project: MergedProject;
  now: number;
  /** A branch card is a way in: its own page is Web14 W7. */
  onBranch: (kind: string) => void;
}) {
  const branches = branchCards(p, now);
  return (
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
        <History project={p} now={now} />
      </div>
    </div>
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
