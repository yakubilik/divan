#!/usr/bin/env node
/** The browser's own ⌘1, pressed for real in a visible Chrome: not a check the
 *  suite runs, because it needs a window on screen and an OS-level key.
 *
 *     node scripts/test-composer-ui.mjs        # builds .test-build/composer
 *     node scripts/check-tab-switch.mjs
 *
 *  Opens Chrome with two blank tabs and the panel's chat page as the third,
 *  and sends ⌘1 through `cua-driver` (which needs Accessibility; start it with
 *  `open -n -g -a CuaDriver --args serve`), once with the chat's box focused
 *  once with nothing focused. A key sent over DevTools never reaches the
 *  browser's own shortcuts, headless or not, so this is the only way to see
 *  the tab actually change. Prints each run's tab visibility, the panel's
 *  address and the keydown the page saw; exits non-zero unless the first tab
 *  came forward, the panel stayed where it was and nothing cancelled the key.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(web, '.test-build', 'composer'), pub = join(web, 'public');
if (!existsSync(join(build, 'index.html'))) { console.error('run scripts/test-composer-ui.mjs first'); process.exit(2); }
const T = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const srv = createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  const f = extname(p) && existsSync(join(build, p)) ? join(build, p) : extname(p) && existsSync(join(pub, p)) ? join(pub, p) : join(build, 'index.html');
  r.writeHead(200, { 'content-type': T[extname(f)] ?? 'application/octet-stream' }); r.end(readFileSync(f)); });
await new Promise((d) => srv.listen(0, '127.0.0.1', d));
const origin = `http://127.0.0.1:${srv.address().port}`;
const profile = mkdtempSync(join(tmpdir(), 'tab-switch-'));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = spawn(chrome, ['--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1100,750', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const ep = await new Promise((d) => { let s = ''; b.stderr.on('data', (x) => { s += x; const m = s.match(/ws:\/\/\S+/); if (m) d(m[0]); }); });
const ws = new WebSocket(ep); await new Promise((d) => ws.onopen = d);
let id = 0; const w = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } };
const cdp = (method, params = {}, sessionId) => new Promise((d) => { const n = ++id; w.set(n, d); ws.send(JSON.stringify({ id: n, method, params, sessionId })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (s, expr) => (await cdp('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }, s)).result?.result?.value;
// Tab 1 is the startup about:blank; add a second blank and the panel as tab 3.
const tabs = [];
const { result: { targetInfos } } = await cdp('Target.getTargets');
const first = targetInfos.find((t) => t.type === 'page');
tabs.push((await cdp('Target.attachToTarget', { targetId: first.targetId, flatten: true })).result.sessionId);
for (const url of ['about:blank#two', `${origin}/__blank`]) {
  const { result } = await cdp('Target.createTarget', { url });
  tabs.push((await cdp('Target.attachToTarget', { targetId: result.targetId, flatten: true })).result.sessionId);
}
const panel = tabs[2];
await ev(panel, `localStorage.clear(); localStorage.setItem('rac.theme','dark'); sessionStorage.setItem('walk.fixture','busy'); location.href='${origin}/chats/c1';`);
await sleep(2500);
const vis = async () => Promise.all(tabs.map((s) => ev(s, 'return document.visibilityState')));
const activate = async () => { await cdp('Target.activateTarget', { targetId: (await cdp('Target.getTargetInfo', {}, panel)).result.targetInfo.targetId }); await sleep(800); };
await ev(panel, `window.__k=[]; addEventListener('keydown',(e)=>{const s={key:e.key,meta:e.metaKey,ctrl:e.ctrlKey};__k.push(s);setTimeout(()=>s.prevented=e.defaultPrevented,0)},true); return true`);
const out = {};
for (const from of ['composer', 'page']) {
  await activate();
  await ev(panel, from === 'composer'
    ? `const t=document.querySelector('textarea[name="composer"]'); t.focus(); t.value=''; return document.activeElement===t`
    : `document.activeElement?.blur(); return true`);
  const before = { vis: await vis(), path: await ev(panel, 'return location.pathname') };
  const wins = JSON.parse(execFileSync('cua-driver', ['call', 'list_windows', JSON.stringify({ pid: b.pid })]).toString());
  const list = wins.structuredContent?.windows ?? wins.windows ?? [];
  const win = list.find((x) => x.pid === b.pid && (x.title ?? '').length) ?? list.find((x) => x.pid === b.pid);
  if (!win) throw new Error('no chrome window: ' + JSON.stringify(wins).slice(0, 400));
  execFileSync('cua-driver', ['call', 'hotkey', JSON.stringify({ pid: b.pid, window_id: win.window_id, keys: ['cmd', '1'], delivery_mode: 'foreground' })]).toString();
  await sleep(1000);
  const after = { vis: await vis(), path: await ev(panel, 'return location.pathname'), keys: await ev(panel, 'return __k.splice(0)') };
  out[from] = { before, after };
}
console.log(JSON.stringify(out, null, 1));
ws.close(); b.kill(); srv.close();
setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
const good = ['composer', 'page'].every((k) => {
  const { before, after } = out[k];
  return before.vis[2] === 'visible' && after.vis[0] === 'visible' && after.vis[2] === 'hidden'
    && after.path === before.path && after.keys.length > 0 && after.keys.every((e) => e.prevented === false);
});
console.log(good ? 'the browser switched tabs; the panel stayed put' : 'FAILED');
process.exitCode = good ? 0 : 1;
