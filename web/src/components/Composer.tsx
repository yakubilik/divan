/** The one Composer (HANDOVER §3, §5): the command bar, the New chat dialog and
 *  the New ticket form, folded into a field with a mode under it.
 *
 *  Over the field is the scope — a product, or nothing, which is Hermes filing
 *  it — set by `+ project` or by typing `@name`. Under it, the mode (Ask · Ice
 *  Box · Start now), the microphone and send. Under that, four chips that say
 *  what a chat will open with: Project, Agent, Account, Model. Every one of
 *  them has a default and none of them is a step — a menu opens only when its
 *  chip is pressed, a changed chip is drawn in ink with an × back to the
 *  default, and it applies to this one send. The rules are `lib/compose.ts`.
 *
 *  Files are dropped on it, pasted into it or picked with the + beside the
 *  microphone, the way they are in a chat's own box. They are held here and go
 *  up with the send: the chat they belong to does not exist until then.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DivanView } from '../lib/divan';
import { useFleet } from '../lib/fleet';
import { hostDefaults, providerDefaults, usePrefs } from '../lib/prefs';
import { useThresholds } from '../lib/machine';
import { listAgents } from '../lib/actions';
import { appendSpeech } from '../lib/dictate';
import { toldDefaults, type ToldPicks } from '../lib/tell';
import {
  MODES, accountOptions, limitsKey, lowQuota, mention, modelOptions, modelValue, readModel,
  type Mode, type Picks,
} from '../lib/compose';
import type { Agent, Provider } from '../lib/protocol';
import { MicButton, useMic } from './Mic';

const HIDDEN: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

const ARROW = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
const CROSS = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;

export interface ComposerProps {
  view: DivanView;
  /** Ask: open a chat with these words in it and go to it. */
  onAsk: (text: string, project: string | null, picks: ToldPicks, files: File[]) => Promise<unknown>;
  /** Ice Box and Start now: write the card. Answers the line to say after. */
  onCard: (text: string, project: string, mode: Exclude<Mode, 'ask'>) => Promise<string>;
  /** Every other choice a new chat has (effort, permissions, a folder, caps):
   *  the full dialog, for the times a default is not the answer. */
  onOptions?: () => void;
  inputRef?: React.RefObject<HTMLTextAreaElement>;
  /** The product this Composer belongs to (the foot of a project page): every
   *  send carries it, and its chip cannot be taken off or changed. */
  lock?: string | null;
}

export function Composer({ view, onAsk, onCard, onOptions, inputRef, lock = null }: ComposerProps) {
  const host = useFleet((s) => s.focus);
  const slot = useFleet((s) => (s.focus ? s.hosts[s.focus] : null));
  const prefs = usePrefs((s) => s.defaults);
  const warn = useThresholds((s) => s.thresholds.warn);

  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('ask');
  const [picks, setPicks] = useState<Picks>({});
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; error?: boolean } | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave also fire crossing between children, so the highlight
  // follows a depth count rather than the first leave it sees.
  const depth = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  const own = useRef<HTMLTextAreaElement>(null);
  const field = inputRef ?? own;
  const box = useRef<HTMLDivElement>(null);
  const mic = useMic({ hostKey: host, onCommit: (chunk) => setText((prev) => appendSpeech(prev, chunk)) });

  // What a chat opens with on this computer, before any chip is touched.
  const base = useMemo(() => (slot && host
    ? toldDefaults(slot, prefs, host, 'claude') ?? toldDefaults(slot, prefs, host) : null),
  [slot, prefs, host]);
  const chosen = readModel(picks.model);
  const provider: Provider = chosen?.provider ?? base?.provider ?? 'claude';
  const pd = host ? providerDefaults(hostDefaults(prefs, host), provider) : null;
  const accounts = accountOptions(slot?.accounts ?? [], provider);
  const account = picks.account ?? (provider === base?.provider ? base?.account_id : pd?.account_id) ?? '';
  const models = modelOptions(slot?.catalog ?? null);
  const model = picks.model ?? (base?.model ? modelValue(base.provider, base.model) : undefined);

  // The sign-ins are a slow question and the Dashboard has not asked it yet.
  useEffect(() => {
    if (host && slot?.status === 'online' && !slot.accounts.length && !slot.loading?.accounts) {
      useFleet.getState().refreshAccounts(host).catch(() => {});
    }
  }, [host, slot?.status]);

  // Which agents exist depends on the sign-in: asked once per computer and account.
  useEffect(() => {
    if (!host || provider !== 'claude' || slot?.status !== 'online') { setAgents(null); return; }
    let alive = true;
    listAgents(host, account || null)
      .then((r: any) => { if (alive) setAgents((r?.agents ?? []).filter((a: Agent) => a.installed)); })
      .catch(() => { if (alive) setAgents([]); });
    return () => { alive = false; };
  }, [host, account, provider, slot?.status]);

  // A menu closes on a press anywhere else, and on Escape.
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-menu-root]')) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [menu]);

  const hermes = agents?.find((a) => a.name === 'hermes' || a.id === 'hermes') ?? null;
  const agentLabel = picks.agent === undefined
    ? (provider !== 'claude' ? 'No agent' : agents && !hermes ? 'No agent' : 'Hermes')
    : picks.agent === null ? 'No agent'
      : (agents?.find((a) => a.id === picks.agent)?.label ?? picks.agent);
  const scoped = lock ?? picks.project ?? null;
  const project = scoped ? view.projects.find((p) => p.key === scoped) ?? null : null;
  const low = lowQuota(slot?.limits?.[limitsKey(provider, account)], warn) === true;

  const change = (value: string) => {
    if (lock) { setText(value); if (said?.error) setSaid(null); return; }
    const m = mention(view, value);
    if (m.project) setPicks((p) => ({ ...p, project: m.project }));
    setText(m.text);
    if (said?.error) setSaid(null);
  };

  const addFiles = (list: FileList) => {
    setFiles((was) => [...was, ...Array.from(list)]);
    if (said?.error) setSaid(null);
  };

  // A screenshot on the clipboard is a file, not text. A rich copy carries
  // both, and there the text is what was meant.
  const onPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData?.files;
    if (!pasted?.length || e.clipboardData.getData('text/plain').trim()) return;
    e.preventDefault();
    addFiles(pasted);
  };

  const send = async () => {
    if (mic.state !== 'idle') { mic.stop(); return; }
    const m = lock ? { project: null, text } : mention(view, text, true);
    const scope = lock ?? m.project ?? picks.project ?? null;
    const words = m.text.trim();
    if (m.project) { setPicks((p) => ({ ...p, project: m.project })); setText(m.text); }
    if ((!words && !files.length) || busy) return;
    if (mode !== 'ask' && files.length) {
      setSaid({ text: 'A card cannot carry files: send them with Ask, or take them off.', error: true });
      return;
    }
    if (mode !== 'ask' && !scope) {
      setSaid({ text: 'A card needs a project: type @name or press + project.', error: true });
      return;
    }
    setBusy(true);
    setSaid(null);
    try {
      if (mode === 'ask') {
        const m2 = readModel(picks.model);
        await onAsk(words, scope, {
          ...(m2 ? { provider: m2.provider, model: m2.model } : {}),
          ...(picks.account !== undefined ? { account_id: picks.account } : {}),
          ...(picks.agent !== undefined ? { agent: picks.agent } : m2 && m2.provider !== 'claude' ? { agent: null } : {}),
        }, files);
        setText('');
        setFiles([]);
      } else {
        const line = await onCard(words, scope!, mode);
        setText('');
        setSaid({ text: line });
      }
      // A changed chip was for that one send.
      setPicks({});
    } catch (e: any) {
      setSaid({ text: e?.message ?? 'That did not reach the computer', error: true });
    } finally {
      setBusy(false);
    }
  };

  const pick = (patch: Picks) => { setPicks((p) => ({ ...p, ...patch })); setMenu(null); };
  const reset = (key: keyof Picks) => setPicks((p) => { const next = { ...p }; delete next[key]; return next; });

  const projectOptions = view.projects.map((p) => ({ value: p.key, label: p.name }));
  const agentOptions = [
    ...(agents ?? []).map((a) => ({ value: a.id, label: a.label || a.name })),
    { value: '', label: 'No agent' },
  ];
  const modelLabel = models.find((o) => o.value === model)?.label ?? (model ? readModel(model)?.model : null) ?? 'none offered';
  const accountLabel = accounts.find((o) => o.value === account)?.label
    ?? (account ? account : "This computer's account");
  const hint = MODES.find((m) => m.key === mode)!.hint;

  return (
    <section className="dv-glass-strong dv-composer" ref={box} aria-label="Composer"
      data-dragging={dragging ? 'true' : undefined}
      onDragEnter={(e) => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
      onDrop={(e) => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}>
      <div className="dv-scope" data-menu-root="">
        <span className="lbl">to</span>
        {lock ? (
          <span className="dv-chip dv-chip--locked" data-locked="true" aria-label={`Scope ${project?.name ?? lock}, fixed to this project`}>
            <span className="dv-mono dv-mono--sm" aria-hidden="true">{(project?.name ?? lock).charAt(0).toUpperCase()}</span>
            {project?.name ?? lock}
          </span>
        ) : project ? (
          <button type="button" className="dv-chip dv-hit" aria-pressed="true"
            aria-label={`Scope ${project.name}, press to clear`}
            onClick={() => reset('project')}>
            <span className="dv-mono dv-mono--sm" aria-hidden="true">{project.name.charAt(0).toUpperCase()}</span>
            {project.name}<span className="x" aria-hidden="true">×</span>
          </button>
        ) : (
          <button type="button" className="dv-chip dv-chip--add dv-hit" aria-haspopup="menu"
            aria-expanded={menu === 'scope'} onClick={() => setMenu(menu === 'scope' ? null : 'scope')}>
            + project
          </button>
        )}
        {menu === 'scope' && (
          <Menu label="Projects" options={projectOptions} value={null}
            onPick={(v) => pick({ project: v })} empty="No project on any machine yet." />
        )}
        {!lock && <span className="dv-meta" style={{ marginLeft: 'auto' }}>empty = Hermes files it</span>}
      </div>
      {files.length > 0 && (
        <ul className="dv-attached" aria-label="Attached files">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.lastModified}-${i}`}>
              {f.type.startsWith('image/') ? <Thumb file={f} /> : <span className="name">{f.name}</span>}
              <button type="button" className="dv-icon-btn dv-hit" aria-label={`Remove ${f.name}`}
                onClick={() => setFiles((was) => was.filter((_, at) => at !== i))}>{CROSS}</button>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor="composer-in" style={HIDDEN}>Message to Divan</label>
      <textarea
        id="composer-in" ref={field} rows={2}
        placeholder={mic.state === 'listening' ? 'Listening…'
          : lock ? `Ask about ${project?.name ?? lock}, or drop a card.` : 'Tell Divan what to do, in which project.'}
        value={mic.interim ? appendSpeech(text, mic.interim) : text}
        onChange={(e) => change(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
        }}
      />
      <div className="dv-composer-foot">
        <div className="dv-seg" role="group" aria-label="Mode">
          {MODES.map((m) => (
            <button key={m.key} type="button" aria-pressed={mode === m.key}
              onClick={() => { setMode(m.key); setSaid(null); }}>{m.label}</button>
          ))}
        </div>
        <span className="dv-meta">{hint}</span>
        <span className="grow" />
        <span className="dv-meta" title="Search chats, folders and commands">⌘K</span>
        <input ref={picker} type="file" multiple name="attachments" style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }} />
        <button type="button" className="dv-icon-btn dv-attach dv-hit" aria-label="Attach a file" title="Attach a file"
          onClick={() => picker.current?.click()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <MicButton mic={mic} size={36} />
        <button type="button" className="dv-send" aria-label="Send" disabled={busy || (!text.trim() && !files.length)}
          onClick={() => void send()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
        </button>
      </div>
      <div className="dv-pickers" role="group" aria-label="What a new chat opens with">
        {!lock && <Picker name="Project" value={project ? project.name : 'auto'} changed={!!project}
          open={menu === 'project'} onOpen={() => setMenu(menu === 'project' ? null : 'project')}
          onReset={() => reset('project')}>
          <Menu label="Projects" options={[{ value: '', label: 'auto' }, ...projectOptions]}
            value={picks.project ?? ''} empty="No project on any machine yet."
            onPick={(v) => (v ? pick({ project: v }) : (reset('project'), setMenu(null)))} />
        </Picker>}
        <Picker name="Agent" value={agentLabel} changed={picks.agent !== undefined}
          open={menu === 'agent'} onOpen={() => setMenu(menu === 'agent' ? null : 'agent')}
          onReset={() => reset('agent')}>
          <Menu label="Agents" options={agentOptions}
            value={picks.agent === undefined ? (hermes?.id ?? '') : (picks.agent ?? '')}
            empty={agents === null ? 'Reading the agents…' : 'No agent installed.'}
            onPick={(v) => pick({ agent: v || null })} />
        </Picker>
        <Picker name="Account" value={accountLabel} changed={picks.account !== undefined}
          open={menu === 'account'} onOpen={() => setMenu(menu === 'account' ? null : 'account')}
          onReset={() => reset('account')}
          warn={low ? 'low quota' : null}>
          <Menu label="Accounts" options={accounts} value={account}
            empty="No sign-in reported yet." onPick={(v) => pick({ account: v })} />
        </Picker>
        <Picker name="Model" value={modelLabel} changed={picks.model !== undefined}
          open={menu === 'model'} onOpen={() => setMenu(menu === 'model' ? null : 'model')}
          onReset={() => reset('model')}>
          <Menu label="Models" options={models} value={model ?? ''}
            empty="This computer has not said what it can open a chat on."
            onPick={(v) => pick({ model: v })} />
        </Picker>
        {!!onOptions && (
          <button type="button" className="dv-btn dv-btn--ghost dv-hit" onClick={onOptions}>More options</button>
        )}
      </div>
      {(busy || !!said || !!mic.error) && (
        <p className="dv-meta" role="status" style={{ margin: '10px 4px 0', color: said?.error || mic.error ? 'var(--red)' : undefined }}>
          {busy ? (mode === 'ask' ? 'starting a chat…' : 'filing the card…') : mic.error ?? said?.text}
        </p>
      )}
    </section>
  );
}

/** A picture waiting to be sent, drawn from the file itself: nothing has been
 *  uploaded yet, so there is no address on the computer to show it from. */
function Thumb({ file }: { file: File }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return src ? <img src={src} alt={file.name} /> : null;
}

/** One of the four: `Agent Hermes ⌄`, quiet while it is the default, in ink with
 *  an × once it is not. */
function Picker({ name, value, changed, open, onOpen, onReset, warn, children }: {
  name: string; value: string; changed: boolean; open: boolean;
  onOpen: () => void; onReset: () => void; warn?: string | null; children: React.ReactNode;
}) {
  return (
    <span data-menu-root="" data-picker={name} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button type="button" className="dv-chip dv-picker dv-hit" aria-haspopup="menu" aria-expanded={open}
        data-changed={changed ? 'true' : undefined} onClick={onOpen}
        aria-label={`${name}: ${value}${warn ? `, ${warn}` : ''}`}>
        <span className="lbl">{name}</span>
        <span className="val">{value}</span>
        {!!warn && <><i className="dv-dot dv-dot--ask" aria-hidden="true" /><span className="warn">{warn}</span></>}
        {ARROW}
      </button>
      {changed && (
        <button type="button" className="dv-icon-btn dv-picker-x dv-hit" aria-label={`${name} back to the default`}
          onClick={onReset}>{CROSS}</button>
      )}
      {open && children}
    </span>
  );
}

/** The menu under a chip: `--glass-2`, `--radius-md`, one radio per option. */
function Menu({ label, options, value, onPick, empty }: {
  label: string; options: { value: string; label: string; note?: string }[];
  value: string | null; onPick: (value: string) => void; empty: string;
}) {
  return (
    <div role="menu" aria-label={label} className="dv-menu">
      {options.length ? options.map((o) => (
        <button key={o.value || '-'} type="button" role="menuitemradio" aria-checked={o.value === value}
          onClick={() => onPick(o.value)}>
          <span>{o.label}</span>
          {!!o.note && <span className="dv-meta">{o.note}</span>}
        </button>
      )) : <p className="dv-meta" style={{ margin: 0, padding: '8px 10px' }}>{empty}</p>}
    </div>
  );
}
