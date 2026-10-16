/** A shell drawn by xterm.js, behind the `TermView` the Terminal tab talks to
 *  (term.ts). Loaded on demand, with its stylesheet, the first time a shell is
 *  drawn. */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { copyText } from './clipboard';
import { MEDIA, MONO } from './theme';
import type { TermView } from './term';

/** A terminal is dark whatever the panel's scheme is: it is what a shell is
 *  expected to look like, and programs pick their colours assuming it. */
const THEME = {
  background: MEDIA.term,
  foreground: MEDIA.ink,
  cursor: MEDIA.termCursor,
  cursorAccent: MEDIA.term,
  selectionBackground: MEDIA.termSelection,
  // xterm makes its scrollbar out of the foreground at a fifth, which is no
  // colour of the panel's: the floating chrome's own pair instead.
  scrollbarSliderBackground: MEDIA.chromeLine,
  scrollbarSliderHoverBackground: MEDIA.inkDim,
  scrollbarSliderActiveBackground: MEDIA.inkDim,
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export async function createView(el: HTMLElement): Promise<TermView> {
  const term = new Terminal({
    fontFamily: MONO,
    fontSize: 13,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 5000,
    macOptionIsMeta: true,
    theme: THEME,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);

  // Copy and paste. ⌘C / ⌘V on a Mac are the browser's own copy and paste
  // events, which xterm.js already answers. Elsewhere Ctrl+C is the shell's
  // interrupt, so copying is Ctrl+Shift+C and pasting Ctrl+Shift+V, the way
  // every Linux terminal does it.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const key = e.key.toLowerCase();
    if (!isMac && e.ctrlKey && e.shiftKey && key === 'c') {
      if (term.hasSelection()) void copyText(term.getSelection());
      e.preventDefault();
      return false;
    }
    if (!isMac && e.ctrlKey && e.shiftKey && key === 'v') {
      e.preventDefault();
      navigator.clipboard?.readText().then((t) => { if (t) term.paste(t); }).catch(() => {});
      return false;
    }
    // ⌘C with nothing selected would otherwise do nothing; with a selection it
    // is the copy event, left to the browser.
    return true;
  });

  return {
    write: (data) => term.write(data),
    onData: (fn) => { term.onData(fn); },
    onResize: (fn) => { term.onResize(fn); },
    fit: () => {
      // A hidden pane measures as nothing; fitting it would shrink the shell
      // to one column.
      if (!el.offsetWidth || !el.offsetHeight) return;
      try { fit.fit(); } catch { /* not laid out yet */ }
    },
    focus: () => term.focus(),
    dispose: () => term.dispose(),
    get cols() { return term.cols; },
    get rows() { return term.rows; },
  };
}
