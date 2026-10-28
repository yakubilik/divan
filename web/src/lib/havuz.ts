/** The tool pool (Havuz): Yakup's catalog of outside tools, read the way the
 *  page draws it.
 *
 *  The catalog lives with its skill under `~/.claude`, which the daemon never
 *  serves. `scripts/havuz-snapshot.py` copies out what the page needs — the
 *  tools, their live status, a picture each — to `~/projects/.havuz/`, and this
 *  reads it back over `/files` from the first computer that has it. Nothing
 *  here writes: the pool is changed only through the skill's own `pool.py`.
 */
import { useEffect, useState } from 'react';
import { fileUrl } from './actions';
import { useFleet } from './fleet';

export const HAVUZ_FILE = '~/projects/.havuz/havuz.json';

export type PoolStatus = 'verified' | 'installed' | 'catalogued';

export interface PoolTool {
  id: string;
  name: string;
  group: string;
  purpose?: string;
  project_fit?: string;
  priority?: string;
  priority_reason?: string;
  platform?: string;
  cost_license?: string;
  setup?: string;
  use?: string;
  cautions?: string;
  canonical?: string;
  kind?: string;
  status: PoolStatus;
  status_label?: string;
  thumb?: string;
  shared?: { link: string; on?: string; note?: string }[];
}

export interface PoolSnapshot {
  generated_at: number;
  catalog_updated?: string;
  tools: PoolTool[];
}

/** The groups in the order the page lists them, with the words it uses. */
export const GROUPS: { key: string; word: string }[] = [
  { key: 'design', word: 'Design' },
  { key: 'ui', word: 'UI' },
  { key: 'video', word: 'Video' },
  { key: 'testing', word: 'Testing' },
  { key: 'security', word: 'Security' },
  { key: 'seo-marketing', word: 'SEO & marketing' },
  { key: 'research', word: 'Research' },
  { key: 'code-graph', word: 'Code graph' },
  { key: 'local-llm', word: 'Local LLM' },
  { key: 'other', word: 'Other' },
];

export function groupWord(key: string): string {
  return GROUPS.find((g) => g.key === key)?.word
    ?? key.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

const PRIORITY: Record<string, number> = { high: 0, medium: 1, low: 2, hold: 3 };
const STATUS: Record<string, number> = { verified: 0, installed: 1, catalogued: 2 };

/** Every group the snapshot has, known ones first in their order, each with
 *  its tools — what is ready on this machine first, then by priority. */
export function grouped(tools: PoolTool[]): { key: string; word: string; tools: PoolTool[] }[] {
  const keys = [...new Set(tools.map((t) => t.group || 'other'))];
  const rank = (k: string) => { const i = GROUPS.findIndex((g) => g.key === k); return i < 0 ? GROUPS.length - 1 : i; };
  keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return keys.map((key) => ({
    key, word: groupWord(key),
    tools: tools.filter((t) => (t.group || 'other') === key).sort((a, b) =>
      (STATUS[a.status] ?? 3) - (STATUS[b.status] ?? 3)
      || (PRIORITY[a.priority ?? ''] ?? 4) - (PRIORITY[b.priority ?? ''] ?? 4)
      || a.name.localeCompare(b.name)),
  }));
}

/** A group named in the address that the pool does not have is all groups. */
export function knownGroup(tools: PoolTool[], g: string | null): string | null {
  return g && tools.some((t) => (t.group || 'other') === g) ? g : null;
}

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'ok'; host: string; pool: PoolSnapshot };

let cache: { at: number; load: Load } | null = null;
const listeners = new Set<(l: Load) => void>();

async function readFrom(host: string): Promise<PoolSnapshot | null> {
  const url = fileUrl(host, HAVUZ_FILE);
  if (!url) return null;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && Array.isArray(j.tools) ? j as PoolSnapshot : null;
  } catch {
    return null;
  }
}

async function refresh(): Promise<void> {
  const { order, focus } = useFleet.getState();
  const hosts = focus ? [focus, ...order.filter((k) => k !== focus)] : order;
  let load: Load = { state: 'missing' };
  for (const h of hosts) {
    const pool = await readFrom(h);
    if (pool) { load = { state: 'ok', host: h, pool }; break; }
  }
  cache = { at: Date.now(), load };
  listeners.forEach((f) => f(load));
}

/** The snapshot, from whichever computer has one. Read again when it is
 *  older than a minute, so a pool changed since stays one reload away. */
export function usePool(): Load {
  const ready = useFleet((s) => s.ready);
  const n = useFleet((s) => s.order.length);
  const [load, setLoad] = useState<Load>(cache?.load ?? { state: 'loading' });
  useEffect(() => {
    listeners.add(setLoad);
    if (ready && n && (!cache || Date.now() - cache.at > 60_000)) void refresh();
    return () => { listeners.delete(setLoad); };
  }, [ready, n]);
  return load;
}

/** A tool's picture, through the computer the snapshot came from. */
export function thumbUrl(host: string, tool: PoolTool): string {
  return tool.thumb ? fileUrl(host, tool.thumb) : '';
}
