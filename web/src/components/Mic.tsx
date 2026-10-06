/** Dictation for any box a person types in, not only the chat's.
 *
 *  The chat composer had the microphone first, and for a while it was the only
 *  box with one: answering a ticket, telling a card's log something, replying
 *  to a question in the corner or commenting on an open item were all typing
 *  only, which on a panel opened from a phone is most of the panel. So the
 *  engine wiring and the button live here, and every box takes the same two.
 *
 *  `lib/dictate.ts` is the engine and the reasoning. What is here is which
 *  computer is asked to listen (`hostKey` — whisper when it can, the browser
 *  otherwise), the names it is told to expect, Esc to give up, and the disc.
 */
import { useEffect, useMemo, useRef } from 'react';
import { dictate, warmDictation } from '../lib/actions';
import { appendSpeech, dictateLang, langName, useDictation, type Dictation } from '../lib/dictate';
import { useFleet } from '../lib/fleet';
import { C } from '../lib/theme';
import { Composer } from '../ui/divan';
import { Icon, P, Pulse, Spinner } from '../ui/kit';

/** A dictation whose finished phrases go to `onCommit`. `hostKey` is the
 *  computer the box belongs to; without one, or on a computer that cannot run
 *  whisper, the browser's own engine listens. `folder` is one more name to
 *  expect, the chat's directory when there is one. */
export function useMic({ hostKey, folder, onCommit }: {
  hostKey?: string | null;
  folder?: string;
  onCommit: (chunk: string) => void;
}): Dictation {
  // What the engines are told to expect: the products and the machines this
  // browser can see. See `phrasesFor`.
  const hosts = useFleet((s) => s.hosts);
  const names = useMemo(() => {
    const out = new Set<string>();
    for (const slot of Object.values(hosts)) {
      out.add(slot.cfg.name);
      for (const pr of slot.projects) out.add(pr.name);
    }
    if (folder) out.add(folder);
    return [...out];
  }, [hosts, folder]);

  const canWhisper = !!hostKey && hosts[hostKey]?.info?.transcription === true;
  const mic = useDictation({
    names,
    onCommit,
    whisper: canWhisper
      ? {
        warm: () => warmDictation(hostKey!),
        send: (pcm, prompt, lang, context) => dictate(hostKey!, pcm, prompt, lang, context),
      }
      : undefined,
  });

  // Esc gives up on a dictation — the mouse pressed the button, so the key
  // cannot be the box's. Only bound while it is running.
  useEffect(() => {
    if (mic.state === 'idle') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') mic.cancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mic.state, mic.cancel]);

  return mic;
}

/** The round button beside a box. Draws nothing when this browser has no way
 *  to listen, rather than a button that cannot work. */
export function MicButton({ mic, size = 36 }: { mic: Dictation; size?: number }) {
  if (!mic.availability || mic.availability === 'none') return null;
  const listening = mic.state === 'listening';
  const waiting = mic.state === 'thinking' || mic.state === 'installing';
  return (
    <button
      type="button"
      onClick={listening || mic.state === 'opening' ? mic.stop : mic.start}
      disabled={waiting}
      title={listening ? 'Stop dictating (Esc to discard)' : `Dictate in ${langName(dictateLang())}`}
      aria-label={listening ? 'Stop dictating' : 'Dictate'}
      aria-pressed={listening}
      style={{
        width: size, height: size, borderRadius: size / 2, flexShrink: 0,
        cursor: waiting ? 'default' : 'pointer',
        background: listening ? C.accent : C.surface2,
        border: `1px solid ${listening ? C.accent : C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
      }}
    >
      {waiting || mic.state === 'opening'
        ? <Spinner size={size < 34 ? 12 : 14} />
        : listening ? <Pulse color={C.onAccent} />
        : <Icon path={P.mic} size={size < 34 ? 14 : 16} color={C.text} />}
    </button>
  );
}

/** The line under a box while the microphone is doing something other than
 *  waiting to be pressed: an error, or the one-time model download. */
export function MicNote({ mic }: { mic: Dictation }) {
  if (mic.error) return <div style={{ fontSize: 12, color: C.danger, marginTop: 6 }}>{mic.error}</div>;
  if (mic.state !== 'installing') return null;
  return (
    <div style={{ fontSize: 12, color: C.text2, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
      <Spinner size={12} />
      {`Fetching the ${langName(dictateLang())} speech model. This happens once, and then it runs on this computer.`}
    </div>
  );
}

/** The design system's one-line box (`ui/divan.tsx`) with the microphone
 *  beside it. The box is controlled by its screen, so a phrase is added to the
 *  value the screen last gave it rather than to the one the render saw. */
export function DictatingComposer({ hostKey, value, onChange, placeholder, ...rest }:
  React.ComponentProps<typeof Composer> & { hostKey: string | null | undefined }) {
  const latest = useRef(value);
  latest.current = value;
  const mic = useMic({
    hostKey,
    onCommit: (chunk) => { latest.current = appendSpeech(latest.current, chunk); onChange(latest.current); },
  });
  const listening = mic.state === 'listening';
  return (
    <>
      <Composer
        {...rest}
        value={mic.interim ? appendSpeech(value, mic.interim) : value}
        onChange={onChange}
        placeholder={listening ? 'Listening…' : placeholder}
        onSend={rest.onSend && (() => { if (mic.state !== 'idle') { mic.stop(); return; } rest.onSend!(); })}
        after={<MicButton mic={mic} size={40} />}
      />
      {(mic.error || mic.state === 'installing') && (
        <div style={{ margin: '-6px 12px 12px', ...rest.style }}><MicNote mic={mic} /></div>
      )}
    </>
  );
}
