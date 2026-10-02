/** Talking into the box instead of typing into it.
 *
 *  The phone has had this since there were voice notes: you hold a button, you
 *  talk, the daemon runs whisper over the recording and the words arrive. On a
 *  computer that arrangement is the wrong shape. You are sitting at a keyboard
 *  with a cursor blinking, and what makes dictation feel like typing rather
 *  than like sending a file is that the words land while you are still
 *  talking — and that they are the words you said.
 *
 *  The second half is what decides the order of the engines. Measured on one
 *  sentence of Turkish with the work's own English in it ("yeni bir branch aç,
 *  commit at, deploy et"): whisper on the computer wrote it down right in a
 *  sixth of the time it took to say. The browser's own recogniser, given the
 *  same recording as a microphone in Chrome 154, heard sound and returned
 *  nothing — on-device and cloud alike, no words and no error. A recogniser
 *  that can fail silently in one browser, answers `network` in Brave and does
 *  not exist in Firefox is not something to build the default on.
 *
 *  So, two engines:
 *
 *  · **computer** — the daemon's whisper, over `POST /dictate`. The default
 *    wherever the chat's computer has a transcriber. The audio is captured as
 *    the 16 kHz mono PCM whisper wants and cut at the pauses (`Phrases`), so a
 *    phrase is sent as it ends and its words land about a second later — the
 *    same way, in every browser. Nothing leaves the person's own machines.
 *  · **browser** — `SpeechRecognition`. On-device where Chromium has a model
 *    for the language (`available()`, `install()`, `processLocally`), the
 *    browser maker's cloud service otherwise. Its words appear as they are
 *    spoken, which is the one thing whisper cannot do, so it is a choice in
 *    Preferences and the answer for a computer with no transcriber. When it
 *    fails in a way that is permanent for the browser, the engine moves to the
 *    computer and stays there.
 *
 *  Everything above the engines — how a chunk of speech is joined onto what is
 *  already in the box, which words the engine is told to expect, where a
 *  stream of samples is cut into phrases, what an error code means in a
 *  sentence — is plain functions at the top of this file, and
 *  `scripts/test-dictate.mjs` is about those.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type Engine = 'local' | 'cloud' | 'whisper';

/** `opening` is permission and a microphone starting; `installing` is the
 *  browser's one-time model download; `thinking` is whisper after the stop,
 *  still working on the last phrase. `listening` is the only one of the four
 *  that is the point. */
export type DictateState = 'idle' | 'opening' | 'installing' | 'listening' | 'thinking';

export interface Support {
  /** A microphone needs https or localhost. The panel is served off loopback,
   *  so this is false only behind a tunnel on plain http — worth saying out
   *  loud, because the failure is otherwise a button that does nothing. */
  secure: boolean;
  /** `SpeechRecognition` exists at all. */
  speech: boolean;
  /** …and it has the on-device half of the API (Chromium). */
  onDevice: boolean;
  /** getUserMedia and an AudioWorklet: what the whisper engine needs. */
  capture: boolean;
}

type SRClass = {
  new (): any;
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};

function speechClass(): SRClass | null {
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as SRClass | null;
}

/** The page is also drawn where there is no browser at all — the checks render
 *  every screen in Node, and Node before 21 has no `navigator`. */
const nav = (): Navigator | undefined => (typeof navigator === 'undefined' ? undefined : navigator);

export function support(): Support {
  const SR = speechClass();
  return {
    secure: typeof isSecureContext === 'undefined' ? true : isSecureContext,
    speech: !!SR,
    onDevice: !!(SR && SR.available && SR.install),
    capture: !!(nav()?.mediaDevices?.getUserMedia) && typeof AudioWorkletNode !== 'undefined',
  };
}

/* ── the words, before and after ──────────────────────────────────────────── */

/** What the mic adds to what is already typed.
 *
 *  Dictation arrives a phrase at a time and has to land in a sentence. The
 *  engines punctuate and capitalise their own output, so this does the one
 *  thing they cannot: decide whether a space belongs in front. A chunk that
 *  opens with punctuation is the tail of the phrase before it and takes none;
 *  anything else takes one, unless the box already ends in whitespace — a
 *  newline the person typed on purpose is left as a newline.
 */
export function appendSpeech(prev: string, chunk: string): string {
  const next = chunk.trim();
  if (!next) return prev;
  if (!prev) return next;
  if (/\s$/.test(prev)) return prev + next;
  if (/^[,.!?;:…)\]}»]/.test(next)) return prev + next;
  return `${prev} ${next}`;
}

/** The words the engine is told to expect.
 *
 *  Both engines take a vocabulary — Chromium as `phrases`, whisper as the text
 *  it should imagine came just before the audio — and both of them use it to
 *  settle a spelling they would otherwise guess at. The useful vocabulary is
 *  not a dictionary: it is the handful of names on this person's own board.
 *  A product called `isghocam` is not in any model's training set, and neither
 *  is the machine in the corner of the room; said once in a prompt, both come
 *  back spelled right.
 *
 *  The fixed half is the vocabulary of the work itself, which every engine
 *  mis-hears in the middle of a sentence in another language — "commit" and
 *  "branch" spoken inside Turkish are the example that started this.
 */
const TRADE = [
  'commit', 'branch', 'merge', 'rebase', 'deploy', 'build', 'repo', 'pull request',
  'ticket', 'backlog', 'board', 'worktree', 'endpoint', 'migration', 'rollback',
];

export function phrasesFor(names: Iterable<string>, limit = 100): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    // A name is only worth biasing towards if it is a word. Ids with dashes
    // are split as well as kept whole, because that is how they are said.
    for (const w of [raw, ...raw.split(/[-_/\s]+/)]) {
      const t = w.trim();
      if (t.length < 3 || t.length > 40) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  };
  for (const n of names) add(n);
  for (const t of TRADE) add(t);
  return out.slice(0, limit);
}

/** The same vocabulary as one line of text, which is what whisper takes. */
export function promptFor(phrases: string[]): string {
  return phrases.length ? `${phrases.join(', ')}.` : '';
}

/** What went wrong, as a sentence rather than a code.
 *
 *  The spec's error names are nearly all about the microphone or the service
 *  and not about the speaker, so each of these says what to do next. `aborted`
 *  and `no-speech` are not here on purpose: one is us stopping it and the
 *  other is silence, and neither is worth a line of red. */
export function errorText(code: string): string {
  switch (code) {
    case 'not-allowed':
      return 'This browser is not letting the page use the microphone. Allow it in the site settings and try again.';
    case 'service-not-allowed':
      return 'This browser will not do speech recognition for a page served this way.';
    case 'audio-capture':
      return 'No microphone answered.';
    case 'network':
      return 'The browser could not reach its speech service.';
    case 'language-not-supported':
      return 'This browser cannot recognise that language.';
    case 'bad-grammar':
      return 'The browser refused the phrase list.';
    default:
      return 'Dictation stopped working.';
  }
}

/** Whether an error is worth giving up the browser's ear for.
 *
 *  Brave answers `network` to every cloud attempt because it ships no key for
 *  one, and a browser that will not recognise a page's audio says
 *  `service-not-allowed`. Both are permanent for this browser and both are
 *  exactly what the computer is for, so they move the engine rather than show
 *  a line of red. A microphone the person has blocked is not: whisper would
 *  need the same microphone. */
export function fallsBackToWhisper(code: string): boolean {
  return code === 'network' || code === 'service-not-allowed' || code === 'language-not-supported';
}

/* ── what this browser will actually do ───────────────────────────────────── */

export type Availability = 'local' | 'downloadable' | 'cloud' | 'whisper' | 'none';

/** Which of the two engines this browser asks for first. The computer, unless
 *  somebody chose the browser's live words over it. */
export type EnginePref = 'computer' | 'browser';

const ENGINE_KEY = 'rac.dictate.engine';

export function dictateEngine(): EnginePref {
  try { return localStorage.getItem(ENGINE_KEY) === 'browser' ? 'browser' : 'computer'; }
  catch { return 'computer'; }
}

export function setDictateEngine(engine: EnginePref): void {
  try { localStorage.setItem(ENGINE_KEY, engine); } catch { /* private mode */ }
}

/** Which engine a language would get, asked before anybody presses anything.
 *
 *  The computer's whisper when it has one and it is the preference. Otherwise
 *  the browser: `available()` answers `available` when its model is on the
 *  machine, `downloadable` when it can be fetched, `unavailable` when it has
 *  none for that language, and a browser with no on-device half at all falls
 *  to its cloud service. A browser with no speech API gets the computer
 *  whatever the preference says. */
export async function availability(
  lang: string, hostCanWhisper: boolean, pref: EnginePref = dictateEngine(),
): Promise<Availability> {
  const s = support();
  if (!s.secure) return 'none';
  const whisper = hostCanWhisper && s.capture;
  if (whisper && pref === 'computer') return 'whisper';
  if (s.onDevice) {
    const SR = speechClass()!;
    try {
      const a = await SR.available!({ langs: [lang], processLocally: true });
      if (a === 'available') return 'local';
      if (a === 'downloadable' || a === 'downloading') return 'downloadable';
    } catch { /* an older shape of the API; treat it as absent */ }
  }
  if (s.speech) return 'cloud';
  return whisper ? 'whisper' : 'none';
}

/** Fetch the on-device model for a language. Resolves true when the browser
 *  has it afterwards. It is hundreds of megabytes and the browser shows no
 *  progress of its own, which is why the panel says what it is doing. */
export async function install(lang: string): Promise<boolean> {
  const SR = speechClass();
  if (!SR?.install) return false;
  try {
    await SR.install({ langs: [lang], processLocally: true });
    return (await SR.available!({ langs: [lang], processLocally: true })) === 'available';
  } catch {
    return false;
  }
}

/* ── the language this browser dictates in ────────────────────────────────── */

const LANG_KEY = 'rac.dictate.lang';

/** The panel's own copy is English and pinned (`main.tsx`). What somebody
 *  *says* is a different question, and the browser's first language is a much
 *  better guess at it than the language the buttons are written in. */
export function defaultLang(): string {
  const first = (nav()?.languages?.[0] || nav()?.language || 'en-US').trim();
  return first.includes('-') ? first : `${first}-${first.toUpperCase()}`;
}

export function dictateLang(): string {
  try { return localStorage.getItem(LANG_KEY) || defaultLang(); } catch { return defaultLang(); }
}

export function setDictateLang(lang: string): void {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* private mode */ }
}

/** `tr-TR` as "Turkish (Türkiye)", in the reader's own language, or back as
 *  itself where the browser cannot name it. */
export function langName(tag: string): string {
  try {
    const dn = new (Intl as any).DisplayNames(['en'], { type: 'language' });
    return dn.of(tag) || tag;
  } catch { return tag; }
}

/** The tags worth offering: the ones this browser says it prefers, plus
 *  whatever has been chosen before. Not a list of the world's languages — a
 *  picker nobody can find their language in is worse than a field. */
export function langChoices(current = dictateLang()): string[] {
  const out: string[] = [];
  for (const raw of [current, ...(nav()?.languages ?? []), nav()?.language, 'en-US']) {
    if (!raw) continue;
    const tag = raw.includes('-') ? raw : `${raw}-${raw.toUpperCase()}`;
    if (!out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 6);
}

/* ── cutting speech into phrases ──────────────────────────────────────────── */

/** What whisper wants, and so what everything below is counted in. */
export const RATE = 16000;

const PAUSE = 1.0 * RATE;       // silence that ends a phrase
const MIN_VOICED = 0.2 * RATE;  // less speech than this is a click, not a phrase
const LEAD = 0.3 * RATE;        // silence kept in front of the first word
const TAIL = 0.2 * RATE;        // …and behind the last
const LONG = 20 * RATE;         // past this, a breath is pause enough
const MAX = 28 * RATE;          // whisper listens thirty seconds at a time

/** A stream of samples in, one phrase out each time the speaker pauses.
 *
 *  This is what stands in for live words. Whisper cannot answer until it has
 *  the audio, so the audio is handed over in the pieces a person already
 *  speaks in: when 0.7 s goes by without a voice, what came before it is a
 *  phrase and is sent while they draw breath for the next one. Shorter and it
 *  cuts in the middle of a thought — and whisper ends every piece with a full
 *  stop; longer and the words are late. It was 0.7 s, and at 0.7 s a Turkish
 *  speaker looking for the next word was cut mid-sentence often enough that
 *  the pieces read as fragments; a second is still under the time the last
 *  piece takes to come back.
 *
 *  Speech is told from silence by loudness against a floor that follows the
 *  room down: a fan is quiet and a voice over it is three times that. Silence
 *  is never sent at all, which matters beyond the bytes — whisper given a
 *  second of nothing does not answer nothing, it answers with a sentence it
 *  remembers from somebody's subtitles.
 */
export class Phrases {
  private blocks: Float32Array[] = [];
  private length = 0;
  private voiced = 0;
  private quiet = 0;
  private floor = 0.004;

  push(block: Float32Array): Int16Array | null {
    if (!block.length) return null;
    let sum = 0;
    for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
    const rms = Math.sqrt(sum / block.length);
    const loud = rms > Math.max(0.01, this.floor * 3);
    // Only quiet moves the floor. If speech could, a long sentence would raise
    // it to its own level and be heard as a pause.
    if (!loud) this.floor = Math.min(0.03, this.floor * 0.95 + rms * 0.05);

    this.blocks.push(block);
    this.length += block.length;
    if (loud) { this.voiced += block.length; this.quiet = 0; }
    else this.quiet += block.length;

    if (this.voiced >= MIN_VOICED) {
      if (this.quiet >= PAUSE || this.length >= MAX
          || (this.length >= LONG && this.quiet >= TAIL)) return this.take();
    } else if (this.quiet >= PAUSE || !this.voiced) {
      // Nothing said yet, or a click and then nothing. Keep only what would be
      // the run-up to a first word.
      this.voiced = 0;
      while (this.blocks.length > 1 && this.length - this.blocks[0].length >= LEAD) {
        this.length -= this.blocks.shift()!.length;
      }
    }
    return null;
  }

  /** Whatever is held when the microphone closes — if anybody spoke in it. */
  flush(): Int16Array | null {
    return this.voiced >= MIN_VOICED ? this.take() : null;
  }

  private take(): Int16Array {
    const n = this.length - Math.max(0, this.quiet - TAIL);
    const out = new Int16Array(n);
    let i = 0;
    for (const b of this.blocks) {
      for (let k = 0; k < b.length && i < n; k++, i++) {
        const v = Math.max(-1, Math.min(1, b[k]));
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
    }
    this.blocks = [];
    this.length = this.voiced = this.quiet = 0;
    return out;
  }
}

/** Samples at the microphone's rate, as samples at whisper's.
 *
 *  Only for the browser that will not do it itself — see `capture`. Each
 *  output sample is the mean of the input samples it covers, which is both the
 *  resampling and the low-pass a voice needs before it is thinned. */
export function resampler(from: number, to = RATE): (block: Float32Array) => Float32Array {
  if (from === to) return (block) => block;
  const step = from / to;
  let acc = 0, n = 0, pos = 0;
  return (block) => {
    const out = new Float32Array(Math.ceil(block.length / step) + 1);
    let o = 0;
    for (let i = 0; i < block.length; i++) {
      acc += block[i]; n++; pos++;
      if (pos >= step) { out[o++] = acc / n; acc = 0; n = 0; pos -= step; }
    }
    return out.subarray(0, o);
  };
}

/* ── capture, for the engine that cannot hear by itself ───────────────────── */

/** An AudioWorklet that does nothing but hand every block of samples over.
 *
 *  Inline, as a blob, rather than a file in `public/`: it is fifteen lines, it
 *  belongs to this module, and a separate asset is one more thing that can be
 *  missing from a build. */
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(new Float32Array(ch));
    return true;
  }
}
registerProcessor('rac-tap', Tap);
`;

interface Capture {
  /** Close the microphone and hand back the phrase that was still open. */
  stop: () => Int16Array | null;
  cancel: () => void;
}

async function capture(onPhrase: (pcm: Int16Array) => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      // The three a dictating voice wants and a recording of music would not.
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    },
  });
  // The resampling is the `AudioContext`'s where it will do it, asked for by
  // opening it at 16 kHz. Firefox opens one and then refuses to connect a
  // microphone running at another rate to it, so there the context is the
  // microphone's and `resampler` does the work.
  let ctx = new AudioContext({ sampleRate: RATE });
  let source: MediaStreamAudioSourceNode;
  try {
    source = ctx.createMediaStreamSource(stream);
  } catch {
    void ctx.close();
    ctx = new AudioContext();
    source = ctx.createMediaStreamSource(stream);
  }
  const close = () => {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } catch (e) {
    close();
    throw e;
  } finally {
    URL.revokeObjectURL(url);
  }
  void ctx.resume();
  const node = new AudioWorkletNode(ctx, 'rac-tap');
  const down = resampler(ctx.sampleRate);
  const phrases = new Phrases();
  node.port.onmessage = (e) => {
    const phrase = phrases.push(down(e.data));
    if (phrase) onPhrase(phrase);
  };
  // Connected to nothing: a node with no output is still pulled in both engines
  // the panel runs in, `process` returning true keeps it alive, and one
  // connected to the speakers is a howl.
  source.connect(node);

  const end = () => {
    node.port.onmessage = null;
    node.disconnect();
    close();
  };
  return { cancel: end, stop: () => { end(); return phrases.flush(); } };
}

/* ── the hook the composer uses ───────────────────────────────────────────── */

export interface Dictation {
  state: DictateState;
  /** Which engine is actually in use, once one has been chosen. */
  engine: Engine | null;
  /** Seconds since the microphone opened, for the counter beside it. */
  seconds: number;
  /** Words the browser's engine has not committed yet: the live half. */
  interim: string;
  /** The computer has a phrase and is writing it down. The only sign whisper
   *  can give that it heard, for the second its words take. */
  writing: boolean;
  error: string | null;
  /** `none` means there is nothing to press, and the composer draws no
   *  microphone at all rather than one that cannot work. */
  availability: Availability | null;
  start: () => void;
  stop: () => void;
  cancel: () => void;
}

export interface DictationOptions {
  /** A finished phrase, to be put in the box. */
  onCommit: (chunk: string) => void;
  /** The names to bias towards: this person's products and machines. */
  names?: Iterable<string>;
  /** Whether the computer the chat is on can run whisper, and how to ask it.
   *  Absent means the browser is the only engine. */
  whisper?: {
    warm: () => void;
    /** `context` is what this dictation has said so far, so a phrase is
     *  heard as the next part of a sentence rather than on its own. */
    send: (pcm: Int16Array, prompt: string, lang: string, context: string) => Promise<string>;
  };
}

export function useDictation({ onCommit, names = [], whisper }: DictationOptions): Dictation {
  const [state, setState] = useState<DictateState>('idle');
  const [engine, setEngine] = useState<Engine | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [interim, setInterim] = useState('');
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);

  const lang = dictateLang();
  const phrases = phrasesFor(names);
  // The handler reads these on an event, long after the render that made them.
  const latest = useRef({ onCommit, phrases, whisper });
  latest.current = { onCommit, phrases, whisper };

  const rec = useRef<any>(null);
  const cap = useRef<Capture | null>(null);
  /** Set while the person still means it. An engine that ends on its own —
   *  Chromium's does, after a long enough pause — is restarted rather than
   *  treated as a stop, which is what makes a sentence with a thought in the
   *  middle of it survive. */
  const wanted = useRef(false);
  const restarts = useRef<number[]>([]);
  /** Whisper's phrases, answered one at a time and in the order they were
   *  said. `run` is which dictation they belong to: an answer that comes back
   *  after Esc belongs to none and is dropped. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** What whisper has written down in this dictation so far, sent with each
   *  next phrase as its lead-in. */
  const heard = useRef('');
  const waiting = useRef(0);
  const run = useRef(0);

  useEffect(() => {
    let alive = true;
    availability(lang, !!whisper).then((a) => { if (alive) setAvail(a); });
    return () => { alive = false; };
  }, [lang, !!whisper]);

  useEffect(() => {
    if (state !== 'listening') return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  const finish = useCallback(() => {
    wanted.current = false;
    rec.current = null;
    cap.current = null;
    restarts.current = [];
    run.current += 1;
    heard.current = '';
    waiting.current = 0;
    queue.current = Promise.resolve();
    setWriting(false);
    setInterim('');
    setSeconds(0);
    setState('idle');
  }, []);

  /** One phrase to the computer, behind the ones already on their way. */
  const sendPhrase = useCallback((pcm: Int16Array) => {
    const w = latest.current.whisper;
    if (!w) return;
    const mine = run.current;
    waiting.current += 1;
    setWriting(true);
    queue.current = queue.current
      // Queued, so by the time a phrase is sent every phrase before it has
      // answered and `heard` holds them all.
      .then(() => (mine === run.current
        ? w.send(pcm, promptFor(latest.current.phrases), lang, heard.current.slice(-300))
        : ''))
      .then((text) => {
        if (mine !== run.current) return;
        waiting.current -= 1;
        if (!waiting.current) setWriting(false);
        if (text) {
          heard.current = appendSpeech(heard.current, text);
          latest.current.onCommit(text);
        }
      })
      .catch((e: any) => {
        if (mine !== run.current) return;
        setError(e?.message ?? 'The computer could not transcribe that.');
        cap.current?.cancel();
        finish();
      });
  }, [lang, finish]);

  /** The computer's engine: a phrase goes up each time the speaker pauses and
   *  its words come back while they are saying the next one. */
  const startWhisper = useCallback(async () => {
    const w = latest.current.whisper;
    if (!w) { setError('No way to turn speech into text here.'); finish(); return; }
    setEngine('whisper');
    w.warm();
    try {
      cap.current = await capture(sendPhrase);
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError'
        ? errorText('not-allowed')
        : 'No microphone answered.');
      finish();
      return;
    }
    if (!wanted.current) { cap.current.cancel(); finish(); return; }
    setState('listening');
  }, [finish, sendPhrase]);

  const startSpeech = useCallback(async (local: boolean) => {
    const SR = speechClass();
    if (!SR) return startWhisper();
    if (local) {
      const a = await availability(lang, !!latest.current.whisper);
      setAvail(a);
      if (a === 'downloadable') {
        setState('installing');
        const ok = await install(lang);
        setAvail(ok ? 'local' : 'cloud');
        if (!wanted.current) { finish(); return; }
        if (!ok) return startSpeech(false);
      } else if (a !== 'local') {
        // This browser has the on-device half of the API but no model for this
        // language. Asking it to process locally anyway is a refusal.
        return startSpeech(false);
      }
    }
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    if (local) { try { r.processLocally = true; } catch { /* cloud only */ } }
    // The phrase list is a Chromium extra and refusing it must not cost us the
    // engine, so it is set on its own and the failure is dropped.
    try {
      const Phrase = (window as any).SpeechRecognitionPhrase;
      if (Phrase && latest.current.phrases.length) {
        r.phrases = latest.current.phrases.map((p: string) => new Phrase(p, 2.0));
      }
    } catch { /* not supported here */ }

    rec.current = r;
    setEngine(local ? 'local' : 'cloud');

    r.onstart = () => { if (wanted.current) setState('listening'); };
    r.onresult = (e: any) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0]?.transcript ?? '';
        if (e.results[i].isFinal) latest.current.onCommit(text);
        else live += text;
      }
      setInterim(live);
    };
    r.onerror = (e: any) => {
      const code = e?.error ?? 'unknown';
      if (code === 'aborted' || code === 'no-speech') return;
      if (fallsBackToWhisper(code) && latest.current.whisper) {
        // Permanent for this browser, so remember it: Brave would otherwise
        // spend a second failing at the cloud every single time.
        setDictateEngine('computer');
        rec.current = null;
        void startWhisper();
        return;
      }
      setError(errorText(code));
      rec.current = null;
      finish();
    };
    r.onend = () => {
      setInterim('');
      if (!wanted.current || rec.current !== r) return;
      // Chromium ends a continuous session by itself after a long pause. Start
      // another — unless it is ending immediately and repeatedly, which is a
      // loop and not a pause.
      const now = Date.now();
      restarts.current = [...restarts.current.filter((t) => now - t < 2000), now];
      if (restarts.current.length > 4) {
        setError('The browser keeps dropping the microphone.');
        finish();
        return;
      }
      try { r.start(); } catch { finish(); }
    };
    try {
      r.start();
    } catch {
      rec.current = null;
      void startWhisper();
    }
  }, [lang, finish, startWhisper]);

  const start = useCallback(() => {
    if (state !== 'idle') return;
    const s = support();
    setError(null);
    setInterim('');
    setSeconds(0);
    if (!s.secure) {
      setError('A microphone needs a secure page. Open the panel over https, or on the computer itself.');
      return;
    }
    wanted.current = true;
    setState('opening');
    const computer = !!latest.current.whisper && s.capture;
    if (computer && (dictateEngine() === 'computer' || !s.speech)) void startWhisper();
    else if (s.speech) void startSpeech(s.onDevice);
    else void startWhisper();
  }, [state, startSpeech, startWhisper]);

  const stop = useCallback(() => {
    if (!wanted.current) return;
    wanted.current = false;
    if (rec.current) {
      // `stop` rather than `abort`: it hands back whatever it had not called
      // final yet, which is the last few words of every sentence.
      try { rec.current.stop(); } catch { /* already gone */ }
      rec.current = null;
      setInterim('');
      setState('idle');
      setSeconds(0);
      return;
    }
    const c = cap.current;
    if (!c) { finish(); return; }
    cap.current = null;
    // The phrase they stopped in the middle of goes up like the others, and
    // the microphone is not `idle` until every one of them has answered.
    const rest = c.stop();
    if (rest) sendPhrase(rest);
    if (!waiting.current) { finish(); return; }
    setState('thinking');
    const mine = run.current;
    void queue.current.then(() => { if (mine === run.current) finish(); });
  }, [finish, sendPhrase]);

  const cancel = useCallback(() => {
    wanted.current = false;
    try { rec.current?.abort(); } catch { /* already gone */ }
    cap.current?.cancel();
    finish();
  }, [finish]);

  useEffect(() => cancel, [cancel]);

  return { state, engine, seconds, interim, writing, error, availability: avail, start, stop, cancel };
}
