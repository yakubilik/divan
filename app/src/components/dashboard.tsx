/** The Dashboard's own blocks, out of the design system's parts and nothing
 *  else.
 *
 *  What each of them *says* is decided in `src/dashboard.ts`, where a check can
 *  reach it without a phone; this is the drawing of it. Every shape here was
 *  measured off `design/divan/frames/01-mobile1-*.html` (V1 the busy top, V2 the
 *  project cards and the agent roster, V3 the calm morning) and
 *  `05-mobile5-*.html` (S1 a machine unreachable, S2 out of quota), and the
 *  frame each one came from is named above it.
 *
 *  Colour never comes from here: a tone is asked of the token table through
 *  `toneColours`, and the parts these are built out of (`components/divan`)
 *  bring their own. The one rule that survives every state: a figure with no
 *  source is not drawn. There is no placeholder in this file. */
import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './icon';
import { Text } from './text';
import { Button, Card, Counter, Monogram, StatusDot, Tap } from './divan';
import { em, RADIUS, SIZE, STATE_MARK, stateColour, toneColours, useTokens, type State, type Tone } from '../theme';
import { systemTone, type CounterSpec, type SystemLine as Line } from '../dashboard';

// ── 1 · the system line ─────────────────────────────────────────────────────

/** The thin line under the project bar: one dot per paired computer, what is
 *  worth saying about them, and what is left of the agent quota.
 *
 *  Mobile1 V1 healthy (`height:34px; border-radius:11px; padding:0 12px; gap:8`
 *  on `s1`, mono 11.5 in `ink2`, a 44×5 track at the end), Mobile5 S1 with a
 *  machine unreachable (the same line on `amberBg` in amber, the silent
 *  machine's dot drawn as a `1.5px` ring) and Mobile5 S2 out of quota (on
 *  `redBg` in red, the track empty).
 *
 *  The two halves are drawn from the same data in all three: which machines
 *  answered on the left, quota on the right. Where nothing has ever measured a
 *  quota there is no right half — an empty track would be a number. */
export function SystemLine({ line, say, quota, label, style }: {
  line: Line;
  /** The words on the left, already in the reader's language. */
  say: string;
  /** …and on the right. Absent where no machine has measured one. */
  quota?: string | null;
  /** The word in front of the track, which only the healthy line has room for:
   *  the other two have spent their left half on a sentence. */
  label?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  // Nothing on this line is a way in. What it is about — the machines and the
  // sign-ins — lives in the Machine place, and the Dashboard is not allowed to
  // lead there: that is the whole point of the three places, and the shell's own
  // check holds every screen to it.
  const tone = systemTone(line);
  const col = tone ? toneColours(t, tone) : null;
  // The left words carry the trouble, except when the trouble is the quota:
  // "3 machines" is then the one ordinary fact on a red line and is drawn as
  // one (Mobile5 S2).
  const said = line.state === 'spent' ? t.ink2 : col ? col.fg : t.ink2;
  const bar = line.quota && line.state !== 'unreachable';
  return (
    <Card ring="none" inset={false} radius={RADIUS.button}
      style={[{ height: 34, marginTop: 10, marginHorizontal: 16,
                backgroundColor: col ? col.bg : t.s1 }, style]}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {line.dots.map((d) => (
            <StatusDot key={d.id} size={7} hollow={!d.reachable}
              state={d.reachable ? stateColour(t, 'running') : col ? col.fg : t.ink3} />
          ))}
        </View>
        <Text mono numberOfLines={1} style={{ flexShrink: 1, fontSize: 11.5, fontWeight: '500', color: said }}>
          {say}
        </Text>
        {!!quota && (
          <>
            {!!label && (
              <Text mono numberOfLines={1}
                style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: '500', color: t.ink2 }}>{label}</Text>
            )}
            {bar && (
              <View style={{ marginLeft: label ? 0 : 'auto', width: 44, height: 5, borderRadius: 3,
                             backgroundColor: t.line2, overflow: 'hidden' }}>
                <View style={{ width: `${Math.max(0, Math.min(100, line.quota!.pct))}%`, height: 5,
                               backgroundColor: col ? col.fg : t.ink2 }} />
              </View>
            )}
            <Text mono numberOfLines={1}
              style={{ marginLeft: label || bar ? 0 : 'auto', fontSize: 11.5, fontWeight: '500',
                       color: line.state === 'spent' ? col!.fg : t.ink2 }}>{quota}</Text>
          </>
        )}
      </View>
    </Card>
  );
}

// ── 2 · the counters ────────────────────────────────────────────────────────

/** The row across the top. Three or four tiles — never a fourth with nothing
 *  behind it (Mobile1 V1, V3; Mobile5 S1's outlined `Unknown`, S2's `Paused`).
 *
 *  A tile is a way in where there is something behind it to open: Mobile6 S3 is
 *  reached from Needs you. The rest are counts and nothing more, so `press`
 *  answers for one tile and not for another rather than every tile being
 *  pressable and three of them doing nothing. */
export function Counters({ counters, label, press, style }: {
  counters: CounterSpec[];
  label: (c: CounterSpec) => string;
  press?: (c: CounterSpec) => (() => void) | undefined;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flexDirection: 'row', gap: 6 }, style]}>
      {counters.map((c) => (
        <Counter key={c.key} value={c.value} label={label(c)} tone={c.tone} ring={c.ring}
          onPress={press?.(c)} />
      ))}
    </View>
  );
}

// ── 3 · a block that explains itself ────────────────────────────────────────

/** The one block on the screen that is a sentence rather than a number: the
 *  calm morning (Mobile1 V3, on `runBg`: a dot, one line in 15 pt semibold, and
 *  a mono line under it) and the quota running out (Mobile5 S2, on `redBg`: a
 *  glyph, the same 15 pt line, a 13.5 paragraph, and a mono footer).
 *
 *  Same block, two tones, because they are the same kind of thing — the screen
 *  saying in words what it would otherwise be leaving a person to infer from an
 *  absence. */
export function Note({ tone, icon, dot, title, body, foot, style }: {
  tone: Tone;
  icon?: string;
  /** A dot instead of a glyph, which is what the calm state uses. */
  dot?: boolean;
  title: string;
  body?: string;
  /** The mono line or lines at the foot. */
  foot?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const col = toneColours(t, tone);
  return (
    <View style={[{ backgroundColor: col.bg, borderRadius: RADIUS.card,
                    padding: 14, paddingHorizontal: 16, gap: 10 }, style]}>
      {/* The calm block's sentence is ordinary ink with a green dot in front of
          it; the paused one's is in its own red, behind a glyph. The frames draw
          the difference and it is the right one — one of them is good news. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {dot ? <StatusDot state={col.fg} size={8} />
             : !!icon && <Icon name={icon} size={18} color={col.fg} />}
        <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: dot ? t.ink : col.fg }}>{title}</Text>
      </View>
      {!!body && <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.45, color: t.ink }}>{body}</Text>}
      {!!foot && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>{foot}</View>}
    </View>
  );
}

/** One mono word of a `Note`'s footer: `used 100%`, `resets 04:00`, `14
 *  finished today`. Mobile5 S2 sets a `Quota ›` at the far end of the same row;
 *  that leads into the Machine place, which nothing on the Dashboard may do, so
 *  it is not here. */
export function NoteFoot({ text }: { text: string }) {
  const t = useTokens();
  return (
    <Text mono numberOfLines={1} style={{ fontSize: 12, fontWeight: '500', color: t.ink2 }}>{text}</Text>
  );
}

// ── 4 · a question only a person can answer ─────────────────────────────────

/** Mobile1 V1's amber-ringed card: whose product it is, who is waiting, the
 *  question in the words it was asked in, and the way in.
 *
 *  The frame draws the agent's two proposed answers as two buttons. Nothing
 *  sends them — a stopped ticket carries a question and not a set of options —
 *  so what is here is the one action that exists: open it and answer. A card
 *  whose queue is on another computer has no such screen and is a card that
 *  enters its product instead, which the screen decides (`dashboard.ts`). */
export function AskCard({ index, project, who, question, action, onPress, onAction }: {
  index: number | null;
  project: string;
  /** `? Coder asks`, `○ Your call` — already in the reader's language. */
  who: string;
  question: string;
  /** The amber button's words, where there is somewhere for it to go. */
  action?: string | null;
  onPress?: () => void;
  onAction?: () => void;
}) {
  const t = useTokens();
  return (
    <Card ring="amber" onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Monogram name={project} index={index} size={22} />
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, fontWeight: '600' }}>{project}</Text>
        <Text mono numberOfLines={1}
          style={{ marginLeft: 'auto', fontSize: 11, fontWeight: '500', color: t.amber }}>{who}</Text>
      </View>
      <Text style={{ fontSize: 15, lineHeight: 15 * 1.35, fontWeight: '500' }}>{question}</Text>
      {!!action && <Button label={action} face="amber" onPress={onAction} />}
    </Card>
  );
}

// ── 5 · a project ───────────────────────────────────────────────────────────

/** One product, with the two figures that exist for every one of them today.
 *
 *  Mobile1 V2: the monogram and the name, a mono line under it, the state in the
 *  corner; then the product's own figure; then a rule and, under it, what the
 *  board holds and the one line worth saying about it. Mobile5 S1 adds the
 *  second corner line — `last seen 21:02` — for a product on a machine that has
 *  gone quiet, and S2 `resume 04:00` for one whose agents are stopped.
 *
 *  The frame's third figure — `€4,812 MRR ▲2.1%` and its fourteen-day trend —
 *  has no source connected, so the card has no such row and the two rows that
 *  remain carry the whole of it. That is the case this component is built for
 *  rather than the case it tolerates: nothing here is laid out around a block
 *  that may not be there. */
export function ProjectCard({ index, name, line, chip, freshness, figure, marks, latest, onPress }: {
  index: number;
  name: string;
  /** The grey mono line: `on studio, cloud · 4 agents`. */
  line: string;
  /** The corner: its mark, its words and its tone. */
  chip: { mark: string; text: string; tone: Tone };
  /** `last seen 21:02` · `resume 04:00`. Absent while everything is current. */
  freshness?: string | null;
  /** What git says: how much was finished in seven days, and when it last
   *  moved. Absent where no repository of this product could be read. */
  figure?: { value: number; label: string; moved: string } | null;
  /** The board's own counts, as marks. */
  marks?: { mark: State; n: number }[];
  /** …and the worst card's line. */
  latest?: string;
  onPress?: () => void;
}) {
  const t = useTokens();
  const col = toneColours(t, chip.tone);
  const foot = (marks && marks.length > 0) || !!latest;
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Monogram name={name} index={index} size={SIZE.monogram} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600' }}>{name}</Text>
          <Text mono numberOfLines={1} style={{ fontSize: 11.5, color: t.ink3, marginTop: 2 }}>{line}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text mono numberOfLines={1}
            style={{ fontSize: 11, fontWeight: '500', color: col.fg, backgroundColor: col.bg,
                     paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, overflow: 'hidden' }}>
            {chip.mark ? `${chip.mark} ${chip.text}` : chip.text}
          </Text>
          {!!freshness && (
            <Text mono numberOfLines={1} style={{ fontSize: 10.5, color: t.ink3, marginTop: 3 }}>{freshness}</Text>
          )}
        </View>
      </View>

      {!!figure && (
        <View>
          <Text mono style={{ fontSize: 20, lineHeight: 20, fontWeight: '500', letterSpacing: em(20, -0.02) }}>
            {figure.value}
          </Text>
          <Text mono numberOfLines={1} style={{ fontSize: 11, color: t.ink3, marginTop: 5 }}>
            {figure.label} · {figure.moved}
          </Text>
        </View>
      )}

      {foot && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10,
                       borderTopWidth: 1, borderTopColor: t.line, paddingTop: 9 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(marks ?? []).map((m) => (
              <Text key={m.mark} mono style={{ fontSize: 11.5, fontWeight: '500', color: stateColour(t, m.mark) }}>
                {STATE_MARK[m.mark]}{m.n}
              </Text>
            ))}
          </View>
          {!!latest && (
            <Text numberOfLines={1} style={{ marginLeft: 'auto', maxWidth: 190, fontSize: 12.5, color: t.ink2 }}>
              {latest}
            </Text>
          )}
        </View>
      )}
    </Card>
  );
}

// ── 6 · who is on what, where ───────────────────────────────────────────────

/** The agent roster (Mobile1 V2): one line per agent at work — its state, which
 *  kind of agent it is, whose product it is, and what it is doing. Four columns
 *  so that the eye reads down them rather than along a sentence. */
export function AgentRoster({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Card inset={false} style={[{ paddingVertical: 4, paddingHorizontal: 14 }, style]}>{children}</Card>
  );
}

export function AgentLine({ mark, tone, who, project, index, text, first, onPress }: {
  mark: string;
  tone: Tone;
  who: string;
  project: string;
  index: number;
  text: string;
  /** The first row of the roster has no line above it. */
  first?: boolean;
  onPress?: () => void;
}) {
  const t = useTokens();
  return (
    <Tap onPress={onPress}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9 },
              !first && { borderTopWidth: 1, borderTopColor: t.line }]}>
      <Text mono style={{ width: 14, fontSize: 12, fontWeight: '700', color: toneColours(t, tone).fg }}>{mark}</Text>
      <Text mono numberOfLines={1} style={{ width: 52, fontSize: 11.5, fontWeight: '500' }}>{who}</Text>
      <Monogram name={project} index={index} size={18} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: t.ink2 }}>{text}</Text>
    </Tap>
  );
}

// ── Divan 2/6: the Dashboard of HANDOVER §4.1 (DashboardPhone) ──────────────

/** `Good evening.` at 38/40, and the one counted line under it. */
export function Greeting({ hello, said }: {
  hello: string;
  said: { key: string; text: string; n: number }[];
}) {
  const t = useTokens();
  return (
    <View style={{ marginTop: 16, gap: 10 }}>
      <Text accessibilityRole="header"
        style={{ fontSize: 38, lineHeight: 40, fontWeight: '500', letterSpacing: em(38, -0.04), color: t.ink }}>
        {hello}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 6 }}>
        {said.map((s) => (
          <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {s.key === 'working' && s.n > 0 && <StatusDot state="running" size={7} />}
            {s.key === 'stuck' && s.n > 0 && <StatusDot state="stuck" size={7} />}
            <Text style={{ fontSize: 14, lineHeight: 22, color: t.ink2 }}>{s.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** One thing waiting (`dv-wait`): the product, how long, the question, and the
 *  answers as buttons — the first amber, the one the worker proposed. */
export function WaitCard({ project, index, age, question, word, tone, actions, note, noteTone }: {
  project: string; index: number | null; age: string | null; question: string;
  word: string; tone: Tone;
  actions: { label: string; face: 'amber' | 'ink' | 'outline' | 'ghost'; onPress?: () => void }[];
  note?: string | null; noteTone?: Tone;
}) {
  const t = useTokens();
  const c = toneColours(t, tone);
  return (
    <View style={{ backgroundColor: t.s1, borderRadius: RADIUS.md, borderWidth: 1, borderColor: t.line,
                   padding: 14, paddingBottom: 12, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Monogram name={project} index={index} size={20} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontWeight: '500', color: t.ink2 }}>{project}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 22, paddingHorizontal: 8,
                       borderRadius: RADIUS.pill, backgroundColor: c.bg }}>
          <StatusDot state={tone === 'red' ? 'stuck' : tone === 'amber' ? 'asking' : 'quiet'} size={7} />
          <Text style={{ fontSize: 11.5, fontWeight: '500', color: c.fg }}>{word}</Text>
        </View>
        {!!age && <Text mono style={{ fontSize: 11.5, color: t.ink3 }}>{age}</Text>}
      </View>
      <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: '500', color: t.ink }}>{question}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {actions.map((a) => {
          const bg = a.face === 'amber' ? t.amber : a.face === 'ink' ? t.ink : a.face === 'outline' ? t.s2 : 'transparent';
          const fg = a.face === 'amber' ? t.onAmber : a.face === 'ink' ? t.onInk : a.face === 'ghost' ? t.ink2 : t.ink;
          return (
            <Pressable key={a.label} accessibilityRole="button" onPress={a.onPress}
              style={{ minHeight: 44, justifyContent: 'center' }}>
              <View style={{ height: 36, paddingHorizontal: 12, borderRadius: RADIUS.pill, justifyContent: 'center',
                             backgroundColor: bg, borderWidth: a.face === 'outline' ? 1 : 0, borderColor: t.line }}>
                <Text style={{ fontSize: 12.5, fontWeight: '500', color: fg }}>{a.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {!!note && <Text mono style={{ fontSize: 11.5, color: toneColours(t, noteTone ?? 'ink3').fg }}>{note}</Text>}
    </View>
  );
}

/** A project tile (`dv-tile`), two to a row on the phone. */
export function Tile({ name, index, now, counts, when, onPress }: {
  name: string; index: number; now: string;
  counts: { state: State; n: number; word: string }[];
  when: string | null;
  onPress: () => void;
}) {
  const t = useTokens();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={name} onPress={onPress}
      style={{ flex: 1, minWidth: 0, minHeight: 132, padding: 14, gap: 10, borderRadius: RADIUS.lg,
               backgroundColor: t.s1, borderWidth: 1, borderColor: t.line }}>
      <Monogram name={name} index={index} size={30} />
      <Text numberOfLines={1} style={{ fontSize: 15, lineHeight: 22, fontWeight: '600', color: t.ink }}>{name}</Text>
      <Text numberOfLines={2} style={{ fontSize: 13, lineHeight: 19, color: t.ink2 }}>{now}</Text>
      <View style={{ marginTop: 'auto', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        {counts.map((c) => (
          <View key={c.state} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <StatusDot state={c.state} size={7} />
            <Text mono style={{ fontSize: 12, fontWeight: '500', color: c.state === 'asking' ? t.amber : t.ink2 }}>{c.n}</Text>
            <Text style={{ fontSize: 12, color: t.ink3 }}>{c.word}</Text>
          </View>
        ))}
        {/* A busy tile's footer wraps, and the time is cut short rather than
            run past the tile's edge (the web tile does the same). */}
        {!!when && <Text mono numberOfLines={1} style={{ marginLeft: 'auto', flexShrink: 1, minWidth: 0, fontSize: 11.5, color: t.ink3 }}>{when}</Text>}
      </View>
    </Pressable>
  );
}

/** A dormant product as one dimmed line (`dv-live`) under the tiles. */
export function QuietRow({ name, index, meta, first, onPress }: {
  name: string; index: number; meta: string; first?: boolean; onPress: () => void;
}) {
  const t = useTokens();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={name} onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 10,
               borderTopWidth: first ? 0 : 1, borderTopColor: t.line2 }}>
      <Monogram name={name} index={index} size={20} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: t.ink3 }}>{name}</Text>
      <Text mono style={{ fontSize: 11.5, color: t.ink3 }}>{meta}</Text>
    </Pressable>
  );
}

/** One line of Working now: a dot, the title, and project · executor · machine · time. */
export function LiveRow({ state, hollow, title, meta, metaTone, first, onPress }: {
  /** A state, or the dot's colour outright. */
  state: State | string; hollow?: boolean; title: string; meta: string;
  /** The meta in amber: it is the word `asking`. */
  metaTone?: 'amber';
  first?: boolean; onPress?: () => void;
}) {
  const t = useTokens();
  return (
    <Tap onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 10,
               borderTopWidth: first ? 0 : 1, borderTopColor: t.line2 }}>
      <StatusDot state={state} hollow={hollow} size={7} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: t.ink }}>{title}</Text>
      <Text mono numberOfLines={1} style={{ fontSize: 11.5, color: metaTone === 'amber' ? t.amber : t.ink3, maxWidth: '55%' }}>{meta}</Text>
    </Tap>
  );
}

/** The rows' own surface (`dv-glass` at `--radius-md`, `padding:4px 14px`). */
export function Rows({ children }: { children: React.ReactNode }) {
  const t = useTokens();
  return (
    <View style={{ backgroundColor: t.s1, borderRadius: RADIUS.md, borderWidth: 1, borderColor: t.line,
                   paddingVertical: 4, paddingHorizontal: 14 }}>{children}</View>
  );
}
