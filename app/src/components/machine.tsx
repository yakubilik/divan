/** The two pages under the Machine tab, out of the design system's parts and
 *  nothing else.
 *
 *  What each of them *says* is decided in `src/machine.ts`, where a check can
 *  reach it without a phone; this is the drawing of it. Every shape was
 *  measured off `design/divan/frames/11-mobile11-*.html` — S15 the machines,
 *  one of them unreachable, and S14 the executors — and the frame each part
 *  came from is named above it.
 *
 *  Colour never comes from here: a tone is asked of the token table through
 *  `toneColours`, and the parts these are built out of (`components/divan`)
 *  bring their own. */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from './icon';
import { Text } from './text';
import { Button, Card, ExecutorBadge, Group, ListRow, Segments, StatusDot, Tap } from './divan';
import { Ring } from './shell';
import { useT } from '../store';
import { useNavGuard } from '../nav';
import { MACHINE_TABS, type MachineTab } from '../shell';
import { em, RADIUS, SIZE, toneColours, useTokens, type State, type Tone } from '../theme';

// ── 1 · the head of a page ──────────────────────────────────────────────────

/** S15 and S14 open the same way: the page's name at 28 pt semibold, and beside
 *  it either a mono count of what is below (`Executors 9`) or the one thing you
 *  can do from here (`+ Pair`), pushed to the far end. */
export function PageHead({ title, count, right, lines = 1, style }: {
  title: string;
  /** The mono number after the name. Absent where the page is not a list. */
  count?: number | null;
  right?: React.ReactNode;
  /** How many lines the name may take. One, because a page's name is a word or
   *  two — except where the page's name is its whole sentence, which is what
   *  Welcome's two steps are. */
  lines?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 4 }, style]}>
      <Text numberOfLines={lines} style={{ flexShrink: 1, fontSize: 28, lineHeight: 28 * 1.15,
                                           fontWeight: '600', letterSpacing: em(28, -0.02) }}>
        {title}
      </Text>
      {count != null && <Text mono style={{ fontSize: 12, color: t.ink3 }}>{count}</Text>}
      {!!right && <View style={{ marginLeft: 'auto' }}>{right}</View>}
    </View>
  );
}

/** The `+ Pair` in S15's head: a word, not a button. */
export function HeadAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} style={{ paddingVertical: 2, paddingHorizontal: 2 }}>
      <Text style={{ fontSize: 13, fontWeight: '500' }}>{label}</Text>
    </Tap>
  );
}

// ── 2 · the quota over the machines ─────────────────────────────────────────

/** S15's top block: `background:s1; border-radius:14px; padding:12px 14px;
 *  gap:8` — what is left of the plan, a 6 pt track, and a mono line under it.
 *
 *  Quota belongs to the account rather than to any one computer, which is why
 *  it sits over the cards instead of in one. It is drawn only when something
 *  measured it. */
export function QuotaCard({ title, says, left, tone, foot, style }: {
  title: string;
  /** `64% left`, `none left`. */
  says: string;
  /** How much of the track is filled, 0 to 1. */
  left: number;
  tone: Tone;
  /** `resets 04:00 · in 4h 44m`, where a window said when. */
  foot?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const col = toneColours(t, tone);
  return (
    <Card ring="none" inset={false} radius={RADIUS.tile} style={style}>
      <View style={{ padding: 12, paddingHorizontal: 14, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={{ fontSize: 14, fontWeight: '600' }}>{title}</Text>
          <Text mono numberOfLines={1}
            style={{ marginLeft: 'auto', fontSize: 12, fontWeight: '500', color: col.fg }}>{says}</Text>
        </View>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: t.line2, overflow: 'hidden' }}>
          <View style={{ width: `${Math.max(0, Math.min(1, left)) * 100}%`, height: 6, backgroundColor: col.fg }} />
        </View>
        {!!foot && <Text mono numberOfLines={1} style={{ fontSize: 11, color: t.ink3 }}>{foot}</Text>}
      </View>
    </Card>
  );
}

// ── 3 · one computer ────────────────────────────────────────────────────────

/** S15's card: a 32 pt well with a monitor in it, the machine's own name in
 *  mono over what sort of thing it is, a dot and a word at the far end saying
 *  whether it answered — then the two numbers, then the buttons.
 *
 *  The dot is hollow where the machine is not answering and the card is ringed
 *  in amber, so "this one has stopped" survives being read in grey and being
 *  glanced at sideways. Removing it is the frame's own long-press. */
export function MachineCard({ name, detail, state, says, tone, ring, figures, actions,
                             onLongPress, line, seen, style }: {
  /** What it runs, by name — and on a quiet machine, that this may be stale. */
  line?: string[];
  /** `seen just now`, `last seen 3h ago`. */
  seen?: string;
  name: string;
  detail?: string;
  state: State;
  /** `reachable`, `unreachable`, `never answered`. */
  says: string;
  tone: Tone;
  ring: 'amber' | 'line';
  /** `12s ago` over `last contact`. Empty on a machine that has never answered:
   *  there is no moment to age and no count to carry. */
  figures: { value: string; label: string; tone?: Tone }[];
  actions: { key: string; label: string; face: 'ink' | 'outline'; onPress: () => void }[];
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const col = toneColours(t, tone);
  return (
    <Card ring={ring} onLongPress={onLongPress} style={style}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: SIZE.rowWell, height: SIZE.rowWell, borderRadius: RADIUS.well,
                       backgroundColor: t.s2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="monitor" size={SIZE.rowIcon} color={t.ink2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text mono numberOfLines={1} style={{ fontSize: 15, fontWeight: '600' }}>{name}</Text>
          {!!detail && <Text numberOfLines={1} style={{ fontSize: 12, color: t.ink3, marginTop: 2 }}>{detail}</Text>}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <StatusDot size={7} hollow={state === 'quiet'}
            state={state === 'quiet' ? t.ink3 : state} />
          <Text numberOfLines={1} style={{ fontSize: 11.5, fontWeight: '500', color: col.fg }}>{says}</Text>
        </View>
      </View>
      {!!line?.length && (
        <Text style={{ fontSize: 13, lineHeight: 19, color: t.ink2 }}>{line.join(' ')}</Text>
      )}
      {!!seen && <Text mono numberOfLines={1} style={{ fontSize: 11.5, color: t.ink3 }}>{seen}</Text>}
      {figures.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {figures.map((f) => (
            <View key={f.label} style={{ flex: 1, minWidth: 0 }}>
              <Text mono numberOfLines={1}
                style={{ fontSize: 15, fontWeight: '500', color: f.tone ? toneColours(t, f.tone).fg : t.ink }}>
                {f.value}
              </Text>
              <Text mono numberOfLines={1} style={{ fontSize: 10.5, color: t.ink3, marginTop: 2 }}>{f.label}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {actions.map((a) => (
          <Button key={a.key} label={a.label} face={a.face} onPress={a.onPress} style={{ flex: 1 }} />
        ))}
      </View>
    </Card>
  );
}

// ── 4 · one worker ──────────────────────────────────────────────────────────

/** The mono chip at the end of an executor's row (S14): `padding:4px 8px;
 *  border-radius:7px`, its tone on its tone's wash — except `unavailable`,
 *  which the frame draws as a ring around nothing so that the one state that
 *  wants a person is the one shape on the page that is outlined. */
function Chip({ text, tone, ring }: { text: string; tone: Tone; ring?: boolean }) {
  const t = useTokens();
  const col = toneColours(t, tone);
  return (
    <Text mono numberOfLines={1}
      style={{ fontSize: 11, fontWeight: '500', color: col.fg, overflow: 'hidden',
               backgroundColor: ring ? 'transparent' : col.bg,
               borderWidth: ring ? 1 : 0, borderColor: col.fg,
               paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 }}>
      {text}
    </Text>
  );
}

/** One row of S14: a 28 pt executor square, who it is with the computer it runs
 *  on in mono beside the name, what it is doing under both, and the state at
 *  the far end. `padding:11px 0` over a hairline.
 *
 *  Four facts and all four are always drawn — what it is for lives on the
 *  heading above the run, which is what keeps this one line long. */
export function ExecutorRow({ face, who, machine, doing, says, tone, ring, first, style }: {
  face: string;
  who: string;
  /** The computer, or `no machine` for the one that is on none. */
  machine: string;
  doing: string;
  says: string;
  tone: Tone;
  ring?: boolean;
  first?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11 },
                  !first && { borderTopWidth: 1, borderTopColor: t.line }, style]}>
      <ExecutorBadge executor={face} size={SIZE.executor} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, fontWeight: '600' }}>{who}</Text>
          <Text mono numberOfLines={1} style={{ flexShrink: 1, fontSize: 11, color: t.ink3 }}>{machine}</Text>
        </View>
        <Text numberOfLines={1} style={{ fontSize: 12.5, color: t.ink2, marginTop: 2 }}>{doing}</Text>
      </View>
      <Chip text={says} tone={tone} ring={ring} />
    </View>
  );
}

// ── 5 · the four tabs (HANDOVER §4.9) ───────────────────────────────────────

/** Machines · Executors · Terminal · Settings, each at its own route. Pressing
 *  one replaces the page rather than stacking it: they are four faces of one
 *  place, and Back leaves the place. */
export function MachineTabs({ here, style }: { here: MachineTab['key']; style?: StyleProp<ViewStyle> }) {
  const T = useT();
  const router = useRouter();
  const go = useNavGuard();
  return (
    <Segments style={style} value={here}
      segments={MACHINE_TABS.map((tab) => ({ key: tab.key, label: T(tab.label) }))}
      onChange={(key) => {
        const tab = MACHINE_TABS.find((x) => x.key === key);
        if (tab && key !== here) go(() => router.replace(tab.route));
      }} />
  );
}

/** The pages that sit under a tab, as rows at the foot of it: everything the
 *  old Machine list reached is one of these, one press away. */
export function UnderTab({ here, style }: { here: MachineTab['key']; style?: StyleProp<ViewStyle> }) {
  const T = useT();
  const router = useRouter();
  const go = useNavGuard();
  const tab = MACHINE_TABS.find((x) => x.key === here);
  if (!tab?.pages.length) return null;
  return (
    <Group label={T('mUnder', { tab: T(tab.label) })} style={style}>
      {tab.pages.map((p, i) => (
        <ListRow key={p.key} first={i === 0} boxed icon={p.icon} title={T(p.title)} note={T(p.note)}
          onPress={() => go(() => router.push(p.route))} />
      ))}
    </Group>
  );
}

/** The quota as the frame draws it: a 40 pt ring of the share left, the figure,
 *  `left of the plan`, and the reset. Amber, with the word, when it is low. */
export function QuotaRing({ pct, low, resets, style }: {
  pct: number; low: boolean; resets?: string | null; style?: StyleProp<ViewStyle>;
}) {
  const T = useT();
  const t = useTokens();
  return (
    <Card ring="line" inset={false} radius={RADIUS.tile} style={style}>
      <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Ring pct={pct} colour={low ? t.amber : t.ink2} track={t.line2} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text mono style={{ fontSize: 20, lineHeight: 24, fontWeight: '500' }}>{pct}%</Text>
            {low && <Text style={{ fontSize: 13, fontWeight: '500', color: t.amber }}>{T('maLow')}</Text>}
          </View>
          <Text style={{ fontSize: 13, lineHeight: 19, color: t.ink2 }}>{T('maLeftOfPlan')}</Text>
          {!!resets && <Text mono numberOfLines={1} style={{ fontSize: 11.5, color: t.ink3, marginTop: 2 }}>{resets}</Text>}
        </View>
      </View>
    </Card>
  );
}
