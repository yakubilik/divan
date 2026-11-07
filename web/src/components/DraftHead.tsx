/** The head of a chat that does not exist yet.
 *
 *  New chat on the Chat place is an empty box, and the chat it opens is made
 *  only when the first words are sent (`lib/tell.ts`). Until then there was no
 *  head at all, so nothing said which model, sign-in or folder the chat would
 *  open on, and nothing could be changed without sending something first. This
 *  is the same row of chips a chat's own head has (`ChatView`'s Header), drawn
 *  from the computer's new-chat defaults, and each one a menu: a choice made
 *  here is what the chat opens with when it is sent.
 *
 *  Controlled: the picks live with whoever sends, because they go into `tell`.
 */
import { useEffect, useMemo, useState } from 'react';
import { C } from '../lib/theme';
import { Chip, Dot, Icon, P, mono } from '../ui/kit';
import { useFleet } from '../lib/fleet';
import { usePrefs } from '../lib/prefs';
import { listAgents } from '../lib/actions';
import { toldDefaults, type ToldPicks } from '../lib/tell';
import { modelOptions, modelValue, readModel } from '../lib/compose';
import { fieldChip, fieldRows, type Field } from '../lib/fields';
import { tilde } from '../lib/format';
import type { Agent, Chat } from '../lib/protocol';

type Menu = Field | 'agent';

export function DraftHead({ hostKey, picks, onPicks }: {
  hostKey: string;
  picks: ToldPicks;
  onPicks: (next: ToldPicks) => void;
}) {
  const slot = useFleet((s) => s.hosts[hostKey] ?? null);
  const prefs = usePrefs((s) => s.defaults);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [query, setQuery] = useState('');
  const [agents, setAgents] = useState<Agent[] | null>(null);

  const base = useMemo(() => (slot ? toldDefaults(slot, prefs, hostKey, picks.provider) : null),
    [slot, prefs, hostKey, picks.provider]);

  const draft = base ? {
    provider: base.provider,
    model: picks.model ?? base.model ?? '',
    effort: picks.effort ?? base.effort ?? null,
    perm_mode: picks.perm_mode ?? base.perm_mode ?? '',
    cwd: picks.cwd ?? base.cwd ?? '',
    account_id: picks.account_id ?? base.account_id ?? '',
  } as Pick<Chat, 'provider' | 'cwd' | 'model' | 'effort' | 'perm_mode' | 'account_id'> : null;

  // The sign-ins are a slow question; the head needs them to name the account.
  useEffect(() => {
    if (slot?.status === 'online' && !slot.accounts.length && !slot.loading?.accounts) {
      useFleet.getState().refreshAccounts(hostKey).catch(() => {});
    }
  }, [hostKey, slot?.status]);

  // Which agents exist depends on the sign-in, the folder and the tool.
  useEffect(() => {
    if (!draft || slot?.status !== 'online') { setAgents(null); return; }
    let alive = true;
    setAgents(null);
    listAgents(hostKey, draft.account_id || null, draft.cwd || undefined, draft.provider)
      .then((r: any) => { if (alive) setAgents((r?.agents ?? []).filter((a: Agent) => a.installed)); })
      .catch(() => { if (alive) setAgents([]); });
    return () => { alive = false; };
  }, [hostKey, draft?.account_id, draft?.cwd, draft?.provider, slot?.status]);

  // A menu closes on a press anywhere else, and on Escape.
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-draft-menu]')) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [menu]);

  if (!slot || !draft) return null;

  const src = {
    chat: draft, catalog: slot.catalog, projects: slot.projects ?? [], accounts: slot.accounts ?? [],
    limits: slot.limits, query, now: Date.now() / 1000,
  };
  const hermes = agents?.find((a) => a.name === 'hermes' || a.id === 'hermes') ?? null;
  const agentLabel = picks.agent === undefined
    ? (agents && !hermes ? 'no agent' : 'Hermes')
    : picks.agent === null ? 'no agent'
      : (agents?.find((a) => a.id === picks.agent)?.label ?? picks.agent);
  const set = (patch: ToldPicks) => { onPicks({ ...picks, ...patch }); setMenu(null); setQuery(''); };
  const toggle = (m: Menu) => { setMenu(menu === m ? null : m); setQuery(''); };
  const changed = Object.keys(picks).length > 0;
  const name = slot.info?.name ?? slot.cfg?.name ?? hostKey;

  const rowsFor = (field: Field) => fieldRows(field, src).map((r) => ({
    value: r.value, label: r.label, note: r.right,
  }));

  const pickModel = (value: string) => {
    const m = readModel(value);
    if (!m) return;
    // Another tool has its own sign-ins, efforts and permission modes: what was
    // picked for the old one does not carry over.
    if (m.provider !== draft.provider) {
      set({ provider: m.provider, model: m.model, account_id: undefined, effort: undefined,
        perm_mode: undefined, agent: undefined });
    } else set({ model: m.model });
  };

  return (
    <div className="dv-chathead" data-draft-head="" style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
      borderBottom: `1px solid ${C.border}`, flexShrink: 0, position: 'relative',
    }}>
      <div className="dv-chatname" style={{ flex: '1 1 0', minWidth: 120 }}>
        <div style={{ fontSize: 17, fontWeight: 600, lineHeight: '24px', color: C.text }}>New chat</div>
        <div style={{ fontSize: 12, color: C.mute, marginTop: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span title={`${name} — the chat opens with these when you send`} style={{
            minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{name.replace(/\.local$/, '')}</span>
          {changed && (
            <button type="button" onClick={() => { onPicks({}); setMenu(null); }}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: C.accent, fontSize: 12 }}>
              back to defaults
            </button>
          )}
        </div>
      </div>
      <div className="dv-chatchips" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Drop open={menu === 'agent'} label="Agents"
          chip={<Chip onClick={() => toggle('agent')} title="Agent">
            <Icon path={P.agent} size={12} color={C.mute} /> {agentLabel}
          </Chip>}
          options={[
            ...(agents ?? []).map((a) => ({ value: a.id, label: a.label || a.name })),
            { value: '', label: 'No agent' },
          ]}
          value={picks.agent === undefined ? (hermes?.id ?? '') : (picks.agent ?? '')}
          empty={agents === null ? 'Reading the agents…' : 'No agent installed.'}
          onPick={(v) => set({ agent: v || null })} />
        <Drop open={menu === 'account_id'} label="Accounts" shrink
          chip={<Chip onClick={() => toggle('account_id')} title="Account this chat will spend" shrink>
            <Icon path={P.agent} size={12} color={C.mute} />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {fieldChip('account_id', src)}
            </span>
          </Chip>}
          options={rowsFor('account_id')} value={draft.account_id ?? ''}
          empty="No sign-in reported yet." onPick={(v) => set({ account_id: v })} />
        <Drop open={menu === 'model'} label="Models"
          chip={<Chip onClick={() => toggle('model')} title="Model">
            <Dot color={C.accent} live /> {fieldChip('model', src) || 'model'}
          </Chip>}
          options={modelOptions(slot.catalog)} value={modelValue(draft.provider, draft.model)}
          empty="This computer has not said what it can open a chat on."
          onPick={pickModel} />
        {!!draft.effort && (
          <Drop open={menu === 'effort'} label="Effort"
            chip={<Chip onClick={() => toggle('effort')} title="Effort">
              <Icon path={P.bolt} size={12} color={C.mute} /> {draft.effort}
            </Chip>}
            options={rowsFor('effort')} value={draft.effort}
            empty="No effort levels." onPick={(v) => set({ effort: v })} />
        )}
        <Drop open={menu === 'perm_mode'} label="Permission mode"
          chip={<Chip onClick={() => toggle('perm_mode')} title="Permission mode"
            tone={draft.perm_mode === 'bypass' ? 'warn' : 'plain'}>
            <Icon path={P.shield} size={12} color={draft.perm_mode === 'bypass' ? C.warn : C.mute} />
            {draft.perm_mode}
          </Chip>}
          options={rowsFor('perm_mode')} value={draft.perm_mode}
          empty="No permission modes." onPick={(v) => set({ perm_mode: v })} />
        <Drop open={menu === 'cwd'} label="Folders" shrink
          chip={<Chip onClick={() => toggle('cwd')} title={draft.cwd} shrink>
            <Icon path={P.folder} size={12} color={C.mute} />
            <span style={{ ...mono, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {draft.cwd ? fieldChip('cwd', src) : 'folder'}
            </span>
          </Chip>}
          search={{ value: query, onChange: setQuery }}
          options={rowsFor('cwd')} value={draft.cwd}
          empty={query ? 'No folder matches.' : 'No folders reported yet.'}
          onPick={(v) => set({ cwd: v })}
          note={draft.cwd ? tilde(draft.cwd) : undefined} />
      </div>
    </div>
  );
}

/** A chip and the menu under it, opening to the left: the head's chips sit
 *  against the right edge, where a menu opening rightwards is cut off. */
function Drop({ open, chip, label, options, value, onPick, empty, shrink, search, note }: {
  open: boolean; chip: React.ReactNode; label: string;
  options: { value: string; label: string; note?: string }[];
  value: string; onPick: (v: string) => void; empty: string; shrink?: boolean;
  search?: { value: string; onChange: (v: string) => void };
  note?: string;
}) {
  return (
    <span data-draft-menu="" style={{
      position: 'relative', display: 'inline-flex', minWidth: shrink ? 0 : undefined,
      flexShrink: shrink ? 1 : 0,
    }}>
      {chip}
      {open && (
        <div role="menu" aria-label={label} className="dv-menu"
          style={{ left: 'auto', right: 0, minWidth: 260, maxWidth: 420, zIndex: 40 }}>
          {!!search && (
            <input autoFocus value={search.value} onChange={(e) => search.onChange(e.target.value)}
              placeholder="Search folders" aria-label="Search folders"
              style={{
                margin: '2px 2px 6px', height: 30, padding: '0 8px', borderRadius: 6, outline: 'none',
                background: C.surface2, border: `1px solid ${C.border}`, color: C.text, font: 'inherit', fontSize: 13,
              }} />
          )}
          {!!note && <p className="dv-meta" style={{ margin: 0, padding: '2px 10px 6px', ...mono }}>{note}</p>}
          {options.length ? options.map((o) => (
            <button key={o.value || '-'} type="button" role="menuitemradio" aria-checked={o.value === value}
              onClick={() => onPick(o.value)}>
              <span>{o.label}</span>
              {!!o.note && <span className="dv-meta">{o.note}</span>}
            </button>
          )) : <p className="dv-meta" style={{ margin: 0, padding: '8px 10px' }}>{empty}</p>}
        </div>
      )}
    </span>
  );
}
