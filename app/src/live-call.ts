import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { onCallEvent, voiceEngine } from '../modules/call';
import * as ema from './ema';
import { client } from './ws';
import { isTurkish } from './tts/speaker';
import { locale, pickVoice } from './voice';
import { emaVoice, fromBase64, pcmBase64, VoiceSession, type Engine, type EngineEvent, type Voice, type Wire } from './voice-session';

/** The streaming call, wired to the phone: the app's socket, the native engine (VoiceEngine.swift) and
 *  the call's one voice. The rules live in src/voice-session.ts; this is only the plumbing, and `live` is
 *  the seam the screen test swaps for a fake engine and a test daemon. */

function wire(): Wire {
  return {
    call: (type, data, ms) => client.call(type, data, ms),
    tell: (type, data) => { client.tell(type, data); },
    on: (l) => client.on(l),
    onStatus: (l) => client.onStatus(l),
    online: () => client.status === 'online',
  };
}

function engine(): Engine {
  const n = voiceEngine!;
  const ls = new Set<(e: EngineEvent) => void>();
  const send = (e: EngineEvent) => { for (const l of [...ls]) l(e); };
  let offs: (() => void)[] = [];
  const subscribe = () => {
    if (offs.length) return;
    offs = [
      onCallEvent('onMicFrame', ({ pcm, t_ms }) => {
        const b = fromBase64(pcm);
        send({ kind: 'frame', pcm: new Int16Array(b.buffer, b.byteOffset, b.byteLength >> 1), t_ms });
      }),
      onCallEvent('onPlayback', ({ id, state, t_ms }) => send({ kind: 'playback', id, state, t_ms })),
      onCallEvent('onAudioRoute', ({ reason, output, flushed }) => send({ kind: 'route', reason, output, flushed })),
      onCallEvent('onAudioInterruption', ({ began }) => send({ kind: 'interruption', began })),
      onCallEvent('onAudioFailed', ({ reason }) => send({ kind: 'failed', reason })),
    ];
  };
  return {
    async start() {
      subscribe();
      try {
        await n.start(false);
      } catch (e: any) {
        const denied = /mic_denied/.test(String(e?.message ?? e));
        throw Object.assign(new Error(String(e?.message ?? e)), { code: denied ? 'mic_denied' : 'mic_failed' });
      }
    },
    stop() {
      for (const off of offs) off();
      offs = [];
      void n.stop();
    },
    running: () => n.running(),
    play: (id, pcm, rate) => n.play(id, pcmBase64(pcm), rate),
    flush: () => n.flush(),
    on(l) { ls.add(l); return () => { ls.delete(l); }; },
  };
}

function emaCallVoice(): Voice | null {
  const v = ema.voice();
  return v ? emaVoice(v) : null;
}

/** The system voice, synthesised into the call's own player so it is echo-cancelled like EMA. */
function systemVoice(lang: string, id: string | null, name: string): Voice {
  return {
    name,
    async *synth(text, cancelled) {
      // A synthesiser that never delivers its last buffer must not hold up every piece after it.
      const r = await Promise.race([
        voiceEngine!.synthesize(text, locale(lang), id, 0.96),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('system voice timed out')), 8000)),
      ]);
      if (cancelled()) return;
      const b = fromBase64(r.pcm);
      yield { pcm: new Int16Array(b.buffer, b.byteOffset, b.byteLength >> 1), rate: r.rate };
    },
  };
}

/** The voice the whole call speaks in, chosen once: EMA for Turkish when it loads, otherwise the system
 *  voice from the first word to the last. Never a switch half way through a call. */
export async function callVoice(lang: string, emaOn: boolean): Promise<{ voice: Voice; ema: boolean }> {
  if (isTurkish(locale(lang)) && emaOn && ema.available() && (await ema.warm())) {
    const v = emaCallVoice();
    if (v) return { voice: v, ema: true };
  }
  const sys = await pickVoice(lang);
  return { voice: systemVoice(lang, sys?.identifier ?? null, sys?.name ?? 'system'), ema: false };
}

let current: VoiceSession | null = null;

/** Remember the call that is up, so a screen that mounts again joins it instead of placing a second one. */
function track(s: VoiceSession): VoiceSession {
  current = s;
  s.subscribe((sn) => { if (sn.state === 'ended' && current === s) current = null; });
  return s;
}

export const live = {
  /** This build has the engine. */
  available: (): boolean => voiceEngine != null,
  create: (voice: Voice): VoiceSession =>
    track(new VoiceSession({ wire: wire(), engine: engine(), voice, log: (l) => console.log(l) })),
  /** The call that is up, if any. */
  active: (): VoiceSession | null => current,
  track,
  voice: callVoice,
  client: () => ({ build: String(Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.version ?? 'dev'),
                   device: `${Platform.OS}` }),
};
