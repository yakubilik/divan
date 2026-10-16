/** One folder for a new chat, from the phone and from the web, decided by the
 *  computer (#299). Driven against one real daemon with two clients.
 *
 *  The daemon is `daemon/scripts/default_cwd_peer.py`: its own DIVAN_HOME and
 *  loopback port, one root holding `DevTrace-main`, `quire` and `zeta` (the
 *  first is what a sorted list used to hand the phone), and two paired
 *  devices. `chat.create` is the real one; a turn is answered by a stand-in and
 *  no CLI is ever started.
 *
 *  The web panel is the panel's own code — the fleet store, `tell()` (the
 *  command bar's New chat), `setDefaultCwd` (Settings → New chats) — over its
 *  own socket client. The phone is the phone's own code — its socket client,
 *  `freshCwd`/`freshChat` (the pen and the first word) — with a remembered
 *  local folder that must no longer count. The checks:
 *
 *    1. Nothing set: both read the same default from `host.info`, both send
 *       it, and the daemon creates both chats there; `chat.create` with no cwd
 *       lands in the same folder.
 *    2. The phone sets the default (its Settings request): the web hears it
 *       and its next chat opens there. The web sets it: the phone's next does.
 *    3. A product page (`tell` with a scope) and a folder picked explicitly
 *       still win, on both sides.
 *    4. A folder this browser used to remember is handed to the computer
 *       once, where nobody chose one there, and the phone then opens in it.
 *
 *  Needs the daemon's Python (PY, else daemon/.venv312, else
 *  ~/projects/divan/daemon/.venv312, else python3). Without one the run says
 *  SKIP; `--require-daemon` makes that a failure.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(web, '..');
const out = join(web, '.test-build', 'default-cwd');

let failures = 0;
function ok(name, cond, detail) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}${cond || !detail ? '' : `\n        ${detail}`}`);
  if (!cond) failures++;
}
function group(name) { console.log(`── ${name}`); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 5000) {
  for (let t = 0; t < ms; t += 20) { if (cond()) return true; await wait(20); }
  return cond();
}

// ── build: both clients' own files, side by side ────────────────────────────
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'web/src/lib/tell.ts', 'web/src/lib/actions.ts', 'web/src/lib/fleet.ts', 'web/src/lib/prefs.ts',
  'web/src/vite-env.d.ts', 'app/src/fresh-chat.ts', 'app/src/ws.ts',
  '--outDir', out, '--rootDir', '.',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
], { cwd: repo, stdio: 'inherit' });
for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => (spec.endsWith('.js') ? m : `${a}${spec}.js${z}`)));
}

// ── a browser, as far as the panel's stores need one ────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.sessionStorage = globalThis.localStorage;
const query = { matches: false, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  documentElement: { dataset: {} }, hidden: false,
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelectorAll: () => [],
};
globalThis.window = {
  matchMedia: () => query, addEventListener() {}, removeEventListener() {},
  location: { hostname: 'localhost', port: '5173', protocol: 'http:', pathname: '/', search: '', hash: '' },
  open() {}, alert() {},
};
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.location = globalThis.window.location;

const load = (p) => import(pathToFileURL(join(out, p)).href);

// ── the daemon ──────────────────────────────────────────────────────────────
function python() {
  const cands = [process.env.PY, join(repo, 'daemon/.venv312/bin/python'),
    join(homedir(), 'projects/divan/daemon/.venv312/bin/python')];
  return cands.find((c) => c && existsSync(c)) ?? 'python3';
}
function startPeer() {
  return new Promise((ok, no) => {
    const proc = spawn(python(), [join(repo, 'daemon/scripts/default_cwd_peer.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', err = '';
    proc.stdout.on('data', (d) => {
      buf += d;
      const line = buf.split('\n').find((l) => l.startsWith('{'));
      if (line) ok({ ...JSON.parse(line), proc });
    });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', no);
    proc.on('exit', (code) => no(new Error(`default_cwd_peer exited ${code}: ${err.slice(-800)}`)));
  });
}

let peer;
try {
  peer = await startPeer();
} catch (e) {
  const msg = `default folder, two clients: SKIP, no daemon to drive (${String(e.message).slice(0, 200)})`;
  if (process.argv.includes('--require-daemon')) { console.error(`✗ ${msg}`); process.exit(1); }
  console.log(msg);
  process.exit(0);
}

const { useFleet, hostKey } = await load('web/src/lib/fleet.js');
const TL = await load('web/src/lib/tell.js');
const A = await load('web/src/lib/actions.js');
const P = await load('web/src/lib/prefs.js');
const F = await load('app/src/fresh-chat.js');
const { RacClient: PhoneClient } = await load('app/src/ws.js');

const { root, folders } = peer;
const cfg = { host: '127.0.0.1', port: peer.port, token: peer.web, name: 'panel' };
const key = hostKey(cfg);
let phone;

try {
  // The web panel, as a browser that paired this computer.
  useFleet.getState().addHost(cfg);
  await until(() => useFleet.getState().hosts[key]?.info?.default_cwd && useFleet.getState().hosts[key]?.catalog);
  const slot = () => useFleet.getState().hosts[key];

  // The phone: its own socket, and a folder it remembered locally before this
  // change — DevTrace-main, the first of a sorted list — that must not count.
  phone = new PhoneClient();
  phone.connect('127.0.0.1', peer.port, peer.phone);
  await until(() => phone.status === 'online');
  const hello = await phone.call('hello', { device_name: 'phone' });
  let phoneInfo = hello.host;
  phone.on((ev) => { if (ev.event === 'host.status') phoneInfo = ev.data; });
  const phoneDefaults = { provider: 'claude', model: 'sonnet', effort: 'high', perm_mode: 'bypass',
    cwd: folders['DevTrace-main'], byProvider: {} };
  /** The phone's pen / first word: `useFreshChat` in `first-word.tsx`, minus React. */
  const phoneNewChat = async () => {
    const cwd = F.freshCwd(phoneInfo);
    return phone.call('chat.create', F.freshChat({ defaults: phoneDefaults, catalog: hello.catalog, cwd, account: '', agent: null }));
  };
  /** The web's New chat from the command bar. */
  const webNewChat = async (scope, words = 'hello') => {
    const told = await TL.tell(words, scope ?? null, { agent: null });
    return slot().chats.find((c) => c.id === told.chatId)
      ?? (await useFleet.getState().call(key, 'chat.get', { chat_id: told.chatId, limit: 1 })).chat;
  };

  group('nothing set: one default, read by both');
  ok('both clients read the same default from the computer, and it is not DevTrace-main',
    F.freshCwd(phoneInfo) === root && P.newChatCwd(slot().info) === root
    && TL.toldDefaults(slot(), P.usePrefs.getState().defaults, key)?.cwd === root,
    `${F.freshCwd(phoneInfo)} / ${P.newChatCwd(slot().info)}`);
  const a = await phoneNewChat();
  const b = await webNewChat();
  ok('a chat from the phone’s pen and one from the web’s New chat open in the same folder',
    a.cwd === root && b?.cwd === root, `${a.cwd} / ${b?.cwd}`);
  const bare = await phone.call('chat.create', { provider: 'claude' });
  ok('chat.create with no cwd opens in that same folder', bare.cwd === root, bare.cwd);

  group('changed on one, used by the other');
  await phone.call('host.default_cwd', { cwd: folders.quire });     // the phone's Settings row
  await until(() => slot().info?.default_cwd === folders.quire);
  ok('the web hears the phone’s choice', slot().info?.default_cwd === folders.quire, slot().info?.default_cwd);
  const c = await webNewChat();
  ok('…and its next New chat opens there', c?.cwd === folders.quire, c?.cwd);
  await A.setDefaultCwd(key, folders.zeta);                           // the web's Settings → New chats
  await until(() => phoneInfo.default_cwd === folders.zeta);
  ok('the phone hears the web’s choice', phoneInfo.default_cwd === folders.zeta, phoneInfo.default_cwd);
  const d = await phoneNewChat();
  ok('…and its next new chat opens there', d.cwd === folders.zeta, d.cwd);
  const e = await webNewChat();
  ok('…as does the web’s', e?.cwd === folders.zeta, e?.cwd);

  group('a product page and an explicit pick still win');
  const scope = { name: 'quire', repos: [folders.quire], hosts: [key] };
  await useFleet.getState().refresh(key);
  const f = await webNewChat(scope);
  ok('the web’s product page opens in the product’s folder', f?.cwd === folders.quire, f?.cwd);
  const g = await phone.call('chat.create', F.freshChat({ defaults: phoneDefaults, catalog: hello.catalog,
    cwd: folders.quire, account: '', agent: null }));
  ok('the phone’s project page (its repo as the cwd) opens there too', g.cwd === folders.quire, g.cwd);
  const h = await A.createChat(key, { provider: 'claude', cwd: folders['DevTrace-main'] });
  const i = await phone.call('chat.create', { provider: 'claude', cwd: folders['DevTrace-main'] });
  ok('a folder picked explicitly wins on both — and an old phone build that sends its own still works',
    h.cwd === folders['DevTrace-main'] && i.cwd === folders['DevTrace-main'], `${h.cwd} / ${i.cwd}`);
  ok('…and none of it moved a chat that already existed',
    (await phone.call('chat.get', { chat_id: a.id, limit: 1 })).chat.cwd === root);

  group('what this browser used to remember is handed over once');
  await phone.call('host.default_cwd', { cwd: null });
  await until(() => slot().info?.default_cwd_chosen === false);
  P.usePrefs.getState().setDefaults(key, { cwd: folders.quire });
  await useFleet.getState().refresh(key);
  await until(() => phoneInfo.default_cwd === folders.quire);
  ok('the computer takes the browser’s remembered folder where nobody chose one',
    phoneInfo.default_cwd === folders.quire && phoneInfo.default_cwd_chosen === true, phoneInfo.default_cwd);
  ok('…and the browser forgets its own copy', P.usePrefs.getState().defaults[key]?.cwd === null);
  const j = await phoneNewChat();
  ok('…so the phone’s next new chat opens where the web’s did', j.cwd === folders.quire, j.cwd);
  await phone.call('host.default_cwd', { cwd: folders.zeta });
  P.usePrefs.getState().setDefaults(key, { cwd: folders.quire });
  await useFleet.getState().refresh(key);
  await wait(200);
  ok('…but never over a folder somebody already chose on the computer',
    phoneInfo.default_cwd === folders.zeta, phoneInfo.default_cwd);
} catch (e) {
  failures++;
  console.error(`  FAIL  ${e?.stack ?? e}`);
} finally {
  try { phone?.disconnect(); } catch {}
  try { useFleet.getState().removeHost(key); } catch {}
  peer.proc.stdin.end();
  await Promise.race([new Promise((r) => peer.proc.on('exit', r)), wait(5000)]);
  if (peer.proc.exitCode === null) peer.proc.kill();
  rmSync(out, { recursive: true, force: true });
}

if (failures) { console.error(`\n✗ default folder: ${failures} failed`); process.exit(1); }
console.log('\n✓ default folder: the phone and the web open new chats where the computer says');
