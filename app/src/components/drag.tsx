/** Carrying a card between the board's columns: the parts a drag draws, and the
 *  hook that turns a thumb into the machine in `src/drag.ts`.
 *
 *  What the gesture *decides* is in that file, where a check can drive the whole
 *  thing without a phone (`scripts/test-drag.cjs`). What is here is the two
 *  things a check cannot reach: the pixels, and the touch.
 *
 *  Every shape was measured off `design/divan/frames/03-mobile3-*.html`, and the
 *  frame each came from is named above it. Colour never comes from here: a tone
 *  is asked of the token table, and the parts these are built out of
 *  (`components/divan`) bring their own.
 *
 *  ── the touch ──
 *
 *  React Native will not hand an in-flight touch to a view that mounts under it,
 *  so the responder has to be in the tree before the finger goes down and has to
 *  be an ancestor of every card. That is what `pan` is for: it goes on the
 *  board's body, and it takes nothing at all until a card has been held —
 *  `onMoveShouldSetPanResponderCapture` answers `true` only then, which is what
 *  lets an ordinary tap stay an ordinary tap and a scroll stay a scroll. The
 *  350 ms itself is a `Pressable`'s own `delayLongPress` on the card, because a
 *  timer of our own would have to re-implement what a press is.
 *
 *  The cost of that arrangement is one thing worth writing down: taking the touch
 *  off the card *cancels its press*, and a cancelled press is how this hook is
 *  told a held card was let go of. So the two are told apart by who has the
 *  touch — `owned` — and not by which callback fired. Without it every drag would
 *  end the moment it began. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, View, type GestureResponderEvent, type LayoutChangeEvent,
         type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Text } from './text';
import { ExecutorBadge } from './divan';
import {
  airborne, columnAt, HOLD_MS, place, step, target, type Carried, type Drag, type Effect,
  type Event, type Point, type Rect, type Row, type Target,
} from '../drag';
import type { DivanColumn } from '../protocol';
import { RADIUS, shadows, toneColours, useTokens, type Tone } from '../theme';

// ── 1 · the line above the cards ────────────────────────────────────────────

/** What the gesture is about to do, where the column's own tally sits while
 *  nothing is being carried (Mobile3 D1–D3: mono 11.5 at `padding:0 4px 4px`,
 *  `ink3` for the instruction and `run` once the card is over a tab). */
export function DragHint({ text, tone }: { text: string; tone: Tone }) {
  const t = useTokens();
  return (
    <Text mono numberOfLines={1}
      style={{ fontSize: 11.5, paddingHorizontal: 4, paddingBottom: 4,
               color: toneColours(t, tone).fg }}>{text}</Text>
  );
}

// ── 2 · the two empty slots ─────────────────────────────────────────────────

/** The hole a card leaves, and the hole it is about to fill.
 *
 *  Mobile3 D2 draws the first as `1.5px dashed var(--line2)` over nothing at
 *  `min-height:104px`, and D3 draws the second as the same outline in `run` over
 *  `runBg`. They are one shape saying two different things — where it was, and
 *  where it goes — and the second is only ever drawn in the column the card would
 *  actually land in. */
export function DropSlot({ landing, style }: { landing?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  return (
    <View style={[{ minHeight: SLOT_H, borderRadius: RADIUS.tile, borderWidth: 1.5,
                    borderStyle: 'dashed', borderColor: landing ? t.run : t.line2,
                    backgroundColor: landing ? toneColours(t, 'run').bg : 'transparent' }, style]} />
  );
}

/** How tall an empty slot stands (D2's `min-height:104px`). */
export const SLOT_H = 104;

// ── 3 · the card under the thumb ────────────────────────────────────────────

/** How wide the carried card is (D2's `fw:260px`), and how far above the thumb it
 *  rides — D2 puts the finger at `226,70` and the card at `110,22`, so it is
 *  centred on the thumb and sits clear of it. */
export const FLOAT_W = 260;
export const FLOAT_LIFT = 48;

/** …and where the board draws it: under the thumb, in the coordinates the view it
 *  is absolutely positioned inside actually uses.
 *
 *  Both arguments are the window's own. A gesture arrives in window coordinates
 *  and so does every rect this drag is measured against, but `left` and `top`
 *  resolve against the containing block — the board's own body, which starts a
 *  safe-area inset, a project bar, a system line, a product's head and a
 *  segmented control down the page. Handing it a raw `pageY` drew the carried
 *  card a couple of hundred points below the thumb. `origin` is that body's place
 *  on the glass, measured, and the subtraction is the whole of this function. */
export function floatAt(at: Point, origin: Point): { left: number; top: number } {
  return { left: at.x - origin.x - FLOAT_W / 2, top: at.y - origin.y - FLOAT_LIFT };
}

/** The card in the air (Mobile3 D2): `background:s2; border:1px solid line2;
 *  border-radius:12px; padding:10px 12px; gap:5` under a long soft fall, with a
 *  24 pt executor square, its name at 12.5 semibold and the title at 15 cut to
 *  one line.
 *
 *  Narrower than the card it came from and deliberately so: it is a thing being
 *  carried rather than a thing lying on the page, and it has to be small enough
 *  that a thumb resting on a 46 pt tab can still see which tab went green.
 *
 *  It takes no touches. The responder for the whole gesture is the board's body,
 *  and a view that follows the thumb around is the last thing that should be
 *  answering for what is under it. */
export function Float({ face, who, title, style }: {
  face: string; who: string; title: string; style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View pointerEvents="none"
      style={[{ position: 'absolute', zIndex: 5, width: FLOAT_W, gap: 5,
                paddingVertical: 10, paddingHorizontal: 12, borderRadius: RADIUS.tab,
                backgroundColor: t.s2, borderWidth: 1, borderColor: t.line2,
                boxShadow: shadows(t).sheet }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ExecutorBadge executor={face} size={24} />
        <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: '600' }}>{who}</Text>
      </View>
      <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600' }}>{title}</Text>
    </View>
  );
}

// ── 4 · the thumb itself ────────────────────────────────────────────────────

/** Everything the board needs to make its cards draggable.
 *
 *  `onMove` is the only thing that leaves this hook with a consequence, and it is
 *  called exactly once per drag that lands somewhere. A drag that is cancelled —
 *  the finger lifted without moving, the touch taken away, a release off the
 *  tabs — calls nothing at all, which is the whole of the fourth promise this
 *  screen makes. */
export function useDrag({ open, rows, onOpen, onMove }: {
  /** Which column the list is showing. */
  open: DivanColumn;
  /** …and the cards in it, in the order they are drawn, each with the machine its
   *  work is on: what a place in the column is read against, and what turns a
   *  drawn index into a position on one computer (`src/drag.ts place`). */
  rows: { card: string; host: string }[];
  onOpen: (column: DivanColumn) => void;
  onMove: (to: { carried: Carried; column: DivanColumn;
                 position: number | null; starts: boolean }) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The same card, where a responder callback can read it without the responder
   *  being rebuilt every time the thumb moves a point. */
  const held = useRef<Drag | null>(null);
  /** The touch has been taken off the card and onto the board. Which is how a
   *  press that was cancelled *because the drag started* is told from one that
   *  was cancelled because the finger came up. */
  const owned = useRef(false);

  /** Where the tabs and the cards are, in the window's own coordinates — which
   *  is what a gesture arrives in, and the one thing `src/drag.ts` cannot know.
   *  Each is a sum of two measurements that arrive in either order: where the
   *  strip is on the glass, and where the tabs are inside it. */
  const targets = useRef<Target[]>([]);
  const tabs = useRef<{ key: string; x: number; y: number; w: number; h: number }[]>([]);
  const tabsAt = useRef<{ x: number; y: number } | null>(null);
  const cards = useRef<Record<string, Rect>>({});
  const cardsAt = useRef<{ x: number; y: number } | null>(null);
  const strip = useRef<View | null>(null);
  const body = useRef<View | null>(null);
  const frame = useRef<View | null>(null);

  /** The things the machine's effects run through, and what the board looks like
   *  right now. All in refs, because the responder is built once and must always
   *  reach the current ones. */
  const out = useRef({ onOpen, onMove });
  out.current = { onOpen, onMove };
  const where = useRef(open);
  where.current = open;
  const order = useRef(rows);
  order.current = rows;
  /** Where the board's own body is on the glass. The carried card is positioned
   *  inside it, so this is what turns a thumb's window coordinates into the ones
   *  `left` and `top` are resolved in. */
  const [origin, setOrigin] = useState<Point>({ x: 0, y: 0 });

  const retarget = useCallback(() => {
    const o = tabsAt.current;
    if (!o) return;
    targets.current = tabs.current.map((r) => ({
      key: r.key as DivanColumn, rect: { x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h },
    }));
  }, []);

  /** Where the two strips are on the glass. Asked again as the card lifts: a list
   *  that has been scrolled has moved, and the drag is aimed at pixels. The list
   *  cannot scroll for the rest of the drag, so one reading holds. */
  const measure = useCallback(() => {
    strip.current?.measureInWindow((x, y) => { tabsAt.current = { x, y }; retarget(); });
    body.current?.measureInWindow((x, y) => { cardsAt.current = { x, y }; });
    frame.current?.measureInWindow((x, y) => {
      // In state rather than a ref: the carried card is drawn from it, so a
      // reading that arrives after the lift has to redraw the float.
      setOrigin((had) => (had.x === x && had.y === y ? had : { x, y }));
    });
  }, [retarget]);

  const run = useCallback((effects: Effect[]) => {
    for (const e of effects) {
      if (e.do === 'haptic') {
        // Three weights, and the light one is the lift. `selectionAsync` is the
        // smallest thing the phone can say and it is what a card crossing onto a
        // tab gets; a failure to buzz is never a failure of the gesture.
        const buzz = e.weight === 'tick' ? Haptics.selectionAsync()
          : Haptics.impactAsync(e.weight === 'firm' ? Haptics.ImpactFeedbackStyle.Medium
                                                    : Haptics.ImpactFeedbackStyle.Light);
        void buzz.catch(() => {});
      } else if (e.do === 'open') out.current.onOpen(e.column);
      else out.current.onMove(e);
    }
  }, []);

  const send = useCallback((make: (d: Drag | null) => Event) => {
    const { drag: next, effects } = step(held.current, make(held.current));
    held.current = next;
    if (next == null) owned.current = false;
    setDrag(next);
    run(effects);
  }, [run]);

  /** Where in the open column the thumb is pointing: its cards, without the one
   *  in the air, in the order they are drawn, each moved onto the glass. */
  const pointing = useCallback((y: number, column: DivanColumn, carried: Carried) => {
    const o = cardsAt.current;
    if (!o) return { slot: null, position: null };
    const drawn: Row[] = [];
    for (const r of order.current) {
      if (r.card === carried.card) continue;
      const rect = cards.current[r.card];
      if (rect) drawn.push({ host: r.host, rect: { ...rect, y: o.y + rect.y } });
    }
    return place(y, column, carried.host, drawn);
  }, []);

  const at = (e: GestureResponderEvent) => ({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });

  // The list opening after 300 ms on a tab is a fact about a thumb that is *not*
  // moving, so it cannot only be decided when one does.
  const carrying = !!drag;
  useEffect(() => {
    if (!carrying) return;
    const timer = setInterval(() => send(() => ({ do: 'tick', now: Date.now() })), 80);
    return () => clearInterval(timer);
  }, [carrying, send]);

  const pan = useMemo(() => PanResponder.create({
    // Nothing until a card has been held: a tap stays a tap and a scroll stays a
    // scroll. The capture phase is where an ancestor takes a touch off the card
    // that is holding it.
    onMoveShouldSetPanResponderCapture: () => {
      if (held.current == null) return false;
      owned.current = true;
      return true;
    },
    onPanResponderMove: (e) => {
      if (held.current == null) return;
      const p = at(e);
      // The place is always read against the column on screen, because that is
      // the only list an index can point into; whether it is the column the card
      // would land in is the machine's to decide (`step`).
      send((d) => ({
        do: 'over', at: p, column: columnAt(p, targets.current), now: Date.now(),
        ...(d ? pointing(p.y, where.current, d.carried) : { slot: null, position: null }),
      }));
    },
    // While a card is in the air nothing else may have the touch.
    onPanResponderTerminationRequest: () => held.current == null,
    onPanResponderRelease: () => { if (held.current != null) send(() => ({ do: 'drop' })); },
    onPanResponderTerminate: () => { if (held.current != null) send(() => ({ do: 'cancel' })); },
  }), [send, pointing]);

  return {
    drag,
    /** On the board's body, above both the tabs and the list. */
    pan,
    /** …on the board's own body, which is what the carried card is positioned
     *  inside and so what its coordinates are relative to. */
    frame: { ref: frame, onLayout: measure },
    /** …on the run of cards inside it, whose own place on the glass is what a
     *  card's place is measured against. */
    list: {
      ref: body,
      onLayout: measure,
      /** One card's place in it — and only while nothing is being carried.
       *  Inserting the slot the card is about to fill pushes everything under it
       *  down, and a place picked against rows that move as the picking happens
       *  is a slot that flickers between two indices under a still thumb. The
       *  layout the drag began in is the one it is aimed at; a column that opens
       *  mid-drag is new and is measured. */
      row: (id: string) => (e: LayoutChangeEvent) => {
        if (held.current != null && cards.current[id]) return;
        const l = e.nativeEvent.layout;
        cards.current[id] = { x: l.x, y: l.y, w: l.width, h: l.height };
      },
    },
    /** …on the tab strip. */
    strip: {
      ref: strip,
      onLayout: measure,
      onMeasure: (rects: { key: string; x: number; y: number; w: number; h: number }[]) => {
        tabs.current = rects;
        retarget();
      },
    },
    /** …and on a card that can be picked up. */
    hold: (carried: Carried) => ({
      holdMs: HOLD_MS,
      onLongPress: (e: GestureResponderEvent) => {
        measure();
        send(() => ({ do: 'lift', carried, open: where.current, at: at(e) }));
      },
      /** The finger came up on a card that was never carried anywhere: the held
       *  card is put back exactly where it was. A press cancelled because the
       *  board took the touch is not this. */
      onPressOut: () => {
        if (!owned.current && held.current?.carried.card === carried.card) {
          send(() => ({ do: 'cancel' }));
        }
      },
    }),
    /** Whether the card has left its place: under Mobile3 D1 it is drawn lifted
     *  where it lies, and only past that does it follow the thumb. */
    flying: !!drag && airborne(drag),
    /** Which column it is aimed at — the tab that lights, which stays lit while
     *  the thumb is down among that column's cards picking a place (D3). */
    target: drag ? target(drag) : null,
    /** …and where to draw it while it has, in `frame`'s own coordinates. Null
     *  while nothing is being carried. The screen never computes this: a raw
     *  window point handed to an absolutely positioned view is the one mistake
     *  this whole arrangement is arranged against. */
    float: drag ? floatAt(drag.at, origin) : null,
  };
}
