import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { onCallEvent, voiceEngine } from '../modules/call';
import * as ema from './ema';
import { client } from './ws';
import { isTurkish } from './tts/speaker';
import { locale, pickVoice } from './voice';
import { fromBase64, pcmBase64, toPcm16, VoiceSession, type Engine, type EngineEvent, type Voice, type Wire } from './voice-session';

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
      onCallEvent('onAudioRoute', ({ reason, output }) => send({ kind: 'route', reason, output })),
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

/** EMA for the whole call: each piece's sentences made one after another, every one handed over as soon
 *  as it is made, with the pause the model asked for after it. */
function emaVoice(): Voice | null {
  const v = ema.voice();
  if (!v) return null;
  return {
    name: 'EMA',
    async *synth(text, cancelled) {
      const parts = v.prepare(text);
      for (let i = 0; i < parts.length; i++) {
        if (cancelled()) return;
        const wave = await v.synthesise(parts[i].text, { seed: i, cancelled });
        if (cancelled()) return;
        const pause = Math.round(parts[i].pause * 48000);
        const out = new Float32Array(wave.length + (i < parts.length - 1 ? pause : 0));
        out.set(wave);
        yield { pcm: toPcm16(out), rate: 48000 };
      }
    },
  };
}

/** The system voice, synthesised into the call's own player so it is echo-cancelled like EMA. */
function systemVoice(lang: string, id: string | null, name: string): Voice {
  return {
    name,
    async *synth(text, cancelled) {
      const r = await voiceEngine!.synthesize(text, locale(lang), id, 0.96);
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
    const v = emaVoice();
    if (v) return { voice: v, ema: true };
  }
  const sys = await pickVoice(lang);
  return { voice: systemVoice(lang, sys?.identifier ?? null, sys?.name ?? 'system'), ema: false };
}

export const live = {
  /** This build has the engine. */
  available: (): boolean => voiceEngine != null,
  create: (voice: Voice): VoiceSession =>
    new VoiceSession({ wire: wire(), engine: engine(), voice, log: (l) => console.log(l) }),
  voice: callVoice,
  client: () => ({ build: String(Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.version ?? 'dev'),
                   device: `${Platform.OS}` }),
};
