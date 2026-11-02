// A chat opened in one press, on what New chat would have opened it with.
//
// The pen on the chat list used to send the phone home to the Dashboard, which
// is a detour and a second tap for "give me an empty chat". It now asks the
// computer for one outright, and this is what it asks with: the same choices
// `app/new-chat.tsx` starts out on before anything in it is touched — the tool
// and its remembered model, effort and sign-in, the computer's permission mode,
// the computer's default folder, and the agent the last chat was opened with (Hermes
// where none ever was, nothing after an explicit "No agent"). No React and no
// store, so `scripts/test-fresh-chat.cjs` holds it to that without a phone.
import { workingAccount } from './compose';
import { permissionFor } from './permissions';
import type { Agent, Chat, CliAccount, Defaults, HostInfo, Provider, ProviderCatalog } from './protocol';

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

/** The folder a new chat opens in when nothing more specific was chosen: the
 *  computer's answer (`host.info.default_cwd`, set from either client's
 *  settings), the same one the web panel reads — never the first entry of a
 *  list. A daemon too old to say gets its first root, which is what it would
 *  use itself. Null before the computer has said anything, and only the sheet
 *  can ask. A product page or a folder picked in the sheet still wins. */
export function freshCwd(host: Pick<HostInfo, 'default_cwd' | 'roots'> | null | undefined): string | null {
  return host?.default_cwd || host?.roots?.[0] || null;
}

/** The sign-in a fresh chat opens on: the one remembered for this tool, unless
 *  the computer's list is known and no longer has it signed in — then the first
 *  one that is. Never one that is signed out. `''` is the computer's own. */
export function freshAccount(d: Defaults, accounts: CliAccount[] | null | undefined): string {
  return workingAccount(accounts, d.provider, d.byProvider?.[d.provider]?.account_id ?? '');
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

/** What opening a fresh chat needs out of the store. */
export interface FreshDeps {
  defaults: Defaults;
  hostInfo: Pick<HostInfo, 'default_cwd' | 'roots'> | null | undefined;
  accounts: CliAccount[] | null | undefined;
  catalog: Partial<Record<Provider, ProviderCatalog>> | null | undefined;
  listAgents: (accountId: string | null, cwd: string, provider: Provider) => Promise<Agent[]>;
  createChat: (d: FreshChat) => Promise<Chat>;
}

/** Make a fresh chat — the pen's press, and a link shared to Divan. Null where
 *  there is no folder to open one in; only the New chat sheet can ask for one.
 *  The agent list is one more round trip, asked only when the remembered choice
 *  is an agent; if it cannot be read the chat opens without one rather than not
 *  at all. */
export async function openFresh(o: FreshDeps): Promise<Chat | null> {
  const cwd = freshCwd(o.hostInfo);
  if (!cwd) return null;
  const account = freshAccount(o.defaults, o.accounts);
  const agents = o.defaults.lastAgent === null ? []
    : await o.listAgents(account || null, cwd, o.defaults.provider).catch(() => []);
  return o.createChat(freshChat({ defaults: o.defaults, catalog: o.catalog, cwd, account, agent: freshAgent(o.defaults, agents) }));
}
