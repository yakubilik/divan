import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/** Only the events iOS owns. Speech events are not here: what is said and heard
 *  goes through `src/voice.ts`, which works the same whether the call was
 *  placed from this phone or arrived at it. */
export type CallEvent =
  /** The phone has a VoIP push token — a different token, for a different APNs
   *  topic, from the one expo-notifications gets. An empty string means iOS
   *  invalidated it. */
  | { event: 'onVoipToken'; token: string }
  | { event: 'onCallRinging'; chatId: string; from: string }
  | { event: 'onCallAnswered'; chatId: string }
  | { event: 'onCallEnded'; reason: string; chatId?: string }
  | { event: 'onCallFailed'; reason: string }
  | { event: 'onCallMuted'; muted: boolean }
  /** The system handed over the audio session; nothing may be spoken or heard
   *  before this arrives. */
  | { event: 'onAudioReady' }
  | { event: 'onAudioGone' };

type Name = CallEvent['event'];
type Payload<N extends Name> = Extract<CallEvent, { event: N }>;

interface CallModule {
  reportIncoming(chatId: string, from: string): Promise<void>;
  startVoiceSession(chatId: string): Promise<void>;
  endVoiceSession(): Promise<void>;
  endCall(): Promise<void>;
  reportConnected(): Promise<void>;
  addListener<N extends Name>(event: N, listener: (payload: Omit<Payload<N>, 'event'>) => void): { remove(): void };
}

/** CallKit and PushKit are iOS-only. A build without the module still runs —
 *  the phone can call the computer, it just cannot be called back. */
const native: CallModule | null = (() => {
  if (Platform.OS !== 'ios') return null;
  try {
    return requireNativeModule<CallModule>('RacCall');
  } catch {
    console.warn('call: the native module is not in this build');
    return null;
  }
})();

export const callAvailable = native != null;

export function onCallEvent<N extends Name>(
  event: N,
  listener: (payload: Omit<Payload<N>, 'event'>) => void,
): () => void {
  if (!native) return () => {};
  const sub = native.addListener(event, listener);
  return () => sub.remove();
}

export const call = {
  reportIncoming: (chatId: string, from: string) => native?.reportIncoming(chatId, from) ?? Promise.resolve(),
  start: (chatId: string) => native?.startVoiceSession(chatId) ?? Promise.resolve(),
  hangUp: () => native?.endVoiceSession() ?? Promise.resolve(),
  end: () => native?.endCall() ?? Promise.resolve(),
  connected: () => native?.reportConnected() ?? Promise.resolve(),
};
