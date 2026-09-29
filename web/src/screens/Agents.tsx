/** Agents: the workers installed on one computer, and the collections they can
 *  be installed from.
 *
 *  One level under Executors, and no frame of its own — Web15's drawer has
 *  eight rows and this is not one of them. So it is built out of what those
 *  frames do draw: the page head, a card of controls, and under it the two
 *  things this screen is about, each under its own section head. An agent is a
 *  card (Web12 W1's project card at a smaller size); a collection is a row that
 *  opens (Web15 W12's table row), because a collection is a list of agents and
 *  not a thing in itself.
 *
 *  Which account's folder is being read is chosen with W15's chips rather than
 *  a menu, the same way the remote screen picks a computer: the choice is the
 *  whole meaning of the list under it, and a closed menu says nothing.
 *
 *  TODO(daemon): the artboard also draws things the protocol does not carry, so
 *  they are not on this screen:
 *   - per-agent on/off toggle (no agent.enable / agent.disable request)
 *   - the tool list an agent may use (Agent has no `tools` field)
 *   - a system-prompt preview and an "Edit" editor (no agent.read / agent.write)
 *   - "Write an agent" and "Import from file" (no agent.create request)
 *   - per-agent last-used time and project (agent.list returns no usage)
 *   - Skills / Commands / Plugins tabs — skills exist only as a count
 *     on a store bundle, and commands/plugins are not in the protocol at all.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { T } from '../lib/theme';
import { Icon, P, Spinner, mono } from '../ui/kit';
import {
  Button, Card, Choice, EmptyState, Note, Pill, Row, SectionHeader, Tag, Well, Write,
} from '../ui/divan';
import { Modal, ModalHead } from '../components/Modal';
import { useFleet } from '../lib/fleet';
import { hostDefaults, providerDefaults, usePrefs } from '../lib/prefs';
import { agentStore, installAgent, listAgents, removeAgent } from '../lib/actions';
import { errText } from '../lib/i18n';
import { shortPath, tilde } from '../lib/format';
import type { Agent, CliAccount, StoreItem, StoreSource } from '../lib/protocol';

/** The computer's own account has no id: agent.list falls back to it, but
 *  agent.install refuses it (needs_own_account), which is why it is offered
 *  for reading and left to fail loudly for writing. */
const OWN = '__own__';

const SCOPE_LABEL: Record<Agent['scope'], string> = {
  project: 'project', user: 'account', builtin: 'built-in',
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'project', label: 'Project' },
  { key: 'account', label: 'Account' },
  { key: 'built-in', label: 'Built-in' },
] as const;
type Filter = typeof FILTERS[number]['key'];

function err(e: any): string {
  return errText(e?.code, e?.message);
}

/** A destructive step never happens on the click that asked for it. The shell
 *  is the panel's own dialog; what is inside it is the design system's. */
function Confirm({ title, body, action, onConfirm, onClose }: {
  title: string; body: string; action: string; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} width={440}>
      <ModalHead title={title} onClose={onClose} />
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px 18px',
      }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>{body}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button face="outline" label="Cancel" onClick={onClose} />
          <Button label={action} onClick={() => { onConfirm(); onClose(); }} />
        </div>
      </div>
    </Modal>
  );
}

/** An agent's own character, in the well a row or a card opens on. It is
 *  deliberately not painted in the agent's own colour: the panel's palette is
 *  the one in `theme.ts` and nothing else. */
const glyphWell = (glyph: string, size = 32) => <Well mark={glyph || '·'} size={size} />;

function AgentCard({ agent, busy, onChat, onRemove }: {
  agent: Agent; busy: boolean; onChat: (() => void) | null; onRemove: (() => void) | null;
}) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {glyphWell(agent.glyph)}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'block', fontSize: 14, fontWeight: 600,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{agent.label || agent.name}</span>
          <span style={{
            ...mono, display: 'block', fontSize: 12, color: T.ink3, marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{agent.name}</span>
        </span>
        <Tag label={SCOPE_LABEL[agent.scope]} />
      </div>

      {agent.description && (
        <div style={{
          fontSize: 13, lineHeight: 1.45, color: T.ink2,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{agent.description}</div>
      )}

      {(agent.model || agent.family) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {agent.model && <Tag label={agent.model} />}
          {agent.family && <Tag label={agent.family} />}
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto',
        paddingTop: 12, borderTop: `1px solid ${T.line}`,
      }}>
        <span title={tilde(agent.path)} style={{
          ...mono, flex: 1, minWidth: 0, fontSize: 11.5, color: T.ink3,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{shortPath(agent.path, 3)}</span>
        {onRemove && (busy
          ? <Spinner size={13} color={T.ink3} />
          : <Button small face="outline" label="Remove" title="Remove this agent" onClick={onRemove} />)}
        {onChat && <Button small label="Start chat" onClick={onChat} />}
      </div>
    </Card>
  );
}

function StoreRow({ source, open, onToggle, busyId, installed, onInstall }: {
  source: StoreSource;
  open: boolean;
  onToggle: () => void;
  busyId: string | null;
  installed: Set<string>;
  onInstall: (item: StoreItem) => void;
}) {
  const owner = source.repo.split('/')[0] || source.repo;
  const skills = source.items.reduce((n, i) => n + (i.skills ?? 0), 0);
  const meta = [owner, `${source.items.length} agents`, skills ? `${skills} skills` : null]
    .filter(Boolean).join(' · ');

  return (
    <Card inset={false}>
      <Row
        first
        icon={open ? P.chevronDown : P.chevronRight}
        title={source.label}
        note={source.note || meta}
        meta={source.note ? meta : null}
        onClick={source.items.length ? onToggle : undefined}
      />

      {source.error && (
        <Row title="Could not read this collection" note={source.error} tone="amber" wash
          meta="unread" />
      )}

      {open && source.items.map((item) => {
        const on = installed.has(item.label.toLocaleLowerCase('tr').replace(/[^a-z0-9]/g, ''));
        return (
          <Row
            key={item.id}
            lead={glyphWell(item.glyph, 28)}
            title={item.label}
            note={item.about || (item.skills ? `${item.skills} skills` : '')}
            meta={item.about && item.skills ? `${item.skills} skills` : null}
            right={busyId === item.id ? <Spinner size={13} color={T.ink3} />
              : on ? <Tag label="installed" tone="run" />
              : <Button small label="Install" onClick={() => onInstall(item)} />}
          />
        );
      })}
    </Card>
  );
}


export function Agents({ onStartChat }: {
  /** Handing the agent up rather than creating the chat here: a chat needs a
   *  model, a folder and a sign-in, and the New chat dialog already asks. */
  onStartChat?: (agent: Agent, accountId: string | null) => void;
}) {
  const { hosts, focus, refreshAccounts } = useFleet();
  const slot = focus ? hosts[focus] : null;
  const online = slot?.status === 'online';

  const [accountId, setAccountId] = useState<string>(OWN);
  const allDefaults = usePrefs((p) => p.defaults);
  const setDefaults = usePrefs((p) => p.setDefaults);
  /** Which family cards are open. Families are collapsed by default — that is
   *  the whole point of the tag. */
  const [openFamilies, setOpenFamilies] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const [sources, setSources] = useState<StoreSource[]>([]);
  const [loadingStore, setLoadingStore] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [openSource, setOpenSource] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [doomed, setDoomed] = useState<Agent | null>(null);

  // Agents live in one account's folder, so an account has to be chosen before
  // the list means anything. account.list is the slow call, hence its own read.
  useEffect(() => {
    if (focus && online) refreshAccounts(focus).catch(() => {});
  }, [focus, online]);

  // account.list returns the computer's own account as a row of its own, and
  // OWN already stands for it — listing both would offer the same folder twice.
  const claudeAccounts: CliAccount[] = useMemo(
    () => (slot?.accounts ?? []).filter((a) => a.provider === 'claude' && !a.is_default),
    [slot?.accounts],
  );

  const argAccount = accountId === OWN ? null : accountId;

  const loadAgents = useCallback(async () => {
    if (!focus || !online) { setAgents([]); return; }
    setLoadingAgents(true);
    setAgentsError(null);
    try {
      const r = await listAgents(focus, argAccount);
      setAgents(r?.agents ?? []);
    } catch (e) {
      setAgents([]);
      setAgentsError(err(e));
    } finally {
      setLoadingAgents(false);
    }
  }, [focus, online, argAccount]);

  const loadStore = useCallback(async () => {
    if (!focus || !online) { setSources([]); return; }
    setLoadingStore(true);
    setStoreError(null);
    try {
      const r = await agentStore(focus);
      setSources(r?.sources ?? []);
    } catch (e) {
      setSources([]);
      setStoreError(err(e));
    } finally {
      setLoadingStore(false);
    }
  }, [focus, online]);

  useEffect(() => { loadAgents(); }, [loadAgents]);
  useEffect(() => { loadStore(); }, [loadStore]);
  // Restoring rather than resetting. `OWN` was the old default and it is the
  // one folder that is reliably empty: agents installed through this app live
  // under the account that installed them, and the computer's own folder only
  // holds what somebody put there by hand. So a remembered choice wins, then
  // the account new chats already use, and only then OWN.
  useEffect(() => {
    if (!focus) return;
    const d = hostDefaults(allDefaults, focus);
    const remembered = d.agentAccountId;
    const forChats = providerDefaults(d, 'claude').account_id;
    // …and a signed-in account before OWN. What this app installs goes into
    // the folder of the account that installed it, so on a computer with real
    // sign-ins the computer's own folder is the one place with nothing in it —
    // which is how an installed agent comes to be missing from the one screen
    // that exists to show it.
    const signedIn = claudeAccounts.find((a) => a.logged_in)?.id ?? '';
    setAccountId(remembered !== undefined
      ? (remembered || OWN)
      : (forChats || signedIn || OWN));
  }, [focus, allDefaults, claudeAccounts]);

  // A store item's id ("hermes:*") is not an agent name, and agent.list does
  // not say where an agent came from, so "installed" is only claimed on an exact
  // name match. A miss just leaves the Install button — never a false badge.
  const installedNames = useMemo(() => {
    const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/[^a-z0-9]/g, '');
    return new Set(agents.flatMap((a) => [norm(a.name), norm(a.label || '')]).filter(Boolean));
  }, [agents]);

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    return agents.filter((a) => {
      if (filter !== 'all' && SCOPE_LABEL[a.scope] !== filter) return false;
      if (!q) return true;
      return (a.label || '').toLocaleLowerCase('tr').includes(q)
        || a.name.toLocaleLowerCase('tr').includes(q)
        || (a.description || '').toLocaleLowerCase('tr').includes(q);
    });
  }, [agents, filter, query]);

  /** What the grid actually draws.
   *
   *  A tool that ships its own workers drops a dozen files in one folder, all
   *  under one prefix, and the daemon tags them as a family for exactly this
   *  reason: they are one tool's insides, not a dozen things to talk to. Left
   *  flat they bury the two or three agents somebody actually installed under
   *  a wall of identical tiles. So a family is one card until it is opened —
   *  and what this app installed is never inside one, so it always shows.
   */
  const entries = useMemo(() => {
    const singles: Agent[] = [];
    const families = new Map<string, Agent[]>();
    for (const a of shown) {
      // A searched-for name should not stay hidden inside a folded card.
      if (a.family && !a.installed && !query.trim()) {
        const arr = families.get(a.family) ?? [];
        arr.push(a);
        families.set(a.family, arr);
      } else {
        singles.push(a);
      }
    }
    // Installed first: they are the answer to "what did I put here".
    singles.sort((x, y) => Number(!!y.installed) - Number(!!x.installed));
    return [
      ...singles.map((agent) => ({ kind: 'one' as const, agent })),
      ...[...families].map(([name, agents]) => ({ kind: 'family' as const, name, agents })),
    ];
  }, [shown, query]);

  const storeShown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    if (!q) return sources;
    return sources
      .map((s) => {
        const hit = s.label.toLocaleLowerCase('tr').includes(q)
          || s.repo.toLocaleLowerCase('tr').includes(q)
          || (s.note || '').toLocaleLowerCase('tr').includes(q);
        if (hit) return s;
        const items = s.items.filter((i) =>
          i.label.toLocaleLowerCase('tr').includes(q)
          || (i.about || '').toLocaleLowerCase('tr').includes(q));
        return items.length ? { ...s, items } : null;
      })
      .filter((s): s is StoreSource => s !== null);
  }, [sources, query]);

  const doInstall = async (item: StoreItem) => {
    if (!focus) return;
    setBusyId(item.id);
    setNotice(null);
    try {
      await installAgent(focus, item.id, argAccount);
      await loadAgents();
    } catch (e: any) {
      // A bundle carries skills, and the computer's own account is the one
      // folder they must never land in — so this one gets a way out, not just
      // an error line.
      setNotice(e?.code === 'needs_own_account'
        ? `${err(e)} Pick one of your own accounts above, then try again.`
        : err(e));
    } finally {
      setBusyId(null);
    }
  };

  const doRemove = async (agent: Agent) => {
    if (!focus) return;
    setBusyId(agent.name);
    setNotice(null);
    try {
      await removeAgent(focus, agent.name, argAccount);
      await loadAgents();
    } catch (e) {
      setNotice(err(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!slot) {
    return (
      <EmptyState
        title="No computer is chosen."
        body="An agent is a definition in a folder on one computer. Pair a computer under
              Machines, and the agents installed on it — and the collections it can install
              from — appear here."
      />
    );
  }

  const accountLabel = accountId === OWN
    ? 'This computer’s account'
    : (claudeAccounts.find((a) => a.id === accountId)?.label ?? accountId);
  const machine = slot.info?.name || slot.cfg.name;

  /** The chips the folder is chosen with: the computer's own account first,
   *  then every account somebody added to it. */
  const chooseAccount = (id: string) => {
    setAccountId(id);
    // Written down, so the next visit opens where this one ended.
    if (focus) setDefaults(focus, { agentAccountId: id === OWN ? '' : id });
  };

  return (
    <>
      <SectionHeader
        kind="page" title="Agents" note={`${machine} · ${accountLabel}`}
        right={online ? `${agents.length} installed` : 'offline'}
        tone={online ? undefined : 'ink3'}
      />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: T.ink3, marginRight: 4 }}>Account</span>
          <Pill
            label="This computer’s"
            face={accountId === OWN ? 'ink' : 'surface'}
            onClick={online ? () => chooseAccount(OWN) : undefined}
          />
          {claudeAccounts.map((a) => (
            <Pill
              key={a.id} label={a.label}
              dot={a.logged_in ? 'running' : 'quiet'}
              title={a.logged_in ? undefined : 'not signed in'}
              face={accountId === a.id ? 'ink' : 'surface'}
              onClick={online ? () => chooseAccount(a.id) : undefined}
            />
          ))}
          {slot.loading.accounts && <Spinner size={13} color={T.ink3} />}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Choice label="Scope" value={filter} onChange={setFilter}
            options={FILTERS.map((f) => ({ key: f.key, label: f.label }))} />
          <span style={{
            flex: 1, minWidth: 180, display: 'flex', alignItems: 'center', gap: 10, fontSize: 14,
          }}>
            <Icon path={P.search} size={16} color={T.ink3} />
            <Write
              value={query} onChange={setQuery} label="Search agents and collections"
              placeholder="Search agents and collections…"
            />
          </span>
          <Button
            small face="outline" label="Refresh" disabled={!online}
            onClick={() => { loadAgents(); loadStore(); }}
          />
        </div>
      </Card>

      {notice && (
        <Note
          tone="amber" icon={P.warn} title="That did not work" body={notice}
          foot={[<Button small face="outline" label="Dismiss" onClick={() => setNotice(null)} />]}
        />
      )}

      <SectionHeader
        title="On this account" count={shown.length}
        note={shown.length === agents.length ? undefined : `of ${agents.length}`}
      />

      {!online ? (
        <Card><div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
          {machine} is not answering. Agents are read from their definitions on that computer,
          so the list arrives when it does.
        </div></Card>
      ) : loadingAgents ? (
        <Card><div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: T.ink2 }}>
          <Spinner size={14} color={T.ink3} /> Reading the agents on {accountLabel}…
        </div></Card>
      ) : agentsError ? (
        <Note tone="red" icon={P.warn} title="Could not read the agents" body={agentsError} />
      ) : !shown.length ? (
        <Card><div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
          {agents.length
            ? 'No agent on this account matches the scope and the words above.'
            : 'Nothing is installed on this account. Install one from a collection below, or '
              + 'drop a markdown file with a name and a description into that tool’s agents '
              + 'folder on the computer.'}
        </div></Card>
      ) : (
        <div style={{
          display: 'grid', gap: 14, alignItems: 'stretch',
          gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))',
        }}>
          {entries.map((e) => {
            if (e.kind === 'family') {
              const open = !!openFamilies[e.name];
              return (
                <Card key={`family:${e.name}`} inset={false} style={{ gridColumn: '1 / -1' }}>
                  <Row
                    first
                    icon={open ? P.chevronDown : P.chevronRight}
                    title={e.name} meta={`${e.agents.length} workers`}
                    note={`They arrived together — one tool’s insides, not ${e.agents.length} `
                      + 'agents to talk to'}
                    onClick={() => setOpenFamilies((o) => ({ ...o, [e.name]: !open }))}
                  />
                  {open && (
                    <div style={{
                      display: 'grid', gap: 14, padding: '0 18px 18px',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))',
                    }}>
                      {e.agents.map((a) => (
                        <AgentCard key={a.id} agent={a} busy={busyId === a.name}
                          onChat={online && onStartChat
                            ? () => onStartChat(a, argAccount) : null}
                          onRemove={a.installed && a.scope !== 'builtin' && !!a.path
                            ? () => setDoomed(a) : null} />
                      ))}
                    </div>
                  )}
                </Card>
              );
            }
            const a = e.agent;
            return (
              <AgentCard
                key={a.id}
                agent={a}
                busy={busyId === a.name}
                onChat={online && onStartChat ? () => onStartChat(a, argAccount) : null}
                // The built-in agent creator has no file behind it, and an
                // agent this app did not write back is refused anyway
                // (agent_not_removable) — so no button is offered for either.
                onRemove={a.installed && a.scope !== 'builtin' && !!a.path
                  ? () => setDoomed(a) : null}
              />
            );
          })}
        </div>
      )}

      <SectionHeader
        title="Collections" count={sources.length}
        right={loadingStore ? 'reading…' : undefined}
      />

      {storeError ? (
        <Note tone="red" icon={P.warn} title="Could not read the collections" body={storeError} />
      ) : !storeShown.length && !loadingStore ? (
        <Card><div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
          {query
            ? 'No collection matches the words above.'
            : 'This computer offers no collection to install from.'}
        </div></Card>
      ) : storeShown.map((s) => (
        <StoreRow
          key={s.id}
          source={s}
          open={openSource === s.id
            || (openSource === null && s.items.length > 0 && s.items.length <= 3)
            || (!!query.trim() && s.items.length <= 12)}
          onToggle={() => setOpenSource((k) => (k === s.id ? null : s.id))}
          busyId={busyId}
          installed={installedNames}
          onInstall={doInstall}
        />
      ))}

      <div style={{ ...mono, fontSize: 12.5, lineHeight: 1.5, color: T.ink3, maxWidth: 620 }}>
        installing downloads text only — nothing is executed. an agent definition is an
        instruction that runs with that computer’s tools, and it can only be installed into an
        account you added yourself.
      </div>

      {doomed && (
        <Confirm
          title="Remove this agent?"
          body={`The ${doomed.label || doomed.name} definition is deleted from that computer. You can install it again from the store.`}
          action="Remove"
          onConfirm={() => doRemove(doomed)}
          onClose={() => setDoomed(null)}
        />
      )}
    </>
  );
}
