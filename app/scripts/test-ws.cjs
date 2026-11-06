/** The phone's reconnect path, checked without a phone or a daemon.
 *
 *  `src/ws.ts` runs in a sandbox of its own whose timers, clock and WebSocket
 *  belong to the test, so fifteen-second heartbeats pass in no time and nothing
 *  else in the suite has its timers moved:
 *
 *    1. one unanswered ping is a busy computer, not a dead socket;
 *    2. two in a row bury it and dial again at once, with reason `heartbeat`;
 *    3. anything that arrives in between counts as an answer — including an
 *       answer handed over just after its timer fired (a busy JS thread);
 *    4. a foreground return asks with a two-second probe, and one that goes
 *       unanswered reconnects with reason `foreground`, as does one that finds
 *       the socket already closed — carrying the code iOS closed it with;
 *    5. a lost connection that is back within three seconds is never shown —
 *       however it went, the OS closing it included — one that is not is
 *       shown at three seconds, and the banner goes the moment it is back;
 *    6. the reason is handed over once, and `hello` carries it, with how long
 *       the old socket had been silent;
 *    7. a foreground return to a socket silent past a heartbeat replaces it at
 *       once instead of asking it for two seconds first (#291);
 *    8. a request on a socket that has gone quiet probes first, and a dead one
 *       is replaced at once and the request carried by the new one (#291);
 *    9. dials come again within two seconds, never fifteen, and a handshake
 *       is given five (#291: the `offline=80.1s` ladder);
 *   10. `callOnce` marks its socket as one-shot for the daemon's log (#291).
 *
 *  Run: node scripts/test-ws.cjs  — folded into test-ustabasi.cjs.
 */
const { transform } = require('sucrase');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
if (!require.extensions['.ts']) {
  require.extensions['.ts'] = (mod, filename) => mod._compile(transform(fs.readFileSync(filename, 'utf8'),
    { transforms: ['typescript', 'imports'], filePath: filename }).code, filename);
}
const checks = [];
const check = (name, ok) => checks.push([name, !!ok]);
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

/** Timers and a clock the test moves by hand. */
function clock() {
  let now = 1_000_000, next = 1;
  const pending = new Map();
  const add = (f, ms, every) => { const h = next++; pending.set(h, { at: now + ms, f, every }); return h; };
  return {
    setTimeout: (f, ms = 0) => add(f, ms, 0),
    setInterval: (f, ms) => add(f, ms, ms),
    clearTimeout: (h) => { pending.delete(h); },
    clearInterval: (h) => { pending.delete(h); },
    now: () => now,
    /** Time passing with no timer running: the app asleep. */
    skip(ms) { now += ms; },
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [h, t] = due;
        now = t.at;
        if (t.every) t.at += t.every; else pending.delete(h);
        t.f();
        await flush();
      }
      now = until;
      await flush();
    },
  };
}

/** `src/ws.ts` with the given clock, and the sockets it opened. */
function sandbox() {
  const c = clock();
  const sockets = [];
  // The LAN door's proof request: what answers at the home address.
  const fetches = [];
  const lan = { answer: () => new Promise(() => {}) };
  class FakeSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.closed = false; sockets.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.closed = true; this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    reply(id, data = {}) { this.onmessage?.({ data: JSON.stringify({ id, type: 'ok', data }) }); }
    event(name) { this.onmessage?.({ data: JSON.stringify({ type: 'event', event: name, data: {} }) }); }
    drop(code) { this.readyState = 3; this.onclose?.({ code }); }
    pings() { return this.sent.filter((m) => m.type === 'ping'); }
  }
  const RealDate = Date;
  const FakeDate = class extends RealDate { static now() { return c.now(); } };
  const ctx = vm.createContext({
    setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, setInterval: c.setInterval, clearInterval: c.clearInterval,
    WebSocket: FakeSocket, Date: FakeDate, console: { warn() {}, log() {}, error() {} },
    encodeURIComponent, JSON, Math, Map, Set, Promise, Error,
    fetch: (url) => { fetches.push(url); return lan.answer(url); },
  });
  const file = path.join(root, 'src/ws.ts');
  const js = transform(fs.readFileSync(file, 'utf8'), { transforms: ['typescript', 'imports'], filePath: file }).code;
  const mod = { exports: {} };
  const req = (name) => require(name.startsWith('.') ? path.join(root, 'src', name + '.ts') : name);
  vm.runInContext(`(function (exports, require, module) {${js}\n})`, ctx)(mod.exports, req, mod);
  return { c, sockets, fetches, lan, RacClient: mod.exports.RacClient, callOnce: mod.exports.callOnce };
}

async function online(s) {
  const client = new s.RacClient();
  client.connect('100.64.0.1', 8790, 't');
  s.sockets.at(-1).open();
  await flush();
  return client;
}

const GRACE = 250;                                     // HEARTBEAT_GRACE_MS

const ready = (async () => {
  // ── the heartbeat ─────────────────────────────────────────────────────────
  {
    const s = sandbox();
    const client = await online(s);
    const first = s.sockets[0];
    await s.c.advance(15_000 + 10_000 + GRACE);
    check('ws: one unanswered ping keeps the socket',
      first.pings().length === 1 && s.sockets.length === 1 && !first.closed && client.status === 'online');
    await s.c.advance(15_000);
    check('ws: a second in a row buries it and dials again at once',
      first.pings().length === 2 && first.closed && s.sockets.length === 2);
    s.sockets[1].open();
    await flush();
    const why = client.takeReconnect();
    check("ws: …with reason 'heartbeat'", why?.reason === 'heartbeat' && why.code === null && why.offline_s >= 0);
    check('ws: the reason is handed over once', client.takeReconnect() === null);
  }
  {
    const s = sandbox();
    await online(s);
    const sock = s.sockets[0];
    await s.c.advance(15_000 + 10_000 + GRACE);          // first miss
    sock.event('text.delta');                            // the socket is alive after all
    await s.c.advance(15_000);                           // second ping, unanswered too
    check('ws: anything that arrives between two misses counts as an answer',
      sock.pings().length === 2 && !sock.closed && s.sockets.length === 1);
    await s.c.advance(5_000 - GRACE);                    // third ping, answered
    sock.reply(sock.pings().at(-1).id);
    await s.c.advance(15_000 + 10_000 + GRACE);          // fourth, unanswered: one miss again
    check('ws: …and an answered ping does too', !sock.closed && s.sockets.length === 1);
  }

  // ── coming back to the foreground ───────────────────────────────────────────
  {
    const s = sandbox();
    const client = await online(s);
    const sock = s.sockets[0];
    await s.c.advance(3_000);
    client.poke();                                       // what _layout.tsx does on 'active'
    await flush();
    check('ws: a foreground return asks the socket at once', sock.pings().length === 1);
    await s.c.advance(1_900);
    const early = !sock.closed;
    await s.c.advance(100 + GRACE);
    check('ws: …and an unanswered one is dropped and reopened after two seconds, not ten',
      early && sock.closed && s.sockets.length === 2);
    s.sockets[1].open();
    await flush();
    check("ws: …with reason 'foreground'", client.takeReconnect()?.reason === 'foreground');
  }
  {
    const s = sandbox();
    const client = await online(s);
    const sock = s.sockets[0];
    await s.c.advance(3_000);
    client.poke();
    await flush();
    await s.c.advance(2_000);                            // the probe's timer fires…
    sock.reply(sock.pings()[0].id);                      // …just before the answer is handed over
    await s.c.advance(GRACE);
    check('ws: an answer handed over just after its timer fired keeps the socket',
      !sock.closed && s.sockets.length === 1);
  }

  // ── a reconnect nobody needs to see ──────────────────────────────────────────
  {
    const s = sandbox();
    const client = await online(s);
    const heard = [];
    client.onStatus((st) => heard.push(st));
    client.poke();
    await s.c.advance(2_000 + GRACE);                    // dead: dropped, a new socket dialled
    await s.c.advance(300);
    s.sockets[1].open();
    await flush();
    check('ws: a reconnect over within a second is never shown, only its arrival',
      s.sockets.length === 2 && JSON.stringify(heard) === '["online"]' && client.status === 'online');
  }
  {
    const s = sandbox();
    const client = await online(s);
    const heard = [];
    client.onStatus((st) => heard.push(st));
    client.poke();
    await s.c.advance(2_000 + GRACE + 2_999);
    const quiet = heard.length === 0;
    await s.c.advance(1);
    check('ws: …and one that is not is shown once three seconds are up',
      quiet && JSON.stringify(heard) === '["connecting"]');
  }

  // ── the banner: "Reconnecting…" is what listeners hear (#291) ───────────────
  {
    // The OS closes the socket from under the app — a return from the
    // background, a network handover — and the next dial is up in 2.5 s.
    const s = sandbox();
    const client = await online(s);
    const heard = [], link = [];
    client.onStatus((st) => heard.push(st));
    client.onLink((st) => link.push(st));
    s.sockets[0].drop(1006);
    await s.c.advance(250);                              // the first retry
    const dialled = s.sockets.length === 2;
    s.sockets[1].drop(1006);                             // refused: the Mac is still waking
    await s.c.advance(500);
    await s.c.advance(1_700);
    s.sockets[2].open();
    await flush();
    check('ws: a recovery under three seconds is never shown, whatever closed the socket',
      dialled && s.sockets.length === 3 && JSON.stringify(heard) === '["online"]');
    check('ws: …while code that must act on a drop hears every step of it at once',
      JSON.stringify(link) === '["offline","connecting","offline","connecting","online"]');
  }
  {
    const s = sandbox();
    const client = await online(s);
    const heard = [];
    client.onStatus((st) => heard.push(st));
    s.sockets[0].drop(1006);
    await s.c.advance(2_999);
    const before = heard.length;
    await s.c.advance(1);
    const shown = heard.at(-1);
    await s.c.advance(4_000);
    const still = client.status !== 'online';
    s.sockets.at(-1).open();
    await flush();
    check('ws: an outage past three seconds is shown at three seconds',
      before === 0 && (shown === 'offline' || shown === 'connecting') && still);
    check('ws: …and the banner goes the moment the socket is back', heard.at(-1) === 'online' && client.status === 'online');
  }
  {
    // Picking a computer just now is no outage: an unreachable one says so.
    const s = sandbox(), client = new s.RacClient();
    const heard = [];
    client.onStatus((st) => heard.push(st));
    client.connect('100.64.0.1', 8790, 't');
    s.sockets[0].drop(1006);
    await flush();
    check('ws: a first connection that fails is shown at once, not hushed', heard.includes('offline'));
  }

  // ── a foreground return after the app slept (#291) ─────────────────────────
  {
    const s = sandbox();
    const client = await online(s);
    const heard = [];
    client.onStatus((st) => heard.push(st));
    s.sockets[0].reply(999);                             // something arrived: the socket was alive
    // iOS suspends the app: no timers run, the socket is taken away, and on
    // return readyState still says OPEN. The clock moves; the timers do not.
    s.c.skip(60_000);
    client.poke();
    await flush();
    check('ws: a return after sixty seconds asleep replaces the socket at once, no probe first',
      s.sockets[0].closed && s.sockets.length === 2 && s.sockets[0].pings().length === 0);
    await s.c.advance(150);
    s.sockets[1].open();
    await flush();
    const why = client.takeReconnect();
    check("ws: …with reason 'foreground', and how long the old socket had been silent",
      why?.reason === 'foreground' && why.silent_s >= 60 && why.offline_s < 1);
    check('ws: …and no banner for it', JSON.stringify(heard) === '["online"]');
  }
  {
    const s = sandbox();
    const client = await online(s);
    await s.c.advance(14_000);                           // a ping went out at 15 s? not yet: quiet but fresh
    s.sockets[0].event('text.delta');
    await s.c.advance(3_000);
    client.poke();
    await flush();
    check('ws: a return to a socket that spoke recently asks it, rather than replacing it',
      !s.sockets[0].closed && s.sockets.length === 1 && s.sockets[0].pings().length === 2);
  }

  // ── a request on a socket that has gone quiet (#291) ───────────────────────
  {
    const s = sandbox();
    const client = await online(s);
    s.c.skip(20_000);                                    // asleep: nothing ran, nothing arrived
    const sent = client.call('chat.send', { text: 'hi' });
    await flush();
    const probed = s.sockets[0].pings().length === 1 && !s.sockets[0].sent.some((m) => m.type === 'chat.send');
    await s.c.advance(2_000 + GRACE);
    const replaced = s.sockets[0].closed && s.sockets.length === 2;
    s.sockets[1].open();
    await flush();
    const req = s.sockets[1].sent.find((m) => m.type === 'chat.send');
    if (req) s.sockets[1].reply(req.id, { ok: 1 });
    const got = await Promise.race([sent, new Promise((r) => setTimeout(r, 50, 'hung'))]);
    check('ws: a send on a socket silent past a heartbeat probes it before sending', probed);
    check('ws: …a dead one is replaced at once', replaced);
    check('ws: …and the send goes out on the new socket and is answered', !!req && got?.ok === 1);
    check("ws: …with reason 'probe'", client.takeReconnect()?.reason === 'probe');
  }
  {
    const s = sandbox();
    const client = await online(s);
    await s.c.advance(4_000);
    void client.call('chat.send', { text: 'hi' });
    await flush();
    check('ws: a send on a socket that is fresh goes straight out, no probe',
      s.sockets[0].pings().length === 0 && s.sockets[0].sent.some((m) => m.type === 'chat.send'));
  }
  {
    // The interval's ping is out with ten seconds to run; a probe does not
    // hide behind it.
    const s = sandbox();
    const client = await online(s);
    await s.c.advance(15_000);                           // heartbeat ping out, unanswered
    s.c.skip(5_000);
    void client.call('chat.send', { text: 'hi' });
    await flush();
    check('ws: a probe goes out even with a heartbeat ping already waiting', s.sockets[0].pings().length === 2);
    s.sockets[0].reply(s.sockets[0].pings()[1].id);
    await flush();
    check('ws: …and an answer to it lets the request through on the same socket',
      s.sockets.length === 1 && s.sockets[0].sent.some((m) => m.type === 'chat.send'));
  }

  // ── dialling again (#291) ─────────────────────────────────────────────────
  {
    const s = sandbox();
    const client = await online(s);
    s.sockets[0].drop(1006);
    const at = [];
    for (let i = 0; i < 9; i++) {
      const n = s.sockets.length;
      const from = s.c.now();
      while (s.sockets.length === n) await s.c.advance(50);
      at.push(s.c.now() - from);
      s.sockets.at(-1).drop(1006);                       // refused: the Mac is restarting
    }
    check('ws: dials come again at 0.25, 0.5, 1, 2 s and then every 2 s, never 15',
      JSON.stringify(at) === JSON.stringify([250, 500, 1000, 2000, 2000, 2000, 2000, 2000, 2000]));
    client.disconnect();
  }
  {
    // Node's WebSocket answers a refused dial with an error and no close.
    const s = sandbox(), client = new s.RacClient();
    client.connect('100.64.0.1', 8790, 't');
    s.sockets[0].onerror?.();
    await s.c.advance(250);
    check('ws: a dial that errors with no close is over at once and dialled again, not left for the handshake limit',
      s.sockets[0].closed && s.sockets.length === 2 && client.status === 'connecting');
    client.disconnect();
  }
  {
    const s = sandbox();
    const { callOnce } = s;
    void callOnce('100.64.0.1', 8790, 't', 'divan.snapshot', {}).catch(() => {});
    check('ws: callOnce marks its socket as one-shot', /[?&]once=1(&|$)/.test(s.sockets[0].url)
      && /token=t(&|$)/.test(s.sockets[0].url));
  }
  {
    const s = sandbox();
    const client = await online(s);
    s.sockets[0].drop(1006);                             // iOS closed it in the background
    await s.c.advance(500);
    client.poke();
    await flush();
    check('ws: a foreground return to a closed socket dials at once', s.sockets.length === 2);
    s.sockets[1].open();
    await flush();
    const why = client.takeReconnect();
    check("ws: …preserving the original socket failure and close code",
      why?.reason === 'socket' && why.code === 1006 && why.offline_s === 0.5);
  }
  {
    const s = sandbox();
    const client = await online(s);
    s.sockets[0].drop(1006);
    await s.c.advance(1_000);                            // the backoff's own retry
    s.sockets[1].open();
    await flush();
    const why = client.takeReconnect();
    check("ws: a socket the OS closed comes back with reason 'socket'", why?.reason === 'socket' && why.code === 1006);
  }
  {
    const s = sandbox();
    const client = await online(s);
    s.sockets[0].drop(1001);
    client.poke('restart');                              // the daemon said it was restarting
    s.sockets[1].open();
    await flush();
    check("ws: a daemon restart comes back with reason 'restart'", client.takeReconnect()?.reason === 'restart');
  }

  {
    const s = sandbox(), client = new s.RacClient();
    client.connect('100.64.0.1', 8790, 't');
    const first = s.sockets[0], lateOpen = first.onopen;
    await s.c.advance(4999);
    const early = !first.closed;
    await s.c.advance(1);
    check('ws: a stalled handshake is closed after five seconds', early && first.closed && client.status === 'offline');
    await s.c.advance(250);
    check('ws: a stalled handshake is retried', s.sockets.length === 2);
    lateOpen();
    check('ws: a stale open cannot revive the abandoned socket', client.status === 'connecting');
    s.sockets[1].open();
    await flush();
    check('ws: the next attempt can recover', client.status === 'online');
    client.disconnect();
    await s.c.advance(30000);
    check('ws: disconnect cancels handshake and retry work', s.sockets.length === 2 && client.status === 'idle');
  }
  {
    const s = sandbox(), client = new s.RacClient();
    client.connect('100.64.0.1', 8790, 't');
    await s.c.advance(3000);
    client.connect('100.64.0.2', 8790, 'other');
    await s.c.advance(3000);
    check('ws: switching hosts cancels the old handshake deadline', !s.sockets[1].closed);
    client.disconnect();
    await s.c.advance(20000);
    check('ws: cancelling a pending connection does not redial', s.sockets.length === 2);
  }

  // ── the LAN door (2026-11-06: tailnet reconnects of 136-782 s at home) ──────
  const crypto = require('crypto');
  const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
  const ours = (token) => (url) => {
    const nonce = new URL(url).searchParams.get('nonce');
    return Promise.resolve({ ok: true, json: async () => ({ proof: sha(`${sha(token)}:${nonce}`) }) });
  };
  const LAN = { host: '192.168.178.149', deviceId: 'dev1' };
  {
    const s = sandbox();
    s.lan.answer = ours('t');
    const client = new s.RacClient();
    client.connect('100.64.0.1', 8790, 't', LAN);
    await flush();
    check('ws: at home the LAN address is asked to prove itself first',
      s.fetches.length === 1 && s.fetches[0].startsWith('http://192.168.178.149:8790/lan/proof?device=dev1&nonce='));
    check('ws: …and once it has, the socket is dialled there, not on the tailnet',
      s.sockets.length === 1 && s.sockets[0].url.startsWith('ws://192.168.178.149:8790/ws?token=t'));
    s.sockets[0].open();
    await flush();
    client.takeReconnect();                              // what `hello` does on every open
    s.sockets[0].drop(1006);
    await flush();
    await s.c.advance(250);
    s.sockets.at(-1).open();
    await flush();
    const why = client.takeReconnect();
    check('ws: a reconnect at home goes through the LAN again, and says so',
      s.sockets.at(-1).url.includes('192.168.178.149') && why?.via === 'lan' && why.dials === 1 && why.fails.length === 0);
  }
  {
    const s = sandbox();
    s.lan.answer = ours('somebody-else');
    const client = new s.RacClient();
    client.connect('100.64.0.1', 8790, 't', LAN);
    await flush();
    check('ws: a stranger at the home address never sees the token',
      s.sockets.every((w) => !w.url.includes('192.168.178.149')));
    check('ws: …and the tailnet is dialled at once',
      s.sockets.length === 1 && s.sockets[0].url.startsWith('ws://100.64.0.1:8790/'));
    s.sockets[0].open();
    await flush();
    client.takeReconnect();                              // what `hello` does on every open
    s.sockets[0].drop(1006);
    await flush();
    s.lan.answer = ours('somebody-else');
    await s.c.advance(250);
    await flush();
    s.sockets.at(-1).open();
    await flush();
    const why = client.takeReconnect();
    check("ws: …the failed proof is told to the daemon as 'lan-proof'",
      why?.via === 'tailnet' && why.fails.includes('lan-proof') && why.dials === 2);
  }
  {
    const s = sandbox();                                 // away: nothing answers at the LAN address
    const client = new s.RacClient();
    client.connect('100.64.0.1', 8790, 't', LAN);
    await flush();
    await s.c.advance(1199);
    check('ws: away from home the tailnet waits for the LAN proof no longer than 1.2 s',
      s.sockets.length === 0);
    await s.c.advance(60);
    check('ws: …and is dialled as soon as it times out', s.sockets.length === 1 && s.sockets[0].url.includes('100.64.0.1'));
  }
  {
    const s = sandbox();
    s.lan.answer = ours('t');
    const client = new s.RacClient();
    client.connect('100.64.0.1', 8790, 't', LAN);
    await flush();
    await s.c.advance(1500);                             // the LAN handshake stalls
    check('ws: a LAN handshake that stalls gives way to the tailnet after 1.5 s',
      s.sockets.length === 2 && s.sockets[0].closed && s.sockets[1].url.includes('100.64.0.1'));
    await s.c.advance(5000);                             // the tailnet stalls too
    await s.c.advance(250);
    await flush();
    check('ws: when the tailnet fails too, the next dial tries the LAN again',
      s.fetches.length === 2 && s.sockets.at(-1).url.includes('192.168.178.149'));
    s.sockets.at(-1).open();
    await flush();
    const why = client.takeReconnect();
    check('ws: every failed dial is counted and named for the daemon',
      why?.via === 'lan' && why.dials === 3 && why.fails.join(',') === 'lan-timeout,timeout');
  }
  {
    const s = sandbox();
    s.lan.answer = ours('t');
    const client = new s.RacClient();
    client.connect('100.64.0.1', 8790, 't', LAN);
    await flush();
    s.sockets[0].drop(4401);
    await flush();
    await s.c.advance(10_000);
    check('ws: a token refused on the LAN is refused, not retried on the tailnet',
      client.status === 'unauthorized' && s.sockets.length === 1);
  }
  {
    const s = sandbox();
    const client = await online(s);                      // paired before the LAN door existed
    client.setLan(LAN);
    s.lan.answer = ours('t');
    s.sockets[0].drop(1006);
    await flush();
    await s.c.advance(250);
    check('ws: a LAN address learned while online is used from the next dial',
      s.fetches.length === 1 && s.sockets.at(-1).url.includes('192.168.178.149'));
  }

  const store = fs.readFileSync(path.join(root, 'src/store.ts'), 'utf8');
  check('ws: a connection coming back is a new link the open chat replays on',
    /linkGen: get\(\)\.linkGen \+ 1/.test(store)
    && /\[id, conn, linkGen, openChat, tryCount\]/.test(fs.readFileSync(path.join(root, 'app/chat/[id].tsx'), 'utf8')));
  check('ws: `hello` carries the reason the socket came back',
    /const reconnect = client\.takeReconnect\(\)/.test(store) && /client\.call\('hello', \{[^}]*reconnect \}/.test(store));
})();

module.exports = { checks, ready };

if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) { console.log((ok ? '  ok    ' : '  FAIL  ') + name); if (!ok) bad++; }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  });
}
