/** A tap on a button that the button never heard of.
 *
 *  On 27 Nov 2026 the send button was tapped about ten times and did nothing:
 *  the composer kept its text, and the computer got one copy of the message,
 *  made at the moment a tap finally worked — after a newline had been typed
 *  into the field. So ten taps never reached `onPress`. Typing worked the whole
 *  time; the connection was not involved (every message that day was on the
 *  computer a tenth of a second after it was made).
 *
 *  Why is not known. Reading React Native 0.81 leaves three ways a touch can
 *  land on a Pressable and not become a press — the press cancelled as "finger
 *  left the button" against a stale measurement of where the button is, a
 *  Pressable whose handlers were not current, or a responder that never let go
 *  — and none could be shown to be the one, without a phone to try it on.
 *
 *  So the button is watched from underneath. The raw touches arrive on a plain
 *  View around it whatever the press machinery decides; a touch that began and
 *  ended there like a tap, and that no press followed, is a lost press. It is
 *  acted on — the message goes — and it is reported with what was seen of it
 *  (`client.note`), which says which of the three it was the next time it
 *  happens. The rules are here so they can be checked without a phone
 *  (`scripts/test-press.cjs`).
 */

/** A touch longer than this is not a tap: somebody is holding the button. */
export const TAP_MAX_MS = 800;
/** A touch that travelled further than this (points) was sliding off. */
export const TAP_SLOP = 12;
/** How long after the finger lifts a press is waited for. `onPress` is called
 *  in the same event as the lift, so this is only room for it to be late. */
export const WAIT_MS = 80;
/** A press that turns up this soon after a lost one was acted on is the same
 *  tap, late: it must not send a second time. */
export const SAME_TAP_MS = 1000;

/** What was seen of a tap that no press followed. No text, no ids: where the
 *  finger was, how long, and how far the press machinery got. */
export interface LostPress {
  /** `onPressIn` was called: the button took the touch. */
  pressIn: boolean;
  /** `onPressOut` was called before the wait ran out. */
  pressOut: boolean;
  ms: number;
  moved: number;
  x: number;
  y: number;
}

export interface PressWatchDeps {
  onLost: (seen: LostPress) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: any) => void;
}

export class PressWatch {
  private touch: { at: number; x: number; y: number; moved: number; in: boolean; out: boolean; pressed: boolean } | null = null;
  private timer: unknown = null;
  private actedAt = -Infinity;

  constructor(private deps: PressWatchDeps) {}

  private now() { return (this.deps.now ?? Date.now)(); }

  touchStart(x: number, y: number) {
    this.clear();
    this.touch = { at: this.now(), x, y, moved: 0, in: false, out: false, pressed: false };
  }

  touchMove(x: number, y: number) {
    const t = this.touch;
    if (t) t.moved = Math.max(t.moved, Math.hypot(x - t.x, y - t.y));
  }

  /** The system took the touch away (a call, a gesture): nothing was tapped. */
  touchCancel() { this.clear(); this.touch = null; }

  pressIn() { if (this.touch) this.touch.in = true; }
  pressOut() { if (this.touch) this.touch.out = true; }

  /** The button's own press. False when this tap was already acted on as a
   *  lost one: the caller does nothing, or the message would go twice. */
  press(): boolean {
    if (this.touch) this.touch.pressed = true;
    this.clear();
    return this.now() - this.actedAt > SAME_TAP_MS;
  }

  touchEnd(x: number, y: number) {
    const t = this.touch;
    if (!t) return;
    this.touchMove(x, y);
    const ms = this.now() - t.at;
    if (t.pressed || ms > TAP_MAX_MS || t.moved > TAP_SLOP) { this.touch = null; return; }
    this.clear();
    this.timer = (this.deps.setTimer ?? setTimeout)(() => {
      this.timer = null;
      if (this.touch !== t || t.pressed) return;
      this.touch = null;
      this.actedAt = this.now();
      this.deps.onLost({ pressIn: t.in, pressOut: t.out, ms, moved: Math.round(t.moved), x: Math.round(x), y: Math.round(y) });
    }, WAIT_MS);
  }

  private clear() {
    if (this.timer != null) (this.deps.clearTimer ?? (clearTimeout as (h: any) => void))(this.timer);
    this.timer = null;
  }

  /** The button is gone. */
  stop() { this.clear(); this.touch = null; }
}
