import { create } from 'zustand';

/** What has been typed into a chat and not sent, kept with the chat it was
 *  typed into.
 *
 *  The composer used to hold this itself, and the composer is one component
 *  that stays mounted while the chat under it changes — so half a message
 *  written in one chat was sitting in the box of the next one opened, where
 *  Enter would have sent it to the wrong agent. Where the composer *was*
 *  remounted the words were simply gone. Neither is what a draft is: it belongs
 *  to the conversation, and it should be there when you come back to it.
 *
 *  The words survive a reload (`localStorage`); what is attached does not, and
 *  is not meant to — an upload is a file on that computer with a lifetime of
 *  its own, and offering it back a day later would be offering a path that may
 *  no longer be there.
 */
const KEY = 'rac.drafts.v1';

/** Enough for every chat a person has half a thought in, and a ceiling so that
 *  a year of abandoned sentences does not live in the browser for ever. */
const MAX_DRAFTS = 60;

function read(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function write(drafts: Record<string, string>): void {
  try { localStorage.setItem(KEY, JSON.stringify(drafts)); } catch { /* private mode: memory only */ }
}

interface DraftState {
  text: Record<string, string>;
  attached: Record<string, any[]>;
  setText: (key: string, next: string | ((was: string) => string)) => void;
  setAttached: (key: string, next: any[] | ((was: any[]) => any[])) => void;
  /** The message went: nothing of it is a draft any more. */
  clear: (key: string) => void;
}

/** Stable, so a selector returning it does not look like a change every time. */
const NONE: any[] = [];

export const useDrafts = create<DraftState>((set, get) => ({
  text: read(),
  attached: {},
  setText: (key, next) => {
    const was = get().text[key] ?? '';
    const said = typeof next === 'function' ? next(was) : next;
    if (said === was) return;
    const text = { ...get().text };
    // An empty box is not a draft. Dropping it rather than storing '' is what
    // keeps the map the size of what is actually half-written.
    if (said) text[key] = said; else delete text[key];
    const keys = Object.keys(text);
    // Insertion order is age: the oldest go first when there are too many.
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_DRAFTS))) delete text[old];
    write(text);
    set({ text });
  },
  setAttached: (key, next) => {
    const was = get().attached[key] ?? NONE;
    const list = typeof next === 'function' ? next(was) : next;
    const attached = { ...get().attached };
    if (list.length) attached[key] = list; else delete attached[key];
    set({ attached });
  },
  clear: (key) => {
    const text = { ...get().text };
    const attached = { ...get().attached };
    delete text[key];
    delete attached[key];
    write(text);
    set({ text, attached });
  },
}));

/** Which chat a draft belongs to. The computer is part of it: two machines
 *  hand out chat ids independently. */
export const draftKey = (hostKey: string, chatId: string): string => `${hostKey}/${chatId}`;

export const draftText = (s: DraftState, key: string): string => s.text[key] ?? '';
export const draftAttached = (s: DraftState, key: string): any[] => s.attached[key] ?? NONE;
