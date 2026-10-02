#!/usr/bin/env node
/** A token the computer refused is not offered again, and the refusal is named.
 *
 *     cd web && npm test
 *
 *  The socket and fetch are stand-ins that count. A computer closes the socket
 *  with 4401 and a reason, and from then on nothing in the panel that carries
 *  that token — the socket's reconnect, /screen.jpg, /files, /upload,
 *  dictation — reaches the network: through the tunnel each of those was one
 *  more count towards locking the household's own address.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'refusal');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }

// ── build ───────────────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/lib/ws.ts', 'src/lib/refusal.ts', 'src/lib/actions.ts', 'src/lib/fleet.ts', 'src/vite-env.d.ts',
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

// ── the network, counted ────────────────────────────────────────────────────

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const sockets = [];
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); }
  send() {}
  close() { this.readyState = 3; }
  /** What the computer does: accept, then close with a code and a reason. */
  refuse(code, reason) { this.readyState = 3; this.onclose?.({ code, reason }); }
}
globalThis.WebSocket = FakeSocket;

const fetched = [];
let answer = { status: 200, body: { path: '/x' } };
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  const { status, body } = answer;
  return { ok: status < 400, status, json: async () => body };
};

const lib = (p) => import(pathToFileURL(join(out, 'src', 'lib', p)).href);
const { RacClient, callOnce } = await lib('ws.js');
const { REFUSAL_TEXT, parseRefusal, refusalText } = await lib('refusal.js');
const { useFleet } = await lib('fleet.js');
const actions = await lib('actions.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const host = (token, h = '100.64.0.9') => ({ host: h, port: 8790, token, name: 'mac' });
function seat(cfg) {
  const key = `${cfg.host}:${cfg.port}`;
  useFleet.setState({ hosts: { ...useFleet.getState().hosts, [key]: { cfg, status: 'online' } } });
  return key;
}
const pcm = new Int16Array(160);
const file = new File(['x'], 'a.txt');

// ── a 4401 ──────────────────────────────────────────────────────────────────

group('after a 4401 nothing that carries the token is sent');
{
  const cfg = host('tailnet-token');
  const key = seat(cfg);
  ok('a token nobody has refused draws and uploads',
    actions.fileUrl(key, '/tmp/a.png').includes('token=tailnet-token')
    && actions.screenUrl(cfg, 1280, '', 1).includes('/screen.jpg?token=tailnet-token'));
  await actions.upload(key, 'c1', file);
  ok('and the upload went out', fetched.length === 1, JSON.stringify(fetched));

  const c = new RacClient();
  c.connect(cfg.host, cfg.port, cfg.token);
  ok('one socket opened', sockets.length === 1);
  sockets[0].refuse(4401, 'not_tunnel_device');
  ok('the client is unauthorized and knows why',
    c.status === 'unauthorized' && c.refusal?.kind === 'not_tunnel_device', JSON.stringify(c.refusal));

  const before = { sockets: sockets.length, fetched: fetched.length };
  c.poke();
  c.connect(cfg.host, cfg.port, cfg.token);
  new RacClient().connect(cfg.host, cfg.port, cfg.token);     // a reattach makes a new client
  await wait(1500);                                           // past the first retry's delay
  const calls = [];
  for (const [name, run] of [
    ['upload', () => actions.upload(key, 'c1', file)],
    ['dictate', () => actions.dictate(key, pcm, '', 'en')],
    ['callOnce', () => callOnce(cfg.host, cfg.port, cfg.token, 'ping')],
    ['call', () => c.call('ping')],
  ]) {
    try { await run(); calls.push(`${name}: went through`); } catch (e) { calls.push(`${name}: ${e.message}`); }
  }
  actions.warmDictation(key);
  ok('no reconnect, no second client, no callOnce socket', sockets.length === before.sockets,
    `${sockets.length - before.sockets} new`);
  ok('no fetch for /upload, /dictate or /dictate/warm', fetched.length === before.fetched,
    JSON.stringify(fetched.slice(before.fetched)));
  ok('/files and /screen.jpg have no address to load',
    actions.fileUrl(key, '/tmp/a.png') === '' && actions.screenUrl(cfg, 1280, '', 2) === '');
  ok('every one of them says why, in the refusal\'s words',
    calls.slice(0, 3).every((s) => s.endsWith(refusalText({ kind: 'not_tunnel_device' }).long)), calls.join('\n    '));
}

group('a 401 over HTTP stops the socket too');
{
  const cfg = host('locked-token', '100.64.0.10');
  const key = seat(cfg);
  answer = { status: 401, body: { detail: 'locked:1790000000:203.0.113.5' } };
  let said = '';
  try { await actions.upload(key, 'c1', file); } catch (e) { said = e.message; }
  answer = { status: 200, body: {} };
  ok('the upload names the lock and the command that lifts it',
    said.includes('remote-ai-chat unlock 203.0.113.5'), said);
  const n = sockets.length;
  const c = new RacClient();
  c.connect(cfg.host, cfg.port, cfg.token);
  ok('and a socket for that token is never opened', sockets.length === n && c.refusal?.kind === 'locked');
}

group('a different token is not caught by somebody else\'s refusal');
{
  const cfg = host('good-token', '100.64.0.11');
  const n = sockets.length;
  const c = new RacClient();
  c.connect(cfg.host, cfg.port, cfg.token);
  ok('it opens', sockets.length === n + 1 && c.status === 'connecting');
  c.disconnect();
}

// ── the words ───────────────────────────────────────────────────────────────

group('each refusal is told apart');
{
  const parsed = [
    parseRefusal(4401, 'not_tunnel_device'), parseRefusal(4401, 'unknown_token'),
    parseRefusal(4401, 'revoked'), parseRefusal(4401, 'locked:1790000000:2001:db8::/64'),
    parseRefusal(1008, ''), parseRefusal(4401, 'unauthorized'),
  ];
  ok('reasons parse to kinds', JSON.stringify(parsed.map((r) => r.kind)) === JSON.stringify(
    ['not_tunnel_device', 'unknown_token', 'revoked', 'locked', 'not_let_in', 'unauthorized']), JSON.stringify(parsed));
  ok('a lock keeps its time and a v6 address whole',
    parsed[3].until === 1790000000 && parsed[3].addr === '2001:db8::/64', JSON.stringify(parsed[3]));
  for (const lang of ['en', 'tr']) {
    const table = REFUSAL_TEXT[lang];
    const kinds = Object.keys(REFUSAL_TEXT.en);
    ok(`${lang}: every kind has its words`, kinds.every((k) => table[k]?.short && table[k]?.long));
    ok(`${lang}: no two kinds read the same`,
      new Set(kinds.map((k) => table[k].short)).size === kinds.length);
    const revoked = lang === 'en' ? /revoked/i : /kaldırıldı|silinmiş/i;
    ok(`${lang}: only a removed device is called revoked`,
      kinds.filter((k) => revoked.test(table[k].short + table[k].long)).join() === 'revoked',
      kinds.filter((k) => revoked.test(table[k].short + table[k].long)).join());
  }
  ok('Turkish is Turkish', refusalText({ kind: 'not_tunnel_device' }, 'tr').short
    !== refusalText({ kind: 'not_tunnel_device' }, 'en').short);
  const lock = refusalText(parsed[3], 'en');
  ok('a lock says until when, and the command', /\d\d:\d\d/.test(lock.short)
    && lock.long.includes('remote-ai-chat unlock 2001:db8::/64'), lock.long);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
