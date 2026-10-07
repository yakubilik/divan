import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { ExpoSpeechRecognitionModule } from '@jamsch/expo-speech-recognition';
import { getLocales } from 'expo-localization';
import * as ema from './ema';
import { createSpeaker, isTurkish } from './tts/speaker';

/** Speech in and speech out, both on the phone.
 *
 *  Nothing audible ever crosses the network. The phone recognises what you said
 *  and sends the daemon a sentence; the daemon sends a sentence back and the
 *  phone reads it. That is why a call needs no WebRTC, no codec and no jitter
 *  buffer — by the time the bytes travel they are just text on the socket the
 *  app already had open.
 *
 *  Half duplex on purpose: the microphone is closed before anything is spoken.
 *  With both open the phone hears its own voice and answers itself. Cutting in
 *  is a tap, not a shout — see the call screen. */

/** What language a call is held in.
 *
 *  Not the interface language — the app ships in English, and the person
 *  holding the phone does not necessarily talk to it in English. The phone's
 *  own first locale is the closest thing to the truth here, and it is what the
 *  keyboard and dictation already use. */
export function locale(tag?: string): string {
  if (tag) return tag;
  const first = getLocales()[0];
  return first?.languageTag || 'en-US';
}

export async function ensureMic(): Promise<boolean> {
  try {
    const r = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return !!r.granted;
  } catch {
    return false;
  }
}

export function startListening(lang: string) {
  ExpoSpeechRecognitionModule.start({
    lang: locale(lang),
    // The screen shows the words as they land, so a long pause still looks
    // alive — and they are also how the call knows you have stopped talking.
    interimResults: true,
    // Continuous, because iOS's own end-of-speech takes about three seconds.
    // Three seconds of silence is not a pause in a conversation, it is the
    // other person having hung up. The call times the gap itself instead, at
    // roughly the length of a breath.
    continuous: true,
    addsPunctuation: true,
    // Recognition quality matters more here than keeping audio off Apple's
    // servers: the questions are full of project names the on-device model has
    // never seen. The audio is a question about a build, not the work itself.
    requiresOnDeviceRecognition: false,
    // Words the recogniser would otherwise spell as something else entirely.
    contextualStrings: ['Claude', 'Codex', 'daemon', 'commit', 'build', 'deploy',
                        'branch', 'merge', 'TestFlight', 'Xcode', 'Expo'],
    iosCategory: CALL_SESSION,
  });
}

/** The session a phone call wants: speaker by default, and `voiceChat`,
 *  which is what turns on the echo cancellation. Without it the microphone
 *  hears the answer being read out and the call starts interrupting itself.
 *  `playAndRecord` is also what keeps a call audible with the silent switch on. */
const CALL_SESSION: Parameters<typeof ExpoSpeechRecognitionModule.setCategoryIOS>[0] = {
  category: 'playAndRecord',
  categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
  mode: 'voiceChat',
};

/** Put the call's session in place before EMA plays. Through the recogniser
 *  rather than expo-audio's setAudioModeAsync, which has no `voiceChat` or
 *  `defaultToSpeaker` and resets every field it is not given — the answer
 *  would come out of the earpiece, or not at all on silent. */
function callSession() {
  if (Platform.OS !== 'ios') return;
  try { ExpoSpeechRecognitionModule.setCategoryIOS(CALL_SESSION); } catch {}
}

export function stopListening() {
  try { ExpoSpeechRecognitionModule.stop(); } catch {}
}

/** Drop the microphone now and throw away whatever was half-heard. `stop()`
 *  asks for a final result; ending a call does not want one. */
export function abortListening() {
  try { ExpoSpeechRecognitionModule.abort(); } catch {}
}

/** Which voice answers the phone.
 *
 *  Not hardcoded, because the good ones are optional downloads: iOS ships a
 *  compact voice and keeps the "Enhanced" one behind Settings → Accessibility →
 *  Spoken Content → Voices. Asking the phone what it actually has and ranking
 *  that is the difference between a considered choice and a broken identifier.
 *
 *  For English the target is Daniel — en-GB, male, unhurried. It is the closest
 *  thing Apple ships to the butler everyone has in mind, and unlike a cloned
 *  voice it costs nothing, runs on the phone and belongs to nobody.
 *
 *  Turkish has one voice, Yelda, and she is female. There is no Turkish butler
 *  to pick, so the ranking below quietly does the only thing it can. */
const WANTED: Record<string, string[]> = {
  en: ['daniel', 'oliver', 'arthur', 'serena'],
  tr: ['yelda'],
};

/** iOS ships three grades of voice and `expo-speech` can only report two: its
 *  native side maps anything that is not `.enhanced` to "Default", which files
 *  a freshly downloaded **Premium** voice — the best one there is — under the
 *  same label as the tinny built-in. Ranking on that field would have thrown
 *  away the voice somebody had just gone and installed.
 *
 *  The identifier does not lie. Apple builds it as
 *  `com.apple.voice.<grade>.<lang>.<Name>`, so the grade is read from there. */
export function grade(v: Speech.Voice): 'premium' | 'enhanced' | 'compact' {
  const id = (v.identifier || '').toLowerCase();
  if (id.includes('premium')) return 'premium';
  if (id.includes('enhanced') || v.quality === Speech.VoiceQuality.Enhanced) return 'enhanced';
  return 'compact';
}

const GRADE_SCORE = { premium: 90, enhanced: 60, compact: 0 };

const picked: Partial<Record<string, Speech.Voice | null>> = {};
let override: Partial<Record<string, string>> = {};

/** The chosen voice wins over anything this file thinks it knows. */
export function setVoicePrefs(ids: Partial<Record<string, string>>) {
  override = ids || {};
  for (const k of Object.keys(picked) as string[]) delete picked[k];
}

function score(v: Speech.Voice, lang: string): number {
  const base = locale(lang).slice(0, 2).toLowerCase();
  const vl = (v.language || '').toLowerCase().replace('_', '-');
  if (!vl.startsWith(base)) return -1;
  let n = GRADE_SCORE[grade(v)];
  if (base === 'en' && vl.startsWith('en-gb')) n += 20;
  const idx = (WANTED[base] || []).indexOf((v.name || '').toLowerCase());
  if (idx >= 0) n += 15 - idx * 4;
  return n;
}

/** Every voice on the phone, the ones for this language first.
 *
 *  Filtering to the app's language hid the Turkish voices from somebody running
 *  the app in English — who is exactly the person who asks a question in
 *  Turkish and wants it answered in a Turkish voice. The language a call is
 *  held in is not the language the menus are in. */
export async function listVoices(lang: string): Promise<Speech.Voice[]> {
  const base = locale(lang).slice(0, 2).toLowerCase();
  const mine = (v: Speech.Voice) =>
    (v.language || '').toLowerCase().replace('_', '-').startsWith(base);
  try {
    const all = await Speech.getAvailableVoicesAsync();
    return all.sort((a, b) => {
      if (mine(a) !== mine(b)) return mine(a) ? -1 : 1;
      if (a.language !== b.language) return a.language.localeCompare(b.language);
      return score(b, lang) - score(a, lang) || a.name.localeCompare(b.name);
    });
  } catch {
    return [];
  }
}

export async function pickVoice(lang: string): Promise<Speech.Voice | null> {
  if (picked[lang] !== undefined) return picked[lang] ?? null;
  let best: Speech.Voice | null = null;
  try {
    const all = await Speech.getAvailableVoicesAsync();
    const chosen = override[lang];
    if (chosen) best = all.find((v) => v.identifier === chosen) ?? null;
    if (!best) {
      let top = 0;
      for (const v of all) {
        const n = score(v, lang);
        if (n > top) { top = n; best = v; }
      }
    }
  } catch {
    best = null;
  }
  picked[lang] = best;
  return best;
}

/** Apple already puts the grade in the name of the ones you download — "Ava
 *  (Premium)" — so appending ours produced "Ava (Premium) (premium)". Only say
 *  it when the name has not said it already. */
function withGrade(v: Speech.Voice): string {
  const g = grade(v);
  return v.name.toLowerCase().includes(g) ? v.name : `${v.name} (${g})`;
}

export function voiceName(lang: string): string | null {
  if (emaWanted(lang)) return EMA_NAME;
  const v = picked[lang];
  return v ? withGrade(v) : null;
}

export function label(v: Speech.Voice): string {
  return `${withGrade(v)} · ${v.language.replace('_', '-')}`;
}

function systemSpeak(text: string, lang: string, onDone: () => void) {
  Speech.speak(text, {
    voice: picked[lang]?.identifier,
    language: locale(lang),
    // Slightly under the default: the answers are dense, and a status read at
    // full speed has to be asked for twice. It also reads as composure rather
    // than as a machine getting through a queue.
    rate: 0.96,
    onDone,
    onStopped: onDone,
    onError: onDone,
  });
}

// ── EMA, the Turkish voice made on the phone ─────────────────────────────────
/** Turkish answers are read by EMA Lightning (src/ema.ts) once it is loaded,
 *  and by the system voice when it is not, when the person has switched it off,
 *  or — for that one answer — when it fails or has not made a sound within
 *  1.5 s. Every other language is the system voice. The choice is
 *  src/tts/speaker.ts; nothing of it leaves the phone. */
export const EMA_NAME = 'EMA';
/** Said when EMA is picked, in the language it speaks. */
export const EMA_SAMPLE = 'Cevaplarını bu sesle okuyacağım.';

let emaOn = true;

export function setEmaEnabled(on: boolean) { emaOn = on; }

/** This build can read Turkish with EMA (files and native module present, nothing failed). */
export function emaAvailable(): boolean { return ema.available(); }

/** Turkish, switched on and available: the voice the next answer is meant to be read in. */
export function emaWanted(lang: string): boolean {
  return isTurkish(locale(lang)) && emaOn && ema.available();
}

/** Load EMA ahead of the first answer. Never throws. */
export function warmEma(): Promise<boolean> { return ema.warm(); }

export function emaStats() { return { ...ema.status(), ...speaker.stats() }; }

const speaker = createSpeaker({
  ema: () => ema.voice(),
  enabled: () => emaOn,
  player: () => ema.player(callSession),
  system: { speak: systemSpeak, stop: () => { try { Speech.stop(); } catch {} } },
  log: (line) => console.log(line),
});

/** Read `text` aloud; `onDone` once, when it has been heard or was stopped. */
export function speak(text: string, lang: string, onDone: () => void) {
  speaker.speak(text, locale(lang), onDone);
}

/** Silence now, whichever voice is talking, and stop making what has not been made yet. */
export function stopSpeaking() {
  speaker.stop();
}

// ── the sound of a call ───────────────────────────────────────────────────────
/** A call that begins with a synthesised voice saying hello begins nowhere: you
 *  have no idea whether it is connecting, whether it heard you, whether there is
 *  a line at all. Two sounds fix that, and they are the ones every phone has
 *  trained everyone to read — the ringback while it dials, the click when the
 *  other end picks up.
 *
 *  The ring is also honest about time rather than filling it: the daemon is
 *  warming the model session while it plays, so the first question afterwards
 *  answers in about a second instead of four. */
const RING_MS = 2000;      // ring.wav, synthesised at 425 Hz — European ringback
const PICKUP_MS = 90;      // pickup.wav

function playOnce(mod: number, ms: number, volume: number): Promise<void> {
  return new Promise((resolve) => {
    let player: AudioPlayer | null = null;
    const done = () => {
      try { player?.remove(); } catch {}
      player = null;
      resolve();
    };
    try {
      player = createAudioPlayer(mod);
      player.volume = volume;
      player.play();
    } catch {
      resolve();
      return;
    }
    // The clips are ours and their lengths are known, so the end is a timer
    // rather than a status subscription — one less thing to leak if the screen
    // is closed mid-ring.
    setTimeout(done, ms);
  });
}

export function ring(): Promise<void> {
  return playOnce(require('../assets/sound/ring.wav'), RING_MS, 0.5);
}

export function pickup(): Promise<void> {
  return playOnce(require('../assets/sound/pickup.wav'), PICKUP_MS, 0.6);
}
