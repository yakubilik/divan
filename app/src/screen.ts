/** The remote screen's small decisions, kept apart from the view so a check
 *  can read them without a phone. The same rules as the panel's
 *  (`web/src/lib/screen.ts`): which modifier the other computer copies with,
 *  and what to say when it will not take a tap. */

export interface ScreenCaps {
  view: boolean; control: boolean; enabled: boolean;
  os?: string; reason?: string | null;
  displays?: { id: string; label: string; w: number; h: number; primary: boolean }[];
}

/** The daemon refuses more than this, so the phone does not send it. */
export const CLIPBOARD_MAX = 256 * 1024;

/** How long a copy shortcut is given to land on the other clipboard before it
 *  is read back. */
export const COPY_SETTLE_MS = 150;

export const remoteIsMac = (os?: string) => (os ?? '').toLowerCase() === 'darwin';

/** The modifier the other computer copies and pastes with. The daemon never
 *  turns `ctrl` into Command, so the client has to know. */
export const clipboardMods = (os?: string): string[] => [remoteIsMac(os) ? 'cmd' : 'ctrl'];

/** Why a tap on the picture will not reach the computer, in words — or null
 *  when it will. Whatever the daemon said comes first: it knows (the
 *  Accessibility switch on a Mac is the usual one). */
export function controlBlocker(caps: ScreenCaps | null): string | null {
  if (!caps) return 'Still asking this computer what it allows…';
  if (!caps.view) return caps.reason || 'There is no screen to show on this computer.';
  if (!caps.control) return caps.reason || 'This computer cannot be controlled from here, only watched.';
  if (!caps.enabled) return 'Remote control is off on this computer. Turn it on to tap, type and paste.';
  return null;
}
