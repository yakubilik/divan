#!/usr/bin/env node
/** A table and a diagram in an answer, drawn in a real browser.
 *
 *     cd web && npm run test:ui
 *
 *  `scripts/prose-harness.tsx` mounts `Prose` with an answer that holds a pipe
 *  table, two ```mermaid fences, one that is not mermaid and one still
 *  streaming. Headless Chrome loads it from a local server that serves mermaid
 *  the way the daemon serves the panel's files; then: the table is a <table>
 *  with its head, rows and inline marks; each good diagram's frame reports a
 *  size and is shown at it; the broken one and the unclosed one are code; the
 *  frames are sandboxed to scripts alone. A picture of each theme is written
 *  next to the build, to be looked at. */
import * as esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(web, '.test-build', 'prose-ui');
rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });
const chrome = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!chrome) { console.error('no browser found — set CHROME to one'); process.exit(2); }

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

// What vite does with `?url`: the file becomes an asset of the build, and the
// import its address.
const MERMAID = join(web, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
await esbuild.build({
  entryPoints: [join(web, 'scripts', 'prose-harness.tsx')],
  bundle: true, format: 'iife', jsx: 'automatic', target: 'es2022',
  outfile: join(build, 'harness.js'), logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' },
  loader: { '.png': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  plugins: [{
    name: 'url',
    setup(b) {
      b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: 'url' }));
      b.onLoad({ filter: /.*/, namespace: 'url' }, () => ({ contents: 'export default "/assets/mermaid.min.js";', loader: 'js' }));
    },
  }],
});
const html = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/harness.css">'
  + '<style>html,body{margin:0;background:var(--bg,#18191c)}</style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>';
let mermaidHits = 0;
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/assets/mermaid.min.js') {
    mermaidHits++;
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(readFileSync(MERMAID));
    return;
  }
  if (path === '/harness.js' || path === '/harness.css') {
    res.writeHead(200, { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/css' });
    res.end(existsSync(join(build, path)) ? readFileSync(join(build, path)) : '');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(html);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0',
  `--user-data-dir=${join(build, 'profile')}`, '--window-size=900,1400', 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] });
try {
  const endpoint = await new Promise((done, fail) => {
    let buf = '';
    const t = setTimeout(() => fail(new Error('browser did not start')), 20000);
    browser.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); done(m[0]); } });
  });
  const ws = new WebSocket(endpoint);
  await new Promise((done) => { ws.onopen = done; });
  let id = 0;
  const waiting = new Map();
  const logs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded') logs.push(m.params.entry.text);
    const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); }
  };
  const cdp = (method, params = {}, sessionId) => new Promise((done) => {
    const n = ++id; waiting.set(n, done); ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
  const { result: { targetId } } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { result: { sessionId } } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const page = async (m, p) => (await cdp(m, p, sessionId)).result;
  await page('Runtime.enable');
  await page('Page.enable');
  // Every message a frame sends the page, so a failure says what the frame said.
  await page('Page.addScriptToEvaluateOnNewDocument', { source: "if (window.top === window) { window.__said = []; addEventListener('message', function (e) { window.__said.push(JSON.stringify(e.data).slice(0, 120)); }, true); }" });
  await page('Log.enable');
  const evaluate = async (expr) => (await page('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

  for (const scheme of ['dark', 'light']) {
    console.log(`── ${scheme}`);
    await page('Emulation.setDeviceMetricsOverride', { width: 900, height: 1400, deviceScaleFactor: 1, mobile: false });
    await page('Page.navigate', { url: `http://127.0.0.1:${port}/?theme=${scheme}` });
    // Both good diagrams report a size, or the broken one has turned to code: wait for both.
    // Polled from here, a snapshot at a time, rather than by a promise held open
    // inside the page.
    const snapshot = `(() => {
      const frames = [...document.querySelectorAll('[data-diagram] iframe')];
      const shown = frames.filter((f) => f.style.opacity === '1');
      const cell = document.querySelector('[data-table] td:nth-child(3)');
      return {
        frames: frames.length, said: window.__said,
        shown: shown.map((f) => ({ w: f.getBoundingClientRect().width, h: f.getBoundingClientRect().height, sandbox: f.getAttribute('sandbox') })),
        pres: [...document.querySelectorAll('pre')].map((p) => p.textContent),
        th: [...document.querySelectorAll('[data-table] th')].map((x) => x.textContent),
        rows: document.querySelectorAll('[data-table] tbody tr').length,
        strong: document.querySelectorAll('[data-table] td strong').length,
        code: document.querySelectorAll('[data-table] td code').length,
        right: cell ? getComputedStyle(cell).textAlign : null,
        pipes: document.body.innerText.includes('|---|'),
      };
    })()`;
    let state;
    const t0 = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 250));
      state = await evaluate(snapshot);
      if ((state?.shown.length >= 2 && state.pres.length >= 2) || Date.now() - t0 > 15000) break;
    }
    ok('the table is a table: its head', JSON.stringify(state.th) === JSON.stringify(['Servis', 'Ne yapıyor', 'Aylık']), JSON.stringify(state.th));
    ok('three rows, bold and code kept in the cells', state.rows === 3 && state.strong === 3 && state.code === 1, JSON.stringify(state));
    ok('a right-aligned column is right-aligned', state.right === 'right', state.right);
    ok('no raw delimiter row left on the page', !state.pipes);
    ok('both good diagrams drawn at a real size', state.shown.length === 2 && state.shown.every((s) => s.w > 150 && s.h > 100), JSON.stringify([state.frames, state.said, state.shown]));
    ok('each frame is sandboxed to scripts alone', state.shown.every((s) => s.sandbox === 'allow-scripts'), JSON.stringify(state.shown));
    ok('the broken diagram falls back to its code', state.pres.some((p) => p.includes('this is not mermaid')), JSON.stringify(state.pres));
    ok('the fence still streaming is code', state.pres.some((p) => p.includes('pie title Yarım')), JSON.stringify(state.pres));
    const shot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const file = join(build, `prose-${scheme}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(`  picture: ${file}`);
  }
  ok('mermaid was fetched from the panel\'s own files', mermaidHits > 0, String(mermaidHits));
  ws.close();
} finally {
  browser.kill();
  server.close();
}
if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
