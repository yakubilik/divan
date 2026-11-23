// A step whose result was written while the panel's socket was down must not
// say "running" for good. 23 Nov 2026: a daemon restart landed mid-tool; the
// result (seq 198761) was written while no socket was up, the new socket's
// first live event (198764) moved the chat's seq past it, and the step's
// loader turned forever.
//
//     cd web && node scripts/test-reconnect-resync.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'reconnect-resync');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules/.bin/tsc'), ['src/lib/timeline.ts', 'src/vite-env.d.ts', '--outDir', out, '--rootDir', '.', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--strict', '--skipLibCheck'], { cwd: web, stdio: 'inherit' });
for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => spec.endsWith('.js') ? m : `${a}${spec}.js${z}`));
}
const dom = new JSDOM('<div></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });

const { useLogs, logKey } = await import(pathToFileURL(join(out, 'src/lib/timeline.js')));
const { useFleet, clientFor, hostKey } = await import(pathToFileURL(join(out, 'src/lib/fleet.js')));

const cfg = { host: '127.0.0.1', port: 9, token: 't', name: 'Test' };
useFleet.getState().addHost(cfg);
const key = hostKey(cfg);
const c = clientFor(key);
c.disconnect();

// The daemon's log for one chat. chat.get answers from it like the daemon does.
const ev = (seq, event, data) => ({ seq, event, chat_id: 'c1', ts: seq, data });
const log = [
  ev(10, 'message.user', { text: 'go' }),
  ev(11, 'tool.use', { id: 'A', tool: 'Bash', input: { command: 'python3 trash.py' } }),
];
c.call = async (type, data) => {
  if (type !== 'chat.get') return {};
  return { events: log.filter((e) => e.seq > (data.since_seq ?? 0)), more: false, busy: true };
};

const S = () => useLogs.getState();
const k = logKey(key, 'c1');
const running = () => S().logs[k].items.filter((i) => i.kind === 'tool' && i.running).map((i) => i.id);

await S().open(key, 'c1');
assert.deepEqual(running(), ['tA'], 'tool A runs before the drop');

// The socket goes; the daemon restarts and writes A's result meanwhile.
c.setStatus('offline');
log.push(ev(12, 'tool.result', { id: 'A', output: 'trashed 1301', is_error: false }));
const b = ev(14, 'tool.use', { id: 'B', tool: 'Read', input: {} });
log.push(b);

// The new socket is up; its first live event arrives before anything else.
c.setStatus('online');
S().feed(key, b);
await new Promise((r) => setTimeout(r, 20));
while (S().logs[k].loading) await new Promise((r) => setTimeout(r, 5));

const tools = S().logs[k].items.filter((i) => i.kind === 'tool');
assert.deepEqual(tools.map((t) => t.id), ['tA', 'tB'], 'each step once, in order');
assert.equal(tools[0].running, false, 'A got the result written while the socket was down');
assert.equal(tools[0].output, 'trashed 1301');
assert.deepEqual(running(), ['tB']);
assert.equal(S().logs[k].seq, 14);

// Live events after the catch-up fold straight in again.
S().feed(key, ev(15, 'tool.result', { id: 'B', output: '', is_error: false }));
assert.deepEqual(running(), []);

console.log('ok - a result written while the socket was down reaches the step');
process.exit(0);
