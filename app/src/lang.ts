/** Words of languages other than English, from the computer's language pack.
 *
 *  The repository holds English only. What the phone has to say or hear in
 *  another language (a call held in Turkish, its yes and no, the reply chips
 *  read out of a question's grammar, the Turkish voice's lexicon) it asks the
 *  computer for once connected (`lang.get`, see docs/PROTOCOL.md) and keeps on
 *  the phone, so the next launch has it before any socket is open. A computer
 *  without a pack answers with none, and everything falls back to English.
 *
 *  The same module as web/src/lib/lang.ts, but kept in a file the store hands
 *  over (`keepPacksIn`) rather than localStorage, and with no React in it: the
 *  layout subscribes through `onPacks`.
 */
/** One pack: `app/call` and the like. Keys are English, values the words. */
export type Pack = Record<string, unknown>;
type Packs = Record<string, Record<string, Pack>>;

/** Where the packs are kept between launches. */
export interface PackStorage {
  read: () => Promise<string | null>;
  write: (text: string) => Promise<void> | void;
}

let packs: Packs = {};
let storage: PackStorage | null = null;
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
  version++;
  for (const l of listeners) l();
}

/** Read the kept packs (once, at launch) and keep the next ones there. */
export async function keepPacksIn(s: PackStorage): Promise<void> {
  storage = s;
  try {
    const raw = await s.read();
    const got = raw ? JSON.parse(raw) : null;
    // Packs a connection delivered while the file was being read win.
    if (got && typeof got === 'object') { packs = { ...got, ...packs }; changed(); }
  } catch { /* nothing kept, or unreadable: the next connection brings them */ }
}

/** The pack `name` of `lang`, if this phone has it. */
export function pack<T = Pack>(lang: string, name: string): T | undefined {
  return packs[lang]?.[name] as T | undefined;
}

/** Whether this phone has any pack of `lang`. */
export function hasLang(lang: string): boolean {
  return !!packs[lang] && Object.keys(packs[lang]).length > 0;
}

/** What `lang.get` answered: replaces that language's packs and keeps them. */
export function setPacks(lang: string, got: Record<string, Pack> | null | undefined): void {
  const next = got && typeof got === 'object' ? got : {};
  if (JSON.stringify(packs[lang] ?? {}) === JSON.stringify(next)) return;
  packs = { ...packs, [lang]: next };
  try { void Promise.resolve(storage?.write(JSON.stringify(packs))).catch(() => {}); } catch { /* kept for this launch only */ }
  changed();
}

/** A regular expression a pack holds as its source, or null when it is missing or broken. */
export function packRegex(source: unknown, flags = 'i'): RegExp | null {
  if (typeof source !== 'string' || !source) return null;
  try { return new RegExp(source, flags); } catch { return null; }
}

/** A number that changes whenever the packs do (for `useSyncExternalStore`
 *  with `onPacks`; this module imports nothing, the web panel's tests compile it). */
export function packsVersion(): number {
  return version;
}

/** Call `fn` whenever the packs change (kept ones read, new ones delivered); returns the unsubscribe. */
export function onPacks(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tests: forget every pack, or install some. Nothing is written. */
export function resetPacks(next: Packs = {}): void {
  packs = next;
  changed();
}
