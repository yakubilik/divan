/** The other direction: the computer calling you.
 *
 *  The call screen already knows how to hold a conversation — this only covers
 *  the part that happens before it is on screen. A VoIP push wakes the phone,
 *  iOS shows its own call screen, and answering opens the same screen the
 *  Phone button opens.
 *
 *  Kept apart from `voice.ts` on purpose: that file is the conversation and
 *  works on its own, and a phone that cannot be rung should still be able to
 *  ring the computer.
 */
import { router } from 'expo-router';
import { callAvailable, onCallEvent } from '../modules/call';
import { ensureMic } from './voice';
import { client } from './ws';

let started = false;

export function startIncomingCalls(): void {
  if (!callAvailable || started) return;
  started = true;

  // The token has to reach the Mac before the first call, not during one, so
  // it goes up the moment iOS hands it over. An empty string means iOS
  // invalidated it and nothing can be delivered until a new one arrives —
  // worth clearing, or the daemon rings a number that no longer exists.
  onCallEvent('onVoipToken', ({ token }) => {
    void client.call('device.prefs', { voip_token: token }).catch(() => {});
  });

  // Answering is the only point where this hands over: the system call screen
  // is already up, the audio session is already ours, and everything after is
  // the ordinary call screen.
  onCallEvent('onCallAnswered', () => {
    router.push('/call');
  });
}

/** Microphone and speech recognition, asked for before the first call rather
 *  than during one — a permission sheet on top of a ringing phone is a call
 *  that cannot be answered. */
export async function prepareForCalls(): Promise<boolean> {
  return ensureMic();
}
