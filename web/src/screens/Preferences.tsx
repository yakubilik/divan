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
import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { SIZE, T, toneColours, useTheme, type Tone } from '../lib/theme';
import { Icon, P, Spinner, mono } from '../ui/kit';
import {
  Button, Card, Cell, Choice, FieldRow, Note, Quoted, Row, SectionHeader, Select, SidePanel,
  StatusDot, Tag, Well, Write, type PanelItem,
} from '../ui/divan';
import { Modal, ModalHead } from '../components/Modal';
import { ProviderMark } from '../components/Sidebar';
import { hostAddr, onAnyEvent, useFleet, type HostSlot } from '../lib/fleet';
import { defaultAgent, hostDefaults, newChatCwd, providerDefaults, resolveDefaults, usePrefs } from '../lib/prefs';
import { installTool, listAgents, pairComputer, parsePairing, setDefaultCwd, toolStatus } from '../lib/actions';
import {
  availability, dictateEngine, dictateLang, install, langChoices, langName,
  setDictateEngine, setDictateLang, support, type Availability, type EnginePref,
} from '../lib/dictate';
import { errText, t } from '../lib/i18n';
import { ago, tilde, until, uptime, windowName } from '../lib/format';
import { copyText } from '../lib/clipboard';
import type {
  Agent, CliAccount, HostConfig, LoginMethod, LoginPrompt, Provider, ToolStatus,
} from '../lib/protocol';
import { refusalText } from '../lib/refusal';
import { signInState, signInWords } from '../lib/machine';
import { START, inFlight, looksLikeEmailCode, step } from '../lib/signin';
import { left as leftWords } from './Accounts';

/** The daemon labels the machine's own account in English ("This computer's
 *  account") because it has no idea who is asking. i18n already carries the
 *  phrase, so the panel says it in its own language. */
function accountName(a: { is_default: boolean; label: string }): string {
  return a.is_default ? t('useDefaultAccount') : a.label;
}

export type SectionId = 'hosts' | 'accounts' | 'defaults' | 'tools' | 'appearance' | 'security' | 'about';

const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'hosts', label: 'Computers', icon: P.cpu },
  { id: 'accounts', label: 'Accounts', icon: P.agent },
  { id: 'defaults', label: 'New chat defaults', icon: P.plus },
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
function Head({ title, hint, right, under }: {
  title: string; hint?: string; right?: React.ReactNode;
  /** A section of a page that already has a head: its name at a card's size. */
  under?: boolean;
}) {
  return (
    <>
      <SectionHeader kind={under ? 'title' : 'page'} title={title} style={under ? { marginTop: 10 } : undefined}>
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

/** Something a row can do that is not what the row is for: a word, not a
 *  button, so the one filled button beside it is the one that reads. */
function Quiet({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="dv-hit" onClick={onClick} style={{
      background: 'transparent', border: 'none', padding: '4px 0', font: 'inherit',
      fontSize: 13, fontWeight: 500, color: T.ink2, cursor: 'pointer', whiteSpace: 'nowrap',
    }}>{label}</button>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** How full a plan window is, in the three tones a reading takes. */
const limitTone = (u: number): Tone => (u >= 0.9 ? 'red' : u >= 0.6 ? 'amber' : 'run');

/* ── login ────────────────────────────────────────────────────────────── */

const TOOL: Record<string, string> = { claude: 'Claude', codex: 'Codex' };

/** A numbered step of the sheet: what to do, said once, over the thing that
 *  does it. */
function StepHead({ n, children }: { n?: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, fontSize: 14, fontWeight: 600 }}>
      {n != null && <span style={{ ...mono, fontSize: 12, color: T.ink3 }}>{n}</span>}
      <span>{children}</span>
    </div>
  );
}

/** The middle of the sheet while there is nothing for a person to do but wait:
 *  one moving thing, and the sentence saying what it is waiting for. */
function Waiting({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
      padding: '26px 0 22px', textAlign: 'center',
    }}>
      <Spinner size={22} color={T.ink2} />
      <div style={{ fontSize: 15, fontWeight: 600 }}>{children}</div>
      {!!note && <div style={{ fontSize: 13, lineHeight: 1.45, color: T.ink2, maxWidth: 360 }}>{note}</div>}
    </div>
  );
}

/** Signing one account in, from choosing how to the computer saying yes.
 *
 *  One thing on the sheet at a time, and the sheet changes when the sign-in
 *  does: how to sign in, then the page to open and the code it gives back, then
 *  a spinner while the computer finishes, then `Signed in` — which closes on
 *  its own, because there is nothing left to press. Where it stands is decided
 *  in `lib/signin.ts`.
 *
 *  It used to keep the link on screen after the code had been sent, with
 *  nothing saying the code was being checked; and a sign-in the computer
 *  settled inside the request (a key) left it on "Preparing the sign-in page…"
 *  for good (26 Nov 2026). */
export function LoginSheet({ hostKey, account, methods, auto, onClose, onFinished }: {
  hostKey: string;
  account: CliAccount;
  methods: LoginMethod[];
  /** Opened by adding the account: the sign-in starts by itself on the usual
   *  way, with no first step to press through. */
  auto?: boolean;
  onClose: () => void;
  onFinished: () => void;
}) {
  const call = useFleet((s) => s.call);
  // Before the computer has said which ways it offers, the one it would pick
  // itself.
  const options = methods.length ? methods : [{ id: account.provider === 'codex' ? 'device' : 'subscription' }];
  const [method, setMethod] = useState<LoginMethod>(options[0]);
  // The first way is the one nearly everybody wants; the rest are a press away
  // rather than a list to read before starting.
  const [others, setOthers] = useState(false);
  const [state, go] = useReducer(step, START);
  const [email, setEmail] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [code, setCode] = useState('');
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const { stage, prompt } = state;

  // The daemon sends login events only down the socket that asked for the
  // login, which is this computer's one client — so the fleet tap is enough.
  useEffect(() => {
    return onAnyEvent((k, ev) => {
      if (k !== hostKey) return;
      const d: any = ev.data || {};
      if (d.account_id !== account.id) return;
      if (ev.event === 'account.login.prompt') go({ type: 'prompt', prompt: d as LoginPrompt });
      if (ev.event === 'account.login.done') {
        go({ type: 'done', ok: !!d.ok, detail: d.detail, why: d.ok ? null : errText(d.error_code, d.error) });
        if (d.ok) onFinished();
      }
    });
  }, [hostKey, account.id]);

  const cancel = useCallback(() => {
    call(hostKey, 'account.login.cancel', { account_id: account.id }).catch(() => {});
  }, [hostKey, account.id]);

  // Leaving the sheet with a pty still open would strand it for 15 minutes.
  useEffect(() => () => { cancel(); }, [cancel]);

  // A success needs a beat to be read, then gets out of the way on its own.
  const close = useRef(onClose);
  close.current = onClose;
  const signedIn = stage === 'done' && state.ok;
  useEffect(() => {
    if (!signedIn) return undefined;
    const t = setTimeout(() => close.current(), 1600);
    return () => clearTimeout(t);
  }, [signedIn]);

  const start = async () => {
    setCode(''); setOpened(false);
    go({ type: 'start', key: !!method.needs_key });
    try {
      const r: any = await call(hostKey, 'account.login', {
        account_id: account.id,
        method: method.id,
        ...(method.wants_email && email.trim() ? { email: email.trim() } : {}),
        ...(method.needs_key ? { api_key: apiKey } : {}),
      });
      go({ type: 'started', needsCode: !!r?.needs_code });
    } catch (e) {
      go({ type: 'refused', why: err(e) });
    }
  };

  // Add was the decision; there is nothing left to ask before the page. A key
  // is the one way that cannot start by itself — it has to be pasted first.
  // On a timer so that a mount React undoes at once (its strict mode) starts
  // nothing, rather than starting a sign-in and cancelling it.
  useEffect(() => {
    if (!auto || options[0].needs_key) return undefined;
    const t = setTimeout(() => { void start(); }, 0);
    return () => clearTimeout(t);
  }, []);

  /** Back to choosing how, from a sign-in already under way: the one on that
   *  computer is called off, and the list of ways is open. */
  const another = () => {
    cancel();
    setCode('');
    setOthers(true);
    go({ type: 'again' });
  };

  const submit = async () => {
    if (stage !== 'code' || code.trim().length < 10) return;
    go({ type: 'submit' });
    try {
      await call(hostKey, 'account.login.submit', { account_id: account.id, code: code.trim() });
    } catch (e) {
      go({ type: 'unsent', why: err(e) });
    }
  };

  const open = () => {
    if (!prompt?.url) return;
    setOpened(true);
    window.open(prompt.url, '_blank', 'noopener');
  };
  const copy = (what: 'link' | 'code', text: string) => {
    void copyText(text);
    setCopied(what);
    setTimeout(() => setCopied((was) => (was === what ? null : was)), 1600);
  };
  const canStart = !method.needs_key || !!apiKey.trim();
  const openButton = !!prompt?.url && (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Button face={opened ? 'outline' : 'ink'} icon={P.external} label="Open the sign-in page" onClick={open} />
      <Button face="outline" icon={P.copy} label={copied === 'link' ? 'Copied' : 'Copy link'}
        onClick={() => copy('link', prompt.url!)} />
    </span>
  );

  return (
    <Modal onClose={onClose} width={520} pinned={inFlight(state)}>
      <ModalHead
        title={`Sign in to ${TOOL[account.provider] ?? account.provider}`}
        subtitle={accountName(account)}
        onClose={onClose}
      />
      <div style={{
        padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {stage === 'method' && (
          <>
            {others ? (
              <Card inset={false}>
                {options.map((m, i) => (
                  <Pick
                    key={m.id} first={i === 0}
                    label={methodName(m.id)} hint={METHOD[m.id]?.body ?? ''}
                    on={m.id === method.id} onPick={() => setMethod(m)}
                  />
                ))}
              </Card>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{methodName(method.id)}</div>
                {!!METHOD[method.id]?.body && (
                  <div style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink2 }}>{METHOD[method.id].body}</div>
                )}
              </div>
            )}

            {method.wants_email && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <Field value={email} onChange={setEmail} autoFocus placeholder="you@example.com" onEnter={start} />
                <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.45 }}>
                  The account’s email, so the page opens on the right one. Optional.
                </div>
              </div>
            )}

            {method.needs_key && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <Field value={apiKey} onChange={setApiKey} secret autoFocus placeholder="Paste the key"
                  onEnter={() => { if (canStart) void start(); }} />
                <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.45 }}>
                  Kept on that computer, never in the panel.
                  {account.provider === 'claude' ? ' A token from `claude setup-token` goes here too.' : ''}
                </div>
              </div>
            )}

            {!others && options.length > 1 && (
              <button type="button" className="dv-hit" onClick={() => setOthers(true)} style={{
                alignSelf: 'flex-start', background: 'transparent', border: 'none', padding: 0,
                font: 'inherit', fontSize: 13, color: T.ink2, textDecoration: 'underline', cursor: 'pointer',
              }}>Sign in another way</button>
            )}
          </>
        )}

        {stage === 'waiting' && !prompt && (
          <Waiting>
            {method.here ? 'Opening the browser on that computer…' : 'Preparing the sign-in page…'}
          </Waiting>
        )}

        {/* Nothing to paste back: a one-time code typed into the page, or a
            sign-in that completes on its own once the page is approved. */}
        {stage === 'waiting' && !!prompt && (
          <>
            {!!prompt.code && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <StepHead n={1}>Copy this code</StepHead>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Quoted style={{ flex: 1, fontSize: 20, letterSpacing: 3, color: T.ink }}>{prompt.code}</Quoted>
                  <Button face="outline" icon={P.copy} label={copied === 'code' ? 'Copied' : 'Copy'}
                    onClick={() => copy('code', prompt.code!)} />
                </div>
              </div>
            )}
            {!!prompt.url && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <StepHead n={prompt.code ? 2 : undefined}>
                  {prompt.code ? 'Open the page and type it in' : 'Approve the sign-in on the page'}
                </StepHead>
                {openButton}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: T.ink2 }}>
              <Spinner size={14} color={T.ink3} /> Waiting for you to finish there. This closes on its own.
            </div>
          </>
        )}

        {stage === 'code' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <StepHead n={1}>Open the sign-in page and approve</StepHead>
              {prompt?.url ? openButton : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: T.ink2 }}>
                  <Spinner size={14} color={T.ink3} /> Preparing the sign-in page…
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <StepHead n={2}>Paste the code the page shows at the end</StepHead>
              <Field value={code} onChange={setCode} autoFocus onEnter={submit}
                placeholder="the code from the page" />
              {looksLikeEmailCode(code) && (
                <div style={{ fontSize: 12.5, lineHeight: 1.45, color: T.amber }}>
                  That looks like the code from the email. It goes on the sign-in page; the page
                  then shows a longer code, and that is the one for here.
                </div>
              )}
            </div>
            {!!prompt?.expires_at && (
              <Cell text={`this link works for ${until(prompt.expires_at)}`} tone="ink3" />
            )}
          </>
        )}

        {stage === 'finishing' && (
          <Waiting note="A few seconds. This closes on its own.">
            {method.needs_key ? 'Checking the key…' : 'Signing in…'}
          </Waiting>
        )}

        {stage === 'done' && state.ok && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            padding: '26px 0 22px', textAlign: 'center',
          }}>
            <Well icon={P.check} />
            <div style={{ fontSize: 17, fontWeight: 600 }}>Signed in</div>
            {!!state.detail && <div style={{ fontSize: 13.5, color: T.ink2 }}>{state.detail}</div>}
          </div>
        )}

        {!!state.problem && (
          <Note tone="red" icon={P.warn}
            title={stage === 'done' ? 'Sign-in failed' : 'That did not work'} body={state.problem} />
        )}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        padding: '12px 20px', borderTop: `1px solid ${T.line}`,
      }}>
        {stage === 'method' && (
          <>
            <Button face="outline" label="Cancel" onClick={onClose} />
            <Button label="Start" onClick={start} disabled={!canStart} />
          </>
        )}
        {inFlight(state) && (
          <>
            {/* A sign-in that started by itself never showed the other ways. */}
            {stage !== 'finishing' && options.length > 1 && (
              <span style={{ marginRight: 'auto' }}><Quiet label="Sign in another way" onClick={another} /></span>
            )}
            <Button face="outline" label="Cancel" onClick={onClose} />
            {stage === 'code' && (
              <Button label="Verify" onClick={submit} disabled={code.trim().length < 10} />
            )}
          </>
        )}
        {stage === 'done' && (
          state.ok
            ? <Button label="Done" onClick={onClose} />
            : <>
                <Button face="outline" label="Close" onClick={onClose} />
                <Button label="Try again" onClick={() => { setCode(''); go({ type: 'again' }); }} />
              </>
        )}
      </div>
    </Modal>
  );
}

/** A computer's own address; one reached through another's gateway says so. */
function addrText(cfg: HostConfig): string {
  const a = hostAddr(cfg);
  return `${a.host}:${a.port}` + (cfg.via ? ` · through ${cfg.host}` : '');
}

/* ── sections ─────────────────────────────────────────────────────────── */

function HostsSection() {
  const { hosts, order, removeHost } = useFleet();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [doomed, setDoomed] = useState<string | null>(null);

  const add = () => {
    const cfg = parsePairing(text);
    if (!cfg) { setProblem('That does not look like a pairing link.'); return; }
    setProblem(null);
    pairComputer(text).then(() => setText(''), (e: any) => setProblem(e?.message || 'That computer could not be paired.'));
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
            <KV k="address" v={addrText(slot.cfg)} code />
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
        hint="Run `divan pair` on that computer, then paste the link it prints here."
      />
      <Card>
        <Field
          value={text} lines={3}
          onChange={(v) => { setText(v); setProblem(null); }}
          placeholder="divan://pair?host=…&port=8790&token=…"
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

function AccountCard({ slot, account, now, onLogin, onLogout, onRename, onDelete }: {
  slot: HostSlot;
  /** The moment the panel is drawn at, in seconds. */
  now: number;
  account: CliAccount;
  onLogin: () => void;
  onLogout: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  // Only a window the tool reported: an empty figure would be a claim the
  // daemon never made.
  const windows = (slot.limits[account.id] ?? [])
    .filter((w) => typeof w.utilization === 'number')
    .sort((x, y) => (y.utilization ?? 0) - (x.utilization ?? 0));
  // A sign-in that is about to stop working, or has, says so on its own row
  // and offers the one thing that helps — signing in again.
  const state = signInState(account, now);
  const ending = state === 'expiring' || state === 'expired';
  const tone: Tone = state === 'expired' ? 'red' : ending ? 'amber' : account.logged_in ? 'run' : 'ink3';
  return (
    <Card inset={false}>
      {/* W16's row, laid out by the stylesheet (`.dv-acct`) so that what can be
          done to a sign-in drops under its name on a phone instead of running
          off the card. */}
      <div className={ending ? 'dv-acct dv-tinted' : 'dv-acct'}
        style={{ background: ending ? toneColours(tone).bg : undefined }}>
        <span className="dv-acct-who">
          <ProviderMark provider={account.provider} dim={!account.logged_in} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 14, fontWeight: 600 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {accountName(account)}
              </span>
              {account.has_key && <Tag label="api key" />}
            </span>
            <span style={{
              display: 'block', fontSize: 12, color: T.ink3, marginTop: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{account.logged_in ? (account.detail || 'signed in') : 'not signed in'}</span>
          </span>
        </span>
        {/* One button that stands out — the one this row is waiting for — and
            the rest as quiet words beside it. */}
        <span className="dv-acct-acts">
          <span style={{ ...mono, fontSize: 12.5, fontWeight: 500, color: toneColours(tone).fg, whiteSpace: 'nowrap' }}>
            {ending ? signInWords(account, now, leftWords) : account.logged_in ? 'signed in' : 'signed out'}
          </span>
          {!account.is_default && <Quiet label="Rename" onClick={onRename} />}
          {account.logged_in && <Quiet label="Sign out" onClick={onLogout} />}
          {!account.is_default && <Quiet label="Delete" onClick={onDelete} />}
          {ending && <Button small label="Renew" onClick={onLogin} />}
          {!account.logged_in && <Button small label="Sign in" onClick={onLogin} />}
        </span>
      </div>
      {/* What is left of the plan, as one line: the bars are a page of their
          own (Accounts › Quota thresholds). */}
      {windows.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '10px 18px 12px', borderTop: `1px solid ${T.line}`,
        }}>
          <span style={{ fontSize: 12.5, color: T.ink3 }}>plan used</span>
          {windows.map((w) => {
            const u = Math.max(0, Math.min(1, w.utilization ?? 0));
            return (
              <Tag key={w.window} tone={u >= 0.6 ? limitTone(u) : 'ink3'}
                label={`${windowName(w.window)} ${pct(u)}${w.resets_at ? ` · resets ${until(w.resets_at)}` : ''}`} />
            );
          })}
        </div>
      )}
    </Card>
  );
}

function AccountsSection({ hostKey, slot, tools, onTools, now = Date.now() / 1000 }: {
  hostKey: string; slot: HostSlot; tools: ToolStatus[];
  now?: number;
  /** Read the tools again, after one has been installed from here. */
  onTools?: () => void;
}) {
  const [installing, setInstalling] = useState<Provider | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);
  const { call, refreshAccounts } = useFleet();
  const [problem, setProblem] = useState<string | null>(null);
  const [login, setLogin] = useState<CliAccount | null>(null);
  /** The account whose sheet was opened by adding it. */
  const [added, setAdded] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<CliAccount | null>(null);
  const [renameText, setRenameText] = useState('');
  const [doomed, setDoomed] = useState<CliAccount | null>(null);
  const [signingOut, setSigningOut] = useState<CliAccount | null>(null);
  const [newProvider, setNewProvider] = useState<Provider>('claude');
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [addProblem, setAddProblem] = useState<string | null>(null);
  const online = slot.status === 'online';

  // A failed read is kept on the slot (`accountsError`) and said below; this
  // page's own `problem` is for the buttons on it.
  const reload = useCallback(() => {
    refreshAccounts(hostKey).catch(() => {});
  }, [hostKey]);

  // Asked again on every reconnect, not only when `online` flips: a socket
  // that drops and comes back between two renders is seen as online twice,
  // with a newer `lastOnline`.
  useEffect(() => { if (online) reload(); }, [hostKey, online, slot.lastOnline]);
  useEffect(() => { setProblem(null); }, [hostKey]);
  const readError = slot.accountsError && !slot.loading.accounts ? slot.accountsError : null;

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

  // Which tool is not on the computer: its own tool report where that has been
  // read, otherwise the versions it reports with its info.
  const missing = (['claude', 'codex'] as Provider[]).filter((p) => {
    const tool = tools.find((x) => x.provider === p);
    if (tool) return !tool.version;
    const v = slot.info?.versions as Record<string, string | null> | undefined;
    return !!v && !v[p];
  });
  // An account can only be added to a tool that is there.
  const addable = (['claude', 'codex'] as Provider[]).filter((p) => !missing.includes(p));
  const adds = addable.length ? addable : (['claude', 'codex'] as Provider[]);
  const addTo: Provider = adds.includes(newProvider) ? newProvider : adds[0];

  /** Adding an account is only ever the first half of signing one in, so the
   *  sign-in starts on it the moment it exists — the page to open is the first
   *  thing the sheet shows. It used to appear as one more row somewhere down
   *  the list, signed out, with its own button to find. */
  const add = async () => {
    const label = newLabel.trim();
    if (!label || adding || !online) return;
    setAdding(true);
    setAddProblem(null);
    try {
      const made: any = await call(hostKey, 'account.create', { provider: addTo, label });
      setNewLabel('');
      reload();
      if (made?.id) { setAdded(made.id); setLogin(made as CliAccount); }
    } catch (e) {
      // Said under the field it is about, not at the top of the page.
      setAddProblem(err(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <Head
        title="Accounts"
        right={
          <>
            {slot.loading.accounts && <Spinner size={13} color={T.ink3} />}
            <Button small face="outline" label="Refresh" onClick={reload} disabled={!online} />
          </>
        }
      />

      {problem && <Aside tone="warn">{problem}</Aside>}
      {online && readError && (
        <Aside tone="warn">The accounts could not be read: {readError}</Aside>
      )}
      {!online && <Aside>This computer is offline — accounts cannot be read.</Aside>}

      {/* Adding one is first: it is what a person most often comes here to do,
          and under a long list of plan bars it was a scroll away (7 Nov 2026).
          One line: which tool, what to call it, and the sign-in follows. */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          {/* A choice only where there are two tools to add one to. */}
          {adds.length > 1 && (
            <Choice
              label="Tool" value={addTo}
              options={adds.map((x) => ({ key: x, label: TOOL[x] ?? x }))}
              onChange={setNewProvider}
            />
          )}
          {/* Never narrower than a name can be typed into: on a phone it takes a
              line of its own under the tool. */}
          <div style={{ flex: '1 1 200px', minWidth: 140 }}>
            <Field
              value={newLabel} onChange={(v) => { setNewLabel(v); setAddProblem(null); }}
              placeholder="e.g. Work, Second subscription" onEnter={add}
            />
          </div>
          <Button label={adding ? 'Adding…' : 'Add'} disabled={!online || adding || !newLabel.trim()} onClick={add} />
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: addProblem ? T.red : T.ink3 }}>
          {addProblem ?? 'Name a new account and add it; the sign-in starts straight after.'}
        </div>
      </Card>

      {(['claude', 'codex'] as Provider[]).map((p) => (
        byProvider[p].length ? (
          <div key={p} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Mark>{p}</Mark>
            {byProvider[p].map((a) => (
              <AccountCard
                key={a.id} slot={slot} account={a} now={now}
                onLogin={() => setLogin(a)}
                onLogout={() => setSigningOut(a)}
                onRename={() => { setRenaming(a); setRenameText(a.label); }}
                onDelete={() => setDoomed(a)}
              />
            ))}
          </div>
        ) : null
      ))}

      {online && !slot.accounts.length && !slot.loading.accounts && !slot.accountsError && (
        <Aside>No accounts on this computer.</Aside>
      )}

      {/* A tool that is not on the computer is not something wrong with it —
          plenty of computers run one of the two — so it is a quiet row under
          the sign-ins with the one button that changes it, not a warning over
          them (26 Nov 2026). */}
      {!!installed && <Aside>{installed}</Aside>}
      {missing.map((p) => (
        <Card key={`missing-${p}`} inset={false}>
          <Row
            first lead={<ProviderMark provider={p} dim />}
            title={TOOL[p] ?? p} note="Not installed on this computer"
            right={<Button small face="outline" label={installing === p ? 'Installing…' : 'Install'}
              disabled={!!installing || !online}
              onClick={() => {
                setInstalling(p);
                setInstalled(null);
                run(async () => {
                  const r: any = await installTool(hostKey, p);
                  setInstalled(r?.already ? `${p} was already there` : `${p} installed ${r?.version ?? ''}`.trim());
                }).finally(() => { setInstalling(null); onTools?.(); });
              }} />}
          />
        </Card>
      ))}

      {login && (
        <LoginSheet
          hostKey={hostKey} account={login} methods={methodsFor(login.provider)}
          auto={added === login.id}
          onClose={() => { setLogin(null); setAdded(null); reload(); }}
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

function ToolsSection({ tools, npm, loading, problem, onReload, under }: {
  tools: ToolStatus[]; npm: boolean | null; loading: boolean;
  problem: string | null; onReload: () => void;
  /** Drawn as a card of This computer rather than as a page of its own: one
   *  row a tool, and nothing a person cannot act on. */
  under?: boolean;
}) {
  if (under) {
    return (
      <>
        <Head under title="Tools"
          right={<Button small face="outline" label={loading ? 'Reading…' : 'Refresh'}
            onClick={onReload} disabled={loading} />} />
        {problem && <Aside tone="warn">{problem}</Aside>}
        <Card inset={false}>
          {tools.map((tool, i) => (
            <Row
              key={tool.provider} first={i === 0}
              lead={<ProviderMark provider={tool.provider} dim={!tool.version} />}
              title={TOOL[tool.provider] ?? tool.provider}
              note={tool.version ? (tool.path ? tilde(tool.path) : undefined) : 'Install it from Accounts'}
              meta={tool.version ? `version ${tool.version}` : 'not installed'}
              tone={tool.version ? undefined : 'ink3'}
            />
          ))}
          {!tools.length && (
            <div style={{ padding: '14px 18px', fontSize: 13, color: T.ink2 }}>
              {loading ? 'Reading the tools on that computer…' : 'No tool information.'}
            </div>
          )}
          {npm === false && (
            <Row title="npm" note="Without it a tool cannot be installed from this panel" meta="missing" tone="amber" />
          )}
        </Card>
      </>
    );
  }
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

/** One setting (Web15 W18): its name over a grey line saying what it does, and
 *  its answer at the end of the row — a `Choice`, a `Select`, or a mono word
 *  where the answer is not the panel's to change. The layout is the
 *  stylesheet's (`.dv-setting`), so that the answer can drop under the name on
 *  a phone instead of squeezing it. */
function Setting({ title, note, first, meta, tone, children }: {
  title: string; note?: React.ReactNode; first?: boolean;
  meta?: string | null; tone?: Tone; children?: React.ReactNode;
}) {
  return (
    <div className="dv-setting" style={{ borderTop: first ? undefined : `1px solid ${T.line}` }}>
      <span className="dv-setting-what">
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{title}</span>
        {!!note && (
          <span style={{ display: 'block', fontSize: 12, lineHeight: 1.45, color: T.ink3, marginTop: 2 }}>{note}</span>
        )}
      </span>
      {!!meta && (
        <span style={{ ...mono, fontSize: 12.5, fontWeight: tone ? 500 : 400, color: tone ? toneColours(tone).fg : T.ink2 }}>
          {meta}
        </span>
      )}
      {children}
    </div>
  );
}

/** Where the New chat dialog gets its opening answers. The tool, model,
 *  effort and sign-in are this panel's own; the folder is the computer's
 *  (`host.default_cwd`), so the phone's new chats open in the same one.
 *
 *  One card, a row a setting, its answer at the end of the row. It was every
 *  account, every model and every folder as a list of its own — three screens
 *  of rows to read past for the one that was already right (26 Nov 2026). */
function DefaultsSection({ hostKey, slot }: { hostKey: string; slot: HostSlot }) {
  const { refreshAccounts } = useFleet();
  const defaults = usePrefs((s) => hostDefaults(s.defaults, hostKey));
  const setDefaults = usePrefs((s) => s.setDefaults);
  const setProviderDefaults = usePrefs((s) => s.setProviderDefaults);
  const online = slot.status === 'online';
  // The folder is the computer's answer: what it says now, and whether
  // somebody chose it or it is simply the first root.
  const folder = newChatCwd(slot.info);
  const chosen = !!slot.info?.default_cwd_chosen;
  const [folderErr, setFolderErr] = useState<string | null>(null);
  const pickFolder = (cwd: string | null) => {
    setFolderErr(null);
    setDefaultCwd(hostKey, cwd).catch((e) => setFolderErr(err(e)));
  };
  const firstRoot = slot.info?.roots?.[0] ?? null;

  // Same reason AccountsSection asks: account.list shells out to the CLIs, so
  // it is asked for once and only re-asked when something needs it.
  useEffect(() => {
    if (online && (!slot.accounts.length || slot.accountsError) && !slot.loading.accounts) {
      refreshAccounts(hostKey).catch(() => {});
    }
  }, [hostKey, online, slot.lastOnline]);

  const provider = defaults.provider;
  const pc = slot.catalog?.[provider] ?? null;
  const accounts = useMemo(
    () => slot.accounts.filter((a) => a.provider === provider && (a.logged_in || a.is_default)),
    [slot.accounts, provider],
  );
  // What New chat would open with right now, stored answers and all.
  const now = resolveDefaults(providerDefaults(defaults, provider), pc, accounts);
  const installed = (['claude', 'codex'] as Provider[]).filter((p) => slot.catalog?.[p]);
  const models = pc?.models ?? [];
  const absent = online ? 'none on this computer' : 'the computer is offline';
  // Which agents exist is a question for that computer and that sign-in — an
  // account's folder holds the ones installed under it — so the list is read
  // again when either changes. Only what was installed through the app: the
  // same list the command bar's chip and the New chat dialog offer.
  const [agents, setAgents] = useState<Agent[] | null>(null);
  useEffect(() => {
    if (!online) { setAgents(null); return undefined; }
    let alive = true;
    setAgents(null);
    listAgents(hostKey, now.account_id || null, undefined, provider)
      .then((r: any) => { if (alive) setAgents(((r?.agents ?? []) as Agent[]).filter((a) => a.installed)); })
      .catch(() => { if (alive) setAgents([]); });
    return () => { alive = false; };
  }, [hostKey, provider, now.account_id, online]);
  const agent = defaultAgent(agents ?? [], defaults.lastAgent);
  // The folders, with the one in use among them even where the list has not
  // been read yet — a list that cannot show its own answer shows a wrong one.
  const folders = [
    { key: '', label: firstRoot ? `${tilde(firstRoot)} · the first root` : 'The computer’s first root' },
    ...slot.projects.map((pr) => ({ key: pr.path, label: tilde(pr.path) })),
  ];
  if (chosen && folder && !folders.some((f) => f.key === folder)) folders.push({ key: folder, label: tilde(folder) });

  return (
    <>
      <Head
        title="New chat defaults"
        hint="What a new chat on this computer starts with. Starting one with something else changes these to match."
      />

      <Card inset={false} style={{ padding: '4px 0' }}>
        {/* A choice only where there are two tools to choose between. */}
        {installed.length > 1 && (
          <Setting first title="Tool" note="The rows under it are this tool’s">
            <Choice
              label="Tool" value={provider}
              options={installed.map((x) => ({ key: x, label: TOOL[x] ?? x }))}
              onChange={(x) => setDefaults(hostKey, { provider: x })}
            />
          </Setting>
        )}
        <Setting
          first={installed.length <= 1} title="Agent" note="Who answers a new chat"
          meta={agents ? null : online ? 'reading…' : absent}
        >
          {!!agents && (
            <Select
              label="Agent" value={agent?.id ?? ''}
              options={[...agents.map((a) => ({ key: a.id, label: a.label || a.name })),
                        { key: '', label: 'No agent' }]}
              // "No agent" is a real answer and is kept as one (`null`), so it
              // is not turned back into Hermes the next time.
              onChange={(v) => setDefaults(hostKey, { lastAgent: v || null })}
            />
          )}
        </Setting>
        <Setting title="Account" meta={accounts.length ? null : absent}>
          {!!accounts.length && (
            <Select
              label="Account" value={now.account_id ?? ''}
              options={accounts.map((a) => ({
                key: a.is_default ? '' : a.id,
                label: a.logged_in && a.detail && !a.is_default ? `${accountName(a)} · ${a.detail}` : accountName(a),
              }))}
              onChange={(v) => setProviderDefaults(hostKey, provider, { account_id: v })}
            />
          )}
        </Setting>
        <Setting title="Model" meta={models.length ? null : absent}>
          {!!models.length && (
            <Select
              label="Model" value={now.model ?? ''}
              options={models.map((m) => ({ key: m.id, label: m.label || m.id }))}
              onChange={(v) => setProviderDefaults(hostKey, provider, { model: v })}
            />
          )}
        </Setting>
        {!!pc?.efforts?.length && (
          <Setting title="Effort">
            <Choice
              label="Effort" value={now.effort ?? ''}
              options={pc.efforts.map((e) => ({ key: e, label: e }))}
              onChange={(e) => setProviderDefaults(hostKey, provider, { effort: e })}
            />
          </Setting>
        )}
        {pc?.default_perm_mode ? (
          // The computer decides this one, and a control that changed a word
          // nothing reads would be a lie: the mode is picked per chat.
          <Setting
            title="Permissions"
            note={now.perm_mode === 'bypass'
              ? 'No permission questions; the dangerous-command list still asks. Changed per chat.'
              : 'This computer’s default. Changed per chat, in New chat.'}
            meta={pc.default_perm_mode} tone={now.perm_mode === 'bypass' ? 'amber' : undefined}
          />
        ) : !!pc?.perm_modes?.length && (
          <Setting
            title="Permissions"
            note={now.perm_mode === 'bypass' ? 'No permission questions; the dangerous-command list still asks.' : undefined}
          >
            <Choice
              label="Permission mode" value={now.perm_mode ?? ''}
              options={pc.perm_modes.map((m) => ({ key: m, label: m }))}
              onChange={(m) => setProviderDefaults(hostKey, provider, { perm_mode: m })}
            />
          </Setting>
        )}
        <Setting title="Folder" note="Kept on the computer, so the phone opens in the same one">
          <Select
            label="Project folder" value={chosen && folder ? folder : ''} disabled={!online}
            options={folders} onChange={(v) => pickFolder(v || null)}
          />
        </Setting>
      </Card>
      {folderErr && <Aside tone="warn">{folderErr}</Aside>}
    </>
  );
}

function SecuritySection({ slot, under }: { slot: HostSlot; under?: boolean }) {
  const roots = slot.info?.roots ?? [];
  return (
    <>
      <Head
        under={under}
        title={under ? 'Folders an agent may open' : 'Security'}
        hint={under ? undefined : 'Chats can only open under the roots below. That limit is enforced on the computer, and holds even in bypass permission mode.'}
      />

      {!under && <Mark>allowed roots</Mark>}
      <Card inset={false}>
        {roots.length ? roots.map((root, i) => (
          <Row key={root} first={i === 0} icon={P.folder} mark title={tilde(root)} />
        )) : (
          <div style={{ padding: '14px 18px', fontSize: 13, color: T.ink2 }}>
            {slot.status === 'online' ? 'This computer reported no roots.' : 'The computer is offline.'}
          </div>
        )}
      </Card>

      {under ? (
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: T.ink3, padding: '0 2px' }}>
          Enforced on the computer, even in bypass. Changed in its config file, not from here.
        </div>
      ) : (
        <Aside>
          The roots come from that computer’s own config and cannot be changed from the panel.
          Edit the config file on the computer instead.
        </Aside>
      )}
    </>
  );
}

function AboutSection({ slot, whole }: {
  slot: HostSlot;
  /** The page is all of This computer: the tools have a card of their own
   *  under this one, so their versions are not said twice. */
  whole?: boolean;
}) {
  const info = slot.info;
  const st = hostState(slot);
  return (
    <>
      <Head title={whole ? 'This computer' : 'About'} hint={whole ? undefined : 'The daemon running on this computer.'} />
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
        <KV k="address" v={addrText(slot.cfg)} code />
        {!whole && <KV k="claude" v={info?.versions?.claude ?? 'not installed'} code />}
        {!whole && <KV k="codex" v={info?.versions?.codex ?? 'not installed'} code />}
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
function DictationRows() {
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
      <Setting title="Dictation language">
        <Select
          label="Dictation language" value={lang}
          options={langChoices(lang).map((tag) => ({ key: tag, label: `${langName(tag)} · ${tag}` }))}
          onChange={pick}
        />
      </Setting>
      {/* A choice only where there are two things to choose between. */}
      {s.secure && canWhisper && s.capture && s.speech && (
        <Setting title="Dictation runs on">
          <Choice
            label="Engine" value={engine}
            options={[{ key: 'computer' as const, label: 'computer' },
                      { key: 'browser' as const, label: 'browser' }]}
            onChange={pickEngine}
          />
        </Setting>
      )}
      {/* Which engine hears you is worth being told before you talk: one line,
          and the one button it sometimes needs. */}
      <div className="dv-setting" style={{ borderTop: `1px solid ${T.line}` }}>
        <span className="dv-setting-what" style={{ fontSize: 13, lineHeight: 1.5, color: T.ink2 }}>{line}</span>
        {state === 'downloadable' && (
          <Button
            small label={busy ? 'Fetching…' : `Fetch the ${langName(lang)} model`}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              install(lang).finally(() => { setBusy(false); read(); });
            }}
          />
        )}
      </div>
    </>
  );
}

export function AppearanceSection() {
  const { choice, scheme, set } = useTheme();
  return (
    <Card inset={false} style={{ padding: '4px 0' }}>
      <Setting
        first title="Theme"
        note={choice === 'system' ? `Following this computer’s theme, which is ${scheme} right now` : 'Set by hand. This browser keeps this theme until you change it back'}
      >
        <Choice
          label="Theme" value={choice}
          options={[{ key: 'system' as const, label: 'system' },
                    { key: 'light' as const, label: 'light' },
                    { key: 'dark' as const, label: 'dark' }]}
          onChange={(v) => set(v)}
        />
      </Setting>
      <DictationRows />
    </Card>
  );
}

/* ── screen ───────────────────────────────────────────────────────────── */

/** `section` is which row of the column this page opens on. It is a prop and
 *  not only local state because five of the seven sections are otherwise
 *  reachable by pressing something, and a static render cannot press. Nothing
 *  passes it in the panel — the drawer opens this page on Accounts, which is
 *  the one that is usually the reason for coming. */
export function Preferences({ section: opening = 'accounts', onSection, only, now }: {
  /** The moment the page is drawn at, in seconds: when a sign-in ends is
   *  measured from it. */
  now?: number;
  section?: SectionId;
  /** These sections and nothing else, one under the other, with no side menu:
   *  how the tabs of the Machine place draw a section as a page of their own
   *  (Settings › General is Appearance and New chats; Accounts is Accounts). */
  only?: SectionId[];
  /** Given, the section is the panel's — in the address, so Back and a reload
   *  come back to it — and `section` is the one on screen. */
  onSection?: (section: SectionId) => void;
}) {
  const { hosts, order, focus } = useFleet();
  const [own, setOwn] = useState<SectionId>(opening);
  const section = onSection ? opening : own;
  const setSection = onSection ?? setOwn;
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

  if (only) {
    const draw = (x: SectionId) => {
      if (x === 'appearance') {
        return (
          <Fragment key={x}>
            <Head title="This browser" hint="How Divan looks and listens here. Kept in this browser, not on any computer." />
            <AppearanceSection />
          </Fragment>
        );
      }
      if (x === 'hosts') return <HostsSection key={x} />;
      if (!slot || !focus) return null;
      if (x === 'defaults') return <DefaultsSection key={x} hostKey={focus} slot={slot} />;
      if (x === 'accounts') return <AccountsSection key={x} hostKey={focus} slot={slot} tools={tools} onTools={loadTools} now={now} />;
      // With About in front of them the other two are cards of that page.
      const whole = only.includes('about') && only.length > 1;
      if (x === 'tools') {
        return <ToolsSection key={x} tools={tools} npm={npm} loading={toolsLoading} problem={toolsProblem} onReload={loadTools} under={whole} />;
      }
      if (x === 'security') return <SecuritySection key={x} slot={slot} under={whole} />;
      if (x === 'about') return <AboutSection key={x} slot={slot} whole={whole} />;
      return null;
    };
    return (
      <>
        {only.some((x) => x !== 'appearance' && x !== 'hosts') && !slot && (
          <Aside>No computer paired yet. Pair one under Computers.</Aside>
        )}
        {only.map(draw)}
      </>
    );
  }

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
              <AppearanceSection />
            </>
          )}

          {section !== 'hosts' && section !== 'appearance' && !slot && (
            <Aside>No computer paired yet. Add one from “Computers” on the left.</Aside>
          )}

          {section === 'accounts' && slot && focus && (
            <AccountsSection hostKey={focus} slot={slot} tools={tools} onTools={loadTools} />
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
