/** Talking into the box instead of typing into it.
 *
 *  The phone has had this since there were voice notes: you hold a button, you
 *  talk, the daemon runs whisper over the recording and the words arrive. On a
 *  computer that arrangement is the wrong shape. You are sitting at a keyboard
 *  with a cursor blinking, and the thing that makes dictation feel like typing
 *  rather than like sending a file is that the words appear *while you are
 *  still talking*. A second of silence after you stop is a second you spend
 *  wondering whether it heard you.
 *
 *  So the panel prefers the browser's own ear. Chromium ships a speech model
 *  it will download and run on the machine — `SpeechRecognition.available()`
 *  says whether a language is there, `install()` fetches it, `processLocally`
 *  pins it to the local one — and it streams results as you speak. Nothing
 *  leaves the computer and the daemon does no work at all.
 *
 *  Three engines, in the order they are tried:
 *
 *  · **local** — the browser's on-device model. The one we want. Works in
 *    Chrome and in Brave, which matters: Brave ships no key for Google's
 *    speech service, so the cloud path below fails there with `network` and
 *    the on-device model is the only one it has.
 *  · **cloud** — the same API without `processLocally`. Safari's
 *    `webkitSpeechRecognition` and Chrome's default. Audio goes to the browser
 *    vendor, which is worth knowing and is why it is second.
 *  · **whisper** — the daemon, over `POST /dictate`. No live words: the audio
 *    is captured as the 16 kHz mono PCM whisper wants and sent in one go when
 *    you stop. This is Firefox, which has no speech API at all, and it is the
 *    answer when a browser that should have one cannot reach it.
 *
 *  Everything above the engines — how a chunk of speech is joined onto what is
 *  already in the box, which words the engine is told to expect, what an error
 *  code means in a sentence — is plain functions at the top of this file, and
 *  `scripts/test-dictate.mjs` is about those.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type Engine = 'local' | 'cloud' | 'whisper';

/** `opening` is permission and a microphone starting; `installing` is the
 *  one-time model download; `thinking` is whisper, which has the audio and is
 *  working on it. `listening` is the only one of the four that is the point. */
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

export function support(): Support {
  const SR = speechClass();
  return {
    secure: typeof isSecureContext === 'undefined' ? true : isSecureContext,
    speech: !!SR,
    onDevice: !!(SR && SR.available && SR.install),
    capture: !!(navigator.mediaDevices?.getUserMedia) && typeof AudioWorkletNode !== 'undefined',
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
 *  exactly what the daemon is for, so they move the engine rather than show a
 *  line of red. A microphone the person has blocked is not: whisper would need
 *  the same microphone. */
export function fallsBackToWhisper(code: string): boolean {
  return code === 'network' || code === 'service-not-allowed' || code === 'language-not-supported';
}

/* ── what this browser will actually do ───────────────────────────────────── */

export type Availability = 'local' | 'downloadable' | 'cloud' | 'whisper' | 'none';

/** Which engine a language would get, asked before anybody presses anything.
 *
 *  `available()` answers `available` when the model is on the machine,
 *  `downloadable` when it can be fetched, `unavailable` when this browser has
 *  no on-device model for that language. A browser with no on-device half at
 *  all falls to its cloud service if it has one — and a browser with neither
 *  gets the daemon, if the daemon has a transcriber. */
export async function availability(lang: string, hostCanWhisper: boolean): Promise<Availability> {
  const s = support();
  if (!s.secure) return 'none';
  if (s.onDevice) {
    const SR = speechClass()!;
    try {
      const a = await SR.available!({ langs: [lang], processLocally: true });
      if (a === 'available') return 'local';
      if (a === 'downloadable' || a === 'downloading') return 'downloadable';
    } catch { /* an older shape of the API; treat it as absent */ }
  }
  if (s.speech) return 'cloud';
  if (hostCanWhisper && s.capture) return 'whisper';
  return 'none';
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
  const first = (navigator.languages?.[0] || navigator.language || 'en-US').trim();
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
  for (const raw of [current, ...(navigator.languages ?? []), navigator.language, 'en-US']) {
    if (!raw) continue;
    const tag = raw.includes('-') ? raw : `${raw}-${raw.toUpperCase()}`;
    if (!out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 6);
}

/* ── capture, for the engine that cannot hear by itself ───────────────────── */

/** An AudioWorklet that does nothing but hand every block of samples over.
 *
 *  Inline, as a blob, rather than a file in `public/`: it is fifteen lines, it
 *  belongs to this module, and a separate asset is one more thing that can be
 *  missing from a build.
 *
 *  The resampling is the `AudioContext`'s, asked for by opening it at 16 kHz —
 *  which is both what whisper wants and a thirtieth of the bytes a stereo
 *  48 kHz recording would have sent over the network. */
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

interface Capture { stop: () => Promise<Int16Array>; cancel: () => void }

async function capture(): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      // The three a dictating voice wants and a recording of music would not.
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    },
  });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(ctx, 'rac-tap');
  const blocks: Float32Array[] = [];
  let n = 0;
  node.port.onmessage = (e) => { blocks.push(e.data); n += e.data.length; };
  ctx.createMediaStreamSource(stream).connect(node);
  // Connected to nothing: a worklet that is not in the graph is not pulled, and
  // one connected to the speakers is a howl. `destination` with a zero gain is
  // the usual trick; a node with no output at all is enough in both engines
  // the panel runs in, and `process` returning true keeps it alive.

  const close = () => {
    node.port.onmessage = null;
    node.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
  return {
    cancel: close,
    stop: async () => {
      close();
      const out = new Int16Array(n);
      let i = 0;
      for (const b of blocks) {
        for (let k = 0; k < b.length; k++, i++) {
          const v = Math.max(-1, Math.min(1, b[k]));
          out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
      }
      return out;
    },
  };
}

/* ── the hook the composer uses ───────────────────────────────────────────── */

export interface Dictation {
  state: DictateState;
  /** Which engine is actually in use, once one has been chosen. */
  engine: Engine | null;
  /** Seconds since the microphone opened, for the counter beside it. */
  seconds: number;
  /** Words the engine has not committed yet: the live half, drawn pale. */
  interim: string;
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
   *  Absent means there is no third engine. */
  whisper?: { warm: () => void; send: (pcm: Int16Array, prompt: string) => Promise<string> };
}

export function useDictation({ onCommit, names = [], whisper }: DictationOptions): Dictation {
  const [state, setState] = useState<DictateState>('idle');
  const [engine, setEngine] = useState<Engine | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [interim, setInterim] = useState('');
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
    setInterim('');
    setSeconds(0);
    setState('idle');
  }, []);

  /** The daemon's engine: record it all, send it when they stop. No live
   *  words — that is the whole reason it is third — so there is nothing to
   *  draw between pressing and the answer but "thinking". */
  const startWhisper = useCallback(async () => {
    const w = latest.current.whisper;
    if (!w) { setError('No way to turn speech into text here.'); finish(); return; }
    setEngine('whisper');
    w.warm();
    try {
      cap.current = await capture();
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError'
        ? errorText('not-allowed')
        : 'No microphone answered.');
      finish();
      return;
    }
    if (!wanted.current) { cap.current.cancel(); finish(); return; }
    setState('listening');
  }, [finish]);

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
        rememberWhisper();
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
    if (preferWhisper() && latest.current.whisper) { void startWhisper(); return; }
    if (s.speech) void startSpeech(s.onDevice);
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
    const w = latest.current.whisper;
    if (!c || !w) { finish(); return; }
    cap.current = null;
    setState('thinking');
    c.stop()
      .then((pcm) => w.send(pcm, promptFor(latest.current.phrases)))
      .then((text) => { if (text) latest.current.onCommit(text); })
      .catch((e: any) => setError(e?.message ?? 'The computer could not transcribe that.'))
      .finally(finish);
  }, [finish]);

  const cancel = useCallback(() => {
    wanted.current = false;
    try { rec.current?.abort(); } catch { /* already gone */ }
    cap.current?.cancel();
    finish();
  }, [finish]);

  useEffect(() => cancel, [cancel]);

  return { state, engine, seconds, interim, error, availability: avail, start, stop, cancel };
}

/* ── remembering that this browser has no cloud ───────────────────────────── */

const WHISPER_KEY = 'rac.dictate.whisper';

function preferWhisper(): boolean {
  try { return localStorage.getItem(WHISPER_KEY) === '1'; } catch { return false; }
}

function rememberWhisper(): void {
  try { localStorage.setItem(WHISPER_KEY, '1'); } catch { /* private mode */ }
}

/** Forget it, so a browser that has since been given a model or a key is tried
 *  again. Settings does this when the language changes. */
export function forgetWhisperPreference(): void {
  try { localStorage.removeItem(WHISPER_KEY); } catch { /* private mode */ }
}
