/* The remote screen's small decisions, kept apart from the view so they can be
 * read and checked on their own: which keys are a shortcut and which a
 * clipboard sync, which modifier the other computer copies with, and what to
 * say when it will not take a click. */

export interface ScreenDisplay { id: string; label: string; w: number; h: number; primary: boolean }
export interface ScreenCaps {
  view: boolean; control: boolean; enabled: boolean;
  os?: string; reason?: string | null; displays?: ScreenDisplay[];
}

/** The daemon refuses more than this, so the panel does not send it. */
export const CLIPBOARD_MAX = 256 * 1024;

/** Is the computer being driven a Mac? `platform.system()` says `Darwin`. */
export const remoteIsMac = (os?: string) => (os ?? '').toLowerCase() === 'darwin';

/** The modifier the other computer copies and pastes with. The daemon takes
 *  `ctrl` at face value and never turns it into Command, so the panel is the
 *  one that has to know. */
export const clipboardMods = (os?: string): string[] => [remoteIsMac(os) ? 'cmd' : 'ctrl'];

/** Is the browser on a Mac (or an iPad with a keyboard)? There ⌘ is the
 *  clipboard key and ⌃C stays ⌃C — the interrupt a terminal on the other end
 *  is waiting for. Everywhere else it is Ctrl. */
export function localIsMac(): boolean {
  const nav: any = typeof navigator === 'undefined' ? {} : navigator;
  return /Mac|iPhone|iPad|iPod/.test(nav.userAgentData?.platform || nav.platform || '');
}

type Chord = { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };

/** A keystroke that is this browser's own copy or paste: the clipboard key and
 *  C or V, with nothing else held. Read off `code` so a Turkish-Q or AZERTY
 *  layout still finds the key where the shortcut is printed. */
export function clipboardChord(e: Chord, mac: boolean = localIsMac()): 'copy' | 'paste' | null {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey || e.shiftKey) return null;
  const k = e.code === 'KeyC' || (!e.code && e.key.toLowerCase() === 'c') ? 'c'
    : e.code === 'KeyV' || (!e.code && e.key.toLowerCase() === 'v') ? 'v' : null;
  return k === 'c' ? 'copy' : k === 'v' ? 'paste' : null;
}

const CODE_PUNCT: Record<string, string> = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', Space: 'space',
};

/** The key of a shortcut, in the daemon's vocabulary. `code` before `key`:
 *  with ⌥ or ⇧ held the browser reports the character that combination
 *  types (⌥R is `®`, ⇧/ is `?`), and the other computer wants the key. */
export function shortcutKey(e: { key: string; code?: string }): string | null {
  const code = e.code ?? '';
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].toLowerCase();
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  if (CODE_PUNCT[code]) return CODE_PUNCT[code];
  if (e.key === ' ') return 'space';
  return e.key.length === 1 ? e.key.toLowerCase() : null;
}

/** Why a click on the picture will not reach the computer, in words — or null
 *  when it will. Whatever the daemon said comes first, because it knows (the
 *  Accessibility switch on a Mac is the usual one). */
export function controlBlocker(caps: ScreenCaps | null): string | null {
  if (!caps) return 'Still asking this computer what it allows…';
  if (!caps.view) return caps.reason || 'There is no screen to show on this computer.';
  if (!caps.control) return caps.reason || 'This computer cannot be controlled from here, only watched.';
  if (!caps.enabled) return 'Remote control is off on this computer. Press Take control to click, type and paste.';
  return null;
}
