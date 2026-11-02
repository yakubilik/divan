// What a cold start opens (Yakup, 2 Nov 2026): an empty chat with Hermes on
// the computer chosen for launch, ready to be talked to — not the Dashboard,
// and not whatever chat was on screen when the app was last killed. Coming
// back from the background is not a launch: the process is still alive, this
// module's state with it, and the chat that was open stays open.
//
// No React and no store here, so `scripts/test-launch.cjs` can hold it.
import type { Defaults } from './protocol';

/** The computer a cold start connects to: the one picked for launch in
 *  Settings while it is still paired, else the first one paired — the home
 *  computer, for nearly everybody — else whatever was last in use. */
export function launchHostId(hosts: { id: string }[], launchHost: string | null | undefined,
                             lastActive: string | null | undefined): string | null {
  if (launchHost && hosts.some((h) => h.id === launchHost)) return launchHost;
  if (hosts.length) return hosts[0].id;
  return lastActive ?? null;
}

/** The defaults a launch chat opens on: the person's own, with Hermes as the
 *  agent whatever the last chat was opened with. */
export function launchDefaults(d: Defaults): Defaults {
  return { ...d, lastAgent: 'hermes' };
}

let done = false;
let skipped = false;

/** Once per process. False on the first call only. */
export function launchHandled(): boolean {
  const was = done;
  done = true;
  return was;
}

/** Something else is opening a screen at launch — a notification tap or a
 *  shared link. That wins; the empty chat is not made. */
export function skipLaunch(): void { skipped = true; }
export function launchSkipped(): boolean { return skipped; }

/** Tests only. */
export function _resetLaunch(): void { done = false; skipped = false; }
