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
 *    5. a reconnect that is over within a second is never shown;
 *    6. the reason is handed over once, and `hello` carries it.
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
  });
  const file = path.join(root, 'src/ws.ts');
  const js = transform(fs.readFileSync(file, 'utf8'), { transforms: ['typescript', 'imports'], filePath: file }).code;
  const mod = { exports: {} };
  const req = (name) => require(name.startsWith('.') ? path.join(root, 'src', name + '.ts') : name);
  vm.runInContext(`(function (exports, require, module) {${js}\n})`, ctx)(mod.exports, req, mod);
  return { c, sockets, RacClient: mod.exports.RacClient };
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
    await s.c.advance(2_000 + GRACE + 999);
    const quiet = heard.length === 0;
    await s.c.advance(1);
    check('ws: …and one that is not is shown once the second is up',
      quiet && JSON.stringify(heard) === '["connecting"]');
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
    check("ws: …with reason 'foreground' and the code it was closed with",
      why?.reason === 'foreground' && why.code === 1006 && why.offline_s === 0.5);
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

  const store = fs.readFileSync(path.join(root, 'src/store.ts'), 'utf8');
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
