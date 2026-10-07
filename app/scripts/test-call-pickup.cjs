/** The general call (#142): reached from the chat list, and picked up with a
 *  greeting and nothing else.
 *
 *  The chat list's call button is pressed for real and the route it pushes is
 *  read back. The call screen is then stood up and its big button pressed with
 *  the phone's voice swapped for a fake speaker: what was said, in what order,
 *  and when the microphone opened is the record that speaker keeps. The EMA
 *  frontend reads the spoken Turkish line, so a spelling that turns into
 *  unknown symbols or spelled-out letters fails here and not on a phone.
 *
 *  Run: node scripts/test-call-pickup.cjs  (also folded into test-ustabasi.cjs.)
 */
const path = require('path');
const { R } = require('./render-chat.cjs');
const machine = require('./test-handover-machine.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const L = require(path.join(root, 'src/call-lines.ts'));
const V = require(path.join(root, 'src/voice.ts'));
const { client } = require(path.join(root, 'src/ws.ts'));
const F = require(path.join(root, 'src/tts/frontend.ts'));
const E = require(path.join(root, 'src/tts/engine.ts'));

/** Pick up a call in `lang` against a fake speaker; the log of what happened. */
async function pickUp(lang) {
  const log = [];
  const real = { ...V };
  const realCall = client.call;
  Object.assign(V, {
    locale: () => lang,
    ensureMic: async () => true,
    pickVoice: async () => null,
    voiceName: () => null,
    ring: async () => { log.push('ring'); },
    pickup: async () => { log.push('pickup'); },
    // Speaking finishes on the next tick, as a voice does: after the call to
    // speak has returned, never inside it.
    speak: (text, _lang, onDone) => { log.push(`speak ${text}`); setTimeout(onDone, 0); },
    startListening: () => { log.push('listen'); },
    stopListening() {}, abortListening() {}, stopSpeaking() {},
  });
  client.call = async (type) => { log.push(`daemon ${type}`); return { working: 2, blocked: 1, idle: 0 }; };
  try {
    machine.stand();
    const Call = require(path.join(root, 'app/call.tsx')).default;
    R.render('dark', h(Call));
    const button = R.presses().find((p) => p.text === 'Call');
    if (!button) return ['no Call button'];
    button.press();
    // Long enough for the pause the screen leaves between a voice and the microphone.
    for (let i = 0; i < 20 && !log.includes('listen'); i++) await new Promise((r) => setTimeout(r, 50));
    await flush();
    return log;
  } finally {
    Object.assign(V, real);
    client.call = realCall;
  }
}

const checks = [];
const ready = (async () => {
  await machine.ready;
  R.words.real();
  try {
    // 1 · the chat list's header has a call button, and it opens /call with no chat on it
    machine.stand({ params: { all: '1' } });
    const Chats = require(path.join(root, 'app/chat/index.tsx')).default;
    R.render('dark', h(Chats, { all: '1' }));
    const button = R.presses().filter((p) => p.label === 'Call');
    button[0]?.press();
    await flush();
    checks.push([`call: the chat list has one Call button in its header, and it opens /call with no chat id — ${JSON.stringify(R.nav.pushed())}`,
      button.length === 1 && eq(R.nav.pushed(), ['/call'])]);

    // 3, 4, 5 · pickup: the greeting and only the greeting, then the microphone
    const tr = await pickUp('tr-TR');
    const spokenTr = L.callLines('tr-TR').greetingSpoken;
    checks.push([`call: in tr-TR the pickup says only the "Alooooo vaysaaaa" line, then listens — ${JSON.stringify(tr)}`,
      eq(tr, ['daemon call.hello', 'ring', 'pickup', `speak ${spokenTr}`, 'listen'])
      && L.callLines('tr-TR').greeting === 'Alooooo vaysaaaa'
      && spokenTr.replace(/[^\p{L} ]/gu, '') === 'Alooooo vaysaaaa']);
    checks.push(['call: no number is spoken at pickup (no working or blocked count)',
      !tr.some((l) => l.startsWith('speak') && /\d/.test(l))]);
    const en = await pickUp('en-US');
    checks.push([`call: in English the pickup says only "Hello." — ${JSON.stringify(en)}`,
      eq(en.filter((l) => l.startsWith('speak')), ['speak Hello.'])]);
    checks.push(['call: listening starts as soon as the greeting ends, with no line in between',
      en.indexOf('listen') === en.indexOf('speak Hello.') + 1 && en.length === 5]);

    // The Turkish line through EMA's frontend: one plain run of letters each, no
    // spelled-out letters and no symbol the voice does not know.
    const read = E.prepare(spokenTr).map((p) => p.text).join(' ');
    checks.push([`call: EMA reads the Turkish greeting as two drawn-out words — ${JSON.stringify(read)}`,
      /^alooooo, vaysaaaa!?$/.test(read) && !F.ids(read).includes(F.UNK)]);
  } finally {
    R.words.keys();
    R.store.reset();
    R.params.reset();
    R.nav.reset();
  }
})();

module.exports = { checks, ready };

if (require.main === module) {
  void ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) {
      console.log((ok ? '  ok    ' : '  FAIL  ') + name);
      if (!ok) bad++;
    }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  });
}
