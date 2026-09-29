#!/usr/bin/env node
/** Do the two themes actually paint?
 *
 *     CHROME=/path/to/chrome node scripts/test-divan-ui.mjs
 *
 *  `npm test` holds the palette to the artboards, renders every part and every
 *  screen, and reads the colours off the markup. What it cannot see is the step
 *  after that: the panel names its colours (`var(--dv-ink3)`) and a browser
 *  resolves them. A variable nobody declared does not fail — it falls back, and
 *  the text quietly takes the colour of whatever is behind it, in one theme
 *  only. So this drives a real browser over the DevTools protocol, opens every
 *  screen in each theme, and reads back the colours that were actually
 *  resolved.
 *
 *  It needs a browser on the machine, so it is not in CI and not in `npm test`
 *  — the same arrangement as `test-ticket-ui.mjs`. It also leaves a screenshot
 *  of each theme in `.test-build/divan/`, which is the thing to hold up against
 *  `design/divan/frames/12-web12-*.html` and `13-web13-*.html`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'divan');

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

// ── the palette, as the check's own answer key ──────────────────────────────
// Read out of the panel's own module, not transcribed again: what this check is
// about is whether the browser resolved them, and `npm test` is what holds them
// to the artboards.
const { DARK, LIGHT, MEDIA, MONOGRAM, ON_COLOUR, EXECUTORS, EXEC_PENDING_INK, EXEC_PENDING_LINE } =
  await (async () => {
    mkdirSync(out, { recursive: true });
    execFileSync(join(web, 'node_modules', '.bin', 'esbuild'), [
      'src/lib/theme.ts', '--bundle', '--format=esm', '--target=es2022',
      `--outfile=${join(out, 'theme.mjs')}`, '--log-level=warning',
    ], { cwd: web, stdio: 'inherit' });
    return import(`file://${join(out, 'theme.mjs')}`);
  })();

// ── build the page ──────────────────────────────────────────────────────────

execFileSync(join(web, 'node_modules', '.bin', 'esbuild'), [
  'scripts/divan-ui-harness.tsx',
  // A plain script, not a module: a module loaded from a file:// page is a
  // cross-origin request, and the page comes up empty.
  '--bundle', '--format=iife', '--jsx=automatic', '--target=es2022',
  `--outfile=${join(out, 'ui-harness.js')}`,
  '--define:process.env.NODE_ENV="development"',
  // The panel is built by vite, which gives it `import.meta.env`; a bundle that
  // has to be a plain script has to be told what that is.
  '--define:import.meta.env.DEV=false',
  '--log-level=warning',
], { cwd: web, stdio: 'inherit' });

writeFileSync(join(out, 'ui-harness.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<title>Divan · both themes</title><style>'
  + 'html,body,#root{margin:0;background:Canvas;color:CanvasText;'
  + 'font-family:-apple-system,system-ui,sans-serif}</style></head>'
  + '<body><div id="root"></div><script src="./ui-harness.js"></script></body></html>');

// ── drive it ────────────────────────────────────────────────────────────────

const browser = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--user-data-dir=' + join(out, 'chrome-profile'),
  '--window-size=1440,900', 'about:blank',
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
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'threw');
  return r.result.value;
}

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

/** `#131210` and `rgba(236,232,225,.08)` as the browser writes them back. */
function asRgb(value) {
  if (value.startsWith('#')) {
    const h = value.slice(1);
    const n = h.length === 3 ? [...h].map((c) => c + c) : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
    return `rgb(${n.map((x) => parseInt(x, 16)).join(', ')})`;
  }
  const nums = value.match(/[\d.]+/g).map(Number);
  if (nums.length === 3) return `rgb(${nums.join(', ')})`;
  const a = nums[3];
  return `rgba(${nums.slice(0, 3).join(', ')}, ${a})`;
}

/** Every colour a theme is allowed to have resolved to, as Chrome spells it. */
function allowed(tokens) {
  const own = [ON_COLOUR, EXEC_PENDING_INK, EXEC_PENDING_LINE, ...MONOGRAM,
               ...Object.values(EXECUTORS).map((e) => e.fill).filter(Boolean),
               ...Object.values(MEDIA)];
  const set = new Set([...Object.entries(tokens).filter(([k]) => k !== 'scheme').map(([, v]) => asRgb(v)),
                       ...own.map(asRgb),
                       'rgba(0, 0, 0, 0)', 'transparent']);
  // Chrome drops a trailing zero and writes `rgba(0, 0, 0, 0.5)`; both spellings
  // of every alpha are accepted so the answer key does not have to guess.
  for (const v of [...set]) set.add(v.replace(/, 0\./, ', .').replace(/, \./, ', 0.'));
  return set;
}

try {
  await page('Page.enable');
  await page('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  for (const scheme of ['dark', 'light']) {
    const tokens = scheme === 'dark' ? DARK : LIGHT;
    console.log(`── the ${scheme} theme, as a browser resolves it`);
    await page('Page.navigate', { url: `file://${join(out, 'ui-harness.html')}?theme=${scheme}` });
    const up = await evaluate(`
      for (let i = 0; i < 100; i++) {
        if (document.querySelector('[data-screen="Dashboard"]')) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    `);
    ok('the page came up', up);
    if (!up) break;

    const vars = await evaluate(`
      const cs = getComputedStyle(document.documentElement);
      return ${JSON.stringify(Object.keys(tokens).filter((k) => k !== 'scheme'))}
        .map((n) => [n, cs.getPropertyValue('--dv-' + n).trim()]);
    `);
    const wrong = vars.filter(([n, v]) => v !== tokens[n]);
    ok('every name in the table is declared on the document, with this theme’s value',
      wrong.length === 0, wrong.map(([n, v]) => `${n}: ${v || 'nothing'}`).join(', '));

    const resolved = await evaluate(`
      const out = { strayed: [], screens: [], painted: 0, where: {} };
      // The panel and the gallery, and not the page around them: html carries
      // the theme attribute, so a descendant selector on it would be
      // everything — including the harness's own root, which is painted in the
      // browser's system colours on purpose, the way index.html paints it.
      for (const el of document.querySelectorAll('[data-screen] *, #root > [data-theme] *')) {
        const cs = getComputedStyle(el);
        for (const prop of ['color', 'background-color', 'border-top-color', 'border-bottom-color',
                            'border-left-color', 'border-right-color']) {
          const v = cs.getPropertyValue(prop);
          if (!v) continue;
          out.painted++;
          out.strayed.push(v);
          if (!out.where[v]) out.where[v] = el.tagName + '.' + prop + ' in '
            + (el.closest('[data-screen]')?.dataset.screen ?? 'gallery');
        }
      }
      out.strayed = [...new Set(out.strayed)];
      out.screens = [...document.querySelectorAll('[data-screen]')].map((d) => d.dataset.screen);
      out.body = getComputedStyle(document.body).backgroundColor;
      out.shadows = [...new Set([...document.querySelectorAll('[data-screen] *, #root > [data-theme] *')]
        .map((el) => getComputedStyle(el).boxShadow).filter((s) => s && s !== 'none'))];
      return out;
    `);
    const palette = allowed(tokens);
    const strayed = resolved.strayed.filter((v) => !palette.has(v));
    ok('every colour the browser resolved on every screen is one of this theme’s',
      strayed.length === 0, strayed.slice(0, 8).map((v) => `${v} — ${resolved.where[v]}`).join('\n    '));
    ok('…and there were enough of them for that to mean something',
      resolved.painted > 2000, String(resolved.painted));
    ok('every screen is on the page', resolved.screens.length === 11, resolved.screens.join(', '));
    ok('the page itself is the theme’s own background',
      resolved.body === asRgb(tokens.bg), resolved.body);
    const shadowStray = resolved.shadows
      .flatMap((s) => s.match(/rgba?\([^)]*\)/g) ?? [])
      .filter((v) => !palette.has(v));
    ok('the shadows and the rings are made of it too', shadowStray.length === 0,
      shadowStray.slice(0, 6).join(', '));

    const shot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, `parts-${scheme}.png`), Buffer.from(shot.data, 'base64'));

    // …and one of the screens, which is the half of this that is about what was
    // already here rather than about what is being added.
    for (const screen of ['Dashboard', 'Settings', 'Terminal']) {
      await evaluate(`
        document.querySelector('[data-screen="${screen}"]').scrollIntoView();
        await new Promise((r) => setTimeout(r, 120));
      `);
      const s = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(join(out, `screen-${screen.toLowerCase()}-${scheme}.png`), Buffer.from(s.data, 'base64'));
    }
    await evaluate('window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 60));');
  }

  // The page is still on the light theme from the loop above, and a screen — as
  // opposed to the gallery — carries no theme of its own, which is the panel's
  // own arrangement: one attribute on `<html>` and everything follows.
  console.log('── the switch, in a browser');
  const switched = await evaluate(`
    const cards = [...document.querySelectorAll('[data-screen] div')]
      .filter((d) => getComputedStyle(d).backgroundColor === ${JSON.stringify(asRgb(LIGHT.s1))});
    const card = cards[0];
    const before = getComputedStyle(card).backgroundColor;
    const beforeVar = getComputedStyle(document.documentElement).getPropertyValue('--dv-bg').trim();
    document.documentElement.dataset.theme = 'dark';
    const after = getComputedStyle(card).backgroundColor;
    const afterVar = getComputedStyle(document.documentElement).getPropertyValue('--dv-bg').trim();
    return { before, after, beforeVar, afterVar, cards: cards.length };
  `);
  ok('one attribute repaints the page', switched.beforeVar === LIGHT.bg && switched.afterVar === DARK.bg,
    JSON.stringify(switched));
  ok('…and every card on every screen with it',
    switched.cards > 5 && switched.before === asRgb(LIGHT.s1) && switched.after === asRgb(DARK.s1),
    JSON.stringify(switched));
} finally {
  ws.close();
  browser.kill();
}

console.log(failures ? `\n${failures} failed` : `\nall good — screenshots in ${out}`);
process.exit(failures ? 1 : 0);
