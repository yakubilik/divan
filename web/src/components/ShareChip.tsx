import { createContext, useContext, useEffect, useState } from 'react';
import { useFleet } from '../lib/fleet';
import { copyText } from '../lib/clipboard';
import { C, R } from '../lib/theme';

/** A key an agent hands over (`daemon/divan/secret_share.py`), the panel's half.
 *
 *  The agent writes `[secret-share rac-secret-NAME label]`; the phone draws it
 *  as a chip (`app/src/components/secret-chip.tsx`) and so does this. A click
 *  asks the daemon for the value (`secret.copy`) and puts it on the clipboard;
 *  the page never shows it. The daemon answers only for a key shared in that
 *  chat and only for an hour from the message, so the chip greys out then.
 *  Before, the panel printed the token as text and the key could only be had
 *  from the phone. */

export const SHARE_TTL_S = 3600;
export const SHARE_SOURCE = /\[secret-share (rac-secret-[a-z0-9][a-z0-9-]{1,80})(?: ([^\]\n]{1,60}))?\]/.source;

/** A label for a service that came without one: `rac-secret-openai-prod` → `openai-prod`. */
export const shareLabel = (service: string, label?: string) =>
  (label ?? '').trim() || service.replace(/^rac-secret-/, '');

/** Which chat a message belongs to, and when it was said: what the daemon is
 *  asked about. Absent (a ticket's report), a share is only its name. */
export type ShareWhere = { hostKey: string; chatId: string; sentAt: number };
export const ShareContext = createContext<ShareWhere | null>(null);

type State = 'idle' | 'busy' | 'copied' | 'failed';

export function ShareChip({ service, label }: { service: string; label?: string }) {
  const where = useContext(ShareContext);
  const name = shareLabel(service, label);
  const until = where ? where.sentAt + SHARE_TTL_S : 0;
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [state, setState] = useState<State>('idle');
  const [gone, setGone] = useState(false);
  const expired = !where || gone || now >= until;

  // Grey on time, with the chat open and nobody touching it.
  useEffect(() => {
    if (expired) return;
    const ms = Math.min((until - Date.now() / 1000) * 1000 + 250, 2 ** 31 - 1);
    const h = window.setTimeout(() => setNow(Date.now() / 1000), Math.max(ms, 0));
    return () => window.clearTimeout(h);
  }, [until, expired, now]);

  useEffect(() => {
    if (state !== 'copied' && state !== 'failed') return;
    const h = window.setTimeout(() => setState('idle'), 1800);
    return () => window.clearTimeout(h);
  }, [state]);

  const onClick = async () => {
    if (!where || expired || state === 'busy') return;
    setState('busy');
    try {
      const r = await useFleet.getState().call<{ value?: string }>(where.hostKey, 'secret.copy', {
        chat_id: where.chatId, service,
      });
      setState(await copyText(String(r?.value ?? '')) ? 'copied' : 'failed');
    } catch (e: any) {
      if (e?.code === 'secret_expired' || e?.code === 'secret_not_shared' || e?.code === 'secret_gone') setGone(true);
      setState('failed');
    }
  };

  const text = !where ? `🔒 ${name}`
    : expired ? `🔒 ${name} · expired`
      : state === 'copied' ? '✓ copied'
        : state === 'failed' ? '⚠︎ could not copy'
          : state === 'busy' ? `🔑 ${name} …` : `🔑 ${name}`;
  return (
    <button
      type="button"
      data-share={service}
      disabled={expired}
      onClick={onClick}
      title={expired ? undefined : 'Copy to the clipboard'}
      style={{
        font: 'inherit', fontSize: 14, fontWeight: expired ? 400 : 600,
        padding: '1px 8px', margin: '0 1px', borderRadius: R.badge,
        border: `1px solid ${C.border}`, background: C.surface2,
        color: expired ? C.faint : state === 'failed' ? C.danger : C.text,
        cursor: expired ? 'default' : 'pointer', verticalAlign: 'baseline',
      }}
    >{text}</button>
  );
}
