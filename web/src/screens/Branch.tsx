/** One face of a product: Quire / Engineering, and the same layout for every
 *  other branch.
 *
 *  Web14 W7 is this page. The breadcrumb, then the name with what the branch is
 *  doing under it and its numbers against it, then the branch's own blocks in a
 *  three-column grid. Engineering fills them with repositories, tickets and what
 *  was said; another branch uses the same slots for the same three questions
 *  asked of its own cards — one layout for every branch, which is the frame's own
 *  note on it.
 *
 *  **A branch with no source connected says so.** `summary` is empty until one
 *  is, and every branch but engineering is in that state today (`docs/PROTOCOL.md`,
 *  "Branches are the faces of a product"). So the line under the name is the
 *  branch's own sentence where something wrote one, the worst card's line where
 *  nothing did, and *no source connected yet* where there is neither — never a
 *  number nobody measured. The frame's `deploys per day · 30 days` chart, its
 *  `212/214 tests`, its `v3.18 deployed` and the check marks beside a repository
 *  are exactly those numbers, and none of them is drawn: nothing carries a
 *  day-by-day history, a test result or a deploy.
 *
 *  What is on the page is the board's own: how much is open on this face, what is
 *  in progress, what is done, the repositories its cards run in, the cards
 *  themselves and what the mirror last wrote on them. The judgements are
 *  `lib/project.ts`.
 */
import { uptime } from '../lib/format';
import { clock } from '../lib/overview';
import {
  branchCards, branchState, cardsOn, figures, happened, refreshed, repoRows, NO_SOURCE,
} from '../lib/project';
import { STATE_MARK, T } from '../lib/theme';
import type { MergedBranch, MergedCard, MergedProject } from '../lib/divan';
import { cardMark } from '../lib/board';
import {
  Card, EmptyState, Figures, Monogram, Row, SectionHeader, StampRow, StatusDot, Tag,
} from '../ui/divan';
import { mono } from '../ui/kit';

export function Branch({ project: p, branch: b, index, now, onProject, onCard }: {
  project: MergedProject;
  branch: MergedBranch;
  /** The product's place in the list, so its monogram is the hue it is
   *  everywhere else. */
  index: number;
  now: number;
  onProject: () => void;
  onCard: (card: MergedCard) => void;
}) {
  const cards = cardsOn(p, b.kind);
  const state = branchState(cards);
  const fresh = refreshed(b, now);
  const said = happened(p, b.kind);
  const repos = repoRows(p, b.kind);
  // The line under the name is the branch card's own reading, so the grid a
  // person came from and the page they arrived at cannot disagree.
  const card = branchCards(p, now).find((x) => x.kind === b.kind);

  return (
    // No shorter than what is in it, for the reason the product's page gives.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, flexShrink: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 500, color: T.ink2,
      }}>
        <Monogram name={p.name} index={index} size={20} />
        <button type="button" onClick={onProject} title={`Everything on ${p.name}`}
          style={{
            background: 'transparent', border: 'none', padding: 0, font: 'inherit',
            color: T.ink2, cursor: 'pointer',
          }}>{p.name}</button>
        <span style={{ color: T.ink3 }}>/</span>
        <span style={{ color: T.ink }}>{b.name || b.kind}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <StatusDot state={state === 'quiet' ? T.line2 : state} />
          <span style={{ ...mono, fontSize: 12, color: T.ink3 }}>
            {b.machines.length ? b.machines.join(' · ') : 'no machine'}
          </span>
        </span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 24, alignItems: 'end',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-.02em' }}>
            {b.name || b.kind}
          </div>
          <div style={{
            fontSize: 15, lineHeight: 1.45, color: T.ink2, marginTop: 6,
          }}>{card?.line ?? NO_SOURCE}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          {!!fresh && (
            <span style={{
              ...mono, fontSize: 11, color: fresh.tone === 'amber' ? T.amber : T.ink3,
            }}>{fresh.text}</span>
          )}
          <Figures figures={figures(b)} />
        </div>
      </div>

      {!cards.length && !repos.length ? (
        <EmptyState
          title="Nothing on this face yet."
          body={`No card on the board names ${b.name || b.kind}, and nothing is connected behind it.
                 Tell Divan about a card in the chat and it lands in the Ice Box, which starts
                 nothing.`}
          foot={p.machines.join(' · ') || 'no machine'}
        />
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12,
          alignItems: 'start',
        }}>
          <Card inset={false} style={{ padding: '16px 18px 4px' }}>
            <SectionHeader title="Repositories" count={repos.length || null} />
            {/* Each row carries its own hairline, the head above them included:
                the frame draws `border-top` on every one. */}
            {repos.length ? repos.map((r) => (
              <Row key={r.path} mark title={r.name}
                note={r.machines.join(' · ') || undefined}
                style={{ padding: '10px 0', gap: 8 }} />
            )) : (
              <div style={{ fontSize: 13.5, color: T.ink2, padding: '4px 0 14px' }}>
                Nothing on this face names a repository.
              </div>
            )}
          </Card>

          <Card inset={false} style={{ padding: '16px 18px 4px' }}>
            <SectionHeader title="Cards" count={cards.length || null} />
            {cards.length ? cards.slice(0, 6).map((c) => {
              const mark = cardMark(c, now, uptime);
              return (
                <Row key={c.id} title={c.title} onClick={() => onCard(c)}
                  note={c.machine} style={{ padding: '10px 0', gap: 8 }}
                  right={mark
                    ? <Tag mark={STATE_MARK[mark.state]} label={mark.label} tone={mark.tone} />
                    : undefined} />
              );
            }) : (
              <div style={{ fontSize: 13.5, color: T.ink2, padding: '4px 0 14px' }}>
                No card on the board names this face.
              </div>
            )}
          </Card>

          <Card inset={false} style={{ padding: '16px 18px 14px' }}>
            <SectionHeader title="Recent activity" />
            {said.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10 }}>
                {said.slice(0, 4).map((h) => (
                  <StampRow key={h.card.id} at={clock(h.at)} text={h.text} />
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13.5, color: T.ink2, paddingTop: 10 }}>
                Nothing has been said on this face yet.
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
