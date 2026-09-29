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
const { DARK, LIGHT, MEDIA, MONOGRAM, ON_COLOUR, EXECUTORS } =
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
  const own = [ON_COLOUR, ...MONOGRAM,
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
    ok('every screen and every panel it opens is on the page',
      resolved.screens.length === 20, resolved.screens.join(', '));
    ok('the page itself is the theme’s own background',
      resolved.body === asRgb(tokens.bg), resolved.body);
    const shadowStray = resolved.shadows
      .flatMap((s) => s.match(/rgba?\([^)]*\)/g) ?? [])
      .filter((v) => !palette.has(v));
    ok('the shadows and the rings are made of it too', shadowStray.length === 0,
      shadowStray.slice(0, 6).join(', '));

    // ── is any of it legible? ────────────────────────────────────────────
    // Membership in the palette says a colour is the design's. It does not say
    // the pair is readable: white is in the table, `s2` is in the table, and
    // white on `s2` is an empty-looking button. So every pair a browser
    // actually painted is measured — text against what is behind it, and a
    // glyph against what is behind it — and held to 3:1, which is WCAG's floor
    // for large text and for a graphic that carries meaning.
    await evaluate(`
      window.__audit = () => {
      const parse = (c) => {
        const n = (c.match(/[\\d.]+/g) || []).map(Number);
        return n.length ? { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 } : null;
      };
      const over = (fg, bg) => ({
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
      });
      const lum = ({ r, g, b }) => {
        const ch = [r, g, b].map((v) => {
          const x = v / 255;
          return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
      };
      const contrast = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      /** What is behind an element, composited: its own fill first, then every
       *  translucent layer above the page, then the page. */
      const behind = (el) => {
        const layers = [];
        for (let n = el; n; n = n.parentElement) {
          const bg = parse(getComputedStyle(n).backgroundColor);
          if (!bg || bg.a === 0) continue;
          layers.push(bg);
          if (bg.a >= 0.999) break;
        }
        let out = { r: 255, g: 255, b: 255, a: 1 };
        for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
        return out;
      };
      const faded = (el) => {
        let o = 1;
        for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity || 1);
        return o;
      };
      const shows = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden';
      };
      const ownText = (el) => [...el.childNodes]
        .some((n) => n.nodeType === 3 && n.textContent.trim().length);

      const thin = [];
      let pairs = 0;
      for (const el of document.querySelectorAll('[data-screen] *, #root > [data-theme] *')) {
        if (!shows(el)) continue;
        const cs = getComputedStyle(el);
        const bg = behind(el);
        const o = faded(el);
        const check = (raw, what) => {
          const fg = parse(raw);
          if (!fg || fg.a === 0) return;
          const ratio = contrast(over({ ...fg, a: fg.a * o }, bg), bg);
          pairs++;
          if (ratio >= 3) return;
          const where = el.closest('[data-screen]')?.dataset.screen ?? 'the parts';
          const label = (el.textContent || '').trim().slice(0, 24) || el.tagName.toLowerCase();
          thin.push(where + ' · ' + label + ' · ' + what + ' ' + raw
            + ' on rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(',') + ')'
            + (o < 1 ? ' at ' + o.toFixed(2) + ' opacity' : '')
            + ' = ' + ratio.toFixed(2) + ':1');
        };
        if (ownText(el) && Number(cs.fontSize.replace('px', '')) > 0) check(cs.color, 'text');
        if (el.tagName.toLowerCase() === 'svg') {
          // The computed value, not the attribute: an icon is handed
          // \`var(--dv-ink3)\` and it is the browser that turns that into a colour.
          if (cs.stroke && cs.stroke !== 'none') check(cs.stroke, 'glyph');
          if (cs.fill && cs.fill !== 'none') check(cs.fill, 'glyph');
        }
      }
      return { thin: [...new Set(thin)], pairs };
      };
    `);
    const legible = await evaluate('return window.__audit();');
    ok('every pair the browser painted is legible — 3:1 or better',
      legible.thin.length === 0, legible.thin.slice(0, 12).join('\n    '));
    ok('…and it measured a page-worth of them', legible.pairs > 600, String(legible.pairs));

    // Settings opens on Accounts, and the section this ticket adds is behind a
    // click on the rail. A source regex is not a render, so it is clicked.
    const appearance = await evaluate(`
      const rail = [...document.querySelectorAll('[data-screen="Settings"] button')];
      const tab = rail.find((b) => b.textContent.trim().startsWith('Appearance'));
      if (!tab) return { found: false };
      tab.click();
      await new Promise((r) => setTimeout(r, 120));
      const pane = document.querySelector('[data-screen="Settings"]');
      return {
        found: true,
        text: pane.innerText,
        segments: [...pane.querySelectorAll('button')].map((b) => b.textContent.trim()),
      };
    `);
    ok('Settings has the Appearance section this ticket adds', appearance.found);
    ok('…and it offers the three answers, with the one in force spelled out',
      ['system', 'light', 'dark'].every((w) => appearance.segments.includes(w))
      && /Following this computer|Set by hand/.test(appearance.text ?? ''),
      (appearance.text ?? '').slice(0, 120));
    const afterClick = await evaluate('return window.__audit();');
    ok('…and it is legible too, which a regex could not have said',
      afterClick.thin.length === 0, afterClick.thin.slice(0, 8).join('\n    '));

    const shot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, `parts-${scheme}.png`), Buffer.from(shot.data, 'base64'));

    // …and one of the screens, which is the half of this that is about what was
    // already here rather than about what is being added.
    for (const screen of ['Dashboard', 'Settings', 'Terminal', 'ChatOpen', 'ApprovalModal']) {
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
