/** One branch's page, out of the design system's parts and nothing else.
 *
 *  What each block *says* is decided in `src/branch.ts`, where a check can reach
 *  it without a phone; this is the drawing of it. Every shape here was measured
 *  off `design/divan/frames/09-mobile9-*.html` — S10, a branch with the generic
 *  layout, and S11, the same layout with Engineering's three extra blocks in the
 *  middle of it — and the frame each one came from is named above it.
 *
 *  The rule the file is written under is the frames' own: **the two variants are
 *  one page.** Every block here is drawn the same way on every branch; what
 *  Engineering adds is three more of the same kind of block, not a second
 *  design. So there is no shape in this file that only one branch can use, and
 *  the rows all share the frame's own list: a hairline above each one, `9-10 pt`
 *  of air around it, and the far end for whatever the row has to say about
 *  itself.
 *
 *  Colour never comes from here: a tone is asked of the token table through
 *  `toneColours`, and the parts these are built out of (`components/divan`)
 *  bring their own. There is no placeholder — a row with nothing in one of its
 *  slots is drawn without that slot. */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './icon';
import { Text } from './text';
import { Card, ExecutorBadge, StatusDot, Tap } from './divan';
import { em, RADIUS, toneColours, useTokens, type State, type Tone } from '../theme';

// ── 1 · whose page this is ──────────────────────────────────────────────────

/** Mobile9 S10: the branch's name at 28 pt semibold with the product's name in
 *  mono beside it, and at the far end — where the frame draws `● live` — a dot
 *  and when this branch's source last spoke.
 *
 *  The frame's `live` is the branch agent's own state, which nothing on the wire
 *  reports; the dot is the worst thing true of the branch's cards and the word
 *  beside it is the clock the branch card in the project page already carries,
 *  so the two screens say the same thing about the same branch. */
export function BranchHead({ name, project, state, refreshed, tone, style }: {
  name: string;
  project: string;
  state: State;
  /** `07:02`, `3 days old`. Absent where no source has ever refreshed it. */
  refreshed?: string | null;
  tone?: Tone | null;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 4 }, style]}>
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 28, fontWeight: '600', letterSpacing: em(28, -0.02) }}>
        {name}
      </Text>
      <Text mono numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, color: t.ink3 }}>{project}</Text>
      <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <StatusDot size={7} state={state === 'quiet' ? t.line2 : state} />
        {!!refreshed && (
          <Text mono numberOfLines={1}
            style={{ fontSize: 11.5, color: tone ? toneColours(t, tone).fg : t.ink3 }}>{refreshed}</Text>
        )}
      </View>
    </View>
  );
}

// ── 2 · a block with nothing behind it yet ──────────────────────────────────

/** The place the chart has (S10 and S11 both draw one: `background:s1;
 *  border-radius:14px; padding:12px 14px 10px; gap:8`, a mono label across the
 *  top and the figures under it), with the reason there is nothing in it.
 *
 *  It is the same card the chart would be drawn in, at the same place in the
 *  page, because that is the honest way to say a source is missing: a page that
 *  quietly left the block out would read as a page that has no such block. */
export function NoSource({ label, body, style }: {
  label: string;
  body: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Card radius={RADIUS.tile} inset={false} style={style}>
      <View style={{ padding: 12, paddingHorizontal: 14, paddingBottom: 10, gap: 8 }}>
        <Text mono numberOfLines={1} style={{ fontSize: 11, color: t.ink3 }}>{label}</Text>
        <Text style={{ fontSize: 13, lineHeight: 13 * 1.45, color: t.ink2 }}>{body}</Text>
      </View>
    </Card>
  );
}

// ── 3 · a row of a list ─────────────────────────────────────────────────────

/** Every list on this page is the same row: a hairline above it, something at
 *  the left, the middle, and whatever the row says about itself at the far end
 *  (S10's log and tickets, S11's repositories and pull requests).
 *
 *  It is one part rather than four because the frames draw one shape four times
 *  — that is what makes Engineering the same page as SEO rather than a denser
 *  relative of it. */
function Row({ first, onPress, children, style }: {
  first?: boolean;
  onPress?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Tap onPress={onPress}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
              !first && { borderTopWidth: 1, borderTopColor: t.line }, style]}>
      {children}
    </Tap>
  );
}

/** The mono chip at the end of a row: what the agent on this card is doing
 *  (S10's `● 9/14`, S11's `× tests`). Mono 11 at `padding:4px 8px;
 *  border-radius:7px`, its tone's colour on its tone's wash — the board's own
 *  chip, at the board's own size. */
function Chip({ text, tone }: { text: string; tone: Tone }) {
  const t = useTokens();
  const col = toneColours(t, tone);
  return (
    <Text mono numberOfLines={1}
      style={{ marginLeft: 'auto', fontSize: 11, fontWeight: '500', color: col.fg,
               backgroundColor: tone === 'ink2' || tone === 'ink3' ? 'transparent' : col.bg,
               paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, overflow: 'hidden' }}>
      {text}
    </Text>
  );
}

// ── 4 · what the agent did ──────────────────────────────────────────────────

/** One line of the log (S10, S11): a 62 pt mono clock against what was said at
 *  it, `padding:7px 0` over a hairline.
 *
 *  The clock goes amber when the computer it happened on has since gone quiet:
 *  the line is then the last thing that machine said rather than the last thing
 *  that happened, and the difference is the whole reason the page has a clock on
 *  every row. */
export function LogRow({ at, text, machine, stale, first, style }: {
  at: string;
  text: string;
  machine?: string | null;
  stale?: boolean;
  first?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 7 },
                  !first && { borderTopWidth: 1, borderTopColor: t.line }, style]}>
      <Text mono numberOfLines={1}
        style={{ width: 62, fontSize: 11, lineHeight: 18, color: stale ? t.amber : t.ink3 }}>{at}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ fontSize: 13.5, lineHeight: 18, color: t.ink2 }}>{text}</Text>
        {!!machine && <Text mono numberOfLines={1} style={{ fontSize: 10.5, color: t.ink3 }}>{machine}</Text>}
      </View>
    </View>
  );
}

// ── 5 · a card that belongs to the branch ───────────────────────────────────

/** One of the branch's tickets (S10): a 22 pt executor square, the title over
 *  the column it is in, and the state chip at the far end.
 *
 *  A row and not a board card: this list is the whole board of one branch, read
 *  rather than arranged, and the column is a line under the title instead of a
 *  tab over the list. Every one of them opens the card itself. */
export function TicketRow({ face, title, column, machine, mark, first, onPress, style }: {
  face: string;
  title: string;
  /** `In Progress`, `Queued` — already in the reader's language. */
  column: string;
  machine?: string | null;
  mark?: { text: string; tone: Tone } | null;
  first?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Row first={first} onPress={onPress} style={[{ paddingVertical: 10 }, style]}>
      <ExecutorBadge executor={face} size={22} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '500' }}>{title}</Text>
        <Text mono numberOfLines={1} style={{ fontSize: 10.5, color: t.ink3, marginTop: 2 }}>
          {machine ? `${column} · ${machine}` : column}
        </Text>
      </View>
      {!!mark && <Chip text={mark.text} tone={mark.tone} />}
    </Row>
  );
}

// ── 6 · Engineering's two blocks that have a source ─────────────────────────

/** A repository the product owns (S11): a 15 pt glyph, the path's last segment
 *  in mono, and at the far end the computers it is checked out on.
 *
 *  The frame puts `✓ checks` there instead. That is the code host's word and
 *  nothing is connected to it, so what stands in the same place is something
 *  this phone actually knows — and never a tick nobody measured. */
export function RepoRow({ name, machines, first, style }: {
  name: string;
  machines?: string | null;
  first?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Row first={first} style={style}>
      <Icon name="folder_open" size={15} color={t.ink3} />
      <Text mono numberOfLines={1} style={{ flexShrink: 1, fontSize: 13.5, fontWeight: '500' }}>{name}</Text>
      {!!machines && (
        <Text mono numberOfLines={1} style={{ marginLeft: 'auto', fontSize: 11, color: t.ink3 }}>{machines}</Text>
      )}
    </Row>
  );
}

/** …and what has landed in it lately (S11's `Recent commits`): the repository,
 *  when it last moved, and how much has landed in seven days.
 *
 *  The age takes the same amber a stale branch does once it is older than a
 *  day, which is the one colour on this row and the one thing worth noticing on
 *  it: a repository the branch has not touched since Tuesday. */
export function CommitRow({ name, said, tone, landed, first, style }: {
  name: string;
  /** `21:14`, `2 days old`. Absent where the reading carried no last commit. */
  said?: string | null;
  tone?: Tone | null;
  landed: string;
  first?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Row first={first} style={style}>
      <Text mono numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, color: t.ink2 }}>{name}</Text>
      {!!said && (
        <Text mono numberOfLines={1}
          style={{ fontSize: 11, color: tone ? toneColours(t, tone).fg : t.ink3 }}>{said}</Text>
      )}
      <Text mono numberOfLines={1}
        style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: '500', color: t.ink3 }}>{landed}</Text>
    </Row>
  );
}

/** …and one pull request open on one of them (S11's `Pull requests`): the
 *  number in mono in a fixed 36 pt column, the title, and how its checks stand
 *  at the far end.
 *
 *  The number column is fixed so that three of them line up under each other
 *  the way the frame draws them. A pull request with no checks at all gets no
 *  chip — not a grey one, and certainly not a green one. */
export function PullRow({ number, title, note, checks, first, style }: {
  number: number;
  title: string;
  /** The mono line under it: which repository it is on where the product owns
   *  more than one, and whether it is a draft. Already in the reader's
   *  language. */
  note?: string | null;
  /** `× 2 checks`, `✓ checks`. Absent where the pull request has no checks. */
  checks?: { text: string; tone: Tone } | null;
  first?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Row first={first} style={style}>
      <Text mono numberOfLines={1} style={{ width: 36, fontSize: 11.5, color: t.ink3 }}>
        {`#${number}`}
      </Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '500' }}>{title}</Text>
        {!!note && (
          <Text mono numberOfLines={1} style={{ fontSize: 10.5, color: t.ink3, marginTop: 2 }}>{note}</Text>
        )}
      </View>
      {!!checks && <Chip text={checks.text} tone={checks.tone} />}
    </Row>
  );
}

// ── 7 · a block with nothing in it ──────────────────────────────────────────

/** The grey line a list draws in its own place when it is empty — an empty log,
 *  a branch with no cards on it, a product with no repository.
 *
 *  The same 13 pt `ink2` sentence at the same inset as a row, so that the
 *  structure of the page survives having nothing in it, which is the design's
 *  rule for every empty state in this product. */
export function Nothing({ text, style }: { text: string; style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  return (
    <Text style={[{ fontSize: 13, lineHeight: 13 * 1.45, color: t.ink2, paddingVertical: 7,
                    paddingHorizontal: 4 }, style]}>{text}</Text>
  );
}
