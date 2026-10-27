#!/usr/bin/env node
/** Photos and videos in a chat, looked at in a real browser (#607).
 *
 *     cd web && npm run test:ui     # or: CHROME=/path/to/chrome node scripts/test-media-ui.mjs
 *
 *  `test-media.mjs` checks the rule for a bubble's size. What it cannot check
 *  is what the browser does with it: that a phone video is drawn as an upright
 *  bubble with its whole frame in it and a landscape one as a wide one, that a
 *  photo alone takes its own shape, and that pressing either opens one viewer
 *  for the photos and videos of the message — the original file, letterboxed,
 *  a video in the browser's own player — that the arrows step through and
 *  Escape puts away, leaving the chat where it was.
 *
 *  One local server stands in for the computer: it serves the page and the
 *  files in `fixtures/media` at `/files?path=…`, the daemon's own address for a
 *  file. Pictures of what it saw go to $USTABASI_SHOTS when that is set.
 *
 *  Not in `npm test`: it needs a browser on the machine.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'media-ui');
const fixtures = join(web, 'scripts', 'fixtures', 'media');
const shots = process.env.USTABASI_SHOTS || join(out, 'shots');

const CHROMES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const chrome = CHROMES.find((p) => existsSync(p));
if (!chrome) {
  console.error('no browser found — set CHROME to one');
  process.exit(2);
}

// ── build the page ──────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(shots, { recursive: true });
// Bundled by vite's own build (rolldown), which is what the panel is built
// with; a plain script, not a module, so nothing about the page is deferred.
await build({
  root: web, configFile: false, logLevel: 'warn', publicDir: false,
  define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.DEV': 'false' },
  build: {
    outDir: out, emptyOutDir: false, minify: false, copyPublicDir: false,
    lib: { entry: join(web, 'scripts', 'media-harness.tsx'), formats: ['iife'], name: 'harness', fileName: () => 'harness.js', cssFileName: 'harness' },
  },
});
writeFileSync(join(out, 'harness.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<title>Media harness</title><link rel="stylesheet" href="./harness.css"><style>'
  + 'html,body,#root{height:100%;margin:0;'
  + 'font-family:-apple-system,system-ui,sans-serif}</style></head>'
  + '<body><div id="root"></div><script src="./harness.js"></script></body></html>');

// ── the computer ────────────────────────────────────────────────────────────

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.webm': 'video/webm', '.wav': 'audio/wav', '.txt': 'text/plain',
};
/** Every file asked for, so the test can say which one the viewer read. */
const asked = [];
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let file;
  if (u.pathname === '/files') {
    asked.push(u.searchParams.get('path'));
    file = join(fixtures, basename(u.searchParams.get('path') || ''));
  } else file = join(out, basename(u.pathname));
  if (!existsSync(file)) { res.writeHead(404).end(); return; }
  const size = statSync(file).size;
  const head = { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  if (u.searchParams.get('download')) head['Content-Disposition'] = `attachment; filename="${basename(file)}"`;
  // A video is read in ranges; a player handed the whole file cannot seek.
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const from = m[1] ? Number(m[1]) : 0;
    const to = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${from}-${to}/${size}`, 'Content-Length': to - from + 1 });
    createReadStream(file, { start: from, end: to }).pipe(res);
    return;
  }
  res.writeHead(200, { ...head, 'Content-Length': size });
  createReadStream(file).pipe(res);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

// ── drive it ────────────────────────────────────────────────────────────────

let browser;
let ws;
let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

try {
  browser = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    '--remote-debugging-port=0', '--user-data-dir=' + join(out, 'chrome-profile'),
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const endpoint = await new Promise((done, fail) => {
    let buf = '';
    const timer = setTimeout(() => fail(new Error('the browser never said where it was listening')), 20000);
    browser.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/ws:\/\/[^\s]+/);
      if (m) { clearTimeout(timer); done(m[0]); }
    });
    browser.on('exit', (code) => { clearTimeout(timer); fail(new Error(`the browser stopped (${code})`)); });
  });

  ws = new WebSocket(endpoint);
  await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    msg.error ? w.fail(new Error(msg.error.message)) : w.done(msg.result);
  };
  const cdp = (method, params = {}, sessionId) => new Promise((done, fail) => {
    const n = ++id;
    waiting.set(n, { done, fail });
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => cdp(method, params, sessionId);
  const evaluate = async (expression) => {
    const r = await page('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'threw');
    return r.result.value;
  };
  const until = (cond, what) => evaluate(`
    for (let i = 0; i < 100; i++) {
      if (${cond}) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(${JSON.stringify(`never: ${what}`)});
  `);
  const settle = (ms = 300) => evaluate(`await new Promise((r) => setTimeout(r, ${ms}));`);
  const click = async (x, y) => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await page('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  };
  const key = async (k, code = k, keyCode) => {
    for (const type of ['keyDown', 'keyUp']) {
      await page('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    }
  };
  const shoot = async (file, clip) => {
    const r = await page('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    writeFileSync(join(shots, file), Buffer.from(r.data, 'base64'));
  };

  await page('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await page('Page.enable');
  await page('Page.navigate', { url: `http://127.0.0.1:${port}/harness.html` });
  await until(`document.querySelector('[data-media]')`, 'the chat came up');
  await until(`[...document.querySelectorAll('[data-media=video] video')].length === 2
    && [...document.querySelectorAll('[data-media=video] video')].every((v) => v.readyState >= 2)`, 'the videos loaded');
  await until(`[...document.querySelectorAll('[data-media=photo] img')].filter((i) => i.complete && i.naturalWidth).length >= 3`, 'the photos loaded');
  await settle();

  /** A bubble as drawn: its box, and how much of its picture that box loses
   *  to `cover` (0 when the box is the picture's own shape). */
  const bubble = (label) => evaluate(`
    const box = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    if (!box) return null;
    const el = box.querySelector('video, img');
    const r = box.getBoundingClientRect();
    const w = el.videoWidth || el.naturalWidth, h = el.videoHeight || el.naturalHeight;
    const a = r.width / r.height, m = w / h;
    return { x: r.x, y: r.y, width: r.width, height: r.height, w, h, fit: getComputedStyle(el).objectFit,
      lost: 1 - Math.min(a / m, m / a), src: el.currentSrc || el.src };
  `);
  const pad = (b) => ({ x: Math.max(0, b.x - 12), y: Math.max(0, b.y - 12), width: b.width + 24, height: b.height + 24 });

  console.log('── the bubbles');
  // Bring the media into view, away from the top, so there is a position to keep.
  await evaluate(`document.querySelector('[aria-label="video portrait.webm"]').scrollIntoView({ block: 'center' });`);
  await settle();
  const pv = await bubble('video portrait.webm');
  const lv = await bubble('video landscape.webm');
  const ph = await bubble('photo photo.jpg');
  ok('the 9:16 video is drawn as a portrait bubble', pv && pv.height > pv.width, JSON.stringify(pv));
  ok('…its box the video\'s own shape, so the whole frame is in it', pv && pv.w === 360 && pv.h === 640 && pv.lost < 0.02, JSON.stringify(pv));
  ok('…as tall as the frame allows (250 × 330 at most, as on the phone)', pv && Math.round(pv.height) === 330, JSON.stringify(pv));
  ok('the 16:9 video is drawn as a landscape bubble', lv && lv.width > lv.height, JSON.stringify(lv));
  ok('…its whole frame in it too', lv && lv.w === 640 && lv.lost < 0.02, JSON.stringify(lv));
  ok('a single portrait photo takes its own shape', ph && ph.height > ph.width && ph.lost < 0.02, JSON.stringify(ph));
  ok('…drawn from the copy kept for the bubble (450 × 800)', ph && /photo-view\.jpg/.test(decodeURIComponent(ph.src)) && ph.w === 450, JSON.stringify(ph));
  ok('the bubble does not play the video in place: no controls on it',
    await evaluate(`return [...document.querySelectorAll('[data-media=video] video')].every((v) => !v.controls && v.paused)`));
  await shoot('portrait-video-bubble.png', pad(pv));
  await shoot('landscape-video-bubble.png', pad(lv));
  await evaluate(`document.querySelector('[aria-label="photo photo.jpg"]').scrollIntoView({ block: 'center' });`);
  await settle();
  await shoot('portrait-photo-bubble.png', pad(await bubble('photo photo.jpg')));

  console.log('── a video, opened');
  await evaluate(`document.querySelector('[aria-label="video portrait.webm"]').scrollIntoView({ block: 'center' });`);
  await settle();
  const scrolled = await evaluate(`return document.getElementById('scroller').scrollTop`);
  ok('the chat is scrolled away from the top', scrolled > 100, String(scrolled));
  const at = await bubble('video portrait.webm');
  await click(at.x + at.width / 2, at.y + at.height / 2);
  await until(`document.querySelector('div[style*="position: fixed"] video')`, 'the viewer opened');
  await until(`document.querySelector('div[style*="position: fixed"] video').readyState >= 2`, 'the video in the viewer loaded');
  await settle(500);
  const viewer = () => evaluate(`
    const v = document.querySelector('div[style*="position: fixed"]');
    if (!v) return null;
    const m = v.querySelector('video, img');
    const r = m.getBoundingClientRect();
    return {
      tag: m.tagName, src: decodeURIComponent(m.currentSrc || m.src),
      path: new URL(m.currentSrc || m.src).searchParams.get('path'), fit: getComputedStyle(m).objectFit,
      controls: !!m.controls, paused: m.paused, w: m.videoWidth || m.naturalWidth, h: m.videoHeight || m.naturalHeight,
      box: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom },
      count: (v.innerText.match(/\\d+ \\/ \\d+/) || [''])[0],
      download: [...v.querySelectorAll('a[download]')].map((a) => decodeURIComponent(a.href)),
      inside: r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
    };
  `);
  const v1 = await viewer();
  ok('pressing the portrait video opens the full-screen viewer on it', v1 && v1.tag === 'VIDEO' && /\/portrait\.webm$/.test(v1.path), JSON.stringify(v1));
  ok('…in the browser\'s own player, with its controls', v1?.controls === true, JSON.stringify(v1));
  ok('…letterboxed, the whole frame: object-fit contain', v1?.fit === 'contain', v1?.fit);
  ok('…and all of it on the screen', v1?.inside, JSON.stringify(v1?.box));
  ok('…bigger than the bubble was', v1 && v1.box.height > at.height * 1.5, JSON.stringify(v1?.box));
  ok('…playing', v1 && !v1.paused, JSON.stringify(v1));
  ok('…one of the two in the message', v1?.count === '1 / 2', v1?.count);
  ok('…with a download of the file', v1?.download.some((h) => /download=1/.test(h) && /portrait\.webm/.test(h)), JSON.stringify(v1?.download));
  await shoot('portrait-video-fullscreen.png');

  await key('ArrowRight', 'ArrowRight', 39);
  await until(`/landscape/.test(document.querySelector('div[style*="position: fixed"] video')?.src || '')`, 'ArrowRight stepped');
  const v2 = await viewer();
  ok('ArrowRight moves to the next video of the same message', /\/landscape\.webm$/.test(v2.path) && v2.count === '2 / 2', JSON.stringify(v2));
  ok('…the first one stopped: only one player left', await evaluate(`return document.querySelectorAll('div[style*="position: fixed"] video').length === 1`));
  await key('ArrowLeft', 'ArrowLeft', 37);
  await until(`/portrait/.test(document.querySelector('div[style*="position: fixed"] video')?.src || '')`, 'ArrowLeft stepped back');
  ok('ArrowLeft goes back', true);
  const next = await evaluate(`const b = document.querySelector('div[style*="position: fixed"] button[title=Next]');
    if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  ok('there are arrows on the screen too', !!next);
  if (next) {
    await click(next.x, next.y);
    await until(`/landscape/.test(document.querySelector('div[style*="position: fixed"] video')?.src || '')`, 'the Next arrow stepped');
    ok('…and the Next arrow steps as well', true);
  }

  await key('Escape', 'Escape', 27);
  await until(`!document.querySelector('div[style*="position: fixed"]')`, 'Escape closed the viewer');
  const after = await evaluate(`return { top: document.getElementById('scroller').scrollTop,
    there: !!document.querySelector('[aria-label="video portrait.webm"]') }`);
  ok('Escape closes it, and the chat is still there', after.there, JSON.stringify(after));
  ok('…at the same scroll position', Math.abs(after.top - scrolled) < 1, JSON.stringify({ before: scrolled, after: after.top }));

  console.log('── a photo, opened');
  await evaluate(`document.querySelector('[aria-label="photo photo.jpg"]').scrollIntoView({ block: 'center' });`);
  await settle();
  const pb = await bubble('photo photo.jpg');
  asked.length = 0;
  await click(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await until(`(() => { const i = document.querySelector('div[style*="position: fixed"] img'); return i && i.complete && i.naturalWidth; })()`, 'the photo opened');
  await settle();
  const p1 = await viewer();
  ok('pressing the photo opens it at the original file, not the bubble\'s copy',
    /\/photo\.jpg$/.test(p1.path) && !/photo-view/.test(p1.src), p1.src);
  ok('…the full-size one (900 × 1600)', p1.w === 900 && p1.h === 1600, JSON.stringify(p1));
  ok('…the original is what the browser asked the computer for', asked.some((p) => /\/photo\.jpg$/.test(p)), JSON.stringify(asked));
  ok('…letterboxed, the whole of it on the screen', p1.fit === 'contain' && p1.inside, JSON.stringify(p1));
  ok('…its box the photo\'s own shape, so nothing of it is cut', Math.abs(p1.box.width / p1.box.height - 900 / 1600) < 0.02, JSON.stringify(p1.box));
  ok('…alone in its message, so no counter', p1.count === '', p1.count);
  await shoot('photo-fullscreen.png');
  await click(8, 790);
  await until(`!document.querySelector('div[style*="position: fixed"]')`, 'a click on the backdrop closed the viewer');
  ok('a click on the backdrop closes it', true);

  console.log('── what was there before');
  const rest = await evaluate(`
    const text = document.body.innerText;
    const audio = document.querySelector('audio');
    return {
      missing: /no longer on the computer/.test(text) && /deleted\\.jpg/.test(text),
      audio: audio ? decodeURIComponent(audio.src) : null,
      transcript: text.includes('a short voice note'),
      file: [...document.querySelectorAll('a')].some((a) => a.textContent === 'notes.txt' && /notes\\.txt/.test(decodeURIComponent(a.href))),
      downloads: [...document.querySelectorAll('[data-chat] a[download]')].map((a) => decodeURIComponent(a.href)),
      grid: document.querySelectorAll('[aria-label="photo grid-a.jpg"] img, [aria-label="photo grid-b.jpg"] img').length,
    };
  `);
  ok('a photo no longer on the computer is the placeholder', rest.missing, JSON.stringify(rest));
  ok('the voice note still plays in place, with its transcript', /note\.wav&/.test(rest.audio || '') && rest.transcript, JSON.stringify(rest));
  ok('a file is still a link', rest.file, JSON.stringify(rest));
  ok('…and the voice note and the file still have their download buttons',
    rest.downloads.some((h) => /note\.wav/.test(h) && /download=1/.test(h)) && rest.downloads.some((h) => /notes\.txt/.test(h) && /download=1/.test(h)),
    JSON.stringify(rest.downloads));
  ok('several photos are still a grid', rest.grid === 2, JSON.stringify(rest));
  const ga = await bubble('photo grid-a.jpg');
  await click(ga.x + ga.width / 2, ga.y + ga.height / 2);
  await until(`/grid-a/.test(document.querySelector('div[style*="position: fixed"] img')?.src || '')`, 'a grid photo opened');
  await key('ArrowRight', 'ArrowRight', 39);
  await until(`/grid-b/.test(document.querySelector('div[style*="position: fixed"] img')?.src || '')`, 'the grid stepped');
  ok('a photo in the grid opens the viewer, and steps to the next one', true);
  await key('Escape', 'Escape', 27);
  await until(`!document.querySelector('div[style*="position: fixed"]')`, 'Escape closed it');
} catch (e) {
  failures++;
  console.error(`  ✗ ${e.message}`);
} finally {
  try { ws?.close(); } catch {}
  browser?.kill();
  server.close();
}

console.log(failures ? `\n${failures} failed` : `\nall good — pictures in ${shots}`);
process.exit(failures ? 1 : 0);
