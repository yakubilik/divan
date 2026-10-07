/** The Dashboard's Composer, decided away from the screen that draws it
 *  (HANDOVER §3, §5).
 *
 *  One field does what two screens used to: the command bar and the New chat
 *  dialog. A press of send opens a chat and says the words in it, and asks
 *  nothing first; what the words call for — an answer, a card, work started —
 *  is the agent's to read. Everything a chat opens with has a default, and
 *  the four chips under the field show it; a chip that was changed applies to
 *  that one send.
 *
 *  No React and no store in here, so `scripts/test-overview.mjs` can hold the
 *  rules without a browser.
 */
import type { DivanView, MergedProject } from './divan';
import type { CliAccount, LimitWindow, Provider, ProviderCatalog } from './protocol';
import { accountName } from './fields';

// ── @project ────────────────────────────────────────────────────────────────

/** The product an `@word` names: its slug, its key or its name, any case. */
export function named(view: Pick<DivanView, 'projects'>, word: string): MergedProject | null {
  const w = word.toLocaleLowerCase('en');
  return view.projects.find((p) => [p.slug, p.key, p.name]
    .some((n) => (n || '').toLocaleLowerCase('en') === w)) ?? null;
}

/** An `@project` typed into the field becomes the Project chip, the same one
 *  its menu sets, and leaves the sentence.
 *
 *  Only a finished word is taken — one followed by a space, or any word at all
 *  when `final` (the moment of sending) — so that `@isg` on its way to
 *  `@quire` is not matched to something else half-way. A word that names no
 *  product stays in the text as written. */
export function mention(view: Pick<DivanView, 'projects'>, text: string, final = false):
  { project: string | null; text: string } {
  const re = final ? /(^|\s)@([\w.-]+)(?=\s|$)/ : /(^|\s)@([\w.-]+)(?=\s)/;
  let out = text;
  let project: string | null = null;
  for (;;) {
    const m = re.exec(out);
    if (!m) break;
    const p = named(view, m[2]);
    if (!p) {
      // Not a product: step past it so the next one can still be read.
      const rest = mention(view, out.slice(m.index + m[0].length), final);
      return { project: rest.project ?? project, text: out.slice(0, m.index + m[0].length) + rest.text };
    }
    project = p.key;
    out = (out.slice(0, m.index) + m[1] + out.slice(m.index + m[0].length)).replace(/^\s+/, '');
  }
  return { project, text: out };
}

/** The product the Project chip starts on where the page has none of its own:
 *  Divan itself, on a computer that has it. Null, which the chip says as
 *  `auto`, everywhere else. */
export function defaultProject(view: Pick<DivanView, 'projects'>): string | null {
  return named(view, 'divan')?.key ?? null;
}

// ── where a card is written ─────────────────────────────────────────────────

/** The machine a card is written on and that machine's own id for the product:
 *  one that is answering, failing that the first that has it. */
export function writer(view: Pick<DivanView, 'hosts'>, p: MergedProject | null):
  { host: string; project: string } | null {
  if (!p) return null;
  const mine = view.hosts.filter((h) => p.ids[h.key]);
  const h = mine.find((x) => x.reachable) ?? mine[0];
  return h ? { host: h.key, project: p.ids[h.key] } : null;
}

// ── the head of the page ────────────────────────────────────────────────────

/** `Good evening.` by the reader's own clock. No name: nothing a computer
 *  reports says who is reading. */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning.';
  if (hour >= 12 && hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

/** The one line under the greeting: what needs you, what is working, what is
 *  stuck — every figure counted off the boards, and a zero said in words. */
export function summary(view: Pick<DivanView, 'totals'>): { key: string; n: number; text: string }[] {
  const { needsYou, running, stuck } = view.totals;
  return [
    { key: 'needs', n: needsYou,
      text: needsYou === 0 ? 'nothing needs you' : needsYou === 1 ? '1 thing needs you' : `${needsYou} things need you` },
    { key: 'working', n: running, text: running === 0 ? 'nothing working' : `${running} working` },
    { key: 'stuck', n: stuck, text: stuck === 0 ? 'nothing is stuck' : `${stuck} stuck` },
  ];
}

/** `Quiet for 5 weeks. Nothing queued.` — a dormant product's line, from the
 *  age of its newest commit. */
export function quietFor(seconds: number, queued: number): string {
  const days = Math.floor(seconds / 86400);
  const span = days >= 60 ? `${Math.floor(days / 30)} months`
    : days >= 14 ? `${Math.floor(days / 7)} weeks` : `${days} days`;
  return `Quiet for ${span}. ${queued ? `${queued} queued.` : 'Nothing queued.'}`;
}

/** A short age for a tile's corner: `14m`, `3h`, `5w`, `2mo`. */
export function short(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const d = Math.floor(s / 86400);
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 30)}mo`;
}

// ── the four chips ──────────────────────────────────────────────────────────

/** What a chip was changed to for this send. `undefined` is the default in
 *  every field; `agent: null` is a real answer, no agent. */
export interface Picks {
  project?: string | null;
  agent?: string | null;
  account?: string;
  /** `provider/model`, because a model belongs to one tool. */
  model?: string;
}

export const modelValue = (provider: Provider, id: string) => `${provider}/${id}`;

export function readModel(value: string | undefined): { provider: Provider; model: string } | null {
  if (!value) return null;
  const at = value.indexOf('/');
  if (at < 0) return null;
  return { provider: value.slice(0, at) as Provider, model: value.slice(at + 1) };
}

/** Every model the computer offers, both tools, as menu options. */
export function modelOptions(catalog: Partial<Record<Provider, ProviderCatalog>> | null | undefined):
  { value: string; label: string; note: string }[] {
  const out: { value: string; label: string; note: string }[] = [];
  for (const provider of ['claude', 'codex'] as Provider[]) {
    for (const m of catalog?.[provider]?.models ?? []) {
      out.push({ value: modelValue(provider, m.id), label: m.label || m.id, note: provider });
    }
  }
  return out;
}

/** The sign-ins one tool can open a chat on: the signed-in ones and the
 *  computer's own, which always counts — New chat's own filter. The value is
 *  what `chat.create` takes, `''` for the computer's own. */
export function accountOptions(accounts: CliAccount[], provider: Provider):
  { value: string; label: string }[] {
  return accounts.filter((a) => a.provider === provider && (a.logged_in || a.is_default))
    .map((a) => ({ value: a.is_default ? '' : a.id, label: accountName(a) }));
}

/** The plan this sign-in is spending, as the highest share of any window it
 *  reports, and whether that is under the line the reader set in Machine ›
 *  Quota thresholds. Null where nothing was measured: no dot, no words. */
export function lowQuota(windows: LimitWindow[] | undefined, warn: number): boolean | null {
  const used = (windows ?? []).map((w) => w.utilization).filter((u): u is number => typeof u === 'number');
  if (!used.length) return (windows ?? []).some((w) => w.status === 'rejected') ? true : null;
  return 1 - Math.max(...used) <= warn || (windows ?? []).some((w) => w.status === 'rejected');
}

/** The key a sign-in's limits are filed under: its id, or the computer's own
 *  as `default-<tool>`. */
export const limitsKey = (provider: Provider, account: string) => account || `default-${provider}`;
