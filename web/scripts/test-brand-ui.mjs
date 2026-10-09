#!/usr/bin/env node
/** The Divan seal in a real browser: the brand control on the line, the tab
 *  icons and the home-screen icon — each one square seal, loaded, and readable
 *  on both canvases — and the brand control still leading to the Dashboard
 *  across a theme switch and a reload, with no request for a file that is not
 *  there. Screenshots go to `.test-build/` (and `$USTABASI_SHOTS` when set).
 *
 *     CHROME=/path/to/chrome node scripts/test-brand-ui.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'brand');

const chrome = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!chrome) {
  console.error('no browser found — set CHROME to one');
  process.exit(2);
}

execFileSync(join(web, 'node_modules', '.bin', 'vite'), [
  'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn',
], { cwd: web, stdio: 'inherit' });

// Served like the daemon serves it: an address with no extension is the
// panel, a file that is not there is a 404 — and every 404 is written down.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const missing = [];
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const path = join(out, pathname);
  if (extname(pathname) && !existsSync(path)) {
    missing.push(pathname);
    res.writeHead(404); res.end(); return;
  }
  const file = extname(pathname) ? path : join(out, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;

const profile = join(web, '.test-build', 'brand-profile');
rmSync(profile, { recursive: true, force: true });
const browser = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const endpoint = await new Promise((done, fail) => {
  let buf = '';
  const timer = setTimeout(() => fail(new Error('the browser never said where it was listening')), 20000);
  browser.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/ws:\/\/[^\s]+/);
    if (m) { clearTimeout(timer); done(m[0]); }
  });
});

const ws = new WebSocket(endpoint);
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
async function evaluate(expression) {
  const r = await page('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'threw');
  return r.result.value;
}
const wait = (cond) => evaluate(`
  for (let i = 0; i < 100; i++) {
    if (${cond}) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
`);
async function open() {
  await page('Page.navigate', { url });
  return wait(`document.querySelector('button[title^="Switch to the"]')`);
}
/** The seal on the line as the page drew it, and the colour of its ink. */
const seal = () => evaluate(`
  const img = document.querySelector('.dv-topline a.dv-word img');
  if (!img) return null;
  await img.decode().catch(() => {});
  const box = img.getBoundingClientRect();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0, r = 0, gr = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 240) { n++; r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
  return {
    src: new URL(img.src).pathname, loaded: img.complete && img.naturalWidth > 0,
    natural: [img.naturalWidth, img.naturalHeight], drawn: [box.width, box.height],
    ink: [r / n, gr / n, b / n],
    canvas: getComputedStyle(document.getElementById('root')).getPropertyValue('--canvas').trim(),
    theme: document.getElementById('root').dataset.theme,
    home: document.querySelector('.dv-topline a.dv-word')?.getAttribute('aria-current') === 'page',
    path: location.pathname + location.search,
  };
`);
const icons = () => evaluate(`
  const links = [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')];
  return Promise.all(links.map(async (l) => {
    const res = await fetch(l.href);
    const bmp = res.ok ? await createImageBitmap(await res.blob()) : null;
    return { rel: l.rel, href: new URL(l.href).pathname, sizes: l.getAttribute('sizes'),
             status: res.status, type: res.headers.get('content-type'), size: bmp ? [bmp.width, bmp.height] : null };
  }));
`);
const press = (sel) => evaluate(`
  document.querySelector(${JSON.stringify(sel)}).click();
  await new Promise((r) => setTimeout(r, 200));
`);

const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
async function shoot(name) {
  await evaluate('await document.fonts.ready; await new Promise((r) => setTimeout(r, 300));');
  const shot = Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  writeFileSync(join(web, '.test-build', `${name}.png`), shot);
  if (process.env.USTABASI_SHOTS) writeFileSync(join(process.env.USTABASI_SHOTS, `${name}.png`), shot);
}

try {
  await page('Page.enable');
  await page('Page.navigate', { url });
  await evaluate(`localStorage.clear();
    localStorage.setItem('rac.theme', 'dark');
    localStorage.setItem('rac.hosts', JSON.stringify([{ host: '127.0.0.1', port: 9, token: 't', name: 'studio' }]));`);

  console.log('── the icons');
  ok('the panel came up', await open());
  const ic = await icons();
  ok('a 32 and a 64 px tab icon and a 180 px home-screen icon, each a square PNG that is there',
    ic.length === 3 && ic.every((i) => i.status === 200 && i.type === 'image/png'
      && i.size && i.size[0] === i.size[1] && i.sizes === `${i.size[0]}x${i.size[1]}`)
    && ic.map((i) => i.size[0]).sort((a, b) => a - b).join() === '32,64,180', JSON.stringify(ic));

  console.log('── the seal on the line, both themes');
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') { await press('button[title^="Switch to the"]'); await open(); }
    const s = await seal();
    ok(`${theme}: the seal is the brand control, loaded, square and drawn square`,
      s && s.theme === theme && s.src === '/divan-seal.png' && s.loaded
      && s.natural[0] === s.natural[1] && s.drawn[0] === s.drawn[1] && s.drawn[0] > 0, JSON.stringify(s));
    const ratio = contrast(s.ink, hex(s.canvas));
    ok(`${theme}: its turquoise ink stands at least 3:1 against the ${s.canvas} canvas (${ratio.toFixed(2)}:1)`,
      ratio >= 3, JSON.stringify(s.ink));
    await shoot(`brand-${theme}`);
  }

  console.log('── the brand control leads to the Dashboard');
  // Every page but the Dashboard opens the line on the way back instead, so
  // the walk is: away, back by that, then the seal itself.
  await press('button[aria-label="Machine"]');
  const away = await evaluate(`return { seal: !!document.querySelector('.dv-topline a.dv-word'),
    back: document.querySelector('.dv-topline .dv-back')?.getAttribute('aria-label') ?? null };`);
  ok('on Machine the line opens on the way back to the Dashboard instead', !away.seal && away.back === 'Back to Dashboard',
    JSON.stringify(away));
  await press('.dv-topline .dv-back');
  ok('…which brings the seal back', await wait(`document.querySelector('.dv-topline a.dv-word img')`));
  await press('.dv-topline a.dv-word');
  const home = await seal();
  ok('pressing the seal is the Dashboard, at /', home && home.loaded && home.home && home.path === '/', JSON.stringify(home));
  await press('button[title^="Switch to the"]');
  await open();
  const after = await seal();
  ok('after a theme switch and a reload the seal is still there, in the other theme',
    after && after.loaded && after.theme === 'dark' && after.home, JSON.stringify(after));
  ok('no request anywhere asked for a file that is not there', missing.length === 0, missing.join(', '));
} finally {
  ws.close();
  browser.kill();
  server.close();
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
