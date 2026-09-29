/** The parts the new desktop screens are made of.
 *
 *  The screens themselves follow in later tickets — a dashboard over several
 *  projects, a project, a branch, a ticket, the machine pages — and none of them
 *  should have to decide again what a card is, how tall a pill stands or which
 *  grey a timestamp takes. Everything here was measured off
 *  `design/divan/frames/12-web12-*.html` … `15-web15-*.html`: the frame and the
 *  option each part came from is named above it, and the numbers are the
 *  frame's own. A part the desktop frames never draw says so.
 *
 *  Colour never comes from here. Every value is a token reference out of
 *  `src/lib/theme.ts` (`T.ink3` is `var(--dv-ink3)`), so a screen built out of
 *  these parts is correct in both themes without knowing which one it is in,
 *  and cannot introduce a colour of its own. `scripts/test-divan.mjs` renders
 *  every part in both themes and reads the colours back off the markup.
 *
 *  `ui/kit.tsx` is the older set the existing screens are built from. The two
 *  are not meant to be mixed in one file; what this module does take from it is
 *  the icon vocabulary (`Icon`, `P`) and the mono style, because a second set of
 *  glyphs would be a worse duplication than this import.
 */
import React from 'react';
import {
  EXECUTORS, monogram, ON_COLOUR, outline, RADIUS,
  SHADOW, SIZE, STATE_MARK, stateColour, T, toneColours,
  type ExecutorFace, type State, type Tone,
} from '../lib/theme';
import { Icon, P, mono } from './kit';

/** A part that goes somewhere is a button; one that does not is a plain box.
 *  The frames draw no pressed or hovered state, so neither is invented here:
 *  what a press does is the screen's business, and what it looks like is the
 *  browser's default cursor and nothing else. */
function Tap({ onClick, title, style, children }: {
  onClick?: () => void; title?: string;
  style: React.CSSProperties; children?: React.ReactNode;
}) {
  if (!onClick) return <div style={style} title={title}>{children}</div>;
  return (
    <button type="button" onClick={onClick} title={title}
      style={{ ...style, border: style.border ?? 'none', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
      {children}
    </button>
  );
}

// ── 1 · card ────────────────────────────────────────────────────────────────

/** The block everything on a Divan screen sits in.
 *
 *  Web14 W6: `background:var(--s1); border-radius:16px; padding:16px 18px;
 *  gap:12px`, and — 56 times across the four desktop frames — a hairline drawn
 *  as `box-shadow:0 0 0 1px var(--line)` rather than as a border, so that the
 *  corner stays exact and the ring costs no layout.
 *
 *  The ring is the card's whole state vocabulary: `line` when it is ordinary,
 *  `amber` when it is asking (Web12 W1's panel, `inset 0 0 0 1px` in the amber),
 *  `red` when it has stopped, `run` when it is the one being carried. Web14 W9
 *  draws the card that is being typed into at `0 0 0 1.5px var(--amber)` with a
 *  long fall under it, which is `ring="amber"` and `raised`.
 *
 *  `bar` is the two-pixel green rule across the top of a card whose work is
 *  running, at the fraction of it that is done.
 *
 *  The frames draw two paddings and this is both of them: a card that is a
 *  section of a page is `16px 18px` (Web14 W6), and a card that is a ticket in
 *  a board column is `12px 14px 13px` at `gap:8px`, which is `tight` (Web12 W2,
 *  where four columns of them agree).
 *
 *  `inset={false}` is the card whose children carry the padding, because they
 *  are rows rather than a block — the agent roster of Web12 W1 (`padding:2px
 *  12px`, each row over a `line`) and the machines table of Web15 W12. */
export function Card({
  ring = 'line', lifted, raised, bar, radius = RADIUS.card, inset = true, tight,
  onClick, title, style, children,
}: {
  ring?: 'line' | 'amber' | 'red' | 'run' | 'none';
  /** Being carried: the surface a step further from the page. */
  lifted?: boolean;
  /** Standing over the page rather than on it — a popover, the card being
   *  written. Thickens the ring to 1.5px, the way Web14 W9 draws it. */
  raised?: boolean;
  bar?: number | null;
  radius?: number;
  inset?: boolean;
  /** A ticket card rather than a section of a page. */
  tight?: boolean;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const edge = ring === 'none' ? null
    : ring === 'amber' ? T.amberRing
    : ring === 'red' ? T.red
    : ring === 'run' ? T.run
    : lifted ? T.line2 : T.line;
  const width = raised ? 1.5 : 1;
  const shadow = [
    edge ? `0 0 0 ${width}px ${edge}` : null,
    raised ? `0 12px 30px ${T.sh}` : lifted ? SHADOW.pop : null,
  ].filter(Boolean).join(', ');
  return (
    <Tap onClick={onClick} title={title} style={{
      background: lifted ? T.sLift : T.s1,
      borderRadius: radius,
      boxShadow: shadow || undefined,
      padding: !inset ? 0 : tight ? '12px 14px 13px' : '16px 18px',
      display: 'flex', flexDirection: 'column', gap: !inset ? 0 : tight ? 8 : 12,
      minWidth: 0, overflow: 'hidden',
      ...style,
    }}>
      {bar != null && (
        <div style={{
          height: 2, width: `${Math.max(0, Math.min(1, bar)) * 100}%`, background: T.run,
          margin: !inset ? 0 : tight ? '-12px -14px 0' : '-16px -18px 0', flexShrink: 0,
        }} />
      )}
      {children}
    </Tap>
  );
}

// ── 2 · row ─────────────────────────────────────────────────────────────────

/** A line of a list, one level deep and no further.
 *
 *  Web15 W12, the machines table: `padding:13px 18px; gap:14px; border-top:1px
 *  solid var(--line)`, a 32 pt well of `s2` holding a 17 pt glyph, a 14 pt
 *  semibold title over a 12 pt grey line, and mono meta at the end — `12s ago`,
 *  `3 tasks` — in `ink2`, or in a state's colour when something is wrong. A row
 *  that wants a person is washed in that state (`background:var(--amberBg)`,
 *  which is the unreachable machine of that frame).
 *
 *  `right` is what that table puts at the far end: the row's own buttons. A row
 *  that goes somewhere instead has the chevron. */
export function Row({
  icon, title, note, meta, tone, wash, right, first, chevron, mark, onClick, style,
}: {
  /** A path out of `P`, the panel's own icon vocabulary. */
  icon?: string;
  title: React.ReactNode;
  /** The grey line under it. */
  note?: React.ReactNode;
  /** The mono word at the end: `all reachable`, `2h 14m`. */
  meta?: string | null;
  /** Which state that word is in. Grey unless something is wrong. */
  tone?: Tone;
  /** Wash the whole row in that state, the way an unreachable machine is. */
  wash?: boolean;
  right?: React.ReactNode;
  /** The first row of a list has no line above it. */
  first?: boolean;
  chevron?: boolean;
  /** A title set in mono: a machine's name, a ticket's id. */
  mark?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  const t = tone ? toneColours(tone) : null;
  return (
    <Tap onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px',
      borderTop: first ? undefined : `1px solid ${T.line}`,
      background: wash && t ? t.bg : 'transparent',
      width: '100%', boxSizing: 'border-box', minWidth: 0, color: T.ink,
      ...style,
    }}>
      {!!icon && (
        <span style={{
          flex: 'none', width: SIZE.rowWell, height: SIZE.rowWell, borderRadius: RADIUS.well,
          background: T.s2, color: T.ink2, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon path={icon} size={SIZE.rowIcon} color={T.ink2} />
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          ...(mark ? mono : null), display: 'block', fontSize: 14, fontWeight: 600,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{title}</span>
        {!!note && (
          <span style={{
            display: 'block', fontSize: 12, color: T.ink3, marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{note}</span>
        )}
      </span>
      {!!meta && (
        <span style={{
          ...mono, flex: 'none', fontSize: 12.5, fontWeight: tone ? 500 : 400,
          color: t ? t.fg : T.ink2, whiteSpace: 'nowrap',
        }}>{meta}</span>
      )}
      {right}
      {chevron && <Icon path={P.chevronRight} size={16} color={T.ink3} />}
    </Tap>
  );
}

// ── 3 · pill ────────────────────────────────────────────────────────────────

/** The one tappable shape that is not a row: the project chips across the top
 *  bar, and the answers under a question.
 *
 *  Web12 W1 and Web14 W6/W9 draw it 46 times, character for character:
 *  `height:32px; padding:0 12px; border-radius:16px; gap:7px; font:500 13px`,
 *  a 7 pt dot in front, `s1` behind it — and the selected one filled with
 *  `ink`, its label in the page colour. Web12 W1's chat panel draws the same
 *  shape as an answer: amber when it is the one being proposed, an `inset 0 0 0
 *  1px var(--line2)` outline when it is one of the others. */
export function Pill({ label, face = 'surface', dot, onClick, title, style }: {
  label: React.ReactNode;
  /** `surface` an unselected chip · `ink` the selected one · `amber` the answer
   *  being proposed · `outline` an answer beside it. */
  face?: 'surface' | 'ink' | 'amber' | 'outline';
  /** The dot in front, as a state or as a colour outright. */
  dot?: State | string | null;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
}) {
  const background = face === 'ink' ? T.ink : face === 'amber' ? T.amber
    : face === 'outline' ? 'transparent' : T.s1;
  const colour = face === 'ink' ? T.bg : face === 'amber' ? T.onAmber : T.ink;
  return (
    <Tap onClick={onClick} title={title} style={{
      flex: 'none', height: SIZE.pill, padding: '0 12px', borderRadius: RADIUS.pill,
      display: 'inline-flex', alignItems: 'center', gap: 7,
      fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
      background, color: colour,
      boxShadow: face === 'outline' ? outline(T.line2) : undefined,
      ...style,
    }}>
      {!!dot && <StatusDot state={dot} />}
      {label}
    </Tap>
  );
}

/** The buttons a card and an empty state end on. Web14 W9: `height:34px;
 *  border-radius:11px`, the filled one `background:var(--ink); color:var(--bg)`
 *  at 600 14, the outlined one `1px solid var(--line2)` at 500 14. Web15 W12's
 *  row actions are the same button one step smaller (`height:32px;
 *  border-radius:9px`), which is `small`. */
export function Button({ label, face = 'ink', icon, small, wide, onClick, title, style }: {
  label: React.ReactNode;
  face?: 'ink' | 'amber' | 'outline';
  icon?: string;
  small?: boolean;
  wide?: boolean;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
}) {
  const background = face === 'ink' ? T.ink : face === 'amber' ? T.amber : 'transparent';
  const colour = face === 'ink' ? T.bg : face === 'amber' ? T.onAmber : T.ink;
  return (
    <Tap onClick={onClick} title={title} style={{
      flex: wide ? 1 : 'none',
      height: small ? SIZE.pill : SIZE.button,
      padding: small ? '0 12px' : '0 14px',
      borderRadius: small ? RADIUS.well : RADIUS.button,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      fontSize: small ? 13 : 14, fontWeight: face === 'outline' ? 500 : 600, whiteSpace: 'nowrap',
      background, color: colour,
      boxShadow: face === 'outline' ? outline(T.line2) : undefined,
      ...style,
    }}>
      {!!icon && <Icon path={icon} size={16} color={colour} />}
      {label}
    </Tap>
  );
}

// ── 4 · tab ─────────────────────────────────────────────────────────────────

export interface TabItem {
  key: string;
  label: string;
  /** The number the frames put after the word: `Chats 6`. */
  count?: number | string | null;
}

/** Overview · Board · Chats, over a project. Web14 W6 and Web12 W2: a track of
 *  `s1` at `border-radius:12px; padding:3px`, each tab `padding:8px 18px` at
 *  `500 13.5px`, and the selected one a card sitting in that well — `s2` at
 *  `border-radius:9px`, the others in `ink2`. */
export function Tabs({ tabs, value, onChange, style }: {
  tabs: TabItem[];
  value: string;
  onChange?: (key: string) => void;
  style?: React.CSSProperties;
}) {
  return (
    <div role="tablist" style={{
      flex: 'none', display: 'flex', background: T.s1, borderRadius: RADIUS.tab, padding: 3,
      fontSize: 13.5, fontWeight: 500, ...style,
    }}>
      {tabs.map((tab) => {
        const on = tab.key === value;
        return (
          <button
            key={tab.key} type="button" role="tab" aria-selected={on}
            onClick={onChange && (() => onChange(tab.key))}
            style={{
              padding: '8px 18px', border: 'none', borderRadius: on ? RADIUS.well : 0,
              background: on ? T.s2 : 'transparent', color: on ? T.ink : T.ink2,
              font: 'inherit', cursor: onChange ? 'pointer' : 'default', whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
            {tab.count != null && <span style={{ ...mono, marginLeft: 7, color: T.ink3 }}>{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── 5 · column tab ──────────────────────────────────────────────────────────

/** One column of the board. On a phone the four columns are four tabs and the
 *  tabs are the drop targets; on the desktop there is room for the columns
 *  themselves, so the tab and the column are the same thing and this is it.
 *
 *  Web12 W2 and Web14 W9: `border-radius:16px; padding:12px; gap:10px`, the
 *  head `padding:2px 4px 6px` with the name at `600 14px`, a mono count 8 pt
 *  after it and a mono aside — `someday`, `agents working` — at the far end.
 *  The column that has work in it carries a faint green wash (the frames write
 *  it a third of the weight of `--runBg`, which is the one green wash the table
 *  has), and while a card is in the air every column that would take it shows a
 *  `1.5px dashed var(--line2)` outline and the one under the cursor turns green. */
export function ColumnTab({
  label, count, sub, live, dragging, dropping, onClick, style, children,
}: {
  label: string;
  count?: number | string | null;
  /** The mono aside at the far end. */
  sub?: string | null;
  /** Work is happening in this column. */
  live?: boolean;
  /** A card is in the air: every column says whether it would take it. */
  dragging?: boolean;
  /** This is the one under the cursor. */
  dropping?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const edge = dropping ? T.run : dragging ? T.line2 : null;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, minWidth: 0,
      borderRadius: RADIUS.card, padding: 12, boxSizing: 'border-box',
      background: dropping || live ? T.runBg : 'transparent',
      border: edge ? `1.5px ${dropping ? 'solid' : 'dashed'} ${edge}` : '1.5px solid transparent',
      ...style,
    }}>
      <button
        type="button" role="tab" aria-selected={!!dropping} onClick={onClick}
        style={{
          display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 4px 6px',
          background: 'transparent', border: 'none', font: 'inherit',
          cursor: onClick ? 'pointer' : 'default', color: dropping ? T.run : T.ink,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
        {count != null && (
          <span style={{ ...mono, fontSize: 12, color: dropping ? T.run : T.ink3 }}>{count}</span>
        )}
        {!!sub && (
          <span style={{
            ...mono, fontSize: 11, color: T.ink3, marginLeft: 'auto',
            whiteSpace: 'nowrap', flex: 'none',
          }}>{sub}</span>
        )}
      </button>
      {children}
    </div>
  );
}

// ── 6 · status dot ──────────────────────────────────────────────────────────

/** The smallest thing on a screen that carries a state: `width:7px;height:7px;
 *  border-radius:4px`, drawn 60-odd times across the frames — in a project
 *  chip, in front of a branch, three in a row for three machines. A machine
 *  that cannot be reached is the same circle drawn as a `1.5px` ring instead of
 *  a fill (Web15 W12), so the difference survives being looked at sideways. */
export function StatusDot({ state, size = SIZE.dot, hollow, style }: {
  /** One of the six states the frames colour, or a colour outright. */
  state: State | string;
  size?: number;
  hollow?: boolean;
  style?: React.CSSProperties;
}) {
  const colour = state in STATE_MARK ? stateColour(state as State) : state;
  return (
    <span style={{
      flex: 'none', width: size, height: size, borderRadius: size / 2, boxSizing: 'border-box',
      background: hollow ? 'transparent' : colour,
      border: hollow ? `1.5px solid ${colour}` : undefined,
      display: 'inline-block',
      ...style,
    }} />
  );
}

/** The same state as a character. Web12 W2's summary line is `? 1 asking · ■ 1
 *  stuck · ● 2 running · ○ 1 yours` at `500 12px` mono, each in its own colour —
 *  which is what keeps a board readable to an eye that does not separate red
 *  from green. */
export function StateMark({ state, label, size = 12, style }: {
  state: State;
  /** What follows the character: `1 stuck`. */
  label?: React.ReactNode;
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <span style={{
      ...mono, fontSize: size, fontWeight: 500, color: stateColour(state), whiteSpace: 'nowrap', ...style,
    }}>
      {STATE_MARK[state]}{label == null ? null : <> {label}</>}
    </span>
  );
}

// ── 7 · executor badge ──────────────────────────────────────────────────────

/** Who is on a ticket, in a square you can read at 28 pt.
 *
 *  Web12 W2 puts it on every card and Web14 W10 draws the roster: a Coder is
 *  `</>` on indigo, a branch agent its initial on its own colour, the research
 *  assistant and the two members of the household are circles. A ticket nobody
 *  has picked up yet is the same square as a dashed outline, in the one pair
 *  whose light side is derived rather than drawn (`execLine`/`execInk`). The
 *  mark is always mono, 700, tightened by `letter-spacing:-.06em` so that
 *  `</>` fits — all three numbers are the frames' own. */
export function ExecutorBadge({ executor, size = SIZE.executor, style }: {
  executor: string;
  size?: number;
  style?: React.CSSProperties;
}) {
  const face: ExecutorFace = EXECUTORS[executor] ?? EXECUTORS.unassigned;
  const fill = face.fill ?? (executor === 'you' ? T.ink : T.s2);
  const ink = face.dashed ? T.execInk
    : face.fill ? ON_COLOUR
    : executor === 'you' ? T.bg : T.ink;
  return (
    <span style={{
      ...mono, flex: 'none', width: size, height: size, boxSizing: 'border-box',
      borderRadius: face.round ? size / 2 : RADIUS.mark,
      background: face.dashed ? 'transparent' : fill,
      border: face.dashed ? `1.5px dashed ${T.execLine}`
        : !face.fill && executor !== 'you' ? `1.5px solid ${T.line2}` : undefined,
      color: ink, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.39, fontWeight: 700, letterSpacing: '-.06em',
      ...style,
    }}>{face.mark}</span>
  );
}

/** A project's letter on its own colour: `34px` at `border-radius:9px` on a
 *  project card (Web12 W1), `46px` at `13px` in a page head (Web14 W6), `18px`
 *  at `5px` in the agent roster — white on every one of the ramp's hues. */
export function Monogram({ name, index, size = SIZE.monogram, style }: {
  name: string;
  /** The project's place in the list being drawn, where there is one: the ramp
   *  is walked in order, so no two projects on a screen share a hue. */
  index?: number | null;
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <span style={{
      flex: 'none', width: size, height: size, borderRadius: Math.round(size * 0.27),
      background: monogram(name, index), color: ON_COLOUR,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.45), fontWeight: 600,
      ...style,
    }}>{(name.trim()[0] ?? '?').toUpperCase()}</span>
  );
}

// ── 8 · counter ─────────────────────────────────────────────────────────────

/** One of the four numbers across the top of the Dashboard.
 *
 *  Web12 W1: `border-radius:14px; padding:14px 16px`, the number in mono at
 *  `500 32px/1` and its name 10 pt under it at `500 13px`. A counter that is at
 *  zero drops its tint and its colour and goes grey on `s1` — Web13 W3 is the
 *  same four tiles on a calm morning, and the difference between the two is
 *  this component's whole behaviour.
 *
 *  `ring` outlines the tile in its tone instead of washing it, which is how
 *  "2 agents nobody has heard from" is told apart from "2 things need you": the
 *  same colour, and not the same kind of fact. */
export function Counter({ value, label, tone, ring, onClick, style }: {
  value: number | string;
  label: React.ReactNode;
  /** What it is a count of. Ignored while the count is 0. */
  tone?: Tone;
  ring?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  const zero = value === 0 || value === '0';
  const t = tone && !zero ? toneColours(tone) : null;
  return (
    <Tap onClick={onClick} style={{
      flex: 1, minWidth: 0, boxSizing: 'border-box',
      borderRadius: RADIUS.tile, padding: '14px 16px',
      background: t && !ring ? t.bg : ring ? 'transparent' : T.s1,
      boxShadow: t && ring ? `0 0 0 1.5px ${t.fg}` : undefined,
      ...style,
    }}>
      <div style={{
        ...mono, fontSize: 32, lineHeight: 1, fontWeight: 500,
        color: t ? t.fg : zero ? T.ink3 : T.ink,
      }}>{value}</div>
      <div style={{
        fontSize: 13, fontWeight: 500, marginTop: 10, color: t ? t.fg : T.ink2,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{label}</div>
    </Tap>
  );
}

// ── 9 · section header ──────────────────────────────────────────────────────

/** What stands above a run of cards. The frames use three, and they mean
 *  different things:
 *
 *  `page` — one per screen: Web12 W1's `Overview` at `600 28px` with
 *  `letter-spacing:-.02em`, and a mono aside at the far end saying how much of
 *  the page below it is true (`4 projects · 7 agents`). Web15's pages draw the
 *  same head at `600 26px` with the aside beside the title in plain text, which
 *  is `note`.
 *
 *  `title` (Web12 W1 above Projects and Agents, 32 times across the frames) is
 *  a `600 15px` with a mono count or aside next to it, baseline-aligned.
 *
 *  `mark` is the smallest: a run of states in mono at `500 12px`, each in its
 *  own colour, which is what the board's summary line is made of. */
export function SectionHeader({
  title, count, note, right, kind = 'title', tone, children, style,
}: {
  title: React.ReactNode;
  /** The mono number that follows the title. */
  count?: number | string | null;
  /** A plain aside beside it: `3 paired`. */
  note?: React.ReactNode;
  /** A mono aside pushed to the far end: `4 projects · 7 agents`. */
  right?: React.ReactNode;
  kind?: 'page' | 'title' | 'mark';
  /** Which state's colour a `mark`, or a `page`'s aside, takes. */
  tone?: Tone;
  /** Anything that belongs on the line itself: the tabs, a button. */
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const asideColour = tone ? toneColours(tone).fg : T.ink3;
  if (kind === 'mark') {
    return (
      <div style={{ ...mono, display: 'flex', gap: 14, fontSize: 12, fontWeight: 500, ...style }}>
        <span style={{ color: asideColour, whiteSpace: 'nowrap' }}>
          {title}{count == null ? null : ` ${count}`}
        </span>
        {children}
      </div>
    );
  }
  const big = kind === 'page';
  return (
    <div style={{
      display: 'flex', alignItems: big ? 'center' : 'baseline', gap: big ? 14 : 8, minWidth: 0, ...style,
    }}>
      <span style={{
        fontSize: big ? 28 : 15, fontWeight: 600,
        letterSpacing: big ? '-.02em' : undefined, whiteSpace: 'nowrap',
      }}>{title}</span>
      {count != null && <span style={{ ...mono, fontSize: 12, color: T.ink3 }}>{count}</span>}
      {!!note && <span style={{ fontSize: big ? 13 : 12, color: T.ink3 }}>{note}</span>}
      {children}
      {!!right && (
        <span style={{
          ...mono, fontSize: 12, color: asideColour, marginLeft: 'auto',
          whiteSpace: 'nowrap', flex: 'none',
        }}>{right}</span>
      )}
    </div>
  );
}

// ── 10 · empty state ────────────────────────────────────────────────────────

/** A screen with nothing on it yet, which in this design is not an apology.
 *
 *  The desktop frames draw no empty screen — every one of them is a full day's
 *  work in progress — so the shape is the phone's, Mobile7 S6: the structure
 *  stays visible, and the middle is a sentence, a paragraph of `ink2` under it,
 *  one or two buttons, and a mono footnote saying what will *not* happen by
 *  itself. Left-aligned, not a mark in a circle. The type is the desktop's own
 *  (`600 28px`, the page head of Web12 W1), because the phone's 24 pt sentence
 *  set in a 900 pt column would be a caption. */
export function EmptyState({ title, body, actions, foot, style }: {
  title: React.ReactNode;
  body?: React.ReactNode;
  actions?: React.ReactNode;
  /** The mono line under the buttons. */
  foot?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center',
      alignItems: 'flex-start', gap: 14, padding: '40px 32px', maxWidth: 560, ...style,
    }}>
      <div style={{ fontSize: 28, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-.02em' }}>{title}</div>
      {!!body && <div style={{ fontSize: 15, lineHeight: 1.5, color: T.ink2 }}>{body}</div>}
      {!!actions && <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>{actions}</div>}
      {!!foot && <div style={{ ...mono, fontSize: 12, lineHeight: 1.5, color: T.ink3 }}>{foot}</div>}
    </div>
  );
}

// ── 11 · side panel ─────────────────────────────────────────────────────────

export interface PanelItem {
  key: string;
  label: string;
  /** A path out of `P`. */
  icon?: string;
  /** The amber number at the end of a row: one sign-in is expiring. */
  count?: number | string | null;
  /** The dot at the end instead: a machine cannot be reached. */
  dot?: State | null;
  /** Drawn as a ring rather than a fill, which is what unreachable is. */
  hollow?: boolean;
}

/** The column the machine pages are navigated by, and the shape every page with
 *  sections of its own takes.
 *
 *  Web15 W12, and the same in all eight of that group:
 *  `grid-template-columns:260px minmax(0,1fr); gap:40px`, the head a `600 24px`
 *  title with `letter-spacing:-.02em` over one grey `13px` line, and under it
 *  rows `height:40px; border-radius:10px; padding:0 12px; gap:10px` at
 *  `500 14px` — the selected one filled with `s2` in `ink`, the rest in `ink2`,
 *  each with a 17 pt glyph and, where there is something to say, a mono count
 *  or a dot at the far end. */
export function SidePanel({ title, note, items, value, onChange, style }: {
  title?: React.ReactNode;
  /** The one grey line under the title: `One machine is unreachable.` */
  note?: React.ReactNode;
  items: PanelItem[];
  value: string;
  onChange?: (key: string) => void;
  style?: React.CSSProperties;
}) {
  return (
    <nav style={{
      flex: 'none', width: SIZE.sidePanel, display: 'flex', flexDirection: 'column', gap: 2, ...style,
    }}>
      {!!title && (
        <div style={{
          fontSize: 24, fontWeight: 600, letterSpacing: '-.02em', margin: '0 0 4px 12px',
        }}>{title}</div>
      )}
      {!!note && <div style={{ fontSize: 13, color: T.ink3, margin: '0 0 14px 12px' }}>{note}</div>}
      {items.map((item) => {
        const on = item.key === value;
        return (
          <button
            key={item.key} type="button" aria-current={on ? 'page' : undefined}
            onClick={onChange && (() => onChange(item.key))}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', boxSizing: 'border-box',
              height: SIZE.sideRow, padding: '0 12px', borderRadius: RADIUS.nav, border: 'none',
              background: on ? T.s2 : 'transparent', color: on ? T.ink : T.ink2,
              fontSize: 14, fontWeight: 500, font: 'inherit',
              cursor: onChange ? 'pointer' : 'default', textAlign: 'left',
            }}
          >
            {!!item.icon && <Icon path={item.icon} size={SIZE.rowIcon} color={on ? T.ink : T.ink2} />}
            <span style={{ flex: 1, whiteSpace: 'nowrap', fontSize: 14, fontWeight: 500 }}>{item.label}</span>
            {item.count != null && (
              <span style={{ ...mono, fontSize: 11, fontWeight: 500, color: T.amber }}>{item.count}</span>
            )}
            {!!item.dot && <StatusDot state={item.dot} hollow={item.hollow} />}
          </button>
        );
      })}
    </nav>
  );
}
