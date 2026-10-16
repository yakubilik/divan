import { create } from 'zustand';
import type { CliAccount, Provider, ProviderCatalog } from './protocol';

/** What a new chat opens with, per tool. Null means "whatever that computer
 *  offers first": a stored model, effort or permission word is only ever a
 *  preference, and a catalog that no longer lists it wins. */
export interface ProviderDefaults {
  model: string | null;
  effort: string | null;
  perm_mode: string | null;
  /** '' is a real answer — the computer's own sign-in, which `chat.create`
   *  takes as no account id at all. */
  account_id: string;
}

/** Defaults belong to a computer, not to this browser: models, accounts and
 *  folders are all things only that daemon can name. Keyed by `hostKey`. */
export interface Defaults {
  provider: Provider;
  /** No longer read for new chats: the folder they open in is the computer's
   *  (`newChatCwd`). A value left from before is handed to the computer once
   *  (`localCwdToAdopt`) and then cleared. */
  cwd: string | null;
  byProvider: Partial<Record<Provider, ProviderDefaults>>;
  /** Which sign-in the Agents screen reads from. Its own setting, because an
   *  agent lives in one account's folder and that decides which ones exist at
   *  all — the computer's own folder is usually the emptiest of the lot.
   *  `undefined` means never chosen; `''` is a real answer, the computer's own.
   *  Remembered per host, like everything else here: a choice that resets
   *  every time the screen is opened is not a choice. */
  agentAccountId?: string;
  /** The agent somebody last picked in the New chat dialog. `undefined` is
   *  never picked — the dialog then opens on Hermes — and `null` is a real
   *  answer, "No agent", which must not be turned back into Hermes. Only a
   *  click writes it: a computer or account that simply has no such agent
   *  must not leave "No agent" behind as if it had been chosen. */
  lastAgent?: string | null;
}

const KEY = 'rac.defaults';

/** Shared constants, not fresh objects: components read these straight out of
 *  a zustand selector, where a new object every render is a re-render loop. */
export const NO_DEFAULTS: Defaults = { provider: 'claude', cwd: null, byProvider: {} };
export const NO_PROVIDER_DEFAULTS: ProviderDefaults = {
  model: null, effort: null, perm_mode: null, account_id: '',
};

function load(): Record<string, Defaults> {
  try {
    const raw = localStorage.getItem(KEY);
    const d = raw ? JSON.parse(raw) : null;
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch { return {}; }
}

interface PrefsState {
  defaults: Record<string, Defaults>;
  setDefaults: (key: string, patch: Partial<Defaults>) => void;
  setProviderDefaults: (key: string, provider: Provider, patch: Partial<ProviderDefaults>) => void;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  defaults: load(),

  setDefaults: (key, patch) => {
    const defaults = {
      ...get().defaults,
      [key]: { ...NO_DEFAULTS, ...(get().defaults[key] ?? {}), ...patch },
    };
    set({ defaults });
    try { localStorage.setItem(KEY, JSON.stringify(defaults)); } catch { /* private mode */ }
  },

  setProviderDefaults: (key, provider, patch) => {
    const host = get().defaults[key] ?? NO_DEFAULTS;
    const current = host.byProvider[provider] ?? NO_PROVIDER_DEFAULTS;
    get().setDefaults(key, {
      byProvider: { ...host.byProvider, [provider]: { ...current, ...patch } },
    });
  },
}));

/** The defaults stored for one computer — `NO_DEFAULTS` until it has any. */
export function hostDefaults(defaults: Record<string, Defaults>, key: string): Defaults {
  return defaults[key] ?? NO_DEFAULTS;
}

export function providerDefaults(d: Defaults, provider: Provider): ProviderDefaults {
  return d.byProvider[provider] ?? NO_PROVIDER_DEFAULTS;
}

/** What a new chat would actually open with, for one tool on one computer: the
 *  stored default where the catalog still lists it, the tool's own first answer
 *  where it does not. New chat and Settings resolve it the same way, or
 *  Settings would be describing a chat nobody is about to open. */
export function resolveDefaults(
  pd: ProviderDefaults, pc: ProviderCatalog | null, accounts: CliAccount[] = [],
) {
  const models = pc?.models ?? [];
  const efforts = pc?.efforts ?? [];
  const perms = pc?.perm_modes ?? [];
  const pick = (stored: string | null, known: string[], fallback: string | null) =>
    (stored && known.includes(stored) ? stored : fallback);
  return {
    model: pick(pd.model, models.map((m) => m.id), models[0]?.id ?? null),
    // Not the first effort but the third: they run low to high, and a tool that
    // offers fewer takes the highest it has.
    effort: pick(pd.effort, efforts, efforts.length ? efforts[Math.min(2, efforts.length - 1)] : null),
    // The computer's declared default first — `bypass`, for both tools — and
    // the stored word only for a daemon old enough to declare none. A stored
    // word that won had turned one `ask` into every chat after it.
    perm_mode: pc?.default_perm_mode && perms.includes(pc.default_perm_mode)
      ? pc.default_perm_mode : pick(pd.perm_mode, perms, perms[0] ?? null),
    // An account this computer no longer has falls back to its own sign-in,
    // never to whichever other account happens to be there.
    account_id: accounts.some((a) => !a.is_default && a.id === pd.account_id) ? pd.account_id : '',
  };
}

/** The folder a new chat opens in on this computer when nothing more specific
 *  was chosen — no product page, no folder picked. The computer decides it
 *  (`host.info.default_cwd`, set from either client's settings) and the phone
 *  reads the same field, so "New chat" opens in one place from both. A daemon
 *  too old to say gets its first root, which is what it would use itself. */
export function newChatCwd(
  info: { default_cwd?: string | null; roots?: string[] } | null | undefined,
): string | null {
  return info?.default_cwd || info?.roots?.[0] || null;
}

/** The folder this browser used to remember for new chats, to hand to the
 *  computer once: while the default lived here, this was where the panel's
 *  new chats opened, and it is what that computer's default should become.
 *  Only where the computer can take one and nobody has set one there yet; null
 *  when there is nothing to hand over. */
export function localCwdToAdopt(
  info: { default_cwd?: string | null; default_cwd_chosen?: boolean } | null | undefined,
  local: string | null | undefined,
): string | null {
  if (!local || !info || info.default_cwd === undefined || info.default_cwd_chosen) return null;
  return local;
}
