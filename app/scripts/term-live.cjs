/** The phone's shell against a real daemon, drawn by the real page in a real
 *  browser: what the WebView does on the phone, done by headless Chrome.
 *
 *     node scripts/term-live.cjs <port> <token> [shot.png]
 *
 *  Not part of `npm test` — it needs a running daemon and a Chrome. A
 *  throwaway daemon does:
 *
 *     cd daemon && DIVAN_HOME=/tmp/d DIVAN_PORT=8911 .venv/bin/python -c \
 *       "from divan.config import Config; print(Config.load().add_device('live')[1])"
 *     DIVAN_HOME=/tmp/d DIVAN_PORT=8911 .venv/bin/python -m divan serve --bind 127.0.0.1
 *
 *  The page is `termPage()` at a phone's size, with `ReactNativeWebView`
 *  standing in as a Chrome binding; the bridge is the app's own `TermBridge`,
 *  on a plain WebSocket to the daemon. Driven: the page comes up and the shell
 *  opens at its size with a prompt; `echo hi` typed into xterm's own textarea
 *  and Return prints `hi`; the bar's Tab completes and Ctrl then `c` stops a
 *  `sleep`; the viewport made shorter (the keyboard coming up) changes
 *  `stty size`; closing ends the shell on the daemon (`term.list` empty).
 *  Leaves a picture of the page if a path is given. */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { transform } = require('sucrase');

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (mod, filename) => {
    mod._compile(transform(fs.readFileSync(filename, 'utf8'),
      { transforms: ['typescript', 'imports'], filePath: filename }).code, filename);
  };
}
const root = path.join(__dirname, '..');
const { TermBridge } = require(path.join(root, 'src/term.ts'));
const { termPage, toPageScript } = require(path.join(root, 'src/term-page.ts'));

const [port, token, shot] = process.argv.slice(2);
if (!port || !token) { console.error('usage: term-live.cjs <port> <token> [shot.png]'); process.exit(2); }
const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean).find((p) => fs.existsSync(p));
if (!chrome) { console.error('no browser found — set CHROME to one'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ok    ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

/** The daemon, as the bridge sees it: `call` and `on`, and every call kept. */
function daemon() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
  const pending = new Map();
  const listeners = new Set();
  const sent = [];
  let rid = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if ((m.type === 'ok' || m.type === 'error') && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.type === 'ok') p.resolve(m.data);
      else p.reject(Object.assign(new Error(m.data?.message || m.data?.code), { code: m.data?.code }));
    } else if (m.type === 'event') {
      for (const l of listeners) l({ event: m.event, chat_id: m.chat_id, seq: m.seq, data: m.data, ts: m.ts });
    }
  };
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return {
    open, sent, ws,
    call: async (type, data = {}) => {
      await open;
      sent.push({ type, data });
      const id = ++rid;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, type, data })); });
    },
    on: (l) => { listeners.add(l); return () => listeners.delete(l); },
  };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'term-live-'));
  const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0',
    `--user-data-dir=${path.join(dir, 'p')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const endpoint = await new Promise((done) => {
      let buf = '';
      browser.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/[^\s]+/); if (m) done(m[0]); });
    });
    const cdpWs = new WebSocket(endpoint);
    await new Promise((r) => { cdpWs.onopen = r; });
    let n = 0;
    const waiting = new Map();
    const fromPage = [];
    let bridge = null;
    cdpWs.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); w(m.result ?? m.error); return; }
      if (m.method === 'Runtime.bindingCalled' && m.params.name === 'rnPost') {
        fromPage.push(JSON.parse(m.params.payload));
        bridge?.fromPage(m.params.payload);
      }
    };
    const cdp = (method, params = {}, sessionId) => new Promise((done) => {
      const id = ++n; waiting.set(id, done); cdpWs.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    const page = (m, p) => cdp(m, p, sessionId);
    const js = async (expr) => (await page('Runtime.evaluate', { expression: expr, returnByValue: true }))?.result?.value;
    const until = async (fn, ms = 10000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await fn()) return true; await sleep(100); }
      return false;
    };
    const screen = () => js(`[...document.querySelectorAll('.xterm-rows > div')].map((r) => r.textContent.replace(/\\u00a0/g, ' ')).join('\\n')`);
    const rowsOf = async () => (await screen()).split('\n');
    const setSize = (width, height) => page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });

    await page('Runtime.enable');
    await page('Page.enable');
    await page('Runtime.addBinding', { name: 'rnPost' });
    await page('Page.addScriptToEvaluateOnNewDocument', { source: 'window.ReactNativeWebView={postMessage:function(s){rnPost(s)}};' });
    // An iPhone's pane under the Machine tabs, keyboard down.
    await setSize(390, 620);

    const d = daemon();
    await d.open;
    bridge = new TermBridge(d, (m) => { void js(toPageScript(m)); });
    fs.writeFileSync(path.join(dir, 'term.html'), termPage());
    await page('Page.navigate', { url: `file://${path.join(dir, 'term.html')}` });

    // 1 · open at the page's size, prompt drawn
    await until(async () => bridge.state === 'live');
    const ready = fromPage.find((m) => m.t === 'ready');
    const opened = d.sent.find((c) => c.type === 'term.open');
    ok('1 the page comes up and says ready with the grid it fitted', !!ready && ready.cols > 20 && ready.rows > 10,
      JSON.stringify(ready));
    ok('1 …and term.open goes out with that size', !!opened && opened.data.cols === ready.cols && opened.data.rows === ready.rows,
      JSON.stringify(opened));
    ok('1 …and the shell\'s prompt is drawn in xterm', await until(async () => (await screen()).trim().length > 0),
      await screen());
    await sleep(1200);

    // 2 · echo hi + Return, typed into xterm's own textarea
    const typeLine = async (text) => {
      await js(`document.querySelector('.xterm-helper-textarea').focus()`);
      await page('Input.insertText', { text });
      await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    };
    d.sent.length = 0;
    await typeLine('echo hi');
    ok('2 echo hi + Return goes out as term.write',
      d.sent.filter((c) => c.type === 'term.write').map((c) => c.data.data).join('') === 'echo hi\r',
      JSON.stringify(d.sent));
    ok('2 …and hi appears on its own line', await until(async () => (await rowsOf()).some((l) => l.trim() === 'hi')),
      await screen());

    // 3 · the bar: Tab completes, Ctrl then c interrupts
    d.sent.length = 0;
    await js(`document.querySelector('.xterm-helper-textarea').focus()`);
    await page('Input.insertText', { text: 'clear; ech' });
    await sleep(300);
    bridge.key('tab');
    await sleep(600);
    ok('3 the bar\'s Tab sends \\t and the shell completes ech to echo',
      d.sent.some((c) => c.type === 'term.write' && c.data.data === '\t')
      && (await until(async () => /ech[o]/.test((await screen()).split('\n').filter((l) => l.includes('clear;')).pop() || ''))),
      await screen());
    await page('Input.insertText', { text: ' done' });
    await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await sleep(500);
    await typeLine('sleep 30');
    await sleep(500);
    d.sent.length = 0;
    bridge.key('ctrl');
    await js(`document.querySelector('.xterm-helper-textarea').focus()`);
    await page('Input.insertText', { text: 'c' });
    await sleep(300);
    await typeLine('echo after-interrupt');
    ok('3 Ctrl then c on the keyboard sends \\x03',
      d.sent.some((c) => c.type === 'term.write' && c.data.data === '\x03'), JSON.stringify(d.sent));
    ok('3 …which stops the sleep: the next line runs at once',
      await until(async () => (await rowsOf()).some((l) => l.trim() === 'after-interrupt'), 4000), await screen());

    // 4 · the keyboard comes up: the pane is shorter, the shell is told
    await typeLine('clear; stty size');
    await sleep(500);
    const before = (await screen()).match(/^(\d+) (\d+)\s*$/m);
    d.sent.length = 0;
    await setSize(390, 330);
    bridge.fit();
    await sleep(600);
    await typeLine('clear; stty size');
    await sleep(600);
    const after = (await screen()).match(/^(\d+) (\d+)\s*$/m);
    const resize = d.sent.find((c) => c.type === 'term.resize');
    ok('4 a shorter pane (keyboard up) sends term.resize with fewer rows',
      !!resize && resize.data.rows < before?.[1], `${JSON.stringify(resize)} from ${before?.[0]}`);
    ok('4 …and the shell\'s pty follows (stty size)', !!before && !!after && Number(after[1]) < Number(before[1]),
      `${before?.[0]} → ${after?.[0]}`);
    // …and turned on its side: wider.
    d.sent.length = 0;
    await setSize(844, 300);
    bridge.fit();
    await sleep(600);
    const turned = d.sent.find((c) => c.type === 'term.resize');
    ok('4 turned to landscape it sends term.resize with more columns',
      !!turned && turned.data.cols > (resize?.data.cols ?? 999), JSON.stringify(turned));
    await setSize(390, 620);
    bridge.fit();
    await sleep(400);
    await typeLine('clear');
    await sleep(400);
    await typeLine('echo hi');
    await sleep(400);
    await typeLine('ls -d /usr/bin');
    await sleep(800);
    if (shot) {
      const png = await page('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(shot, Buffer.from(png.data, 'base64'));
      console.log(`  ·     ${shot}`);
    }

    // 5 · leaving
    const termId = bridge.termId;
    bridge.close();
    await sleep(800);
    const check = daemon();
    const list = await check.call('term.list');
    ok('5 leaving sends term.close and the daemon ends the shell',
      d.sent.some((c) => c.type === 'term.close' && c.data.term_id === termId)
      && !(list.terms || []).some((t) => t.term_id === termId), JSON.stringify(list));
    check.ws.close();
    d.ws.close();
  } finally {
    browser.kill();
  }
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
