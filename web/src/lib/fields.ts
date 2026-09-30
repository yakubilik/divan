/** What a chat can be moved to, and what each of those says about itself.
 *
 *  A chat carries five settings that can be changed after it has started: which
 *  model, how hard it thinks, what it is allowed to do without asking, which
 *  folder it is in, and which sign-in it spends. They are chosen in two places
 *  now — the sheet the chat screen opens (`components/FieldSheet.tsx`) and the
 *  list a window on the Dashboard opens over itself (`components/ChatPanel.tsx`)
 *  — and the two must not disagree about what the choices are or what they are
 *  called, so the judgement is here and the drawing is there.
 *
 *  Nothing in this file is invented: the models, efforts and permission modes
 *  are the computer's own catalog, the folders are its projects, the sign-ins
 *  are its accounts, and the figure beside an account is the window it last
 *  reported. A plan nobody has run anything on says nothing rather than `0%`.
 */
import { tilde } from './format';
import type { Catalog, Chat, CliAccount, LimitWindow, Project } from './protocol';

export type Field = 'model' | 'effort' | 'perm_mode' | 'cwd' | 'account_id';

/** The five, in the order a head draws them: the sign-in first, because that is
 *  the one somebody goes looking for when a plan runs out mid-chat. */
export const FIELDS: Field[] = ['account_id', 'model', 'effort', 'perm_mode', 'cwd'];

export const FIELD_LABEL: Record<Field, string> = {
  model: 'Model', effort: 'Effort', perm_mode: 'Permission mode', cwd: 'Project folder',
  account_id: 'Account',
};

/** The daemon labels the machine's own sign-in in its own words; everything
 *  else is the label it was paired under. */
export function accountName(a: CliAccount): string {
  return a.is_default ? "This computer's account" : a.label;
}

/** …and the same thing short enough for a 350 pt window. */
export function shortAccount(a: CliAccount): string {
  return a.is_default ? 'this computer' : a.label;
}

/** The key an account's plan windows are filed under: the default sign-in
 *  reports as `default-<tool>`, because on the chat it is "no account id". */
export const limitKey = (a: CliAccount, provider: string): string =>
  (a.is_default ? `default-${provider}` : a.id);

/** How full a sign-in is, in words: the fullest window it last reported, and
 *  `used up` where one was refused and has not reset yet. Empty where nothing
 *  has been measured — that is not the same as empty capacity. */
export function accountRoom(windows: LimitWindow[] | undefined, now: number): string {
  const refused = (windows ?? []).some((w) => w.status === 'rejected'
    && (w.resets_at == null || w.resets_at > now));
  if (refused) return 'used up';
  const top = (windows ?? [])
    .filter((w) => typeof w.utilization === 'number')
    .sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))[0];
  return top ? `${Math.round((top.utilization ?? 0) * 100)}% used` : '';
}

/** One thing a chat can be moved to. `right` is the figure or the path at the
 *  end of the row; `warn` marks the one that should be read twice — a sign-in
 *  with nothing left, and the permission mode that stops asking. */
export interface FieldRow {
  value: string;
  label: string;
  hint?: string;
  right?: string;
  warn?: boolean;
}

export interface FieldSource {
  chat: Pick<Chat, 'provider' | 'cwd' | 'model' | 'effort' | 'perm_mode' | 'account_id'>;
  catalog: Catalog | null;
  projects?: Project[];
  accounts?: CliAccount[];
  limits?: Record<string, LimitWindow[]>;
  /** Folders only: what has been typed into the search box. */
  query?: string;
  now?: number;
}

export function fieldRows(field: Field, src: FieldSource): FieldRow[] {
  const { chat } = src;
  const pc = src.catalog?.[chat.provider] ?? null;
  if (field === 'account_id') {
    const now = src.now ?? Date.now() / 1000;
    return (src.accounts ?? [])
      .filter((a) => a.provider === chat.provider && (a.logged_in || a.is_default))
      .map((a) => {
        const room = accountRoom(src.limits?.[limitKey(a, chat.provider)], now);
        return {
          // The default account is "no account id", not an id of its own.
          value: a.is_default ? '' : a.id,
          label: accountName(a),
          hint: a.logged_in ? a.detail : 'not signed in',
          right: room,
          warn: room === 'used up' || !a.logged_in,
        };
      });
  }
  if (field === 'model') {
    return (pc?.models ?? []).map((m) => ({
      value: m.id, label: m.label || m.id, hint: m.hint, right: m.id,
    }));
  }
  if (field === 'effort') {
    return (pc?.efforts ?? []).map((e) => ({ value: e, label: e }));
  }
  if (field === 'perm_mode') {
    return (pc?.perm_modes ?? []).map((m) => ({
      value: m,
      label: m,
      hint: m === 'bypass'
        ? 'Skips the permission questions. The dangerous-command list still asks.'
        : undefined,
      warn: m === 'bypass',
    }));
  }
  const q = (src.query ?? '').trim().toLocaleLowerCase('tr');
  return (src.projects ?? [])
    .filter((p) => !q || p.name.toLocaleLowerCase('tr').includes(q)
      || p.path.toLocaleLowerCase('tr').includes(q))
    .map((p) => ({ value: p.path, label: p.name, right: tilde(p.path) }));
}

/** What the chat is on now, spelled the way the rows are. */
export function fieldValue(field: Field, chat: FieldSource['chat']): string {
  if (field === 'cwd') return chat.cwd;
  if (field === 'model') return chat.model;
  if (field === 'effort') return chat.effort ?? '';
  if (field === 'account_id') return chat.account_id ?? '';
  return chat.perm_mode;
}

/** …and in the few words a chip has room for. An effort or a permission mode is
 *  its own name; a folder is its last two parts; a sign-in is short; a model is
 *  the catalog's label where there is one, because `claude-opus-5` is an id and
 *  `Opus 5` is what it is called. */
export function fieldChip(field: Field, src: FieldSource): string {
  const { chat } = src;
  const value = fieldValue(field, chat);
  if (field === 'account_id') {
    const a = (src.accounts ?? []).find((x) => (x.is_default ? '' : x.id) === value);
    return a ? shortAccount(a) : (value || 'this computer');
  }
  if (field === 'model') {
    const m = (src.catalog?.[chat.provider]?.models ?? []).find((x) => x.id === value);
    return m?.label || value;
  }
  if (field === 'cwd') {
    const parts = value.split(/[/\\]/).filter(Boolean);
    return parts.slice(-2).join('/') || value;
  }
  return value;
}
