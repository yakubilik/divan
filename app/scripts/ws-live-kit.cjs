/** What the live socket checks share (#291): a real daemon, a proxy that can
 *  break the line between it and the phone, and the phone's own socket client
 *  in a process of its own.
 *
 *    · `peer()` starts `daemon/scripts/soak_peer.py` — the real Server under
 *      uvicorn, configured as `divan serve` is, on its own DIVAN_HOME — whose
 *      one chat gets a numbered event every 200 ms. `restart()` stops it and
 *      starts it again on the same home and port: the same computer after a
 *      restart.
 *    · `proxy()` sits between the two and injects the faults: a stall of
 *      everything the daemon sends, a connection killed with no close frame,
 *      and the line going dead while the phone sleeps (the daemon's side torn
 *      down, the phone's left open and silent — what iOS hands back).
 *    · `phone()` runs `ws-live-child.cjs`: `src/ws.ts` itself, on Node's own
 *      WebSocket, doing what the store and the open chat do with it. It can
 *      be frozen with SIGSTOP — no timer runs, nothing is read, exactly an app
 *      iOS has suspended — and woken with a foreground.
 *
 *  Not a test: test-ws-live.cjs and soak-ws.cjs use it.
 */
const { spawn, fork } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const repo = path.join(root, '..');

function python() {
  const tries = [process.env.PY, path.join(repo, 'daemon/.venv/bin/python'),
    path.join(os.homedir(), 'projects/divan/daemon/.venv312/bin/python'),
    path.join(os.homedir(), 'projects/divan/daemon/.venv/bin/python')].filter(Boolean);
  return tries.find((p) => fs.existsSync(p)) ?? null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

/** The daemon. `log` is everything it wrote to stderr, line by line. `extra`
 *  is more of soak_peer.py's own flags. */
async function peer(py, extra = []) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'divan-soak-'));
  const port = await freePort();
  const log = [];
  let proc = null;
  let info = null;
  async function start() {
    proc = spawn(py, [path.join(repo, 'daemon/scripts/soak_peer.py'), '--home', home, '--port', String(port), ...extra],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (b) => {
      err += b.toString();
      const lines = err.split('\n');
      err = lines.pop();
      for (const l of lines) log.push(l);
    });
    info = await new Promise((resolve, reject) => {
      let out = '';
      // Three minutes: on 25 Oct 2026, at load 28, importing the daemon alone took 56 s
      // of wall clock for 3 s of CPU, and the peer came up after 88 s.
      const timer = setTimeout(() => reject(new Error(`soak_peer did not start:\n${log.slice(-20).join('\n')}`)), 180000);
      proc.stdout.on('data', (b) => {
        out += b.toString();
        const nl = out.indexOf('\n');
        if (nl >= 0) { clearTimeout(timer); resolve(JSON.parse(out.slice(0, nl))); }
      });
      proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`soak_peer exited ${code}:\n${log.slice(-20).join('\n')}`)); });
    });
    return info;
  }
  async function stop(signal = 'SIGTERM') {
    if (!proc || proc.exitCode !== null || proc.signalCode) return;
    const gone = new Promise((r) => proc.once('exit', r));
    proc.kill(signal);
    const t = setTimeout(() => proc.kill('SIGKILL'), 10000);
    await gone;
    clearTimeout(t);
  }
  await start();
  return {
    get info() { return info; }, port, log,
    async restart() { await stop(); return start(); },
    async close() { await stop(); fs.rmSync(home, { recursive: true, force: true }); },
  };
}

/** A TCP proxy in front of the daemon, with faults to inject. */
async function proxy(upstreamPort) {
  const pairs = new Set();
  let refusing = false;
  const server = net.createServer((client) => {
    if (refusing) { client.on('error', () => {}); try { client.resetAndDestroy(); } catch { client.destroy(); } return; }
    const up = net.connect(upstreamPort, '127.0.0.1');
    const pair = { client, up, stalled: null, dead: false };
    pairs.add(pair);
    client.setNoDelay(true); up.setNoDelay(true);
    client.on('data', (b) => { if (!pair.dead) up.write(b); });
    up.on('data', (b) => {
      if (pair.dead) return;
      if (pair.stalled) pair.stalled.push(b); else client.write(b);
    });
    const end = () => { pairs.delete(pair); if (!pair.dead) { client.destroy(); up.destroy(); } };
    client.on('close', end); up.on('close', end);
    client.on('error', () => {}); up.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    get count() { return pairs.size; },
    /** Everything the daemon sends is held back for `ms`, then let through. */
    stall(ms) {
      const now = [...pairs];
      for (const p of now) p.stalled = p.stalled ?? [];
      return new Promise((r) => setTimeout(() => {
        for (const p of now) {
          const held = p.stalled ?? [];
          p.stalled = null;
          if (!p.client.destroyed) for (const b of held) p.client.write(b);
        }
        r();
      }, ms));
    },
    /** Every connection dies with no close frame: a reset on both sides. */
    kill() {
      for (const p of [...pairs]) {
        pairs.delete(p);
        p.dead = true;
        try { p.client.resetAndDestroy(); } catch { p.client.destroy(); }
        try { p.up.resetAndDestroy(); } catch { p.up.destroy(); }
      }
    },
    /** The computer stops being reachable: every connection dies with no
     *  close frame and every new one is reset, until `unblock()` — a daemon
     *  stopped, or its port blocked. */
    block() { refusing = true; this.kill(); },
    unblock() { refusing = false; },
    /** The line goes dead the way it does under a suspended app: the daemon's
     *  side is torn down, the phone's stays open and never hears another byte. */
    blackhole() {
      for (const p of [...pairs]) {
        p.dead = true;
        try { p.up.resetAndDestroy(); } catch { p.up.destroy(); }
      }
    },
    close() {
      for (const p of [...pairs]) { p.client.destroy(); p.up.destroy(); }
      return new Promise((r) => server.close(() => r()));
    },
  };
}

/** The phone: `src/ws.ts` in a child process, driven over IPC — or another
 *  child script driven the same way (`outbox-live-child.cjs`: the whole store). */
function phone(script = 'ws-live-child.cjs', env = {}) {
  const child = fork(path.join(__dirname, script), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
                                                         env: { ...process.env, ...env } });
  const heard = [];               // every message from the child, with the parent's own clock
  const waiters = new Set();
  child.on('message', (m) => {
    m.at = Date.now();
    heard.push(m);
    for (const w of [...waiters]) if (w.match(m)) { waiters.delete(w); clearTimeout(w.timer); w.resolve(m); }
  });
  let seq = 0;
  const next = (match, ms, what) => new Promise((resolve, reject) => {
    const w = { match, resolve, timer: setTimeout(() => { waiters.delete(w); reject(new Error(`phone: no ${what} in ${ms} ms`)); }, ms) };
    waiters.add(w);
  });
  return {
    child, heard,
    send(m) { child.send(m); },
    /** Ask the child something and wait for its answer. */
    async ask(cmd, extra = {}, ms = 30000) {
      const id = ++seq;
      const answer = next((m) => m.re === id, ms, cmd);
      child.send({ cmd, id, ...extra });
      return answer;
    },
    freeze() { child.kill('SIGSTOP'); },
    /** The app killed: no goodbye, nothing flushed that was not already. */
    kill() { child.kill('SIGKILL'); return new Promise((r) => (child.exitCode !== null || child.signalCode ? r() : child.once('exit', r))); },
    thaw() { child.kill('SIGCONT'); },
    async close() {
      if (child.exitCode !== null || child.signalCode) return;
      child.kill('SIGCONT');
      const gone = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');
      const t = setTimeout(() => child.kill('SIGKILL'), 3000);
      await gone;
      clearTimeout(t);
    },
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { python, peer, proxy, phone, wait, freePort };
