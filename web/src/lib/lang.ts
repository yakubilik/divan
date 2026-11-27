/** Words of languages other than English, from the computer's language pack.
 *
 *  The repository holds English only. A panel that has to speak or read
 *  another language (the step strip in the language the person writes in, the
 *  reply pills read out of a question's grammar, why a key was refused) asks
 *  the computer for its pack once it is online (`lang.get`, see
 *  docs/PROTOCOL.md) and keeps it in this browser, so the next visit has it
 *  before any socket is open. A computer without a pack answers with none, and
 *  everything here falls back to English.
 */
import { useSyncExternalStore } from 'react';

/** One pack: `web/steps` and the like. Keys are English, values the words. */
export type Pack = Record<string, unknown>;

const KEY = 'rac.langPacks';

let packs: Record<string, Record<string, Pack>> = read();
let version = 0;
const listeners = new Set<() => void>();

function read(): Record<string, Record<string, Pack>> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const got = raw ? JSON.parse(raw) : null;
    return got && typeof got === 'object' ? got : {};
  } catch {
    return {};
  }
}

/** The pack `name` of `lang`, if this browser has it. */
export function pack<T = Pack>(lang: string, name: string): T | undefined {
  return packs[lang]?.[name] as T | undefined;
}

/** What `lang.get` answered: replaces that language's packs and keeps them. */
export function setPacks(lang: string, got: Record<string, Pack> | null | undefined): void {
  const next = got && typeof got === 'object' ? got : {};
  if (JSON.stringify(packs[lang] ?? {}) === JSON.stringify(next)) return;
  packs = { ...packs, [lang]: next };
  try { localStorage.setItem(KEY, JSON.stringify(packs)); } catch { /* private mode: this tab only */ }
  version++;
  for (const l of listeners) l();
}

/** A regular expression a pack holds as its source, or null when it is missing or broken. */
export function packRegex(source: unknown, flags = 'i'): RegExp | null {
  if (typeof source !== 'string' || !source) return null;
  try { return new RegExp(source, flags); } catch { return null; }
}

/** Re-render when a pack arrives (the first visit, before it is kept). */
export function useLangPacks(): number {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => version,
    () => version,
  );
}

/** Tests: forget every pack, or install some. */
export function resetPacks(next: Record<string, Record<string, Pack>> = {}): void {
  packs = next;
  version++;
  for (const l of listeners) l();
}
