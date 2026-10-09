// A chat opened in one press, on what New chat would have opened it with.
//
// The pen on the chat list used to send the phone home to the Dashboard, which
// is a detour and a second tap for "give me an empty chat". It now asks the
// computer for one outright, and this is what it asks with: the same choices
// `app/new-chat.tsx` starts out on before anything in it is touched — the tool
// and its remembered model, effort and sign-in, the computer's permission mode,
// the remembered folder, and the agent the last chat was opened with (Hermes
// where none ever was, nothing after an explicit "No agent"). No React and no
// store, so `scripts/test-fresh-chat.cjs` holds it to that without a phone.
import { accountValues } from './compose';
import { permissionFor } from './permissions';
import type { Agent, CliAccount, Defaults, Provider, ProviderCatalog } from './protocol';

/** What `chat.create` is given. */
export interface FreshChat {
  provider: Provider;
  model: string;
  effort?: string;
  perm_mode: string;
  cwd: string;
  account_id?: string;
  agent_id?: string;
  title?: string;
}

/** The folder a fresh chat opens in: the remembered one, else the first the
 *  computer lists. Null where there is none, and only the sheet can ask. */
export function freshCwd(d: Defaults, projects: { path: string }[]): string | null {
  return d.cwd || projects[0]?.path || null;
}

/** The sign-in a fresh chat opens on: the one remembered for this tool, unless
 *  the computer's list is known and no longer has it signed in — then the
 *  computer's own, as the sheet resolves it. `''` is the computer's own. */
export function freshAccount(d: Defaults, accounts: CliAccount[] | null | undefined): string {
  const stored = d.byProvider?.[d.provider]?.account_id ?? '';
  if (!stored || !accounts?.length) return stored;
  return accountValues(accounts, d.provider).some((a) => a.value === stored) ? stored : '';
}

/** The sheet's agent rule: the last one chosen, else Hermes; an explicit
 *  "No agent" (`lastAgent === null`) stays none. Only installed ones count. */
export function freshAgent(d: Defaults, agents: Agent[] | null | undefined): Agent | null {
  if (d.lastAgent === null) return null;
  const list = (agents ?? []).filter((a) => a.installed);
  const named = (w: string | null | undefined) => (w ? list.find((a) => a.id === w || a.name === w) : undefined);
  return named(d.lastAgent) ?? named('hermes') ?? null;
}

export function freshChat(o: {
  defaults: Defaults;
  catalog: Partial<Record<Provider, ProviderCatalog>> | null | undefined;
  cwd: string;
  account: string;
  agent: Agent | null;
}): FreshChat {
  const d = o.defaults;
  const provider = d.provider;
  const cat = o.catalog?.[provider] ?? null;
  const pd = d.byProvider?.[provider];
  // A remembered model or effort the tool no longer offers falls back the way
  // the sheet's does: this tool's own, then the general one, then its first.
  const knows = (m: string | null | undefined) => !!m && (!cat || cat.models.some((x) => x.id === m));
  const model = [pd?.model, d.model].find(knows) ?? cat?.models[0]?.id ?? pd?.model ?? d.model;
  const efforts = (cat?.models.find((m: any) => m.id === model) as any)?.efforts ?? cat?.efforts;
  const effort = [pd?.effort, d.effort].find((e) => e && (!efforts || efforts.includes(e))) ?? efforts?.[0] ?? undefined;
  return {
    provider, model, ...(effort ? { effort } : {}), perm_mode: permissionFor(provider, cat, d), cwd: o.cwd,
    ...(o.account ? { account_id: o.account } : {}),
    // An agent chat is named after the agent, as the sheet and the panel name it.
    ...(o.agent ? { agent_id: o.agent.id, title: o.agent.label || o.agent.name } : {}),
  };
}
