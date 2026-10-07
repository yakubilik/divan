#!/usr/bin/env node
/** Every route of the panel in a real browser, Night and Day, desktop and phone
 *  width; Back, reload and cold open for every page type; the HANDOVER §2 rules
 *  read off the built pages; and the panel over a computer with nothing on it.
 *
 *     CHROME=/path/to/chrome node scripts/test-walk-ui.mjs
 *
 *  Pictures go to $USTABASI_SHOTS when it is set, else .test-build/walk/shots. */
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checker, launch, web } from './walk-browser.mjs';
import { AUDIT } from './walk-audit.js';

const { ok, done } = checker();
const b = await launch('walk');
const shots = process.env.USTABASI_SHOTS || join(b.build, 'shots');
mkdirSync(shots, { recursive: true });

const ROUTES = [
  ['dashboard', '/'], ['waiting', '/waiting'],
  ['project', '/p/quire'], ['project-dormant', '/p/hush'], ['board', '/p/quire/board'],
  ['repositories', '/p/quire/branches'], ['new-ticket', '/p/quire/new'], ['project-chats', '/p/quire/chat'],
  ['branch', '/p/quire/b/Engineering'], ['branch-unconnected', '/p/quire/b/SEO'], ['ticket', '/p/quire/c/k1'],
  ['chat', '/chats'],
  ...['machines', 'executors', 'terminal', 'settings', 'screen', 'accounts', 'quota', 'admin', 'fleet',
      'projects', 'agents', 'update', 'preferences'].map((v) => [`machine-${v}`, `/machine/${v}`]),
];
/** Things that open over a page and are not a route of their own. */
const OVER = [
  ['dashboard-picker', '/', `[...document.querySelectorAll('button')].find((e) => e.getAttribute('aria-label') === 'Agent: Hermes').click();`],
  ['dashboard-palette', '/', `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));`],
  ['dashboard-more-options', '/', `[...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'More options').click();`],
  ['chat-earlier', '/chats', `[...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Earlier').click();`],
];
const THEMES = [['dark', 'night'], ['light', 'day']];
const WIDTHS = [1440, 390];
const audit = (phone) => b.evaluate(AUDIT.replace('__PHONE__', String(phone)));
const found = { blur: [], contrast: [], small: [], unlabelled: [], emoji: [] };
const keep = (where, res) => { for (const k of Object.keys(found)) for (const x of res[k]) found[k].push(`${where}: ${x}`); };

try {
  console.log('── every route, Night and Day, 1440 and 390 wide');
  const problems = [];
  const missing = [];
  let pictures = 0;
  for (const width of WIDTHS) {
    const phone = width < 600;
    await b.size(width, phone);
    for (const [theme, word] of THEMES) {
      for (const [name, path, act] of [...ROUTES, ...OVER]) {
        await b.cold(path, { theme });
        if (act) { await b.evaluate(act); await new Promise((r) => setTimeout(r, 400)); }
        const drawn = await b.evaluate(`return document.getElementById('root').dataset.theme === ${JSON.stringify(theme)}
          && !!document.querySelector('.dv-topline') && !document.body.textContent.includes('Something went wrong');`);
        if (!drawn) missing.push(`${name} ${word} ${width}`);
        keep(`${name} ${word} ${width}`, await audit(phone));
        await b.shot(join(shots, `web-${name}-${word}-${width}.png`), width, phone);
        pictures++;
        for (const p of b.drain()) problems.push(`${name} ${word} ${width}: ${p}`);
      }
    }
  }
  ok(`${ROUTES.length} routes and ${OVER.length} overlays drew in both themes at both widths, ${pictures} pictures saved`,
    !missing.length && pictures === (ROUTES.length + OVER.length) * 4, missing.join('\n    '));
  ok('zero console errors and zero uncaught exceptions on the walk', !problems.length, problems.slice(0, 20).join('\n    '));

  console.log('── Back, reload and cold open, for every page type');
  await b.size(1440, false);
  const at = () => b.evaluate('return location.pathname;');
  const mark = (js) => b.evaluate(`return !!(${js});`);
  /** A press on the first `css` match whose name starts with `text`. A link the
   *  panel does not catch is a real navigation, and is waited out like one. */
  const press = async (css, text) => {
    const found = await b.evaluate(`
      const el = [...document.querySelectorAll(${JSON.stringify(css)})].find((e) =>
        (e.getAttribute('aria-label') || e.textContent).trim().startsWith(${JSON.stringify(text)}));
      if (!el) return false; setTimeout(() => el.click(), 0); return true;`);
    await new Promise((r) => setTimeout(r, 500));
    await b.settle();
    return found;
  };
  const back = async () => { await b.evaluate('setTimeout(() => history.back(), 0);'); await new Promise((r) => setTimeout(r, 500)); await b.settle(); };
  const machineTab = (label) => `[...document.querySelectorAll('[aria-label="Machine"] [aria-pressed="true"]')].some((e) => e.textContent.trim().startsWith(${JSON.stringify(label)}))`;
  const PAGES = [
    // type, where it is, what says it is there, how it is reached, from where
    ['dashboard', '/', `document.querySelector('h1.dv-greet')`, null, null],
    ['project', '/p/quire', `document.querySelector('h1')?.textContent.trim() === 'Quire' && document.querySelector('[aria-pressed="true"]')?.textContent.trim() === 'Overview'`, ['a[data-tile]', 'Q'], '/'],
    ['board', '/p/quire/board', `document.querySelector('.dv-board-cols')`, ['button[aria-pressed]', 'Board'], '/p/quire'],
    ['ticket', '/p/quire/c/k1', `document.querySelector('h1')?.textContent.trim() === 'Webhook retry policy'`, ['.dv-board-cols button', 'Webhook retry policy'], '/p/quire/board'],
    ['branch', '/p/quire/b/Engineering', `document.querySelector('h1')?.textContent.trim() === 'Engineering'`, ['a[href="/p/quire/b/Engineering"]', ''], '/p/quire'],
    ['chat', '/chats/c1', `document.querySelector('textarea[name="composer"]')`, ['.dv-topline button', 'Chats'], '/'],
    ['waiting', '/waiting', `/answer|task|Nothing/.test(document.querySelector('h1')?.textContent ?? '')`, ['a[href="/waiting"]', 'See all'], '/'],
    ['machine › machines', '/machine/machines', machineTab('Machines'), ['.dv-topline button', 'Machine'], '/'],
    ['machine › executors', '/machine/executors', machineTab('Executors'), ['[aria-label="Machine"] button', 'Executors'], '/machine/machines'],
    ['machine › terminal', '/machine/terminal', machineTab('Terminal'), ['[aria-label="Machine"] button', 'Terminal'], '/machine/machines'],
    ['machine › settings', '/machine/settings', machineTab('Settings'), ['[aria-label="Machine"] button', 'Settings'], '/machine/machines'],
  ];
  const where = Object.fromEntries(PAGES.map(([, path, js]) => [path, js]));
  for (const [type, path, js, via, from] of PAGES) {
    await b.cold(path);
    const coldOk = (await at()) === path && await mark(js);
    await b.reload();
    const reloadOk = (await at()) === path && await mark(js);
    let backOk = true;
    let detail = '';
    if (via) {
      await b.cold(from);
      const pressed = await press(...via);
      const arrived = pressed && (await at()) === path && await mark(js);
      await back();
      const returned = (await at()) === from && await mark(where[from]);
      backOk = arrived && returned;
      detail = `pressed ${pressed}, arrived ${arrived}, back to ${await at()}`;
    }
    ok(`${type}: cold open and reload land on ${path}${via ? `, and Back from it returns to ${from}` : ''}`,
      coldOk && reloadOk && backOk, `cold ${coldOk}, reload ${reloadOk}, ${detail}`);
  }
  const bad = b.drain();
  ok('no console errors while going back and forth', !bad.length, bad.join('\n    '));

  console.log('── HANDOVER §2 over every built page, both themes');
  ok('no element has a backdrop-filter', !found.blur.length, found.blur.slice(0, 10).join('\n    '));
  ok('no text is under 4.5:1 against its surface', !found.contrast.length, found.contrast.slice(0, 15).join('\n    '));
  ok('no interactive element is under 44px on the phone layout', !found.small.length, found.small.slice(0, 15).join('\n    '));
  ok('every icon-only button and every field has an accessible name', !found.unlabelled.length, found.unlabelled.slice(0, 10).join('\n    '));
  ok('no emoji in what the panel says', !found.emoji.length, found.emoji.slice(0, 10).join('\n    '));
  const sheets = readdirSync(b.build).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(b.build, f), 'utf8')).join('');
  const declared = (sheets.match(/backdrop-filter\s*:\s*[^;}]+/g) ?? []).filter((d) => !/:\s*none/.test(d));
  ok('…and no stylesheet declares one', !declared.length, declared.join(' '));

  console.log('── no sample figure from the handover, and the empty sentences');
  const SAMPLE = ['mac-studio', 'macbook-air', '4 Jan 2026', 'Exam info pages', 'resets in 2d', 'Safari 17', '12 open',
    '6 done this month', 'Show 4 more', '2 answers, 1 task', 'Quiet for 5 weeks', 'Quiet for 2 months', '14m ago',
    'isghocam', 'babysee', 'Lesson search', 'Paywall copy', 'Certificate PDF', 'safari-e2e', '12 passed', '#112',
    'resume 05:03', 'testing 3/4', '3/4 checks'];
  const code = (file) => readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/\{\s*\}/g, '');
  const files = [];
  const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|css)$/.test(f)) files.push(p); } };
  // The phone's design gallery is a development route that turns away in a
  // release build; it holds the parts' names, not data.
  for (const dir of ['src', '../app/src', '../app/app']) walk(join(web, dir));
  const hits = files.filter((f) => !f.endsWith('divan-gallery.tsx'))
    .flatMap((f) => SAMPLE.filter((s) => code(f).includes(s)).map((s) => `${relative(web, f)}: ${s}`));
  ok(`none of ${SAMPLE.length} sample values from the frames is in the code of either client`, !hits.length, hits.join('\n    '));

  const empty = async (path) => { await b.cold(path, { fixture: 'empty' }); return b.evaluate('return document.body.innerText;'); };
  const dash = await empty('/');
  ok('an empty computer: the Dashboard says nothing waits and draws no Needs you, and no figure of its own',
    /Nothing needs you|nothing is stuck/i.test(dash) && !/Needs you\n/.test(dash) && !/\b\d+\s+working\b/.test(dash), dash.slice(0, 400));
  const wait = await empty('/waiting');
  ok('…Waiting on you says so in one sentence', /Nothing is waiting on you|Nothing waits/i.test(wait), wait.slice(0, 300));
  const term = await empty('/machine/terminal');
  ok('…the Terminal says no chat has been started', /No chat has been started anywhere/.test(term), term.slice(0, 300));
  const chats = await empty('/chats');
  ok('…and the Chat place opens a box to write in, with no conversation invented', /No conversation yet/.test(chats) && /Message to Hermes/.test(chats) && !/Webhook retry policy/.test(chats), chats.slice(0, 300));
  const emptyBad = b.drain();
  ok('…with no console errors', !emptyBad.length, emptyBad.join('\n    '));
} finally {
  b.close();
}
process.exit(done());
