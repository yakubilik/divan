/** The phone, for the live socket checks (#291): `src/ws.ts` itself on Node's
 *  own WebSocket, doing with it what the app does.
 *
 *  As the store does: on every 'online' it says `hello` with the reason the
 *  last socket went and — as the open chat does, without waiting for that —
 *  asks the chat for what it missed, forward from where it stood when the
 *  socket went (store.ts `resumeFrom`), page by page.
 *  Events that arrive live are kept by sequence number too. Every second it
 *  asks the daemon something, the way a screen that is open does, and keeps
 *  what became of each request.
 *
 *  Driven by its parent over IPC (see ws-live-kit.cjs `phone()`). Every status
 *  the screen would be shown (`onStatus`) and every real change of the socket
 *  (`onLink`) is reported as it happens.
 */
const { transform } = require('sucrase');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
if (!require.extensions['.ts']) {
  require.extensions['.ts'] = (mod, filename) => mod._compile(transform(fs.readFileSync(filename, 'utf8'),
    { transforms: ['typescript', 'imports'], filePath: filename }).code, filename);
}

// Every socket the phone opens, and which kind: the live one or a one-shot.
const opened = { live: 0, once: 0 };
const Real = globalThis.WebSocket;
globalThis.WebSocket = class extends Real {
  constructor(url, ...rest) {
    super(url, ...rest);
    if (/[?&]once=1/.test(String(url))) opened.once++; else opened.live++;
  }
};
for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) globalThis.WebSocket[k] = Real[k];

const { RacClient, callOnce } = require(path.join(root, 'src/ws.ts'));
const client = new RacClient();
const say = (m) => { try { process.send(m); } catch {} };
console.warn = () => {};

let chat = null;
const seen = new Set();                // sequence numbers of the chat, however they arrived
let replaying = null;
let replays = 0;
const reasons = [];
const calls = { ok: 0, dropped: 0, timeout: 0, other: 0, pending: 0 };
let ticking = true;

client.onStatus((s) => {
  say({ kind: 'status', s, t: Date.now() });
  if (s === 'online') replaying = afterConnect();
});
let linked = false;
let resumeFrom = null;
client.onLink((s) => {
  say({ kind: 'link', s, t: Date.now() });
  if (s === 'online') { linked = true; return; }
  if (linked && resumeFrom == null && seen.size) resumeFrom = Math.max(...seen);
  linked = false;
});
client.on((ev) => {
  if (ev.chat_id === chat && ev.event === 'soak.tick' && ev.seq != null) seen.add(ev.seq);
});

async function catchUp() {
  const from = resumeFrom;
  let since = from ?? (seen.size ? Math.max(...seen) : 0);
  for (let page = 0; page < 50; page++) {
    const r = await client.call('chat.get', { chat_id: chat, since_seq: since });
    const evs = r.events.filter((e) => (e.seq ?? 0) > since);
    for (const e of evs) if (e.event === 'soak.tick') seen.add(e.seq);
    if (!r.more || !evs.length) break;
    since = evs[evs.length - 1].seq;
  }
  if (resumeFrom === from) resumeFrom = null;
}

/** Resolves when the chat is caught up; `hello` runs beside it, as in the
 *  app, where the open chat's own effect does not wait for the store's hello. */
function afterConnect() {
  const reconnect = client.takeReconnect() ?? undefined;
  if (reconnect) reasons.push(reconnect);
  client.call('hello', { device_name: 'iPhone', reconnect })
    .catch((e) => say({ kind: 'hello-failed', message: e?.message, t: Date.now() }));
  return catchUp().then(() => {
    replays++;
    say({ kind: 'live', t: Date.now() });
  }, (e) => say({ kind: 'replay-failed', message: e?.message, t: Date.now() }));
}

function track(p) {
  calls.pending++;
  return p.then(() => { calls.ok++; }, (e) => {
    const m = String(e?.message || '');
    if (/timed out|zaman/i.test(m)) calls.timeout++;
    else if (e?.code === 'offline') calls.dropped++;
    else calls.other++;
  }).finally(() => { calls.pending--; });
}

let inflight = new Set();
setInterval(() => {
  if (!ticking || !chat) return;
  const p = track(client.call('ping', {}));
  inflight.add(p);
  p.finally(() => inflight.delete(p));
}, 1000);

process.on('message', async (m) => {
  const re = m.id;
  try {
    if (m.cmd === 'connect') {
      chat = m.chat;
      client.connect('127.0.0.1', m.port, m.token);
      say({ re });
    } else if (m.cmd === 'pause') {
      // The app going to the background: nothing more is asked.
      ticking = false;
      await Promise.allSettled([...inflight]);
      say({ re });
    } else if (m.cmd === 'resume') {
      ticking = true;
      say({ re });
    } else if (m.cmd === 'foreground') {
      // What _layout.tsx does on AppState 'active'.
      client.poke();
      say({ re, t: Date.now() });
    } else if (m.cmd === 'check') {
      // Back online: a request answered on a live socket, and if the socket is
      // a new one, what it missed fetched.
      const t0 = Date.now();
      await client.call('ping', {}, 10000);
      if (replaying) await replaying;
      say({ re, ms: Date.now() - t0, status: client.status });
    } else if (m.cmd === 'once') {
      // What loadDivan does for a computer the phone is not connected to.
      const out = [];
      for (let i = 0; i < m.n; i++) {
        try { await callOnce('127.0.0.1', m.port, m.token, 'ping', {}, 15000); out.push('ok'); }
        catch (e) { out.push(String(e?.message)); }
        await new Promise((r) => setTimeout(r, m.gap ?? 100));
      }
      say({ re, out });
    } else if (m.cmd === 'report') {
      if (replaying) await replaying;
      await catchUp();
      // The daemon's own record of the chat, forward from the first one seen.
      const first = Math.min(...seen);
      const theirs = [];
      let since = first - 1;
      for (let page = 0; page < 200; page++) {
        const r = await client.call('chat.get', { chat_id: chat, since_seq: since, limit: 2000 });
        for (const e of r.events) if (e.event === 'soak.tick') theirs.push(e.seq);
        if (!r.more || !r.events.length) break;
        since = r.events[r.events.length - 1].seq;
      }
      const last = Math.max(...seen);
      const missing = theirs.filter((s) => s <= last && !seen.has(s));
      say({ re, seen: seen.size, first, last, theirs: theirs.length, missing: missing.slice(0, 20), missingCount: missing.length,
            calls: { ...calls }, opened: { ...opened }, replays, reasons });
    }
  } catch (e) {
    say({ re, error: String(e?.message || e) });
  }
});

process.on('SIGTERM', () => { client.disconnect(); process.exit(0); });
