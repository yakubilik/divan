/** This computer: everything one paired machine keeps, and the one setting
 *  that is this browser's.
 *
 *  One level under Settings, and no frame of its own — Web15's drawer has eight
 *  rows and this is the page behind four of them. So the shape is W15's own:
 *  the `260px` column of rows on the left (`SidePanel`, the same part the
 *  drawer itself is navigated by), the page beside it, and every section a run
 *  of cards with W17's rows in them — a thing, a grey line saying what it is,
 *  and one button.
 *
 *  TODO(daemon): the Settings artboard draws several things the protocol does
 *  not carry. They are left off this screen rather than faked:
 *   - "Restart the daemon" — there is no restart request here (Update has one).
 *   - "Open the file" / a config.toml path in the header — no config.path request.
 *   - Storage (2.2 GB) — nothing reports disk usage.
 *   - Notifications — push is per device and the panel has no push registration.
 *   - Security: the dangerous-command list and the denied-path list. host.info
 *     carries `roots` and nothing else, so only roots are shown.
 *   - Accounts: "Move a sign-in" (account.export/import exist, but moving a
 *     sign-in between two computers is its own flow and is not built here).
 *   - "make default" — is_default is derived from the account having no home
 *     folder; there is no request that sets it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SIZE, T, useTheme, type Tone } from '../lib/theme';
import { Icon, P, Spinner, mono } from '../ui/kit';
import {
  Button, Card, Cell, Choice, FieldRow, Note, Quoted, Row, SectionHeader, SidePanel,
  StatusDot, Slider, Tag, Well, Write, type PanelItem,
} from '../ui/divan';
import { Modal, ModalHead } from '../components/Modal';
import { ProviderMark } from '../components/Sidebar';
import { onAnyEvent, useFleet, type HostSlot } from '../lib/fleet';
import { hostDefaults, providerDefaults, resolveDefaults, usePrefs } from '../lib/prefs';
import { parsePairing, toolStatus } from '../lib/actions';
import {
  availability, dictateEngine, dictateLang, install, langChoices, langName,
  setDictateEngine, setDictateLang, support, type Availability, type EnginePref,
} from '../lib/dictate';
import { errText, t } from '../lib/i18n';
import { ago, tilde, until, uptime, windowName } from '../lib/format';
import { copyText } from '../lib/clipboard';
import type {
  CliAccount, LimitWindow, LoginMethod, LoginPrompt, Provider, ToolStatus,
} from '../lib/protocol';
import { refusalText } from '../lib/refusal';

/** The daemon labels the machine's own account in English ("This computer's
 *  account") because it has no idea who is asking. i18n already carries the
 *  phrase, so the panel says it in its own language. */
function accountName(a: { is_default: boolean; label: string }): string {
  return a.is_default ? t('useDefaultAccount') : a.label;
}

type SectionId = 'hosts' | 'accounts' | 'defaults' | 'tools' | 'appearance' | 'security' | 'about';

const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'hosts', label: 'Computers', icon: P.cpu },
  { id: 'accounts', label: 'Accounts', icon: P.agent },
  { id: 'defaults', label: 'New chats', icon: P.plus },
  { id: 'tools', label: 'Tools', icon: P.bolt },
  { id: 'appearance', label: 'Appearance', icon: P.eye },
  { id: 'security', label: 'Security', icon: P.shield },
  { id: 'about', label: 'About', icon: P.layout },
];

/** The daemon's own words for a sign-in route. Which of these are on offer is
 *  the computer's answer (tool.status), not a guess made here. */
const METHOD: Record<string, { label: string; body: string }> = {
  subscription: { label: 'Claude subscription', body: 'Sign in on a page that opens in the browser. Spends your subscription quota.' },
  console: { label: 'Anthropic Console', body: 'Pay as you go. Billed to the API account, not a subscription.' },
  sso: { label: 'Company sign-in (SSO)', body: 'Through your organisation’s identity provider.' },
  api_key: { label: 'API key', body: 'Paste the key. No browser opens.' },
  device: { label: 'ChatGPT with a one-time code', body: 'A page opens; you type the code it gives you.' },
  browser_here: { label: 'That computer’s browser', body: 'Completes on its own if you are sitting at that computer.' },
};

function methodName(id: string): string { return METHOD[id]?.label ?? id; }

function err(e: any): string { return errText(e?.code, e?.message); }

function hostDetail(slot: HostSlot): string {
  if (slot.status === 'online') return 'online';
  if (slot.status === 'connecting') return 'connecting…';
  if (slot.status === 'unauthorized') return refusalText(slot.refusal).short;
  return slot.lastOnline ? `offline · ${ago(slot.lastOnline / 1000)}` : 'offline';
}

/** A connection as one of the six states the design colours. */
function hostState(slot: HostSlot): { state: 'running' | 'asking' | 'stuck' | 'quiet'; tone: Tone } {
  if (slot.status === 'online') return { state: 'running', tone: 'run' };
  if (slot.status === 'connecting') return { state: 'asking', tone: 'amber' };
  if (slot.status === 'unauthorized') return { state: 'stuck', tone: 'red' };
  return { state: 'quiet', tone: 'ink3' };
}

/** A sign-in URL carries a one-time code in its query. The host is what the
 *  user needs to recognise; the rest never goes on screen. */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}${u.search ? '?••••••••••' : ''}`;
  } catch {
    return url.split('?')[0] + '?••••••••••';
  }
}

/* ── small pieces ─────────────────────────────────────────────────────── */

/** A destructive step never happens on the click that asked for it. The shell
 *  is the panel's own dialog; what is inside it is the design system's. */
function Confirm({ title, body, action, onConfirm, onClose }: {
  title: string; body: string; action: string; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} width={440}>
      <ModalHead title={title} onClose={onClose} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px 18px' }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>{body}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button face="outline" label="Cancel" onClick={onClose} />
          <Button label={action} onClick={() => { onConfirm(); onClose(); }} />
        </div>
      </div>
    </Modal>
  );
}

/** One fact about a computer: what it is, and what it says. W14 W8's panel row,
 *  which is the shape the whole of this screen's detail is written in. */
function KV({ k, v, code }: { k: string; v: React.ReactNode; code?: boolean }) {
  return (
    <FieldRow
      label={k}
      value={code ? <span style={mono}>{v}</span> : v}
      style={{ padding: '9px 18px' }}
    />
  );
}

/** What stands over a section of this page: its name, a sentence saying what
 *  the section is for, and whatever button belongs to the whole of it. */
function Head({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <>
      <SectionHeader kind="page" title={title}>
        {!!right && <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>{right}</span>}
      </SectionHeader>
      {!!hint && (
        <div style={{ fontSize: 14, lineHeight: 1.5, color: T.ink2, maxWidth: 620 }}>{hint}</div>
      )}
    </>
  );
}

/** A sentence about the whole of a section rather than about one card. The
 *  quiet one is a card of `ink2`; the one that wants reading twice is the
 *  design's own washed note. */
function Aside({ children, tone = 'mute' }: {
  children: React.ReactNode; tone?: 'mute' | 'warn';
}) {
  if (tone === 'warn') return <Note tone="amber" icon={P.warn} title={children} />;
  return (
    <Card>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>{children}</div>
    </Card>
  );
}

/** The mono heading over a group of rows: Web15 W18's own, and `SectionHeader`
 *  already draws it. */
function Mark({ children }: { children: React.ReactNode }) {
  return <SectionHeader kind="mark" title={children} />;
}

/** A value being typed: the card's own inset block with nothing but a field in
 *  it, which is what Web14 W9 writes a ticket into. */
function Field({ value, onChange, placeholder, secret, autoFocus, onEnter, lines }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  secret?: boolean; autoFocus?: boolean; onEnter?: () => void; lines?: number;
}) {
  return (
    <Quoted>
      <Write
        value={value} onChange={onChange} placeholder={placeholder}
        secret={secret} autoFocus={autoFocus} lines={lines} label={placeholder}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter && !lines) { e.preventDefault(); onEnter(); } }}
      />
    </Quoted>
  );
}

/** One of a set of answers, as a row rather than as a dot: the chosen one is
 *  the row filled with `s2`, which is how Web15 draws the one you are on. */
function Pick({ label, hint, right, on, first, onPick }: {
  label: string; hint?: string; right?: string; on: boolean; first?: boolean; onPick: () => void;
}) {
  return (
    <Row
      first={first} title={label} note={hint} meta={right ?? null}
      tone={on ? 'ink2' : undefined} wash={on}
      right={on ? <Icon path={P.check} size={16} color={T.ink} /> : undefined}
      onClick={onPick}
      style={{ padding: '11px 18px' }}
    />
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** How full a plan window is, in the three tones a reading takes. */
const limitTone = (u: number): Tone => (u >= 0.9 ? 'red' : u >= 0.6 ? 'amber' : 'run');

/** Plan usage is only drawn for a window the tool actually reported. An empty
 *  track would be a claim the daemon never made. */
function Limits({ windows }: { windows: LimitWindow[] }) {
  const shown = windows
    .filter((w) => typeof w.utilization === 'number')
    .sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0));
  if (!shown.length) return null;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      padding: '14px 18px', borderTop: `1px solid ${T.line}`,
    }}>
      <Mark>plan usage</Mark>
      {shown.map((w) => {
        const u = Math.max(0, Math.min(1, w.utilization ?? 0));
        return (
          <Slider
            key={w.window} value={u} format={pct}
            label={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {windowName(w.window)}
                {u >= 0.6 && <Tag label={u >= 0.9 ? 'nearly gone' : 'getting low'} tone={limitTone(u)} />}
              </span>
            }
            note={w.resets_at ? `resets ${until(w.resets_at)}` : 'no reset time reported'}
          />
        );
      })}
    </div>
  );
}

/* ── login ────────────────────────────────────────────────────────────── */

type LoginStage = 'method' | 'waiting' | 'code' | 'done';

function LoginSheet({ hostKey, account, methods, onClose, onFinished }: {
  hostKey: string;
  account: CliAccount;
  methods: LoginMethod[];
  onClose: () => void;
  onFinished: () => void;
}) {
  const call = useFleet((s) => s.call);
  const options = methods.length ? methods : [{ id: 'subscription' }];
  const [method, setMethod] = useState<LoginMethod>(options[0]);
  const [stage, setStage] = useState<LoginStage>('method');
  const [email, setEmail] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [code, setCode] = useState('');
  const [prompt, setPrompt] = useState<LoginPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // The daemon sends login events only down the socket that asked for the
  // login, which is this computer's one client — so the fleet tap is enough.
  useEffect(() => {
    return onAnyEvent((k, ev) => {
      if (k !== hostKey) return;
      const d: any = ev.data || {};
      if (d.account_id !== account.id) return;
      if (ev.event === 'account.login.prompt') {
        setPrompt(d as LoginPrompt);
        setStage((s) => (s === 'done' ? s : (d.needs_code ? 'code' : 'waiting')));
        if (d.needs_code) setBusy(false);
      }
      if (ev.event === 'account.login.done') {
        setStage('done');
        setBusy(false);
        setOk(!!d.ok);
        setProblem(d.ok ? null : errText(d.error_code, d.error));
        if (d.ok) onFinished();
      }
    });
  }, [hostKey, account.id]);

  const cancel = useCallback(() => {
    call(hostKey, 'account.login.cancel', { account_id: account.id }).catch(() => {});
  }, [hostKey, account.id]);

  // Leaving the sheet with a pty still open would strand it for 15 minutes.
  useEffect(() => () => { cancel(); }, [cancel]);

  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r: any = await call(hostKey, 'account.login', {
        account_id: account.id,
        method: method.id,
        ...(method.wants_email && email.trim() ? { email: email.trim() } : {}),
        ...(method.needs_key ? { api_key: apiKey } : {}),
      });
      // An API key is settled inside the request; everything else waits for a
      // prompt event. The done event arrives either way.
      setStage(r?.needs_code ? 'code' : 'waiting');
      // Asked for a code, the sheet is waiting on the person, not the computer:
      // Verify has to be pressable.
      if (r?.needs_code) setBusy(false);
    } catch (e) {
      setBusy(false);
      setProblem(err(e));
      setStage('method');
    }
  };

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await call(hostKey, 'account.login.submit', { account_id: account.id, code: code.trim() });
      setStage('waiting');
    } catch (e) {
      setProblem(err(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} width={520}>
      <ModalHead
        title={`${accountName(account)} · sign-in`}
        subtitle={<span style={mono}>{account.provider}</span>}
        onClose={onClose}
      />
      <div style={{
        padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {stage === 'method' && (
          <>
            <Mark>how should this account sign in</Mark>
            <Card inset={false}>
              {options.map((m, i) => (
                <Pick
                  key={m.id} first={i === 0}
                  label={methodName(m.id)} hint={METHOD[m.id]?.body ?? ''}
                  on={m.id === method.id} onPick={() => setMethod(m)}
                />
              ))}
            </Card>

            {method.wants_email && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <Mark>the account’s email</Mark>
                <Field value={email} onChange={setEmail} placeholder="you@example.com" onEnter={start} />
                <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.45 }}>
                  The computer starts the sign-in with this address; the page opens on that account.
                </div>
              </div>
            )}

            {method.needs_key && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <Mark>api key</Mark>
                <Field value={apiKey} onChange={setApiKey} secret placeholder="Paste the key" />
                <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.45 }}>
                  The key is stored on that computer, not in the panel. It spends your API bill,
                  not your subscription.
                </div>
              </div>
            )}
          </>
        )}

        {(stage === 'waiting' || stage === 'code') && (
          <>
            {prompt?.url ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <Mark>1 · open this link in a browser</Mark>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Quoted style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      display: 'block', whiteSpace: 'nowrap', overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>{maskUrl(prompt.url)}</span>
                  </Quoted>
                  <Button small face="outline" icon={P.copy} label="Copy"
                    onClick={() => void copyText(prompt.url!)} />
                  <Button small face="outline" icon={P.external} label="Open"
                    onClick={() => window.open(prompt.url!, '_blank', 'noopener')} />
                </div>
                <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.45 }}>
                  The one-time code in the URL is masked — copying takes the whole thing.
                </div>
              </div>
            ) : (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: T.ink2,
              }}>
                <Spinner size={14} color={T.ink3} /> Preparing the sign-in page…
              </div>
            )}

            {prompt?.code && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <Mark>enter this code on the page</Mark>
                <Quoted style={{ fontSize: 20, letterSpacing: 3 }}>{prompt.code}</Quoted>
              </div>
            )}

            {stage === 'code' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <Mark>2 · paste the code the page gives you at the end</Mark>
                <Field value={code} onChange={setCode} autoFocus onEnter={submit}
                  placeholder="the code from the page" />
              </div>
            )}

            {stage === 'waiting' && prompt && !prompt.needs_code && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: T.ink2,
              }}>
                <Spinner size={14} color={T.ink3} /> Waiting for approval…
              </div>
            )}

            {prompt?.expires_at && (
              <Cell text={`expires in ${until(prompt.expires_at)}`} tone="ink3" />
            )}
          </>
        )}

        {stage === 'done' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14.5 }}>
            <StatusDot state={ok ? 'running' : 'stuck'} />
            <span style={{ color: ok ? T.ink : T.red, fontWeight: 600 }}>
              {ok ? 'Signed in' : 'Sign-in failed'}
            </span>
          </div>
        )}

        {problem && <Note tone="red" icon={P.warn} title="That did not work" body={problem} />}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        padding: '12px 20px', borderTop: `1px solid ${T.line}`,
      }}>
        {stage === 'method' && (
          <>
            <Button face="outline" label="Cancel" onClick={onClose} />
            <Button
              label={busy ? 'Starting…' : 'Start'} onClick={start}
              disabled={busy || (!!method.needs_key && !apiKey.trim())}
            />
          </>
        )}
        {(stage === 'waiting' || stage === 'code') && (
          <>
            <Button face="outline" label="Cancel" onClick={onClose} />
            {stage === 'code' && (
              <Button label="Verify" onClick={submit} disabled={busy || code.trim().length < 10} />
            )}
          </>
        )}
        {stage === 'done' && (
          ok
            ? <Button label="Done" onClick={onClose} />
            : <>
                <Button face="outline" label="Close" onClick={onClose} />
                <Button
                  label="Try again"
                  onClick={() => { setStage('method'); setPrompt(null); setCode(''); setProblem(null); }}
                />
              </>
        )}
      </div>
    </Modal>
  );
}

/* ── sections ─────────────────────────────────────────────────────────── */

function HostsSection() {
  const { hosts, order, addHost, removeHost } = useFleet();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [doomed, setDoomed] = useState<string | null>(null);

  const add = () => {
    const cfg = parsePairing(text);
    if (!cfg) { setProblem('That does not look like a pairing link.'); return; }
    setProblem(null);
    setText('');
    addHost(cfg);
  };

  return (
    <>
      <Head
        title="Computers"
        hint="The panel connects to every paired computer at once. Removing one revokes this browser’s pairing on that computer and forgets it here; nothing else on it is touched."
      />

      {order.map((k) => {
        const slot = hosts[k];
        if (!slot) return null;
        const info = slot.info;
        const st = hostState(slot);
        return (
          <Card key={k} inset={false}>
            <Row
              first icon={P.cpu} mark title={info?.name || slot.cfg.name}
              meta={hostDetail(slot)} tone={st.tone}
              lead={<Well icon={P.cpu} />}
              right={
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StatusDot state={st.state} hollow={slot.status !== 'online'} />
                  <Button small face="outline" label="Remove" onClick={() => setDoomed(k)} />
                </span>
              }
            />
            <KV k="address" v={`${slot.cfg.host}:${slot.cfg.port}`} code />
            <KV k="token" v="•••••••••• · kept in the panel, never shown" code />
            <KV k="daemon" v={info?.daemon_version ?? 'not reported'} code />
            <KV k="system" v={info ? `${info.os} ${info.os_version}` : 'not reported'} code />
            <KV k="uptime" v={info ? uptime(info.uptime_s) : 'not reported'} code />
            <KV k="open sessions" v={info ? String(info.active_sessions) : 'not reported'} code />
            <KV k="devices" v={info ? String(info.connected_devices) : 'not reported'} code />
          </Card>
        );
      })}

      <Head
        title="Add a computer"
        hint="Run `remote-ai-chat pair` on that computer, then paste the link it prints here."
      />
      <Card>
        <Field
          value={text} lines={3}
          onChange={(v) => { setText(v); setProblem(null); }}
          placeholder="remoteaichat://pair?host=…&port=8790&token=…"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, fontSize: 12.5, color: problem ? T.red : T.ink3 }}>
            {problem ?? 'The token in that link is kept in the panel and never shown on screen.'}
          </span>
          <Button label="Add" onClick={add} disabled={!text.trim()} />
        </div>
      </Card>

      {doomed && (
        <Confirm
          title="Remove this computer?"
          body={`${hosts[doomed]?.info?.name || hosts[doomed]?.cfg.name || doomed} leaves this panel, and this browser's pairing is revoked on it so the token stops working. Nothing else on that computer is touched — pair again to add it back.`}
          action="Remove"
          onConfirm={() => removeHost(doomed)}
          onClose={() => setDoomed(null)}
        />
      )}
    </>
  );
}

function AccountCard({ slot, account, onLogin, onLogout, onRename, onDelete }: {
  slot: HostSlot;
  account: CliAccount;
  onLogin: () => void;
  onLogout: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const windows = slot.limits[account.id] ?? [];
  return (
    <Card inset={false}>
      <Row
        first
        lead={<ProviderMark provider={account.provider} dim={!account.logged_in} />}
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {accountName(account)}
            </span>
            {account.is_default && <Tag label="the computer’s own account" />}
            {account.has_key && <Tag label="api key" />}
          </span>
        }
        note={account.logged_in ? (account.detail || 'signed in') : 'not signed in'}
        meta={account.logged_in ? 'signed in' : 'signed out'}
        tone={account.logged_in ? 'run' : 'ink3'}
        right={
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {!account.is_default && <Button small face="outline" label="Rename" onClick={onRename} />}
            {account.logged_in
              ? <Button small face="outline" label="Sign out" onClick={onLogout} />
              : <Button small label="Sign in" onClick={onLogin} />}
            {!account.is_default && <Button small face="outline" label="Delete" onClick={onDelete} />}
          </span>
        }
      />
      <KV k="id" v={account.id} code />
      <Limits windows={windows} />
    </Card>
  );
}

function AccountsSection({ hostKey, slot, tools }: {
  hostKey: string; slot: HostSlot; tools: ToolStatus[];
}) {
  const { call, refreshAccounts } = useFleet();
  const [problem, setProblem] = useState<string | null>(null);
  const [login, setLogin] = useState<CliAccount | null>(null);
  const [renaming, setRenaming] = useState<CliAccount | null>(null);
  const [renameText, setRenameText] = useState('');
  const [doomed, setDoomed] = useState<CliAccount | null>(null);
  const [signingOut, setSigningOut] = useState<CliAccount | null>(null);
  const [newProvider, setNewProvider] = useState<Provider>('claude');
  const [newLabel, setNewLabel] = useState('');
  const online = slot.status === 'online';

  const reload = useCallback(() => {
    refreshAccounts(hostKey).catch((e) => setProblem(err(e)));
  }, [hostKey]);

  useEffect(() => { if (online) reload(); }, [hostKey, online]);

  const run = async (fn: () => Promise<any>) => {
    setProblem(null);
    try { await fn(); reload(); }
    catch (e) { setProblem(err(e)); }
  };

  const byProvider = useMemo(() => {
    const out: Record<Provider, CliAccount[]> = { claude: [], codex: [] };
    for (const a of slot.accounts) out[a.provider]?.push(a);
    return out;
  }, [slot.accounts]);

  const methodsFor = (p: Provider): LoginMethod[] =>
    tools.find((t) => t.provider === p)?.login_methods ?? [];

  return (
    <>
      <Head
        title="Accounts"
        hint="Each account runs in its own folder on that computer; you pick which one a chat spends when you open it."
        right={
          <>
            {slot.loading.accounts && <Spinner size={13} color={T.ink3} />}
            <Button small face="outline" label="Refresh" onClick={reload} disabled={!online} />
          </>
        }
      />

      {problem && <Aside tone="warn">{problem}</Aside>}
      {!online && <Aside>This computer is offline — accounts cannot be read.</Aside>}

      {(['claude', 'codex'] as Provider[]).map((p) => (
        byProvider[p].length ? (
          <div key={p} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Mark>{p}</Mark>
            {byProvider[p].map((a) => (
              <AccountCard
                key={a.id} slot={slot} account={a}
                onLogin={() => setLogin(a)}
                onLogout={() => setSigningOut(a)}
                onRename={() => { setRenaming(a); setRenameText(a.label); }}
                onDelete={() => setDoomed(a)}
              />
            ))}
          </div>
        ) : null
      ))}

      {online && !slot.accounts.length && !slot.loading.accounts && (
        <Aside>No accounts on this computer.</Aside>
      )}

      <Head title="Add an account" hint="A new account starts with an empty folder; you sign in separately." />
      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Mark>tool</Mark>
            <Choice
              label="Tool" value={newProvider}
              options={[{ key: 'claude' as Provider, label: 'claude' },
                        { key: 'codex' as Provider, label: 'codex' }]}
              onChange={setNewProvider}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Mark>account name</Mark>
            <Field
              value={newLabel} onChange={setNewLabel} placeholder="e.g. Work, Second subscription"
              onEnter={() => newLabel.trim() && run(async () => {
                await call(hostKey, 'account.create', { provider: newProvider, label: newLabel.trim() });
                setNewLabel('');
              })}
            />
          </div>
          <Button
            label="Add" disabled={!online || !newLabel.trim()}
            onClick={() => run(async () => {
              await call(hostKey, 'account.create', { provider: newProvider, label: newLabel.trim() });
              setNewLabel('');
            })}
          />
        </div>
      </Card>

      {login && (
        <LoginSheet
          hostKey={hostKey} account={login} methods={methodsFor(login.provider)}
          onClose={() => { setLogin(null); reload(); }}
          onFinished={reload}
        />
      )}

      {renaming && (
        <Modal onClose={() => setRenaming(null)} width={440}>
          <ModalHead title="Account name" subtitle={<span style={mono}>{renaming.id}</span>}
            onClose={() => setRenaming(null)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px 18px' }}>
            <Field value={renameText} onChange={setRenameText} autoFocus placeholder="Account name" />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button face="outline" label="Cancel" onClick={() => setRenaming(null)} />
              <Button
                label="Save" disabled={!renameText.trim()}
                onClick={() => {
                  const a = renaming;
                  setRenaming(null);
                  run(() => call(hostKey, 'account.rename', { account_id: a.id, label: renameText.trim() }));
                }}
              />
            </div>
          </div>
        </Modal>
      )}

      {signingOut && (
        <Confirm
          title="Sign out of this account?"
          body={`The ${signingOut.label} sign-in is revoked on that computer and any chat spending it is released. The account stays — you can sign in again later.`}
          action="Sign out"
          onConfirm={() => {
            const a = signingOut;
            run(() => call(hostKey, 'account.logout', { account_id: a.id }));
          }}
          onClose={() => setSigningOut(null)}
        />
      )}

      {doomed && (
        <Confirm
          title="Delete this account?"
          body={`The ${doomed.label} account and its folder on that computer are deleted for good. Any chat spending it is released. This cannot be undone.`}
          action="Delete"
          onConfirm={() => {
            const a = doomed;
            run(() => call(hostKey, 'account.delete', { account_id: a.id }));
          }}
          onClose={() => setDoomed(null)}
        />
      )}
    </>
  );
}

function ToolsSection({ tools, npm, loading, problem, onReload }: {
  tools: ToolStatus[]; npm: boolean | null; loading: boolean;
  problem: string | null; onReload: () => void;
}) {
  return (
    <>
      <Head
        title="Tools"
        hint="The command-line tools that run the chats — versions are re-read from that computer."
        right={<Button small face="outline" label={loading ? 'Reading…' : 'Refresh'}
          onClick={onReload} disabled={loading} />}
      />

      {problem && <Aside tone="warn">{problem}</Aside>}

      {tools.map((tool) => (
        <Card key={tool.provider} inset={false}>
          <Row
            first
            lead={<ProviderMark provider={tool.provider} dim={!tool.version} />}
            title={tool.provider}
            note={tool.version ? `version ${tool.version}` : 'not installed on this computer'}
            meta={tool.version ? 'installed' : 'absent'}
            tone={tool.version ? 'run' : 'ink3'}
            right={<StatusDot state={tool.version ? 'running' : 'quiet'} hollow={!tool.version} />}
          />
          {tool.path && <KV k="path" v={tilde(tool.path)} code />}
          {!!tool.login_methods?.length && (
            <KV
              k="sign-in methods"
              v={
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {tool.login_methods.map((m) => (
                    <Tag key={m.id} label={methodName(m.id)} />
                  ))}
                </span>
              }
            />
          )}
        </Card>
      ))}

      {!tools.length && !loading && !problem && <Aside>No tool information.</Aside>}

      <Card inset={false}>
        <Row
          first icon={P.bolt} title="npm"
          note="needed to install a tool from this panel"
          meta={npm == null ? 'not reported' : npm ? 'present' : 'missing'}
          tone={npm ? 'run' : 'ink3'}
        />
      </Card>
      {npm === false && <Aside>Without npm the tools cannot be installed from this panel.</Aside>}
    </>
  );
}

/** Where the New chat dialog gets its opening answers. Unlike everything else
 *  on this screen these are the panel's own, not the daemon's: the phone keeps
 *  the same preference in its own storage, and neither can see the other's. */
function DefaultsSection({ hostKey, slot }: { hostKey: string; slot: HostSlot }) {
  const { refreshAccounts } = useFleet();
  const defaults = usePrefs((s) => hostDefaults(s.defaults, hostKey));
  const setDefaults = usePrefs((s) => s.setDefaults);
  const setProviderDefaults = usePrefs((s) => s.setProviderDefaults);
  const online = slot.status === 'online';

  // Same reason AccountsSection asks: account.list shells out to the CLIs, so
  // it is asked for once and only re-asked when something needs it.
  useEffect(() => {
    if (online && !slot.accounts.length && !slot.loading.accounts) {
      refreshAccounts(hostKey).catch(() => {});
    }
  }, [hostKey, online]);

  const provider = defaults.provider;
  const pc = slot.catalog?.[provider] ?? null;
  const accounts = useMemo(
    () => slot.accounts.filter((a) => a.provider === provider && (a.logged_in || a.is_default)),
    [slot.accounts, provider],
  );
  // What New chat would open with right now, stored answers and all.
  const now = resolveDefaults(providerDefaults(defaults, provider), pc, accounts);
  const installed = (['claude', 'codex'] as Provider[]).filter((p) => slot.catalog?.[p]);

  return (
    <>
      <Head
        title="New chats"
        hint="What the New chat dialog opens with on this computer. Nothing here is a lock — starting a chat with something else changes these to match."
      />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Mark>tool</Mark>
          <Choice
            label="Tool" value={provider}
            options={(installed.length ? installed : (['claude'] as Provider[]))
              .map((x) => ({ key: x, label: x }))}
            onChange={(x) => setDefaults(hostKey, { provider: x })}
          />
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
          New chats open with this tool, and everything below belongs to it. To set the other
          one’s defaults, switch to it here first.
        </div>
      </Card>

      <Mark>account</Mark>
      <Card inset={false}>
        {accounts.map((a, i) => {
          const value = a.is_default ? '' : a.id;
          return (
            <Pick
              key={a.id} first={i === 0} label={accountName(a)}
              hint={a.logged_in ? a.detail : 'not signed in'}
              on={now.account_id === value}
              onPick={() => setProviderDefaults(hostKey, provider, { account_id: value })}
            />
          );
        })}
        {!accounts.length && (
          <div style={{ padding: '14px 18px', fontSize: 13, color: T.ink2 }}>
            {online ? 'No account of this tool is signed in on that computer.' : 'The computer is offline.'}
          </div>
        )}
      </Card>

      <Mark>model</Mark>
      <Card inset={false}>
        {(pc?.models ?? []).map((m, i) => (
          <Pick
            key={m.id} first={i === 0} label={m.label || m.id} hint={m.hint} right={m.id}
            on={now.model === m.id}
            onPick={() => setProviderDefaults(hostKey, provider, { model: m.id })}
          />
        ))}
        {!pc?.models.length && (
          <div style={{ padding: '14px 18px', fontSize: 13, color: T.ink2 }}>
            {online ? 'That computer listed no models for this tool.' : 'The computer is offline.'}
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card style={{ flex: 1, minWidth: 260 }}>
          <Mark>effort</Mark>
          {pc?.efforts?.length
            ? <Choice
                label="Effort" value={now.effort ?? ''}
                options={pc.efforts.map((e) => ({ key: e, label: e }))}
                onChange={(e) => setProviderDefaults(hostKey, provider, { effort: e })}
              />
            : <div style={{ fontSize: 13, color: T.ink3 }}>this tool has no effort setting</div>}
        </Card>
        <Card style={{ flex: 1, minWidth: 260 }}>
          <Mark>permission mode</Mark>
          {pc?.default_perm_mode
            // The computer decides this one, and a control that changed a word
            // nothing reads would be a lie: the mode is picked per chat, in New chat.
            ? <div style={{ fontSize: 13, color: T.ink3 }}>
                new chats open in <span style={{ ...mono, color: T.ink }}>{pc.default_perm_mode}</span> — this
                computer's default. Another mode is picked per chat, in New chat.
              </div>
            : <Choice
                label="Permission mode" value={now.perm_mode ?? ''}
                options={(pc?.perm_modes ?? []).map((m) => ({ key: m, label: m }))}
                onChange={(m) => setProviderDefaults(hostKey, provider, { perm_mode: m })}
              />}
        </Card>
      </div>
      {now.perm_mode === 'bypass' && (
        <Aside tone="warn">
          Every new chat will start in bypass — no permission questions.
          The dangerous-command list still asks, even there.
        </Aside>
      )}

      <Mark>project folder</Mark>
      <Card inset={false}>
        {/* A computer can have a hundred folders; the list scrolls rather than
            pushing everything else off the screen. */}
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          <Pick
            first label="Ask each time" hint="New chat opens with no folder picked"
            on={!defaults.cwd}
            onPick={() => setDefaults(hostKey, { cwd: null })}
          />
          {slot.projects.map((pr) => (
            <Pick
              key={pr.path} label={pr.name} right={tilde(pr.path)}
              on={defaults.cwd === pr.path}
              onPick={() => setDefaults(hostKey, { cwd: pr.path })}
            />
          ))}
        </div>
      </Card>

      <Aside>
        Remembered in this browser, for this computer — the phone app keeps its own.
      </Aside>
    </>
  );
}

function SecuritySection({ slot }: { slot: HostSlot }) {
  const roots = slot.info?.roots ?? [];
  return (
    <>
      <Head
        title="Security"
        hint="Chats can only open under the roots below. That limit is enforced on the computer, and holds even in bypass permission mode."
      />

      <Mark>allowed roots</Mark>
      <Card inset={false}>
        {roots.length ? roots.map((root, i) => (
          <Row key={root} first={i === 0} icon={P.folder} mark title={tilde(root)} />
        )) : (
          <div style={{ padding: '14px 18px', fontSize: 13, color: T.ink2 }}>
            {slot.status === 'online' ? 'This computer reported no roots.' : 'The computer is offline.'}
          </div>
        )}
      </Card>

      <Aside>
        The roots come from that computer’s own config and cannot be changed from the panel.
        Edit the config file on the computer instead.
      </Aside>
    </>
  );
}

function AboutSection({ slot }: { slot: HostSlot }) {
  const info = slot.info;
  const st = hostState(slot);
  return (
    <>
      <Head title="About" hint="The daemon running on this computer." />
      <Card inset={false}>
        <Row
          first icon={P.cpu} mark title={info?.name || slot.cfg.name}
          meta={hostDetail(slot)} tone={st.tone}
          right={<StatusDot state={st.state} hollow={slot.status !== 'online'} />}
        />
        <KV k="daemon version" v={info?.daemon_version ?? 'not reported'} code />
        <KV k="system" v={info ? `${info.os} ${info.os_version}` : 'not reported'} code />
        <KV k="uptime" v={info ? uptime(info.uptime_s) : 'not reported'} code />
        <KV k="devices" v={info ? String(info.connected_devices) : 'not reported'} code />
        <KV k="open sessions" v={info ? String(info.active_sessions) : 'not reported'} code />
        <KV k="address" v={`${slot.cfg.host}:${slot.cfg.port}`} code />
        <KV k="claude" v={info?.versions?.claude ?? 'not installed'} code />
        <KV k="codex" v={info?.versions?.codex ?? 'not installed'} code />
        {info?.transcription != null && (
          <KV k="transcription" v={info.transcription ? 'on' : 'off'} code />
        )}
      </Card>
    </>
  );
}

/* ── appearance ───────────────────────────────────────────────────────── */

/** The one setting on this screen that belongs to the browser rather than to a
 *  computer: Divan is drawn in both themes (Web12 and Web13 are the same
 *  desktop screens dark and light) and which one is on screen is the reader's,
 *  not the daemon's. It follows the computer until it is told not to, and then
 *  it is remembered — a theme that resets every morning is not a setting. */
/** Dictation is this browser's, like the theme: the microphone is its, the
 *  speech model is its, and the language somebody speaks is not a fact about
 *  any of the computers in the list. The reason it is a setting at all rather
 *  than a guess is that the panel's own copy is English and pinned, so the
 *  buttons say nothing about what is spoken into them — and a model fetched for
 *  the wrong language is a few hundred megabytes of nothing.
 *
 *  The line under it is the honest state of the engines (`lib/dictate.ts`),
 *  because they are not interchangeable: the computer's whisper gets the words
 *  right and hands them over a phrase at a time, the browser's own model shows
 *  them as they are spoken, and the browser's cloud service sends the audio to
 *  its maker. Which one you get is worth being told before you talk, not
 *  after — and where there is a choice between the first and the rest, it is
 *  offered.
 */
function DictationSection() {
  const [lang, setLang] = useState(dictateLang);
  const [engine, setEngine] = useState(dictateEngine);
  const [state, setState] = useState<Availability | null>(null);
  const [busy, setBusy] = useState(false);
  const canWhisper = useFleet((s) => Object.values(s.hosts).some((h) => h.info?.transcription));
  const s = support();

  const read = useCallback(() => {
    availability(lang, canWhisper, engine).then(setState);
  }, [lang, canWhisper, engine]);
  useEffect(read, [read]);

  const pick = (tag: string) => {
    setDictateLang(tag);
    setLang(tag);
  };
  const pickEngine = (e: EnginePref) => {
    setDictateEngine(e);
    setEngine(e);
  };

  const line = !s.secure
    ? 'A microphone needs a secure page. The panel is one when it is opened on the computer itself, or over https behind a tunnel.'
    : state === 'local'
      ? `${langName(lang)} is on this computer. Nothing is sent anywhere and the words appear while you talk.`
      : state === 'downloadable'
        ? `This browser can fetch a ${langName(lang)} model and then run it here. A few hundred megabytes, once.`
        : state === 'cloud'
          ? `This browser has no ${langName(lang)} model of its own, so it will send the audio to its maker's speech service.`
          : state === 'whisper'
            ? 'Whisper runs on the computer the chat is on. Nothing is sent anywhere else, and the words arrive a phrase at a time, each time you pause.'
            : 'Nothing here can turn speech into text, so the composer draws no microphone.';

  return (
    <>
      <Mark>dictation</Mark>
      {langChoices(lang).map((tag, i) => (
        <Pick
          key={tag} first={i === 0} label={langName(tag)} right={tag}
          on={tag === lang} onPick={() => pick(tag)}
        />
      ))}
      {/* A choice only where there are two things to choose between. */}
      {s.secure && canWhisper && s.capture && s.speech && (
        <Choice
          label="Engine" value={engine}
          options={[{ key: 'computer' as const, label: 'computer' },
                    { key: 'browser' as const, label: 'browser' }]}
          onChange={pickEngine}
        />
      )}
      <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>{line}</div>
      {state === 'downloadable' && (
        <Button
          label={busy ? 'Fetching…' : `Fetch the ${langName(lang)} model`}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            install(lang).finally(() => { setBusy(false); read(); });
          }}
        />
      )}
    </>
  );
}

export function AppearanceSection() {
  const { choice, scheme, set } = useTheme();
  return (
    <>
      <Mark>theme</Mark>
      <Choice
        label="Theme" value={choice}
        options={[{ key: 'system' as const, label: 'system' },
                  { key: 'light' as const, label: 'light' },
                  { key: 'dark' as const, label: 'dark' }]}
        onChange={(v) => set(v)}
      />
      <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
        {choice === 'system'
          ? `Following this computer, which is ${scheme} right now. It changes with it.`
          : `Set by hand. This browser will open ${choice} until you change it back.`}
      </div>
      <DictationSection />
    </>
  );
}

/* ── screen ───────────────────────────────────────────────────────────── */

/** `section` is which row of the column this page opens on. It is a prop and
 *  not only local state because five of the seven sections are otherwise
 *  reachable by pressing something, and a static render cannot press. Nothing
 *  passes it in the panel — the drawer opens this page on Accounts, which is
 *  the one that is usually the reason for coming. */
export function Preferences({ section: opening = 'accounts' }: { section?: SectionId }) {
  const { hosts, order, focus } = useFleet();
  const [section, setSection] = useState<SectionId>(opening);
  const slot = focus ? hosts[focus] : null;
  const online = slot?.status === 'online';

  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [npm, setNpm] = useState<boolean | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsProblem, setToolsProblem] = useState<string | null>(null);

  // tool.status re-probes both CLIs, so it is asked for once per computer and
  // then only when the user asks again.
  const loadTools = useCallback(async () => {
    if (!focus || !online) return;
    setToolsLoading(true);
    setToolsProblem(null);
    try {
      const r: any = await toolStatus(focus);
      setTools(r?.tools ?? []);
      setNpm(typeof r?.npm === 'boolean' ? r.npm : null);
    } catch (e) {
      setToolsProblem(err(e));
    } finally {
      setToolsLoading(false);
    }
  }, [focus, online]);

  useEffect(() => { setTools([]); setNpm(null); }, [focus]);
  useEffect(() => { if (online) loadTools(); }, [loadTools]);

  const counts: Partial<Record<SectionId, number>> = {
    hosts: order.length,
    accounts: slot?.accounts.length,
    security: slot?.info?.roots?.length,
  };

  const items: PanelItem[] = SECTIONS.map((x) => ({
    key: x.id, label: x.label, icon: x.icon,
    count: counts[x.id] != null ? counts[x.id] : undefined,
  }));

  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', alignItems: 'stretch',
      overflow: 'hidden', background: T.bg,
    }}>
      {/* Web15's own column, the same part the drawer one level up is
          navigated by — this page is a drawer inside a drawer, and drawing it
          with a second kind of list would say it was something else. */}
      {/* As wide as the column itself and no wider: the sentence under the
          rows is what a `flex: none` box would otherwise be measured by, and
          one long line of it pushed this column to three hundred and eighty. */}
      <div style={{
        flex: 'none', width: SIZE.sidePanel, padding: '28px 12px 28px 20px', overflowY: 'auto',
      }}>
        <SidePanel
          title="This computer"
          note={slot ? (slot.info?.name || slot.cfg.name) : 'Nothing is paired yet.'}
          items={items} value={section} onChange={(k) => setSection(k as SectionId)}
        />
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: T.ink3, margin: '14px 12px 0' }}>
          Every setting under these rows lives on that computer. The panel only reads and
          changes it; Appearance is the one that is this browser's own.
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '28px 32px 40px 28px' }}>
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, maxWidth: 860,
        }}>
          {section === 'hosts' && <HostsSection />}

          {section === 'appearance' && (
            <>
              <Head
                title="Appearance"
                hint="Divan is drawn in two themes and which one is on screen is yours, not the
                      daemon's. It follows this computer until you say otherwise."
              />
              <Card><AppearanceSection /></Card>
            </>
          )}

          {section !== 'hosts' && section !== 'appearance' && !slot && (
            <Aside>No computer paired yet. Add one from “Computers” on the left.</Aside>
          )}

          {section === 'accounts' && slot && focus && (
            <AccountsSection hostKey={focus} slot={slot} tools={tools} />
          )}
          {section === 'defaults' && slot && focus && (
            <DefaultsSection hostKey={focus} slot={slot} />
          )}
          {section === 'tools' && slot && (
            <ToolsSection
              tools={tools} npm={npm} loading={toolsLoading}
              problem={toolsProblem} onReload={loadTools}
            />
          )}
          {section === 'security' && slot && <SecuritySection slot={slot} />}
          {section === 'about' && slot && <AboutSection slot={slot} />}
        </div>
      </div>
    </div>
  );
}
