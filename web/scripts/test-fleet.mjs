#!/usr/bin/env node
/** Every computer in one panel: the shared machine directory, through the gateway.
 *
 *     cd web && npm test
 *
 *  The page is an HTTPS panel served by one computer. Sockets are stand-ins
 *  that answer like that computer and like a peer behind its gateway. What has
 *  to hold: the peers come from the computer's directory, not from this
 *  browser's storage; every socket is the page's own secure origin, never a
 *  plain `ws://` to a tailnet address; pairing registers the link there and
 *  never takes the serving computer away; and a peer that goes away is
 *  offline on its own, with the browser's token untouched.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'fleet');

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
    // Vite's build-time flag; this is a production page.
    .replace(/import\.meta\.env\.DEV/g, 'false')
    .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => (
      spec.endsWith('.js') ? m : `${a}${spec}.js${z}`
    )));
}

// ── an HTTPS page, and the computers behind it ──────────────────────────────

const TOKEN = 'browser-token';
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
globalThis.location = {
  protocol: 'https:', hostname: 'divan.example', port: '', pathname: '/machine/machines', search: '',
  hash: `#t=${TOKEN}&h=divan.example&p=443&n=Mac&d=dev1`,
};
globalThis.history = { replaceState() { globalThis.location.hash = ''; } };

/** The directory the serving computer keeps, and what each peer is doing. */
const directory = [{ id: 'p1', name: 'Cinema PC', host: '100.76.67.2', port: 8790, addr: '100.76.67.2:8790' }];
const asleep = new Set();
const sent = [];
const sockets = [];

class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) {
    this.url = url; this.readyState = 0; sockets.push(this);
    const peer = /\/peer\/([^/]+)\/ws/.exec(url)?.[1];
    this.peer = peer ?? null;
    setTimeout(() => {
      if (this.readyState === 3) return;
      if (peer && (asleep.has(peer) || !directory.some((p) => p.id === peer))) {
        // The gateway declines the handshake: the browser never sees it open.
        this.readyState = 3; this.onclose?.({ code: 1006, reason: '' });
        return;
      }
      this.readyState = 1; this.onopen?.();
    }, 0);
  }
  send(raw) {
    const req = JSON.parse(raw);
    sent.push({ url: this.url, ...req });
    const name = this.peer ? directory.find((p) => p.id === this.peer)?.name : 'Mac';
    let data = {};
    let type = 'ok';
    switch (req.type) {
      case 'hello': data = { host: { name }, catalog: null }; break;
      case 'host.info': data = { name }; break;
      case 'chat.list': data = { chats: [], groups: [] }; break;
      case 'host.projects': data = { projects: [] }; break;
      case 'limits.get': data = { accounts: {} }; break;
      case 'fleet.list':
        if (this.peer) { type = 'error'; data = { message: 'unknown type: fleet.list' }; break; }
        data = { peers: directory.map((p) => ({ ...p })), self: { name: 'Mac' } }; break;
      case 'fleet.add': {
        const link = String(req.data.link);
        if (!link.includes('100.117.81.91')) { type = 'error'; data = { code: 'peer_refused', message: 'refused' }; break; }
        const p = { id: 'p2', name: 'Salure-5986', host: '100.117.81.91', port: 8790, addr: '100.117.81.91:8790' };
        directory.push(p);
        data = p; break;
      }
      case 'fleet.remove': {
        const i = directory.findIndex((p) => p.id === req.data.id);
        if (i >= 0) directory.splice(i, 1);
        data = { id: req.data.id }; break;
      }
      default: data = {};
    }
    setTimeout(() => this.onmessage?.({ data: JSON.stringify({ id: req.id, type, data }) }), 0);
  }
  close() { this.readyState = 3; }
  /** The far end goes: the gateway closes a relayed socket with 4502. */
  drop(code = 4502, reason = 'peer_gone') { this.readyState = 3; this.onclose?.({ code, reason }); }
  event(ev, data = {}) {
    this.onmessage?.({ data: JSON.stringify({ type: 'event', event: ev, chat_id: null, seq: null, ts: 1, data }) });
  }
}
globalThis.WebSocket = FakeSocket;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

// A pairing this browser made on its own before there was a directory: a
// tailnet address an HTTPS page cannot dial.
store.set('rac.hosts', JSON.stringify([
  { host: '100.76.67.2', port: 8790, token: 'old-direct-token', name: 'Cinema PC' },
]));

const lib = (p) => import(pathToFileURL(join(out, 'src', 'lib', p)).href);
const { useFleet, hostKey, directoryKey } = await lib('fleet.js');
const { wsUrl, httpBase, dialable } = await lib('ws.js');
const actions = await lib('actions.js');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await tick(10); }
  return cond();
}
const rows = () => useFleet.getState().order.map((k) => useFleet.getState().hosts[k]);
const HOME = 'divan.example:443';

// ── addresses ───────────────────────────────────────────────────────────────

group('addresses');
ok('a gateway socket is the page\'s own secure origin',
  wsUrl('divan.example', 443, 'tk', 'p1') === 'wss://divan.example:443/peer/p1/ws?token=tk',
  wsUrl('divan.example', 443, 'tk', 'p1'));
ok('and so is its HTTP', httpBase('divan.example', 443, 'p1') === 'https://divan.example:443/peer/p1');
ok('a tailnet address is not dialable from an HTTPS page', !dialable('100.76.67.2'));
ok('the page\'s own host is', dialable('divan.example'));
ok('a peer is keyed by its own address, whoever reaches it',
  hostKey({ host: 'divan.example', port: 443, via: 'p1', addr: '100.76.67.2:8790' }) === '100.76.67.2:8790');

// ── boot ────────────────────────────────────────────────────────────────────

group('the directory, on a fresh load');
useFleet.getState().boot();
ok('the computer that served the page is the directory', directoryKey(useFleet.getState()) === HOME);
await until(() => rows().some((r) => r.cfg.via === 'p1' && r.status === 'online'));
let list = rows();
ok('the serving computer and its peer are both listed', list.length === 2, JSON.stringify(list.map((r) => r.cfg)));
ok('the serving computer is first', list[0]?.cfg.host === 'divan.example');
const pc = list.find((r) => r.cfg.via === 'p1');
ok('the peer has its own name and is online from its own reply',
  pc?.cfg.name === 'Cinema PC' && pc?.status === 'online' && pc?.info?.name === 'Cinema PC');
ok('exactly one row for the computer the browser had paired on its own',
  list.filter((r) => hostKey(r.cfg) === '100.76.67.2:8790').length === 1);
ok('no socket ever went to a plain ws:// address', sockets.every((s) => s.url.startsWith('wss://divan.example:443/')),
  sockets.map((s) => s.url).join('\n    '));
ok('the browser\'s own token is the one used; the peer\'s credential is not in the page',
  sockets.every((s) => s.url.includes(`token=${TOKEN}`)));
const saved = JSON.parse(store.get('rac.hosts'));
ok('the directory\'s rows are not copied into this browser\'s storage',
  saved.every((h) => !h.via) && saved.some((h) => h.host === 'divan.example'), JSON.stringify(saved));
ok('a file on the peer is fetched through the gateway',
  actions.fileUrl('100.76.67.2:8790', 'C:/x.txt').startsWith('https://divan.example:443/peer/p1/files?'));

// ── pairing ─────────────────────────────────────────────────────────────────

group('pressing Pair');
const before = sent.length;
const key = await actions.pairComputer('divan://pair?host=100.117.81.91&port=8790&token=salure-cred&name=Salure');
ok('the link is registered with the serving computer',
  sent.slice(before).some((r) => r.type === 'fleet.add' && r.url.startsWith(`wss://${HOME}/ws`)));
await until(() => rows().find((r) => r.cfg.via === 'p2')?.status === 'online');
list = rows();
ok('the new computer has one row, online', key === '100.117.81.91:8790'
  && list.filter((r) => hostKey(r.cfg) === key).length === 1
  && list.find((r) => hostKey(r.cfg) === key)?.status === 'online');
ok('and the serving computer is still there', list.some((r) => hostKey(r.cfg) === HOME) && list.length === 3);
ok('the pasted credential is not kept in the browser', !store.get('rac.hosts').includes('salure-cred'));
let refused = null;
try { await actions.pairComputer('divan://pair?host=100.1.2.3&port=8790&token=nope'); } catch (e) { refused = e; }
ok('a link the computer refuses says so and adds nothing', refused && rows().length === 3, String(refused));

group('another browser hears of it');
const homeSock = () => sockets.filter((s) => s.url.startsWith(`wss://${HOME}/ws`) && s.readyState === 1).at(-1);
directory.push({ id: 'p3', name: 'ThinkPad', host: '100.82.124.86', port: 8790, addr: '100.82.124.86:8790' });
homeSock().event('fleet.changed');
await until(() => rows().some((r) => r.cfg.via === 'p3'));
ok('a fleet.changed event brings the new row in', rows().some((r) => r.cfg.via === 'p3'));
directory.pop();
homeSock().event('fleet.changed');
await until(() => !rows().some((r) => r.cfg.via === 'p3'));
ok('and takes a removed one away', !rows().some((r) => r.cfg.via === 'p3'));

// ── a peer goes away ────────────────────────────────────────────────────────

group('a peer goes away');
asleep.add('p1');
sockets.filter((s) => s.peer === 'p1' && s.readyState === 1).forEach((s) => s.drop());
await until(() => rows().find((r) => r.cfg.via === 'p1')?.status === 'offline');
list = rows();
ok('it is offline', list.find((r) => r.cfg.via === 'p1')?.status === 'offline');
ok('the others stay online', list.filter((r) => r.cfg.via !== 'p1').every((r) => r.status === 'online'),
  JSON.stringify(list.map((r) => [hostKey(r.cfg), r.status])));
ok('the browser\'s token is not marked refused', list.every((r) => r.status !== 'unauthorized'));
const homeCall = await useFleet.getState().call(HOME, 'host.info', {}).then(() => true, () => false);
ok('the serving computer still answers', homeCall);
asleep.delete('p1');
const back = await until(() => rows().find((r) => r.cfg.via === 'p1')?.status === 'online', 5000);
ok('it comes back by itself, without pairing again', back);

// ── unpairing ───────────────────────────────────────────────────────────────

group('unpairing a peer');
const sentBefore = sent.length;
useFleet.getState().removeHost('100.117.81.91:8790');
await tick();
ok('it is removed from the directory on the serving computer',
  sent.slice(sentBefore).some((r) => r.type === 'fleet.remove' && r.data.id === 'p2' && r.url.startsWith(`wss://${HOME}/ws`)));
ok('nothing revokes the browser\'s own token', !sent.slice(sentBefore).some((r) => r.type === 'device.revoke_self'));
ok('the serving computer stays', rows().some((r) => hostKey(r.cfg) === HOME));

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
