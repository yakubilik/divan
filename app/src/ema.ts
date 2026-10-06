import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Engine, ortRuntime, prepare, RATE, STAGES, type Ort, type Stage } from './tts/engine';
import type { Ema, Player } from './tts/speaker';

/** EMA Lightning, the Turkish voice made on the phone: where its files are, loading it, and playing what
 *  it makes. The pipeline itself is `src/tts/engine.ts`; this is the part that needs a phone.
 *
 *  The three ONNX files are not in git. `npm run tts:models` copies them from `tts/models/` into
 *  `assets/tts/`, and `plugins/with-tts-models.js` puts whatever is there into the app bundle at prebuild.
 *  A build without them, or without onnxruntime's native module (Expo Go, an older build), says so here
 *  and the call reads Turkish with the system voice, as it did before. Nothing is loaded at import:
 *  onnxruntime installs itself when it is first required, and that is `warm()`, on the call screen. */

const fileName = (stage: Stage) => `ema-${stage}.onnx`;

function modelFile(stage: Stage): File | null {
  try { return new File(Paths.bundle, fileName(stage)); } catch { return null; }
}

/** ORT strips a leading file:// itself but does not undo the URL's escapes. */
function pathOf(stage: Stage): string {
  const uri = modelFile(stage)!.uri;
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

let present: boolean | null = null;
let failure: string | null = null;
let engine: Engine | null = null;

/** The model files are in this build. */
export function assetsPresent(): boolean {
  if (present === null) {
    try { present = Platform.OS === 'ios' && STAGES.every((s) => !!modelFile(s)?.exists); } catch { present = false; }
  }
  return present;
}

/** EMA could read the next Turkish answer once warm: the files are here and nothing has failed yet. */
export function available(): boolean {
  return assetsPresent() && failure === null;
}

export function ready(): boolean {
  return !!engine?.ready;
}

export function status() {
  return { available: available(), ready: ready(), failure, timings: engine?.timings ?? null };
}

/** Load the three graphs and run one word through them. Resolves false, never throws, when EMA cannot run. */
export async function warm(): Promise<boolean> {
  if (!available()) return false;
  try {
    if (!engine) {
      // Required here and not imported: the module's first evaluation installs the native binding, and
      // throws in a build that does not have it.
      const ort = require('onnxruntime-react-native') as Ort;
      engine = new Engine(ortRuntime(ort, pathOf));
    }
    const t = await engine.load();
    console.log(`ema: loaded in ${t.loadMs} ms, warmed in ${t.warmMs} ms`);
    return true;
  } catch (e: any) {
    failure = String(e?.message ?? e);
    engine = null;
    console.warn(`ema: unavailable: ${failure}`);
    return false;
  }
}

/** EMA for the speaker, or null when it is not loaded. */
export function voice(): Ema | null {
  const e = engine;
  if (!e?.ready) return null;
  return {
    ready: () => e.ready,
    prepare: (text) => prepare(text),
    synthesise: (spoken, o) => e.synthesise(spoken, o),
  };
}

// ── playing it ──────────────────────────────────────────────────────────────

/** 16-bit PCM WAV of `pcm` followed by `pause` seconds of silence. */
export function wav(pcm: Float32Array, pause: number): Uint8Array {
  const n = pcm.length + Math.round(pause * RATE);
  const out = new Uint8Array(44 + n * 2);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return out;
}

type Item = { file: File; player: AudioPlayer; seconds: number; tail: number };
let serial = 0;

/** Pieces as WAV files in the cache, each in its own expo-audio player, played back to back.
 *
 *  Each file carries the silence that follows its piece, and the next player starts inside that
 *  silence — a little before the file ends, on a timer from when it was started — so the seam between
 *  two players, which is not sample-exact, always falls in a pause the model asked for anyway. The
 *  players are created as the pieces arrive, so the next one is loaded before it is needed.
 *
 *  Chosen over a native PCM queue (AVAudioEngine) because it needs no new native code beside
 *  onnxruntime and plays through whatever session the call has set; `session()` is that session. */
export function player(session: () => void): Player {
  const queue: Item[] = [];
  const live = new Set<Item>();
  let current: Item | null = null;
  let handOffDue = false;
  let finished: (() => void) | null = null;
  let stopped = false;
  let sessionSet = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (f: () => void, ms: number) => {
    const h = setTimeout(() => { timers.delete(h); f(); }, ms);
    timers.add(h);
  };

  const drop = (item: Item) => {
    live.delete(item);
    try { item.player.remove(); } catch {}
    try { item.file.delete(); } catch {}
  };

  const drained = () => {
    if (stopped || current || queue.length || live.size || !finished) return;
    const f = finished;
    finished = null;
    f();
  };

  const ended = (item: Item) => {
    if (!live.has(item)) return;
    drop(item);
    if (current === item) {
      current = null;
      if (queue.length) start();
    }
    drained();
  };

  const start = () => {
    const item = queue.shift();
    if (!item || stopped) return;
    if (!sessionSet) { sessionSet = true; try { session(); } catch {} }
    current = item;
    handOffDue = false;
    item.player.play();
    const handOff = Math.max(0, item.seconds - Math.min(item.tail * 0.4, 0.1));
    later(() => {
      if (current !== item) return;
      if (queue.length) { current = null; start(); } else handOffDue = true;
    }, handOff * 1000);
    // didJustFinish ends it; this is in case that event never comes.
    later(() => ended(item), (item.seconds + 1) * 1000);
  };

  return {
    enqueue(pcm, pause) {
      if (stopped) return;
      const file = new File(Paths.cache, `ema-${Date.now()}-${serial++}.wav`);
      file.write(wav(pcm, pause));
      const p = createAudioPlayer({ uri: file.uri });
      const item: Item = { file, player: p, seconds: pcm.length / RATE + pause, tail: pause };
      p.addListener('playbackStatusUpdate', (s) => { if (s.didJustFinish) ended(item); });
      live.add(item);
      queue.push(item);
      if (!current) start();
      else if (handOffDue) { current = null; start(); }
    },
    finish(onDrained) {
      finished = onDrained;
      drained();
    },
    stop() {
      stopped = true;
      finished = null;
      for (const h of timers) clearTimeout(h);
      timers.clear();
      for (const item of [...live]) {
        try { item.player.pause(); } catch {}
        drop(item);
      }
      queue.length = 0;
      current = null;
    },
  };
}
