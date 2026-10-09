/** The call screen on the streaming session (#150), its own controls pressed.
 *
 *  `app/call.tsx` is stood up through the shared harness with the native engine swapped for the fake of
 *  `test-voice-session.cjs` and the socket pointed at the isolated daemon that test starts. The Call button
 *  is pressed for real; the screen is then rendered again as the call goes on — a screen opened on a call
 *  that is up joins it — and what its big button says is compared with the state the daemon announced.
 *  The End call button is pressed for real too. Simulated audio, as there.
 *
 *  Run: node scripts/test-call-live.cjs [--shot <dir>]   (also folded into test-ustabasi.cjs.)
 *  `--shot` leaves `call.png`: the screen mid-answer, through `shot-dashboard.cjs`'s photographer.
 */
const fs = require('fs');
const path = require('path');
const { R } = require('./render-chat.cjs');
const machine = require('./test-handover-machine.cjs');
const H = require('./test-voice-session.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

const V = require(path.join(root, 'src/voice.ts'));
const VS = require(path.join(root, 'src/voice-session.ts'));
const { live } = require(path.join(root, 'src/live-call.ts'));
const { RacClient } = require(path.join(root, 'src/ws.ts'));
const L = require(path.join(root, 'src/call-lines.ts'));

/** What the big button says for each of the daemon's states (the screen's own words). */
const LABEL = { listening: 'Listening', hearing: 'Hearing you', thinking: 'Asking…', speaking: 'Speaking',
                working: 'Working on it', reconnecting: 'Reconnecting…' };

const checks = [];
const ready = (async () => {
  await machine.ready;
  let peer;
  try { peer = await H.startPeer(); } catch (e) {
    checks.push([`call screen (live): SKIP, no daemon to drive (${String(e.message).slice(0, 120)})`, !process.argv.includes('--require-daemon')]);
    return;
  }
  const { fx } = H.fixtures(peer.fixtures);
  const realV = { ...V };
  const realLive = { ...live };
  const client = new RacClient();
  client.connect('127.0.0.1', peer.port, peer.token);
  for (let i = 0; i < 100 && client.status !== 'online'; i++) await H.wait(20);
  await client.call('hello', { device_name: 'screen', lang: 'tr' });
  const calls = [];
  const events = [];
  client.on((ev) => { if (ev.event?.startsWith('voice.')) events.push(ev); });
  const wire = {
    call: (t, d, ms) => { calls.push(t); return client.call(t, d, ms); }, tell: (t, d) => client.tell(t, d),
    on: (l) => client.on(l), onStatus: (l) => client.onStatus(l), online: () => client.status === 'online',
  };
  let engine = new H.FakeEngine();
  let mic = true;
  Object.assign(V, {
    locale: () => 'tr-TR', ensureMic: async () => mic, pickVoice: async () => null, voiceName: () => 'EMA',
    ring: async () => {}, pickup: async () => {},
  });
  Object.assign(live, {
    available: () => true,
    voice: async () => ({ voice: H.fakeVoice, ema: true }),
    create: (v) => live.track(new VS.VoiceSession({ wire, engine, voice: v })),
    client: () => ({ build: 'test', device: 'screen' }),
  });
  R.words.real();
  const Call = require(path.join(root, 'app/call.tsx')).default;
  const shot = process.argv.indexOf('--shot') > 0 ? process.argv[process.argv.indexOf('--shot') + 1] : null;
  try {
    machine.stand({ params: {} });
    R.store.set({ conn: 'online' });
    R.render('dark', h(Call));
    R.presses().find((p) => p.text === 'Call').press();
    for (let i = 0; i < 200 && !(live.active()?.state === 'listening'); i++) await H.wait(20);
    const s = live.active();
    await H.wait(1500);                                   // the greeting plays out
    const markup = () => R.render('dark', h(Call));
    const button = () => R.presses().map((p) => p.text).find((t) => Object.values(LABEL).includes(t)) || null;
    const first = markup();
    checks.push([`call screen (live): pressing Call places one streaming session and shows "Listening" with the greeting written — ${button()}`,
      !!s && calls.filter((c) => c === 'voice.start').length === 1 && button() === 'Listening'
      && first.includes(L.callLines('tr-TR').greeting) && first.includes('Just talk')]);

    // Speak; sample the screen as it goes. Each picture's button must name the state the session is in.
    const said = fx['short-status'];
    fs.writeFileSync(path.join(peer.timelines, 'screen.json'), JSON.stringify(said.spans.map((sp) => [s.timelineMs() + sp.start_ms, s.timelineMs() + sp.end_ms, sp.text])));
    void engine.say(said.samples);
    const seen = [];
    const wrong = [];
    let shotTaken = false;
    for (let t = 0; t < 9000; t += 40) {
      await H.wait(40);
      const st = s.state;
      const m = markup();
      const b = button();
      if (b !== LABEL[st]) wrong.push(`${st}→${b}`);
      if (seen[seen.length - 1] !== b) seen.push(b);
      if (shot && !shotTaken && st === 'speaking' && s.conversation().some((l) => l.who === 'them' && l.turn > 0)) {
        fs.mkdirSync(shot, { recursive: true });
        require('./shot-dashboard.cjs').photograph(m, 'dark', path.join(shot, 'call.png'), 844);
        shotTaken = true;
      }
    }
    const daemonStates = events.filter((e) => e.event === 'voice.state').map((e) => e.data.state);
    checks.push([`call screen (live): the button follows the session — ${seen.join(' → ')} (daemon: ${daemonStates.join(' → ')})`,
      !wrong.length && ['Hearing you', 'Asking…', 'Speaking', 'Listening'].every((l) => seen.includes(l))
      && seen.indexOf('Hearing you') < seen.indexOf('Speaking')]);
    const after = markup();
    checks.push(['call screen (live): what was heard and the answer are written as bubbles, and the wait is shown in seconds',
      after.includes('Testler bitti mi') && after.includes('Şu an') && /answered \d+\.\d s after you stopped/.test(after)]);

    // End call, pressed.
    R.presses().find((p) => p.text === 'End call').press();
    await H.wait(300);
    checks.push(['call screen (live): End call stops the session, releases the microphone and leaves no call to rejoin',
      s.state === 'ended' && !engine.running() && live.active() === null && calls.includes('voice.stop')]);

    // Permission refused at the screen: no session, nothing held.
    mic = false;
    engine = new H.FakeEngine();
    const before = calls.filter((c) => c === 'voice.start').length;
    R.render('dark', h(Call));
    R.presses().find((p) => p.text === 'Call').press();
    await H.wait(200);
    await flush();
    checks.push(['call screen (live): with the microphone refused nothing is started and nothing is held',
      calls.filter((c) => c === 'voice.start').length === before && live.active() === null && !engine.running() && engine.startCount === 0]);
  } catch (e) {
    checks.push([`call screen (live): ${e.stack || e}`, false]);
  } finally {
    Object.assign(V, realV);
    Object.assign(live, realLive);
    client.disconnect();
    peer.proc.stdin.end();
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
