/** The first screen: a panel with no computer behind it yet.
 *
 *  Three steps, and the flow is the whole page — there is no shell around it,
 *  because the shell is about a fleet and there is none. The desktop frames
 *  draw no pairing flow (every artboard opens on a day's work already in
 *  progress), so the shape is the one Web15 W12's pairing card uses for the
 *  same job one page in: a command in a `Quoted` block, a field to paste what
 *  it printed, and one button. Three of those, each a card that wears its own
 *  state as a ring — grey while it is waiting, amber while it is the one to do,
 *  green once it is done.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { T } from '../lib/theme';
import { Icon, P, Spinner, mono } from '../ui/kit';
import {
  Button, Card, Quoted, SectionHeader, Slider, StatusDot, Tag, Well, Write,
} from '../ui/divan';
import { parsePairing } from '../lib/actions';
import { hostKey, useFleet } from '../lib/fleet';
import type { HostConfig } from '../lib/protocol';
import { copyText } from '../lib/clipboard';
import { refusalText } from '../lib/refusal';

type StepState = 'done' | 'active' | 'todo';

interface Probe {
  state: 'checking' | 'up' | 'down';
  /** Only ever set when the daemon actually told us — it answers /health
   *  without CORS headers, so a cross-origin dev panel can prove it is alive
   *  but cannot read the version out of it. */
  version: string | null;
}

const INSTALL = 'cd daemon && ./install.sh';
const PAIR = 'divan pair --name Panel';

/** Alive, and the version if the browser is allowed to read the answer.
 *  A `no-cors` request still resolves when the daemon replies and only
 *  rejects when nothing is listening — which is the question being asked. */
async function probeHealth(host: string, port: number): Promise<Probe> {
  const url = `http://${host}:${port}/health`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json();
    return { state: 'up', version: typeof j?.version === 'string' ? j.version : null };
  } catch { /* cross-origin read blocked, or nothing there — ask again, blind */ }
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store' });
    return { state: 'up', version: null };
  } catch {
    return { state: 'down', version: null };
  }
}

/** A token is shown as its first and last few characters and nothing else —
 *  enough to tell two pairings apart, useless to anyone reading the screen. */
function mask(token: string): string {
  const t = token.trim();
  if (!t) return '';
  if (t.length <= 10) return '•'.repeat(t.length);
  return `${t.slice(0, 4)}${'•'.repeat(Math.min(16, t.length - 8))}${t.slice(-4)}`;
}

/** The ring a step wears, which is the design's own way of saying where you
 *  are in a set of them: green behind you, amber under your hand, grey ahead. */
const RING: Record<StepState, 'run' | 'amber' | 'line'> = {
  done: 'run', active: 'amber', todo: 'line',
};

function Step({ n, state, title, aside, children }: {
  n: number;
  state: StepState;
  title: string;
  aside?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Card ring={RING[state]} raised={state === 'active'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {state === 'done'
          ? <Well icon={P.check} />
          : <Well mark={String(n)} />}
        <span style={{
          flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600,
          color: state === 'todo' ? T.ink3 : T.ink,
        }}>{title}</span>
        {aside}
      </div>
      {children}
    </Card>
  );
}

/** A command the user runs on the other machine: mono, selectable, copyable —
 *  never a sentence dressed up as code. */
function CodeBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const copy = () => {
    void copyText(text)
      .then(() => {
        setCopied(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {});
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Quoted style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          userSelect: 'text', display: 'block',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{text}</span>
      </Quoted>
      <Button
        small face="outline" icon={copied ? P.check : P.copy}
        label={copied ? 'Copied' : 'Copy'} onClick={copy}
      />
    </div>
  );
}

/** One of the four things a pairing is made of. The label is the mono line the
 *  frames put over a value, and the box is the card's own inset block. */
function Field({ label, value, onChange, placeholder, secret, width }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secret?: boolean;
  width?: number;
}) {
  return (
    <div style={{ width, flex: width ? undefined : 1, minWidth: 0 }}>
      <div style={{ ...mono, fontSize: 11, color: T.ink3, paddingBottom: 5 }}>{label}</div>
      <Quoted>
        <Write
          value={value} onChange={onChange} placeholder={placeholder}
          secret={secret} label={label}
        />
      </Quoted>
    </div>
  );
}

export function Onboarding({ onPaired }: { onPaired: () => void }) {
  const addHost = useFleet((s) => s.addHost);
  const hosts = useFleet((s) => s.hosts);

  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('8790');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [paste, setPaste] = useState('');
  const [fromLink, setFromLink] = useState(false);
  /** Bumped on every resolved link so the box is rebuilt empty rather than
   *  re-rendered — a controlled value alone can leave the pasted token sitting
   *  in the DOM node. */
  const [pasteNonce, setPasteNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe>({ state: 'checking', version: null });
  const [pairedKey, setPairedKey] = useState<string | null>(null);

  const portNum = Number(port);
  const validAddr = !!host.trim() && Number.isFinite(portNum) && portNum > 0;

  // Poked on load and whenever the address settles, so typing a different host
  // re-answers "is anything listening there" without a button press.
  const seq = useRef(0);
  useEffect(() => {
    if (!validAddr) { setProbe({ state: 'down', version: null }); return; }
    const mine = ++seq.current;
    // A green tick belongs to the address it was earned at. Change the address
    // and it goes back to a question until this one has answered.
    setProbe({ state: 'checking', version: null });
    const id = window.setTimeout(() => {
      probeHealth(host.trim(), portNum).then((r) => { if (seq.current === mine) setProbe(r); });
    }, 350);
    return () => window.clearTimeout(id);
  }, [host, port]);

  const recheck = () => {
    const mine = ++seq.current;
    setProbe({ state: 'checking', version: null });
    probeHealth(host.trim(), portNum).then((r) => { if (seq.current === mine) setProbe(r); });
  };

  const onPaste = (text: string) => {
    setPaste(text);
    setError(null);
    if (!text.trim()) { setFromLink(false); return; }
    const cfg = parsePairing(text);
    if (!cfg) {
      setFromLink(false);
      setError('Could not read that pairing link — it should be divan://pair?… or the QR’s JSON.');
      return;
    }
    setHost(cfg.host);
    setPort(String(cfg.port));
    setToken(cfg.token);
    setName(cfg.name || cfg.host);
    setDeviceId(cfg.device_id);
    setFromLink(true);
    // The link carries the token in the clear, so it does not stay on screen:
    // what it resolved to is shown below, masked.
    setPaste('');
    setPasteNonce((n) => n + 1);
  };

  const connect = () => {
    if (!validAddr) { setError('Address is missing.'); return; }
    if (!token.trim()) { setError('No token — paste the pairing link, or type it in.'); return; }
    const cfg: HostConfig = {
      host: host.trim(), port: portNum, token: token.trim(),
      name: name.trim() || host.trim(), device_id: deviceId,
    };
    setError(null);
    setPairedKey(hostKey(cfg));
    addHost(cfg);
  };

  const status = pairedKey ? hosts[pairedKey]?.status ?? 'connecting' : null;
  const info = pairedKey ? hosts[pairedKey]?.info ?? null : null;

  // The panel is usable the moment the socket is up; the "ready" step is drawn
  // for a beat first so the flow visibly finishes rather than snapping away.
  useEffect(() => {
    if (status !== 'online') return;
    const id = window.setTimeout(onPaired, 700);
    return () => window.clearTimeout(id);
  }, [status]);

  const s1: StepState = probe.state === 'up' ? 'done' : 'active';
  const s2: StepState = pairedKey ? 'done' : probe.state === 'up' ? 'active' : 'todo';
  const s3: StepState = status === 'online' ? 'done' : pairedKey ? 'active' : 'todo';
  const done = [s1, s2, s3].filter((s) => s === 'done').length;

  const preview = useMemo(() => (token.trim()
    ? `${host.trim()}:${port} · ${mask(token)}`
    : null), [host, port, token]);

  return (
    <div style={{ height: '100%', width: '100%', overflowY: 'auto', background: T.bg, color: T.ink }}>
      <div style={{
        maxWidth: 640, margin: '0 auto', padding: '56px 24px 64px',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <SectionHeader
          kind="page" title="Let’s finish setting up"
          note="Three steps. Once the panel reaches the daemon, that computer’s chats open here."
        />

        <Card>
          <Slider
            label="Setting up" value={done / 3} format={() => `${done} of 3`}
            note={done === 3 ? 'All three done — the panel is opening.'
              : 'Each step is answered by the computer, not by this browser.'}
          />
        </Card>

        <Step
          n={1} state={s1} title="The daemon is running"
          aside={probe.state === 'up' ? <Tag label="answering" tone="run" />
            : probe.state === 'checking' ? <Spinner size={13} color={T.ink3} />
            : <Tag label="nothing there" tone="amber" />}
        >
          {probe.state === 'up' ? (
            <div style={{ ...mono, fontSize: 12.5, color: T.ink3 }}>
              {host.trim()}:{port}{probe.version ? ` · v${probe.version}` : ''}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
                {probe.state === 'checking'
                  ? 'Probing the address…'
                  : 'Nothing answers at this address. Install it from the repo on that computer:'}
              </div>
              {probe.state === 'down' && (
                <>
                  <CodeBox text={INSTALL} />
                  <div style={{ display: 'flex' }}>
                    <Button face="outline" label="Check again" onClick={recheck} />
                  </div>
                </>
              )}
            </>
          )}
        </Step>

        <Step
          n={2} state={s2} title="Pair the computer"
          aside={pairedKey ? <Tag label="paired" tone="run" />
            : s2 === 'active' ? <Tag label="now" tone="amber" /> : null}
        >
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
            Run this on the computer, then paste the link it prints below.
          </div>
          <CodeBox text={PAIR} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ ...mono, fontSize: 11, color: T.ink3 }}>pairing link</div>
            <Quoted key={pasteNonce} style={{
              boxShadow: fromLink ? `0 0 0 1px ${T.run}` : undefined,
            }}>
              <Write
                value={paste} onChange={onPaste} lines={3} label="Pairing link"
                placeholder="divan://pair?host=…&port=8790&token=…"
              />
            </Quoted>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, lineHeight: 1.4,
              color: fromLink ? T.run : T.ink3,
            }}>
              {fromLink && <Icon path={P.check} size={13} color={T.run} />}
              {fromLink
                ? 'Link read — the token stays masked below.'
                : 'The QR’s JSON works too. A pasted token is never left on screen.'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="host" value={host} onChange={(v) => { setHost(v); setFromLink(false); }} />
            <Field label="port" value={port} width={96}
              onChange={(v) => { setPort(v.replace(/[^0-9]/g, '')); setFromLink(false); }} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="token" value={token} secret placeholder="device token"
              onChange={(v) => { setToken(v); setFromLink(false); }} />
            <Field label="name" value={name} onChange={setName} placeholder="This computer" width={170} />
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            paddingTop: 12, borderTop: `1px solid ${T.line}`,
          }}>
            <span style={{
              ...mono, flex: 1, minWidth: 0, fontSize: 12,
              color: error ? T.red : T.ink3,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }} title={error ?? preview ?? ''}>
              {error ?? preview ?? 'waiting for a token'}
            </span>
            <Button
              label="Connect" onClick={connect}
              disabled={!token.trim() || !validAddr || !!pairedKey}
            />
          </div>
        </Step>

        <Step
          n={3} state={s3} title="Ready"
          aside={status === 'online' ? <Tag label="connected" tone="run" />
            : s3 === 'active' ? <Spinner size={13} color={T.ink3} /> : null}
        >
          {!pairedKey ? (
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink3 }}>
              Once pairing is done this computer’s chats, projects and agents open in the panel.
            </div>
          ) : status === 'online' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <StatusDot state="running" />
              <span style={{ ...mono, fontSize: 12.5, color: T.ink3 }}>
                {info?.name ?? name ?? host}
                {info?.daemon_version ? ` · daemon ${info.daemon_version}` : ''}
              </span>
            </div>
          ) : (
            <div style={{
              fontSize: 13.5, lineHeight: 1.5,
              color: status === 'unauthorized' ? T.red : T.ink3,
            }}>
              {status === 'unauthorized'
                ? refusalText(pairedKey ? hosts[pairedKey]?.refusal : null).long
                : 'Connecting…'}
            </div>
          )}
        </Step>
      </div>
    </div>
  );
}
