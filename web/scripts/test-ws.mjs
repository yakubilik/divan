#!/usr/bin/env node
/** The panel's socket on a slow, lossy link, checked without a browser or a daemon.
 *
 *     cd web && node scripts/test-ws.mjs        (part of `npm test`)
 *
 *  `src/lib/ws.ts` is built and run here with a WebSocket, timers and a clock
 *  that belong to the test, so fifteen-second heartbeats pass in no time. The
 *  rules are the phone's (`app/src/ws.ts`, checked by `app/scripts/test-ws.cjs`):
 *
 *    1. one unanswered ping is a slow link, not a dead socket; two in a row
 *       bury it and dial again at once;
 *    2. anything that arrives in between counts as an answer — including a
 *       frame handed over just after the ping's timer fired;
 *    3. dials come again at 0.25, 0.5, 1, 2 s and then every 2 s;
 *    4. a handshake is given five seconds, then closed and dialled again;
 *    5. coming back to the tab asks the socket with a two-second ping that
 *       forgives nothing, and replaces at once one that has been silent for
 *       longer than a heartbeat;
 *    6. a computer that refuses the token (4401) is never dialled again,
 *       however the socket before it went.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'ws');

// ── build ───────────────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/lib/ws.ts', 'src/vite-env.d.ts',
  '--outDir', out, '--rootDir', '.',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--strict', '--skipLibCheck',
], { cwd: web, stdio: 'inherit' });

for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => (
      spec.endsWith('.js') ? m : `${a}${spec}.js${z}`
    )));
}

// ── a clock and a socket the test moves by hand ─────────────────────────────

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

let now = 1_000_000, nextHandle = 1;
const timers = new Map();
const add = (f, ms, every) => { const h = nextHandle++; timers.set(h, { at: now + (ms || 0), f, every }); return h; };
globalThis.setTimeout = (f, ms = 0) => add(f, ms, 0);
globalThis.setInterval = (f, ms) => add(f, ms, ms);
globalThis.clearTimeout = (h) => { timers.delete(h); };
globalThis.clearInterval = (h) => { timers.delete(h); };
Date.now = () => now;
console.warn = () => {};                                // the client says when it buries a socket

/** Time passing, every timer due in it run in order. */
async function advance(ms) {
  const until = now + ms;
  for (;;) {
    const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    const [h, t] = due;
    now = t.at;
    if (t.every) t.at += t.every; else timers.delete(h);
    t.f();
    await flush();
  }
  now = until;
  await flush();
}
/** Time passing with no timer running: the laptop asleep, the tab frozen. */
const skip = (ms) => { now += ms; };

let sockets = [];
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.closed = false; sockets.push(this); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  reply(id, data = {}) { this.onmessage?.({ data: JSON.stringify({ id, type: 'ok', data }) }); }
  event(name) { this.onmessage?.({ data: JSON.stringify({ type: 'event', event: name, data: {} }) }); }
  /** The far end goes, or says no: a close with a code and a reason. */
  drop(code, reason = '') { this.readyState = 3; this.onclose?.({ code, reason }); }
  pings() { return this.sent.filter((m) => m.type === 'ping'); }
}
globalThis.WebSocket = FakeSocket;

const { RacClient } = await import(pathToFileURL(join(out, 'src', 'lib', 'ws.js')).href);

const GRACE = 250;                                      // HEARTBEAT_GRACE_MS

const checks = [];
const check = (name, ok, detail) => checks.push([name, !!ok, detail]);

/** One story, on a clock and a set of sockets of its own. */
async function scene(name, run) {
  timers.clear();
  sockets = [];
  try { await run(); } catch (e) { check(`${name} (threw)`, false, String(e?.stack ?? e)); }
}

let tokens = 0;
async function online(token = `t${++tokens}`) {
  const client = new RacClient();
  client.connect('100.64.0.1', 8790, token);
  sockets.at(-1).open();
  await flush();
  return client;
}

// ── the heartbeat ───────────────────────────────────────────────────────────

await scene('heartbeat: one miss, then two', async () => {
  const client = await online();
  const first = sockets[0];
  await advance(15_000 + 10_000 + GRACE);
  check('one unanswered ping keeps the socket',
    first.pings().length === 1 && sockets.length === 1 && !first.closed && client.status === 'online',
    `pings=${first.pings().length} sockets=${sockets.length} status=${client.status}`);
  await advance(15_000 - 1);
  const early = !first.closed && sockets.length === 1;
  await advance(1);
  const dialled = first.closed && sockets.length === 2 && client.status === 'connecting';
  sockets.at(-1).open();
  await flush();
  check('a second in a row buries it and dials again at once, and the new socket is the connection',
    early && first.pings().length === 2 && dialled && client.status === 'online' && sockets.length === 2,
    `early=${early} pings=${first.pings().length} dialled=${dialled} sockets=${sockets.length} status=${client.status}`);
});

await scene('heartbeat: a failed call after the bury', async () => {
  const client = await online();
  const heard = [];
  client.onStatus((s) => heard.push(s));
  let said = null;
  await advance(15_000 + 10_000 + GRACE + 14_000);       // one miss; the second ping is out
  client.call('chat.get', {}).catch((e) => { said = e; });
  await advance(1_000);                                  // the second miss
  check('a request waiting on a buried socket is told the computer is offline, and listeners hear the redial',
    said?.code === 'offline' && JSON.stringify(heard) === '["offline","connecting"]' && sockets.length === 2,
    `said=${said?.code} heard=${JSON.stringify(heard)} sockets=${sockets.length}`);
});

await scene('heartbeat: frames between misses', async () => {
  await online();
  const sock = sockets[0];
  await advance(15_000 + 10_000 + GRACE);                // first miss
  sock.event('text.delta');                              // the socket is alive after all
  await advance(15_000);                                 // second ping, unanswered too
  check('anything that arrives between two misses counts as an answer',
    sock.pings().length === 2 && !sock.closed && sockets.length === 1,
    `pings=${sock.pings().length} closed=${sock.closed} sockets=${sockets.length}`);
  await advance(5_000 - GRACE);                          // third ping, answered
  sock.reply(sock.pings().at(-1).id);
  await advance(15_000 + 10_000 + GRACE);                // fourth, unanswered: one miss again
  check('…and an answered ping does too',
    sock.pings().length === 4 && !sock.closed && sockets.length === 1,
    `pings=${sock.pings().length} closed=${sock.closed} sockets=${sockets.length}`);
});

await scene('heartbeat: a frame during the grace', async () => {
  const client = await online();
  const sock = sockets[0];
  await advance(15_000 + 10_000 + GRACE);                // first miss
  await advance(5_000 - GRACE + 10_000);                 // the second ping's timer has just fired…
  const waiting = !sock.closed && sock.pings().length === 2;
  sock.event('text.delta');                              // …and a frame that was already here is handed over
  await advance(GRACE);
  check('a frame that arrives during the grace keeps the socket',
    waiting && !sock.closed && sockets.length === 1 && client.status === 'online',
    `waiting=${waiting} closed=${sock.closed} sockets=${sockets.length} status=${client.status}`);
  await advance(5_000 - GRACE + 10_000 + GRACE);         // the third ping: a first miss again, not a second
  const kept = !sock.closed && sockets.length === 1;
  await advance(5_000 - GRACE + 10_000 + GRACE);         // the fourth: nothing came in between
  check('…and the miss before it is forgiven, so it takes two more to bury the socket',
    kept && sock.closed && sockets.length === 2, `kept=${kept} closed=${sock.closed} sockets=${sockets.length}`);
});

// ── dialling again ──────────────────────────────────────────────────────────

await scene('retry delays', async () => {
  const client = await online();
  sockets[0].drop(1006);
  const at = [];
  for (let i = 0; i < 9; i++) {
    const n = sockets.length;
    const from = now;
    while (sockets.length === n && now - from < 20_000) await advance(50);
    at.push(now - from);
    sockets.at(-1).drop(1006);                           // refused: the daemon is restarting
  }
  check('dials come again at 0.25, 0.5, 1, 2 s, then slow to every 15 s for a computer that stays away',
    JSON.stringify(at) === JSON.stringify([250, 500, 1000, 2000, 4000, 8000, 15000, 15000, 15000]), JSON.stringify(at));
  await advance(15_000);
  sockets.at(-1).open();                                 // accepted, and dropped at once (a peer proxy's peer_gone)
  await flush();
  sockets.at(-1).drop(1006);
  await advance(250);
  check('…a socket dropped as soon as it opened does not start the ladder over',
    sockets.length === 11, `sockets=${sockets.length}`);
  await advance(15_000);
  sockets.at(-1).open();
  await flush();
  await advance(3_000);                                  // it stays up a while
  sockets.at(-1).drop(1006);
  await advance(250);
  check('…and a connection that came back starts the ladder over',
    client.status === 'connecting' && sockets.length === 13, `status=${client.status} sockets=${sockets.length}`);
  client.disconnect();
});

// ── the handshake ───────────────────────────────────────────────────────────

await scene('handshake timeout', async () => {
  const client = new RacClient();
  client.connect('100.64.0.1', 8790, `t${++tokens}`);
  const first = sockets[0], lateOpen = first.onopen;
  await advance(4_999);
  const early = !first.closed && client.status === 'connecting';
  await advance(1);
  check('a stalled handshake is closed after five seconds',
    early && first.closed && client.status === 'offline', `early=${early} closed=${first.closed} status=${client.status}`);
  await advance(250);
  check('…and dialled again', sockets.length === 2 && client.status === 'connecting',
    `sockets=${sockets.length} status=${client.status}`);
  lateOpen?.();
  await advance(5_000 + 500);                            // the second stalls too; the third is out
  check('a stale open cannot revive the abandoned socket, and each dial has its own five seconds',
    sockets.length === 3 && sockets[1].closed && client.status === 'connecting',
    `sockets=${sockets.length} status=${client.status}`);
  sockets[2].open();
  await flush();
  await advance(20_000);
  check('the next attempt can recover, and an open socket is not closed by the handshake limit',
    client.status === 'online' && !sockets[2].closed && sockets.length === 3,
    `status=${client.status} sockets=${sockets.length}`);
  client.disconnect();
});

await scene('handshake timeout: switching and leaving', async () => {
  const client = new RacClient();
  client.connect('100.64.0.1', 8790, `t${++tokens}`);
  await advance(3_000);
  client.connect('100.64.0.2', 8790, `t${++tokens}`);
  await advance(3_000);                                  // six seconds after the first dial
  const kept = sockets.length === 2 && sockets[0].closed && !sockets[1].closed;
  await advance(2_000);                                  // five after the second
  const own = sockets[1].closed && client.status === 'offline';
  client.disconnect();
  await advance(30_000);
  check('switching computers cancels the old handshake deadline and starts its own, and disconnect cancels the retry',
    kept && own && sockets.length === 2 && client.status === 'idle',
    `kept=${kept} own=${own} sockets=${sockets.length} status=${client.status}`);
});

// ── coming back to the tab ──────────────────────────────────────────────────

await scene('foreground: a probe', async () => {
  const client = await online();
  const sock = sockets[0];
  await advance(3_000);
  client.poke();                                         // what App.tsx does on 'visibilitychange'
  client.poke();                                         // …and again on 'focus'
  await flush();
  const asked = sock.pings().length === 1 && !sock.closed && sockets.length === 1;
  await advance(1_900);
  const early = !sock.closed;
  await advance(100 + GRACE);
  check('coming back asks a socket that spoke recently, once, and an unanswered one is replaced after two seconds, not ten',
    asked && early && sock.closed && sockets.length === 2,
    `asked=${asked} early=${early} closed=${sock.closed} sockets=${sockets.length}`);
});

await scene('foreground: a probe answered late', async () => {
  const client = await online();
  const sock = sockets[0];
  await advance(3_000);
  client.poke();
  await flush();
  await advance(2_000);                                  // the probe's timer fires…
  sock.reply(sock.pings()[0].id);                        // …just before the answer is handed over
  await advance(GRACE);
  const kept = !sock.closed && sockets.length === 1 && client.status === 'online';
  client.poke();                                         // the first probe is over: this one asks again
  await flush();
  const again = sock.pings().length === 2;
  await advance(2_000 + GRACE);                          // …and nothing at all comes back
  check('an answer handed over just after the probe\'s two seconds keeps the socket; no answer at all does not',
    kept && again && sock.closed && sockets.length === 2,
    `kept=${kept} again=${again} closed=${sock.closed} sockets=${sockets.length}`);
});

await scene('foreground: after a sleep', async () => {
  const client = await online();
  const sock = sockets[0];
  sock.event('text.delta');                              // something arrived: the socket was alive
  // The laptop slept: the far end gave up on the socket, and on waking the
  // browser still says OPEN.
  await advance(1_000);
  client.poke();
  await flush();
  const asked = !sock.closed && sockets.length === 1 && sock.pings().length === 1;
  await advance(2_000 + GRACE);                          // …and the dead socket says nothing
  check('a return to a socket that died with a sleeping laptop asks it first, and replaces it two seconds later',
    asked && sock.closed && sockets.length === 2,
    `asked=${asked} closed=${sock.closed} sockets=${sockets.length} pings=${sock.pings().length}`);
});

await scene('foreground: a hidden tab', async () => {
  const client = await online();
  const sock = sockets[0];
  // A hidden tab's timers run about once a minute: the socket is fine, its
  // last ping is simply long ago.
  skip(60_000);
  client.poke();
  await flush();
  sock.reply(sock.pings().at(-1).id);
  await advance(2_000 + GRACE);
  check('a return to a quiet socket that still answers keeps it: no reconnect for a tab that was only hidden',
    !sock.closed && sockets.length === 1 && client.status === 'online',
    `closed=${sock.closed} sockets=${sockets.length} status=${client.status}`);
});

await scene('foreground: a heartbeat ping already out', async () => {
  const client = await online();
  const sock = sockets[0];
  await advance(15_000);                                 // the interval's ping is out, ten seconds to run
  await advance(1_000);
  client.poke();
  await flush();
  const own = sock.pings().length === 2;
  await advance(2_000 + GRACE);
  check('a foreground check does not hide behind the heartbeat\'s ping: it sends its own and decides in two seconds',
    own && sock.closed && sockets.length === 2, `own=${own} closed=${sock.closed} sockets=${sockets.length}`);
});

// ── a refusal ───────────────────────────────────────────────────────────────

await scene('refused on the redial', async () => {
  const client = await online();
  sockets[0].drop(1006);
  await advance(250);                                    // the first retry
  const redialled = sockets.length === 2;
  sockets[1].drop(4401, 'revoked');
  client.poke();
  await advance(60_000);
  check('a redial the computer refuses (4401) ends in unauthorized, and nothing dials again',
    redialled && client.status === 'unauthorized' && client.refusal?.kind === 'revoked' && sockets.length === 2,
    `redialled=${redialled} status=${client.status} refusal=${JSON.stringify(client.refusal)} sockets=${sockets.length}`);
});

await scene('refused on the first dial', async () => {
  const client = new RacClient();
  const heard = [];
  client.onStatus((s) => heard.push(s));
  const token = `t${++tokens}`;
  client.connect('100.64.0.1', 8790, token);
  sockets[0].drop(4401, 'unknown_token');
  client.poke();
  await advance(60_000);                                 // past every retry step and the handshake limit
  let said = null;
  await client.call('ping').catch((e) => { said = e; });
  client.connect('100.64.0.1', 8790, token);
  check('a first dial the computer refuses ends in unauthorized: no retry, no handshake timeout, no second offer',
    client.status === 'unauthorized' && client.refusal?.kind === 'unknown_token' && sockets.length === 1
    && JSON.stringify(heard) === '["connecting","unauthorized","unauthorized"]' && said?.code === 'unauthorized',
    `status=${client.status} refusal=${JSON.stringify(client.refusal)} sockets=${sockets.length} heard=${JSON.stringify(heard)} said=${said?.code}`);
});

// ── the verdict ─────────────────────────────────────────────────────────────

let bad = 0;
for (const [name, ok, detail] of checks) {
  console.log((ok ? '  ok    ' : '  FAIL  ') + name);
  if (!ok) { bad++; if (detail) console.log(`          ${detail}`); }
}
console.log(bad ? `\n${bad} of ${checks.length} failed` : `\nall ${checks.length} checks passed`);
process.exit(bad ? 1 : 0);
