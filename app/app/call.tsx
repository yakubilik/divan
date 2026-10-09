import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useSpeechRecognitionEvent } from '@jamsch/expo-speech-recognition';
import { useStore, useT } from '../src/store';
import { errText } from '../src/i18n';
import { live as liveApi } from '../src/live-call';
import type { Snapshot, VoiceSession } from '../src/voice-session';
import { client } from '../src/ws';
import { useColors, type Palette } from '../src/theme';
import { Text } from '../src/components/ui';
import { abortListening, EMA_SAMPLE, emaAvailable, emaStats, ensureMic, label as voiceLabel, listVoices, locale as voiceLocale, pickVoice, pickup, ring, setEmaEnabled, setVoicePrefs, speak, startListening, stopListening, stopSpeaking, voiceName, warmEma } from '../src/voice';
import { isTurkish } from '../src/tts/speaker';
import { callLines, chatCallLines, yesNo } from '../src/call-lines';
import { Switch } from '../src/components/divan';
import type * as Speech from 'expo-speech';

type Phase = 'idle' | 'dialling' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'working' | 'reconnecting';

/** The streaming call's state as the screen shows it. Every one but `starting` and `ended` is the daemon's
 *  own `voice.state` (or the socket being down), so what the screen says is what the session is doing. */
const LIVE_PHASE: Record<Snapshot['state'], Phase> = {
  idle: 'idle', starting: 'dialling', listening: 'listening', hearing: 'hearing', thinking: 'thinking',
  speaking: 'speaking', working: 'working', reconnecting: 'reconnecting', ended: 'idle',
};
type Line = { id: number; who: 'you' | 'them'; text: string };

/** How long a gap in the talking means "your turn". iOS's own end-of-speech is
 *  about three seconds, which in a conversation reads as the line going dead;
 *  this is roughly the length of a breath. Too short and it cuts you off
 *  mid-thought, so it is measured from the last word actually recognised. */
const SILENCE_MS = 800;

/** Leaving the microphone open through the answer so you can talk over it.
 *
 *  Off, and it stays off until somebody can test it with real speakers. Echo
 *  cancellation removed most of the phone's own voice but not all of it, and
 *  continuous recognition hands back one growing transcript — so two passes of
 *  the same leaked sentence arrived as "that did not go through that did not go
 *  through", which matches no single thing that was said and therefore read as
 *  a person interrupting. It was sent, it failed, the failure was read out, the
 *  microphone heard that too, and the call talked to itself until it was
 *  closed.
 *
 *  Half duplex has none of that failure mode: nothing can be heard while
 *  anything is being said. Cutting in costs a tap, which is a price worth
 *  paying for a call that cannot get stuck in a loop. */
const BARGE_IN = false;

/** How long to let the speaker settle before believing the microphone again.
 *
 *  `onDone` fires when the synthesiser has finished producing the audio, not
 *  when the room has finished hearing it — and a Premium voice through a phone
 *  speaker carries. Three hundred milliseconds was not enough. */
const AFTER_SPEECH_MS = 600;

/** How long a call from inside a chat waits on one turn before giving up on it.
 *  The turn itself goes on in the chat either way; this is only how long the
 *  phone stays quiet before saying it did not hear back. */
const TURN_MAX_MS = 15 * 60 * 1000;

type TurnEnd = 'done' | 'error' | 'gone';

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** What is left of `heard` once everything traceable to `spoken` is taken out.
 *
 *  Not a single match: a leak can arrive twice over. The first attempt asked
 *  whether the whole heard string appeared inside the spoken one, which is true
 *  for one pass of echo and false for two — so "that did not go through that
 *  did not go through" read as a person talking, was sent, failed, was read out
 *  again, and the call fed on itself.
 *
 *  This walks the words instead, swallowing any run that still appears in what
 *  was said, however many runs there are. What survives is the part nothing
 *  accounts for, which is the only part a person can have contributed. */
function residue(heard: string, spoken: string): string {
  const sp = norm(spoken);
  const words = heard.split(/\s+/).filter(Boolean);
  if (!sp) return words.join(' ');
  const kept: string[] = [];
  let i = 0;
  while (i < words.length) {
    let run = '';
    let last = -1;
    for (let j = i; j < words.length; j++) {
      const next = run + norm(words[j]);
      if (!next || !sp.includes(next)) break;
      run = next;
      last = j;
    }
    if (last >= i) i = last + 1;            // that run came out of the speaker
    else kept.push(words[i++]);
  }
  return kept.join(' ');
}

/** Nothing survives that the phone did not say itself. */
function isEcho(heard: string, spoken: string): boolean {
  if (!norm(heard)) return true;
  if (!norm(spoken)) return false;          // nothing was said; it cannot be echo
  return norm(residue(heard, spoken)).length < 4;
}

/** Echo while waiting on a yes or a no: most of the question, heard back. */
function echoOfQuestion(heard: string, spoken: string): boolean {
  const h = norm(heard);
  const sp = norm(spoken);
  return !h || (sp.includes(h) && h.length * 2 >= sp.length);
}

/** Your words with the leaked ones taken off the front. */
function stripEcho(heard: string, spoken: string): string {
  return residue(heard, spoken) || heard;
}

/** The call.
 *
 *  Two of them share this screen. Opened from the chat list it is the general
 *  call: questions go to the concierge (`call.ask`). Opened from a chat it
 *  carries that chat's id and talks to that chat: every utterance is sent with
 *  `chat.send`, as if it had been typed, so it is a turn of that session on its
 *  own model, account and permission mode, and both sides stay in the
 *  transcript. What is read back is the short form of the reply (`call.reply`);
 *  the whole of it is in the chat.
 *
 *  One turn is: listen until you stop talking, ask the daemon, read the answer
 *  out, listen again. The loop is deliberate — a call that has to be poked for
 *  every sentence is a walkie-talkie, and the whole point of this screen is to
 *  be able to put the phone to your ear while walking.
 *
 *  It is half duplex. The microphone closes before anything is spoken, because
 *  with both ends open the phone hears its own voice and talks to itself.
 *  Cutting in is a tap on the big button, which is also how you end a silence
 *  iOS has not decided is over yet. */
export default function Call() {
  const c = useColors();
  const styles = useMemo(() => mkStyles(c), [c]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  // The call is held in the phone's own language, not the interface's.
  const lang = voiceLocale();
  const conn = useStore((s) => s.conn);
  // Set when the call was placed from inside a chat; the general call has none.
  const { chat: chatId } = useLocalSearchParams<{ chat?: string }>();
  const chatTitle = useStore((s) => (chatId ? s.chats?.[chatId]?.title : null));

  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [voice, setVoice] = useState<string | null>(null);
  const [voices, setVoices] = useState<Speech.Voice[] | null>(null);
  const prefs = useStore((st) => st.prefs);
  const setPrefs = useStore((st) => st.setPrefs);

  // The recogniser's last words, kept outside React: the `end` event fires
  // before a queued state update lands, and reading a stale transcript there
  // sent the daemon the *previous* question.
  const transcript = useRef('');
  const phaseRef = useRef<Phase>('idle');
  const live = useRef(false);            // the call is up (not the mic)
  const scroller = useRef<ScrollView | null>(null);
  const nextId = useRef(1);
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speaking = useRef('');            // what is being read out right now
  const micOn = useRef(false);
  // Set while we are the ones closing the microphone to send a question, so the
  // `end` that follows is not mistaken for the recogniser giving up on its own.
  const sending = useRef(false);
  /** Every close we perform ourselves still comes back as `end`, and an abort
   *  as an `aborted` error on top of it. Both handlers exist to reopen a
   *  microphone that died unexpectedly — so without a way to tell our own close
   *  from a real one they reopened the one we had just closed on purpose, three
   *  `startListening` calls raced, and recognition returned nothing at all. */
  const closedAt = useRef(0);
  // `armSilence` is defined above `send` and closes over it; going through a
  // ref is what keeps that from being a use-before-declaration.
  const sendRef = useRef<() => void>(() => {});
  // Last thing read out, and last thing sent. Both are here to break loops: a
  // call that talks to itself does it by sending back what it just said, or by
  // sending the same thing twice.
  const lastSpoken = useRef('');
  const lastAsked = useRef('');
  const failures = useRef(0);
  const hangUpRef = useRef<() => void>(() => {});
  // A call from inside a chat: how to end the turn being waited on, the
  // approval asked aloud (`asked` once the question has been said), and the
  // lines said while the turn runs, kept in order.
  const turnEnd = useRef<((how: TurnEnd) => void) | null>(null);
  const approval = useRef<{ id: string; asked: boolean } | null>(null);
  const voiceQueue = useRef<Promise<void>>(Promise.resolve());
  const pulse = useRef(new Animated.Value(0)).current;
  // The streaming call (src/voice-session.ts), when this build and the computer both have it. Everything
  // below that is about recognisers, silence timers and echo is the older half-duplex call, kept for a
  // build without the native engine or a computer without `voice.start`.
  const liveCall = useRef<VoiceSession | null>(null);
  const heardByTurn = useRef(new Map<number, { text: string; final: boolean }>());
  const [latency, setLatency] = useState<number | null>(null);

  // The stored choice has to reach the voice module before anything is spoken.
  useEffect(() => { setVoicePrefs(prefs.voiceIds ?? {}); }, [prefs.voiceIds]);

  useEffect(() => { setEmaEnabled(!prefs.emaOff); setVoice(voiceName(lang)); }, [prefs.emaOff, lang]);

  useEffect(() => { void pickVoice(lang).then(() => setVoice(voiceName(lang))); }, [lang]);

  // EMA, the Turkish voice made on the phone, loads when the call screen opens
  // rather than at app start: it is some 35 MB of model and only a call needs it.
  // Until it is ready, and in a build without it, the system voice reads.
  const [emaState, setEmaState] = useState<'loading' | 'ready' | 'off'>(
    isTurkish(lang) && emaAvailable() ? 'loading' : 'off');
  useEffect(() => {
    if (!isTurkish(lang) || !emaAvailable()) return;
    let gone = false;
    void warmEma().then((ok) => {
      if (gone) return;
      setEmaState(ok ? 'ready' : 'off');
      setVoice(voiceName(lang));
    });
    return () => { gone = true; };
  }, [lang]);

  const pickEma = useCallback(async (on: boolean) => {
    await setPrefs({ emaOff: !on });
    setEmaEnabled(on);
    setVoice(voiceName(lang));
    if (on) { setVoices(null); speak(EMA_SAMPLE, lang, () => {}); }
  }, [lang, setPrefs]);

  const chooseVoice = useCallback(async (v: Speech.Voice) => {
    // Picking a system voice for Turkish is choosing it over EMA.
    const emaOff = isTurkish(lang) ? true : prefs.emaOff;
    await setPrefs({ voiceIds: { ...(prefs.voiceIds ?? {}), [lang]: v.identifier }, emaOff });
    setEmaEnabled(!emaOff);
    setVoicePrefs({ ...(prefs.voiceIds ?? {}), [lang]: v.identifier });
    await pickVoice(lang);
    setVoice(voiceName(lang));
    setVoices(null);
    // Say something in it, so the choice is made by ear and not by name.
    speak(T('callVoiceTry'), lang, () => {});
  }, [lang, prefs.voiceIds, prefs.emaOff, setPrefs, T]);

  const setPhaseBoth = useCallback((p: Phase) => { phaseRef.current = p; setPhase(p); }, []);

  const say = useCallback((who: 'you' | 'them', text: string) => {
    setLines((prev) => [...prev, { id: nextId.current++, who, text }]);
  }, []);

  /** The only way anything is spoken.
   *
   *  Two refs held the same idea — what is being said now, and what was said
   *  last — and they were written in different places. The greeting set one and
   *  not the other, so the echo guard at send time had nothing to compare the
   *  greeting's own echo against, decided it could not be echo, and sent it as a
   *  question. That is the first thing that happens on every call, which is why
   *  the loop started before a word was ever spoken to it.
   *
   *  Speaking and recording what was spoken are now one action, so they cannot
   *  come apart again. `record` is for the case where a second sentence follows
   *  a first and both are still in the air. */
  const sayAloud = useCallback((text: string, onDone: () => void, record?: string) => {
    const heardable = record ?? text;
    speaking.current = heardable;
    lastSpoken.current = heardable;
    speak(text, lang, onDone);
  }, [lang]);

  const hush = useCallback(() => {
    if (silence.current) { clearTimeout(silence.current); silence.current = null; }
  }, []);

  /** Close the microphone on purpose. Counts the events it is about to cause so
   *  the handlers know to let them pass. */
  const closeMic = useCallback((mode: 'stop' | 'abort') => {
    if (!micOn.current) return;
    micOn.current = false;
    // A window, not a count: a close raises `end` and sometimes an `aborted`
    // error too, and counting a fixed number would swallow the next real
    // failure whenever it raised fewer.
    closedAt.current = Date.now();
    if (mode === 'stop') stopListening();
    else abortListening();
  }, []);

  /** True when this event is one we caused. */
  const ours = useCallback(() => Date.now() - closedAt.current < 600, []);

  /** Start (or restart) the countdown to "you have stopped talking". Every
   *  recognised word pushes it back, so it only ever fires on a real gap. */
  const armSilence = useCallback(() => {
    hush();
    silence.current = setTimeout(() => {
      if (!live.current || phaseRef.current !== 'listening') return;
      if (!transcript.current.trim()) { armSilence(); return; }   // nobody said anything yet
      sendRef.current();
    }, SILENCE_MS);
  }, [hush]);

  /** Open the microphone for a fresh turn.
   *
   *  It may already be open: it stays on through the answer so you can cut in,
   *  and whatever it collected then is echo. Aborting first throws that away —
   *  `abort` rather than `stop`, because `stop` would hand us the echo as a
   *  final result. The native side needs a beat between the two. */
  const listen = useCallback(() => {
    if (!live.current) return;
    transcript.current = '';
    speaking.current = '';
    setHeard('');
    setPhaseBoth('listening');
    const go = () => {
      if (!live.current) return;
      startListening(lang);
      micOn.current = true;
      armSilence();
    };
    if (micOn.current) {
      closeMic('abort');
      setTimeout(go, 120);
    } else {
      setTimeout(go, AFTER_SPEECH_MS);
    }
  }, [lang, setPhaseBoth, armSilence, closeMic]);

  // ── the recogniser ───────────────────────────────────────────────────────
  useSpeechRecognitionEvent('result', (e) => {
    const said = e.results?.[0]?.transcript ?? '';
    if (!said) return;

    // Heard while the answer is still being read out: either the phone hearing
    // itself, or you cutting in.
    if (phaseRef.current === 'speaking') {
      if (!BARGE_IN || isEcho(said, speaking.current)) return;
      const mine = stripEcho(said, speaking.current);
      stopSpeaking();
      transcript.current = mine;
      setHeard(mine);
      setPhaseBoth('listening');
      armSilence();
      return;
    }

    if (phaseRef.current !== 'listening') return;
    transcript.current = said;
    setHeard(said);
    armSilence();
  });

  useSpeechRecognitionEvent('error', (e) => {
    if (ours()) return;
    if (!live.current) return;
    // The microphone is open through the answer as well, and hearing nothing
    // while the phone talks is the normal case, not a fault. Reopening here
    // would put the call into listening on top of its own voice.
    if (phaseRef.current === 'speaking') { micOn.current = false; return; }
    // A pause, or a session we aborted ourselves on the way to the next turn.
    if (e.error === 'no-speech' || e.error === 'aborted') { listen(); return; }
    setNote(T('callMicError'));
    setPhaseBoth('idle');
    live.current = false;
  });

  useSpeechRecognitionEvent('end', () => {
    micOn.current = false;
    if (ours()) return;
    if (sending.current) { sending.current = false; return; }
    if (!live.current) return;
    // iOS stopped of its own accord — a long silence, a route change, the app
    // coming back. On a call that is not the end of anything, so reopen it.
    if (phaseRef.current === 'listening') listen();
  });

  // ── a call from inside a chat ────────────────────────────────────────────
  /** Say a line while a chat's turn is running, after whatever is already
   *  being said. `phase` is what the screen shows while it is said: a question
   *  is 'speaking', so a tap cuts in to answer it; the 'looking' line leaves
   *  the call 'thinking'. */
  const sayInTurn = useCallback((text: string, phase: Phase = 'thinking') => {
    const next = voiceQueue.current.then(() => new Promise<void>((done) => {
      if (!live.current) { done(); return; }
      setPhaseBoth(phase);
      say('them', text);
      sayAloud(text, done);
    }));
    voiceQueue.current = next;
    return next;
  }, [say, sayAloud, setPhaseBoth]);

  /** The approval the chat is waiting on, asked aloud. The answer is the next
   *  thing heard (see `send`). A destructive request is said and left to the
   *  app, the same rule the general call keeps. */
  const askApproval = useCallback(async (d: any) => {
    const lines = chatCallLines(lang);
    if (d?.input?.kind === 'mcp_elicitation' || d?.input?.kind === 'user_input') {
      approval.current = null;
      await sayInTurn(lines.structured);
      return;
    }
    if (d?.danger) { await sayInTurn(lines.dangerous); return; }
    approval.current = { id: d?.request_id, asked: false };
    await sayInTurn(lines.approval(d?.tool || ''), 'speaking');
    if (!live.current || approval.current?.id !== d?.request_id) return;
    approval.current.asked = true;
    // A second "yes" in a row is a second answer, not the echo of the first.
    lastAsked.current = '';
    listen();
  }, [lang, sayInTurn, listen]);

  /** Answered somewhere — by voice, in the app, or by the timeout. */
  const settleApproval = useCallback(() => {
    approval.current = null;
    if (phaseRef.current === 'listening') {
      hush();
      closeMic('abort');
      setHeard('');
      setPhaseBoth('thinking');
    }
  }, [hush, closeMic, setPhaseBoth]);

  /** Follow one turn of the chat until it is over. The phone sees every event
   *  of every chat; this listens to the one it called. Once per turn, at the
   *  first tool, it says it is looking rather than going quiet. */
  const followTurn = useCallback((id: string) => new Promise<TurnEnd>((resolve) => {
    const lines = chatCallLines(lang);
    let looked = false;
    let failed = false;
    let over = false;
    const finish = (how: TurnEnd) => {
      if (over) return;
      over = true;
      off();
      offStatus();
      clearTimeout(timer);
      if (turnEnd.current === finish) turnEnd.current = null;
      approval.current = null;
      resolve(how);
    };
    const off = client.on((ev) => {
      if (ev.chat_id !== id) return;
      const d: any = ev.data || {};
      if (ev.event === 'tool.use' && !looked) { looked = true; void sayInTurn(lines.looking); }
      else if (ev.event === 'approval.request') void askApproval(d);
      else if (ev.event === 'approval.resolved') { if (approval.current?.id === d.request_id) settleApproval(); }
      else if (ev.event === 'turn.error') failed = true;
      // Idle is the end of the turn and of anything queued behind it: the
      // moment a typed message would have been answered too.
      else if (ev.event === 'chat.updated' && d.status === 'idle') finish(failed ? 'error' : 'done');
    });
    // Events missed while the socket was down are not replayed here, so a
    // reconnect asks whether the chat is still at it.
    const offStatus = client.onStatus((st) => {
      if (st !== 'online') return;
      void client.call<{ busy?: boolean }>('chat.history', { chat_id: id, limit: 1 })
        .then((h) => { if (h && !h.busy) finish(failed ? 'error' : 'done'); }).catch(() => {});
    });
    const timer = setTimeout(() => finish('error'), TURN_MAX_MS);
    turnEnd.current = finish;
  }), [lang, sayInTurn, askApproval, settleApproval]);

  /** One utterance as a turn of the chat; the spoken form of its reply. */
  const askChat = useCallback(async (id: string, question: string): Promise<string> => {
    // Listening starts before sending, so a turn that ends at once is not missed.
    const ended = followTurn(id);
    try {
      await client.call('chat.send', { chat_id: id, text: question });
    } catch (err) {
      turnEnd.current?.('gone');
      throw err;
    }
    const how = await ended;
    if (how === 'gone') return '';
    if (how === 'error') throw new Error('turn failed');
    const r = await client.call<{ text: string }>('call.reply', { chat_id: id, lang });
    await voiceQueue.current;          // the 'looking' line, or an "okay", finishes first
    return r?.text || '';
  }, [followTurn, lang]);

  /** A spoken answer to the approval question: yes allows, no denies, and
   *  anything else asks again. */
  const answerApproval = useCallback(async (said: string) => {
    const a = approval.current;
    if (!a || !chatId) return;
    const lines = chatCallLines(lang);
    say('you', said);
    setHeard('');
    const yes = yesNo(said);
    if (yes === null) {
      lastAsked.current = '';
      setPhaseBoth('speaking');
      say('them', lines.yesOrNo);
      sayAloud(lines.yesOrNo, () => { if (live.current && phaseRef.current === 'speaking') listen(); });
      return;
    }
    approval.current = null;
    setPhaseBoth('thinking');
    try {
      await client.call('approval.respond', { chat_id: chatId, request_id: a.id, decision: yes ? 'allow' : 'deny' });
    } catch {
      // Answered in the app in the meantime; the turn goes on either way.
    }
    void sayInTurn(yes ? lines.allowed : lines.denied);
  }, [chatId, lang, say, setPhaseBoth, sayAloud, listen, sayInTurn]);

  const ask = useCallback(async (question: string) => {
    say('you', question);
    setHeard('');
    setPhaseBoth('thinking');
    let answer: string;
    let failed = false;
    try {
      if (chatId) {
        answer = (await askChat(chatId, question)).trim();
      } else {
        // The phone transcribed it, so the phone knows which language it was —
        // the daemon would otherwise take its cue from the snapshot, which is
        // mostly Turkish, and answer English questions in Turkish.
        const r = await client.call<{ text: string }>('call.ask', { text: question, lang });
        answer = (r?.text || '').trim();
      }
    } catch (err: any) {
      failed = true;
      answer = err?.code === 'offline' ? T('callOffline') : T('callFailed');
    }
    if (!live.current) return;
    // Three failures in a row is a computer that is not going to answer, and
    // reading the same apology out on a loop helps nobody.
    if (failed) {
      failures.current += 1;
      if (failures.current >= 3) {
        setNote(answer);
        hangUpRef.current();
        return;
      }
    } else {
      failures.current = 0;
    }
    if (!answer) { listen(); return; }
    say('them', answer);
    setPhaseBoth('speaking');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // The microphone goes back on *before* the answer starts, and stays on
    // through it. That is the whole of cutting in: there is no button to find,
    // you just talk, and the `result` handler decides whether what it heard was
    // you or the phone hearing itself.
    if (BARGE_IN && !micOn.current) {
      startListening(lang);
      micOn.current = true;
    }
    sayAloud(answer, () => {
      if (!live.current || phaseRef.current !== 'speaking') return;
      listen();
    });
  }, [chatId, askChat, lang, listen, say, sayAloud, setPhaseBoth, T]);

  /** Your turn is over: close the microphone and put the question on the wire.
   *
   *  Two things are refused here rather than sent. Anything that is a piece of
   *  what was just read out is the phone hearing itself, however it got in —
   *  the microphone should have been shut, echo cancellation should have caught
   *  it, and this is the last place to notice before it becomes a question.
   *  Asking the same thing twice in a row is the same fault one step later.
   *  Either way the turn is dropped and the call goes back to listening, which
   *  is what a person would do having heard nothing. */
  const send = useCallback(() => {
    const said = transcript.current.trim();
    if (!said || !live.current) return;
    hush();
    // The answer to an approval question is usually one short word, which the
    // general echo rule (fewer than four letters of your own) would throw away
    // — and "Yes or no?" contains both answers. There, echo is hearing a good
    // half of the question back, which a one-word answer never is.
    const answering = !!approval.current?.asked;
    const echo = answering ? echoOfQuestion(said, lastSpoken.current) : isEcho(said, lastSpoken.current);
    if (echo || norm(said) === norm(lastAsked.current)) {
      transcript.current = '';
      setHeard('');
      armSilence();
      return;
    }
    sending.current = true;
    closeMic('stop');
    // A chat waiting on an approval that was asked aloud: this is the answer.
    if (answering) { void answerApproval(said); return; }
    lastAsked.current = said;
    void ask(said);
  }, [hush, ask, answerApproval, closeMic, armSilence]);

  // Kept current on every render rather than in an effect: the silence timer
  // that calls it can fire before effects have run.
  sendRef.current = send;

  // ── call control ─────────────────────────────────────────────────────────
  /** The screen from the session: its state, what it heard per turn and what it said. A turn the daemon
   *  replaced (the caller went on talking) keeps neither its half-heard words nor its dropped answer. */
  const onLive = useCallback((sn: Snapshot, s: VoiceSession) => {
    setPhaseBoth(LIVE_PHASE[sn.state]);
    if (sn.heard) heardByTurn.current.set(sn.heard.turn, { text: sn.heard.text, final: sn.heard.final });
    const turns = new Set<number>([...heardByTurn.current.keys(), ...sn.said.map((p) => p.turn)]);
    const out: Line[] = [];
    let partial = '';
    for (const turn of [...turns].sort((a, b) => a - b)) {
      const h = heardByTurn.current.get(turn);
      if (h?.final) out.push({ id: turn * 2, who: 'you', text: h.text });
      else if (h && turn === sn.turn) partial = h.text;
      const said = sn.said.filter((p) => p.turn === turn && (turn === 0 || !s.isDead(turn) || s.heardOf(turn) > 0));
      if (said.length) {
        const text = turn === 0 ? callLines(lang).greeting : said.map((p) => p.text).join(' ');
        out.push({ id: turn * 2 + 1, who: 'them', text });
      }
    }
    setLines(out);
    setHeard(partial);
    const last = [...s.timings.values()].filter((t) => t.endToAudible != null).pop();
    if (last) setLatency(last.endToAudible);
    if (sn.error) setNote(errText(sn.error.code, sn.error.message));
    if (sn.ended && sn.ended !== 'hangup' && sn.ended !== 'unsupported') {
      setNote(T(sn.ended === 'denied' ? 'callNoMic' : sn.ended === 'dropped' ? 'callDropped' : 'callMicError'));
    }
    if (sn.state === 'ended') { live.current = false; liveCall.current = null; }
  }, [lang, setPhaseBoth, T]);

  /** Placing the streaming call: the same ring and pickup, then a session that listens all the time.
   *  False when the computer does not know `voice.start` — the older call takes over. */
  const startLive = useCallback(async (): Promise<boolean> => {
    if (!(await ensureMic())) { setNote(T('callNoMic')); return true; }
    setNote(null);
    setLatency(null);
    heardByTurn.current.clear();
    live.current = true;
    setPhaseBoth('dialling');
    // One voice for the whole call, chosen before the first word.
    const { voice: v, ema: onEma } = await liveApi.voice(lang, !prefs.emaOff);
    setVoice(onEma ? voiceName(lang) : v.name);
    if (isTurkish(lang) && !onEma && !prefs.emaOff && emaAvailable()) setNote(T('callSystemVoiceWhole'));
    await ring();
    if (!live.current) return true;
    await pickup();
    if (!live.current) return true;
    const s = liveApi.create(v);
    liveCall.current = s;
    s.subscribe((sn) => { if (liveCall.current === s || sn.state === 'ended') onLive(sn, s); });
    await s.start({ chatId: chatId || null, lang, client: liveApi.client(), greeting: callLines(lang).greetingSpoken });
    if (s.snapshot().ended === 'unsupported') {
      liveCall.current = null;
      live.current = false;
      return false;
    }
    return true;
  }, [chatId, lang, prefs.emaOff, onLive, setPhaseBoth, T]);

  /** Placing the call.
   *
   *  Ringback, then the click of somebody picking up, then a voice. Those two
   *  sounds are doing real work: they are how anyone who has ever used a phone
   *  already knows the line is connecting, that it went through, and that it is
   *  now their turn — none of which a synthesised "hello" out of silence says.
   *
   *  They also cost nothing. The first question to the concierge would take
   *  about four seconds cold, because the CLI sets itself up on its first
   *  query; `call.hello` starts that on the way past and the ringing covers it,
   *  so the first question lands in about a second like every other one. The
   *  greeting itself is spoken by the phone and never waits on the network. */
  const start = useCallback(async () => {
    if (liveApi.available() && (await startLive())) return;
    if (!(await ensureMic())) { setNote(T('callNoMic')); return; }
    setNote(null);
    live.current = true;
    failures.current = 0;
    lastSpoken.current = '';
    lastAsked.current = '';
    setPhaseBoth('dialling');
    // Cheap, cached, and done while it rings — the greeting is the first thing
    // spoken and it should already be in the right voice.
    await pickVoice(lang);
    setVoice(voiceName(lang));

    // Fired, not awaited, and its answer not used: this is what warms the model
    // session, and the ringing is what it warms behind. What is running is
    // not said at pickup; the model answers that when it is asked.
    // A call from inside a chat has no concierge to warm: it talks to the
    // chat's own session, which is already there.
    if (!chatId) void client.call('call.hello', {}).catch(() => {});

    // Ringing, then the click of the other end picking up, then the voice. The
    // microphone opens on the click and not before: a ringtone is not a
    // question, and the recogniser should never have to decide that.
    await ring();
    if (!live.current) return;
    await pickup();
    if (!live.current) return;

    const { greeting, greetingSpoken } = callLines(lang);
    setPhaseBoth('speaking');
    say('them', greeting);
    if (BARGE_IN) { startListening(lang); micOn.current = true; }

    // The greeting, then straight to listening. This runs on `onStopped` too,
    // which is what cutting in triggers — and cutting in has already opened the
    // microphone itself. The phase guard is what stops the greeting from
    // opening a second one on its way out.
    sayAloud(greetingSpoken, () => {
      if (live.current && phaseRef.current === 'speaking') listen();
    });
  }, [chatId, lang, listen, say, setPhaseBoth, startLive, T]);

  /** Hanging up stops listening and speaking, and nothing else: a turn still
   *  running goes on in the chat, exactly as a typed one would. */
  const hangUp = useCallback(() => {
    const s = liveCall.current;
    liveCall.current = null;
    if (s) void s.stop();
    live.current = false;
    turnEnd.current?.('gone');
    approval.current = null;
    voiceQueue.current = Promise.resolve();
    hush();
    closeMic('abort');
    stopSpeaking();
    setPhaseBoth('idle');
    setHeard('');
  }, [setPhaseBoth, hush, closeMic]);

  useEffect(() => { hangUpRef.current = hangUp; }, [hangUp]);

  /** The big button. What it does depends on what is happening — which is the
   *  point: there is only ever one thing you could want. */
  const tap = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (phase === 'idle') { void start(); return; }
    if (phase === 'dialling') return;                                // it is ringing; let it
    if (liveCall.current) return;                                    // a live call needs no button: just talk
    if (phase === 'speaking') { stopSpeaking(); listen(); return; }   // cut in
    if (phase === 'listening') { send(); return; }                    // send it now
  }, [phase, start, listen, send]);

  // Leaving the screen must not leave a microphone open behind it.
  // In the background the call keeps its microphone (the app has the audio background mode, as a phone
  // call does); if iOS stopped the engine anyway, it is started again when the app is back in front.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void liveCall.current?.foreground();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => () => {
    live.current = false;
    void liveCall.current?.stop();
    liveCall.current = null;
    turnEnd.current?.('gone');
    if (silence.current) clearTimeout(silence.current);
    abortListening();
    stopSpeaking();
  }, []);

  useEffect(() => {
    if (phase === 'listening' || phase === 'thinking' || phase === 'dialling' || phase === 'working' || phase === 'reconnecting') {
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]));
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(0);
  }, [phase, pulse]);

  const label = phase === 'idle' ? T('callStart')
    : phase === 'dialling' ? T('callDialling')
    : phase === 'listening' ? T('callListening')
    : phase === 'hearing' ? T('callHearing')
    : phase === 'thinking' ? T('callThinking')
    : phase === 'working' ? T('callWorking')
    : phase === 'reconnecting' ? T('callReconnecting')
    : T('callSpeaking');

  const hint = liveCall.current && phase !== 'idle' && phase !== 'dialling'
    ? (latency != null ? T('callLatency', { s: (latency / 1000).toFixed(1) }) : T('callHintLive'))
    : phase === 'dialling' ? T('callHintDialling')
    : phase === 'listening' ? T('callHintListening')
    : phase === 'speaking' ? T(BARGE_IN ? 'callHintSpeaking' : 'callHintTapCut')
    : phase === 'idle' ? T(chatId ? 'callHintIdleChat' : 'callHintIdle') : '';

  const ringColor = phase === 'speaking' ? c.ok
    : phase === 'thinking' || phase === 'dialling' || phase === 'working' || phase === 'reconnecting' ? c.warn : c.accent;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 8 }}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={[{ fontSize: 17, lineHeight: 24 }, { color: c.accent }]}>{T('close')}</Text>
        </Pressable>
        <Text style={[{ fontSize: 17, fontWeight: '600' as const, lineHeight: 22 }, { color: c.ink }]}>{chatTitle || T('callTitle')}</Text>
        <View style={{ width: 54 }} />
      </View>

      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: 12 }}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}>
        {lines.length === 0 && phase === 'idle' && (
          <Text style={[{ fontSize: 15, lineHeight: 20 }, { color: c.muted, textAlign: 'center', marginTop: 40 }]}>
            {T(chatId ? 'callEmptyChat' : 'callEmpty')}
          </Text>
        )}
        {lines.map((l) => (
          <View key={l.id} style={[styles.bubble, l.who === 'you' ? styles.you : styles.them]}>
            <Text style={[{ fontSize: 17, lineHeight: 24 }, { color: l.who === 'you' ? c.ink : c.ink }]}>{l.text}</Text>
          </View>
        ))}
        {!!heard && (
          <View style={[styles.bubble, styles.you, { opacity: 0.5 }]}>
            <Text style={[{ fontSize: 17, lineHeight: 24 }, { color: c.ink }]}>{heard}</Text>
          </View>
        )}
      </ScrollView>

      {voices !== null && (
        <View style={styles.voiceBox}>
          <View style={styles.voiceHead}>
            <Text style={[{ fontSize: 13, fontWeight: '500' as const, letterSpacing: 1.2, textTransform: 'uppercase' as const }, { color: c.muted }]}>{T('callVoicePick')}</Text>
            <Pressable onPress={() => setVoices(null)} hitSlop={10}>
              <Text style={[{ fontSize: 15, lineHeight: 20 }, { color: c.accent }]}>{T('close')}</Text>
            </Pressable>
          </View>
          {isTurkish(lang) && emaAvailable() && (
            <View style={styles.voiceRow}>
              <View style={styles.emaRow}>
                <Pressable onPress={() => void pickEma(true)} style={{ flex: 1 }}>
                  <Text style={[{ fontSize: 15, lineHeight: 20 }, { color: !prefs.emaOff ? c.accent : c.ink }]}>{T('callVoiceEma')}</Text>
                </Pressable>
                <Switch label={T('callVoiceEmaSwitch')} value={!prefs.emaOff} onChange={(on) => void pickEma(on)} />
              </View>
              <Text style={[{ fontSize: 13, lineHeight: 18 }, { color: c.muted }]}>{emaLine(emaState, T)}</Text>
            </View>
          )}
          <ScrollView style={{ maxHeight: 220 }}>
            {voices.map((v) => {
              const on = (!isTurkish(lang) || !!prefs.emaOff || !emaAvailable()) && (prefs.voiceIds ?? {})[lang] === v.identifier;
              return (
                <Pressable key={v.identifier} onPress={() => void chooseVoice(v)} style={styles.voiceRow}>
                  <Text style={[{ fontSize: 15, lineHeight: 20 }, { color: on ? c.accent : c.ink }]}>{voiceLabel(v)}</Text>
                </Pressable>
              );
            })}
            {voices.length === 0 && (
              <Text style={[{ fontSize: 15, lineHeight: 20 }, { color: c.muted, padding: 12 }]}>{T('callVoiceNone')}</Text>
            )}
          </ScrollView>
        </View>
      )}
      {!!note && <Text style={[{ fontSize: 13, lineHeight: 18 }, styles.note]}>{note}</Text>}
      {conn !== 'online' && <Text style={[{ fontSize: 13, lineHeight: 18 }, styles.note]}>{T('callOffline')}</Text>}

      <View style={{ alignItems: 'center', paddingBottom: insets.bottom + 24 }}>
        <Text style={[{ fontSize: 13, lineHeight: 18 }, { color: c.muted, marginBottom: 2, height: 18 }]}>{hint}</Text>
        <Pressable onPress={() => { void listVoices(lang).then(setVoices); }} hitSlop={8}>
          <Text style={[{ fontSize: 13, lineHeight: 18 }, { color: c.muted, marginBottom: 8, height: 16 }]}>
            {voice ? T('callVoice', { v: voice }) : ' '}
          </Text>
        </Pressable>
        <Pressable onPress={tap} disabled={phase === 'thinking'}>
          <Animated.View style={[styles.mic, {
            borderColor: ringColor,
            backgroundColor: phase === 'idle' ? c.card : c.accentTint,
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] }) }],
          }]}>
            <Text style={[{ fontSize: 17, fontWeight: '600' as const, lineHeight: 22 }, { color: phase === 'idle' ? c.ink : ringColor }]}>{label}</Text>
          </Animated.View>
        </Pressable>
        {phase !== 'idle' && (
          <Pressable onPress={hangUp} style={styles.hangUp} hitSlop={10}>
            <Text style={[{ fontSize: 15, lineHeight: 20 }, { color: c.danger }]}>{T('callHangUp')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** What the EMA row says under its name: loading, why it is not there, or the
 *  numbers of the last answer — the only place the phone's own speed shows. */
function emaLine(state: 'loading' | 'ready' | 'off', T: ReturnType<typeof useT>): string {
  const s = emaStats();
  if (s.failure) return T('callVoiceEmaFailed', { e: s.failure.slice(0, 80) });
  if (state === 'loading' && !s.ready) return T('callVoiceEmaLoading');
  const sec = (ms: number | null | undefined) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)} s`);
  return T('callVoiceEmaStats', {
    load: sec(s.timings ? s.timings.loadMs + s.timings.warmMs : null),
    first: sec(s.firstChunkMs),
    rtf: s.rtf == null ? '–' : s.rtf.toFixed(2),
  });
}

const mkStyles = (c: Palette) => StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  bubble: { padding: 12, borderRadius: 14, marginBottom: 10, maxWidth: '86%' },
  you: { alignSelf: 'flex-end', backgroundColor: c.bubble },
  them: { alignSelf: 'flex-start', backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
  note: { color: c.warn, textAlign: 'center', paddingHorizontal: 20, paddingBottom: 6 },
  mic: { width: 190, height: 190, borderRadius: 95, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  hangUp: { marginTop: 18, paddingVertical: 8, paddingHorizontal: 20 },
  voiceBox: { marginHorizontal: 20, marginBottom: 10, backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.line },
  voiceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 },
  voiceRow: { paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: c.line },
  emaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 2 },
});
