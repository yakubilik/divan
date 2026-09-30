#!/usr/bin/env node
/** Every web page, beside the frame that drew it.
 *
 *     cd web && node scripts/audit-frames.mjs [path/to/frames]
 *
 *  This is not part of `npm test` and must not become part of it: the frames are
 *  private and are not in this repository, so a check that reads them cannot run
 *  on a clone. `test-divan.mjs` is the one that runs everywhere, and the way it
 *  manages is by quoting the values it needs into its own source. That works for
 *  sixteen colours. It does not work for the question this file answers — *is
 *  every word on the page the word the frame put there* — because the answer is
 *  a few thousand strings and quoting them would be copying the frames in.
 *
 *  So: point it at the frames and it reads them. Seventeen web artboards — Web12
 *  W1–W2, Web13 W3–W4, Web14 W6–W10, Web15 W11–W18, and there is no W5 — each one
 *  rendered, and the panel driven to the page it drew and rendered too. What comes
 *  out is two lists per variant: what the frame says and the panel does not, and
 *  what the panel says and the frame does not. It fixes nothing and it fails
 *  nothing: **a difference is not an error here**, so the exit code is zero
 *  whenever the run finished. It is non-zero only when the run could not happen at
 *  all — no frame directory, no `INDEX.json`, an artboard that is not in the file
 *  `INDEX.json` says it is in.
 *
 *  ## How a frame is read
 *
 *  A frame is a Design Canvas document: one `<x-dc>` template, one
 *  `class Component extends DCLogic` beside it whose `renderVals()` returns the
 *  data, and `{{ … }}`, `<sc-for>` and `<sc-if>` between the two. The runtime
 *  that draws them (`design/divan/support.js`) is a React renderer and wants a
 *  browser; all this needs is the text, so the three constructs are interpreted
 *  here — thirty lines of `walk()` below — against the values `renderVals()`
 *  hands back. That is the whole of the reading: no frame is copied anywhere, no
 *  frame is quoted whole, and nothing is written outside `.test-build`.
 *
 *  ## How the panel is read
 *
 *  Mounted, in a document, and pressed — `test-drive.mjs`'s own arrangement,
 *  because a page reached by clicking what a person clicks is the page a person
 *  gets. jsdom, the real `react-dom/client`, the fixtures the rest of the checks
 *  are drawn from, and one seeded board per world. Each variant is driven to the
 *  state its own artboard is in, which is why the seeded computer answers a brief
 *  for W8 and a display list for W15, and why W14's wall has its tiles put up: a
 *  run that compared W8 against "nobody has written this one's brief yet" would be
 *  reporting the fixture rather than the page.
 *
 *  ## What a "difference" is
 *
 *  Both sides are reduced to their text, normalised (one kind of quote, one kind
 *  of space, no stray separators), and each unit is looked for anywhere in the
 *  other side's text. So a line the panel splits across two elements and the
 *  frame keeps in one still matches: this asks *whether a word is on the page*,
 *  not where. Position, order and pixels are not its business — `test-divan.mjs`
 *  holds the palette, `test-shell.mjs` and `test-machine.mjs` hold the tracks.
 *
 *  Most of what differs is a frame's invented data against the fixture's: the
 *  artboards are drawn on four made-up products, three made-up machines and one
 *  made-up evening, and the panel draws whatever its paired computers report. Each
 *  of those is *waived by a rule carrying the reason it is allowed to match*
 *  (`WAIVED`, per variant, and every rule's reason is printed with the units it
 *  swallowed) — so the two lists that come out are the differences nobody has
 *  explained yet, which is the only number on the page worth reading.
 *
 *  The last two lines of the run are the summary: the differences the bar itself
 *  carries, which every artboard is under and which are therefore said once, and
 *  the pages under `src/screens/` that no web artboard draws at all.
 *
 *  The report written from a run of this is
 *  `docs/audit/2026-09-30-divan-web-frames.md`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'audit');
const frames = resolve(web, process.argv[2] ?? '../design/divan/frames');

const die = (msg) => { console.error(`audit-frames: ${msg}`); process.exit(1); };

// ── the frames have to be there ─────────────────────────────────────────────

if (!existsSync(frames)) {
  die(`no frame directory at ${frames}\n`
    + '  The frames are private and are not in this repository. Pass the path:\n'
    + '    node scripts/audit-frames.mjs ../../remote-ai-chat/design/divan/frames');
}
let index;
try { index = JSON.parse(readFileSync(join(frames, 'INDEX.json'), 'utf8')); }
catch (e) { die(`cannot read ${join(frames, 'INDEX.json')}: ${e.message}`); }

/** The four files the web artboards are in, and which variant is in which. The
 *  order is `INDEX.json`'s own, W11 included where the frame file puts it
 *  (after W16) rather than where its number would. W5 does not exist. */
const FILES = [
  { match: '12-web12', variants: ['W1', 'W2'] },
  { match: '13-web13', variants: ['W3', 'W4'] },
  { match: '14-web14', variants: ['W6', 'W7', 'W8', 'W9', 'W10'] },
  { match: '15-web15', variants: ['W12', 'W13', 'W14', 'W15', 'W16', 'W11', 'W17', 'W18'] },
];

for (const f of FILES) {
  f.file = index.find((e) => (e.file ?? '').includes(f.match))?.file;
  if (!f.file) die(`INDEX.json lists no file matching ${f.match}`);
  f.path = join(frames, f.file.replace(/^frames\//, ''));
  if (!existsSync(f.path)) die(`INDEX.json names ${f.file}, which is not there`);
}

// ── text, the same way on both sides ────────────────────────────────────────

/** One kind of quote, one kind of space, no stray separator: a difference has to
 *  be a difference in the words, not in which apostrophe somebody typed. */
const norm = (s) => s
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[\u00a0\u2009\u202f\u2007]/g, ' ')  // every space a designer types
  .replace(/…/g, '...')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^[·|,;:]+\s*/, '').replace(/\s*[·|,;:]+$/, '')
  .trim();

/** Every text node under an element, in order, normalised and emptied of blanks.
 *  `style` and `script` are skipped on both sides — the panel ships its palette
 *  as a stylesheet in the page, and a frame carries the artboard's own CSS. */
function textsOf(root, { interpolate = null, bound = null } = {}) {
  const found = [];
  const walk = (node, scope) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        const raw = child.nodeValue ?? '';
        const done = interpolate ? interpolate(raw, scope) : raw;
        const unit = norm(done);
        if (unit) found.push(unit);
        // A unit that came out of a `{{ … }}` is the artboard's *data* and not
        // its chrome: `renderVals()` put it there. Recorded rather than
        // guessed at, which is the only way to tell an invented ticket title
        // from a button's label without listing either.
        if (unit && bound && raw.includes('{{')) bound.add(unit);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'style' || tag === 'script' || tag === 'noscript') continue;
      if (interpolate && tag === 'sc-for') { forEach(child, scope, walk); continue; }
      if (interpolate && tag === 'sc-if') {
        if (truthy(child.getAttribute('value'), scope)) walk(child, scope);
        continue;
      }
      walk(child, scope);
    }
  };
  walk(root, interpolate ? interpolate.scope : null);
  return found;
}

/** `{{ expr }}` against a scope, which is `renderVals()`'s object with the
 *  loop variables laid over it. A binding that throws is empty rather than
 *  fatal: the frames are drawn by a runtime with its own opinions about a
 *  missing value, and a run that dies on one says nothing about any page. */
const evalIn = (expr, scope) => {
  const keys = Object.keys(scope ?? {});
  try { return new Function(...keys, `return (${expr});`)(...keys.map((k) => scope[k])); }
  catch { return undefined; }
};
const unwrap = (attr) => String(attr ?? '').replace(/^\s*\{\{/, '').replace(/\}\}\s*$/, '').trim();
const truthy = (attr, scope) => !!evalIn(unwrap(attr), scope);
const forEach = (el, scope, walk) => {
  const list = evalIn(unwrap(el.getAttribute('list')), scope);
  const as = el.getAttribute('as') || 'it';
  if (!Array.isArray(list)) return;
  for (const item of list) walk(el, { ...scope, [as]: item });
};

// ── the frames, read ────────────────────────────────────────────────────────

const { JSDOM } = await import('jsdom');

/** Every web variant's text, by id. The artboard is the element carrying
 *  `data-screen-label` — so the designer's caption above it and the note
 *  underneath it, which are about the drawing rather than in it, are left out. */
const frameTexts = {};
const frameLabel = {};
/** Per variant, the units that came out of a data binding rather than out of the
 *  template: everything `renderVals()` invented. */
const frameBound = {};
for (const f of FILES) {
  const src = readFileSync(f.path, 'utf8');
  const js = /<script type="text\/x-dc" data-dc-script>([\s\S]*?)<\/script>/.exec(src);
  let vals = {};
  if (js) {
    try {
      class DCLogic {}
      const Component = new Function('DCLogic', `${js[1]}\nreturn Component;`)(DCLogic);
      vals = new Component().renderVals() ?? {};
    } catch (e) { die(`${f.file}: its renderVals() would not run: ${e.message}`); }
  }
  const doc = new JSDOM(src).window.document;
  for (const id of f.variants) {
    const art = doc.querySelector(`#${id} [data-screen-label]`);
    if (!art) die(`${f.file}: no artboard #${id}`);
    frameLabel[id] = art.getAttribute('data-screen-label');
    const interpolate = (raw, scope) => raw.replace(
      /\{\{([\s\S]*?)\}\}/g, (_, e) => String(evalIn(e.trim(), scope) ?? ''));
    interpolate.scope = vals;
    const bound = new Set();
    frameTexts[id] = textsOf(art, { interpolate, bound });
    frameBound[id] = bound;
  }
}

// ── the panel, built ────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/App.tsx', 'src/vite-env.d.ts',
  '--outDir', '.test-build/audit', '--rootDir', '.',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
], { cwd: web, stdio: 'inherit' });

for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => (
      spec.endsWith('.js') ? m : `${a}${spec}.js${z}`
    )));
}

// ── a document ──────────────────────────────────────────────────────────────

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5177/panel',
  pretendToBeVisual: true,
});
const w = dom.window;
for (const name of Object.getOwnPropertyNames(w)) {
  if (name in globalThis) continue;
  try { globalThis[name] = w[name]; } catch { /* a getter that refuses: not ours */ }
}
for (const name of ['window', 'document', 'location', 'history', 'localStorage',
                    'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
                    'Node', 'Element', 'HTMLElement', 'Event', 'KeyboardEvent', 'MouseEvent']) {
  try { globalThis[name] = w[name]; } catch { /* as above */ }
}
try { Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true }); }
catch { /* node's own is good enough */ }
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.ResizeObserver = globalThis.ResizeObserver;
}
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.IntersectionObserver = globalThis.IntersectionObserver;
}
if (!w.Element.prototype.scrollIntoView) {
  w.Element.prototype.scrollIntoView = function scrollIntoView() {};
}
process.on('unhandledRejection', () => { /* a screen asking an absent computer */ });

const load = (p) => import(pathToFileURL(join(out, p)).href);
const { App } = await load('src/App.js');
const { useFleet } = await load('src/lib/fleet.js');
const { useDivanStore, answered, silent } = await load('src/lib/divan.js');
const { useDock } = await load('src/lib/sessions.js');
const { setThemeChoice } = await load('src/lib/theme.js');
const { boards } = await import(pathToFileURL(join(web, 'scripts', 'overview-fixture.js')).href);
const { host: fakeHost } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act ?? (await import('react-dom/test-utils')).act;

const seed = (store, patch) => {
  Object.assign(store.getInitialState(), patch);
  store.setState(patch);
};

/** The clock every board is built against: the merge measures staleness from
 *  now, so a fixture seeded at a fixed moment would be a fleet that went quiet
 *  years ago. */
const NOW = Math.floor(Date.now() / 1000);
const WORLDS = boards(NOW);

/** Two computers, the second of them refusing the connection with its board
 *  still in hand: the arrangement W10 and W12 draw, as near as two machines can
 *  draw three. */
const host = (name) => ({ ...fakeHost(), cfg: { ...fakeHost().cfg, name },
                          info: { ...fakeHost().info, name } });

/** The three answers a page in here asks a computer for, given so that the page
 *  is read in the state its own artboard draws rather than in its empty state.
 *  A run that compared W8 against "nobody has written this one's brief yet" and
 *  W15 against "there is no screen on this computer" would be reporting the
 *  fixture, not the page. Nothing in them is copied from a frame — they are the
 *  panel's own fixtures, in the shape `docs/PROTOCOL.md` gives each answer. */
const BRIEF = {
  goal: 'Let a studio upload a CSV of names and emails, preview who would be '
    + 'invited, then send in one go.',
  done_criteria: ['a dry run names the duplicates', 'the invite is idempotent per upload',
                  'more than 500 rows is refused'],
  verify_cmd: 'npm test clients/import',
  constraints: ['no new dependencies'],
  paths: ['api/src/routes/clients/import.ts'],
  notes: 'Drafted from the chat it was asked in.',
};
const DISPLAYS = [
  { id: 'd1', label: 'studio', w: 2560, h: 1440, primary: true },
  { id: 'd2', label: 'mini', w: 1920, h: 1080, primary: false },
];

seed(useFleet, {
  hosts: { studio: host('studio'), mini: host('mini') },
  order: ['studio', 'mini'], focus: 'studio', ready: true,
  allHosts: false,
  call: async (key, type, data) => {
    // The boards are seeded straight into the store below; a socket answering
    // `{}` here would replace a fixture with an empty board.
    if (type === 'divan.snapshot') throw new Error('seeded from the fixture');
    if (type === 'account.list') return { accounts: fakeHost().accounts };
    if (type === 'screen.info') return { view: true, control: true, enabled: false, displays: DISPLAYS };
    if (type === 'divan.card.get') {
      const snap = WORLDS.busy.find((e) => e.key === key)?.snap;
      const card = (snap?.cards ?? []).find((c) => c.id === data?.card_id) ?? null;
      return card ? { card: { ...card, agent: BRIEF }, ticket: null } : {};
    }
    return {};
  },
});

const root = createRoot(w.document.getElementById('root'));
await act(async () => { root.render(React.createElement(App)); });

const doc = w.document;
const press = async (key) => {
  await act(async () => {
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key, metaKey: true, bubbles: true }));
  });
};
/** A key with nothing held down, which is the only kind the board's own `N`
 *  listens for — the panel's shortcuts all want ⌘, so a bare letter reaches the
 *  page and nothing else. */
const tap = async (key) => {
  await act(async () => {
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true }));
  });
};
const button = (label, within = doc) => [...within.querySelectorAll('button')]
  .find((b) => norm(b.textContent ?? '') === norm(label)) ?? null;
const inside = (label, within = doc) => [...within.querySelectorAll('button')]
  .find((b) => norm(b.textContent ?? '').includes(norm(label))) ?? null;
const click = async (el) => {
  if (!el) throw new Error('nothing to press');
  await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
};
const header = () => doc.querySelector('header');
/** A field by what it says it is, which is how a person finds one. */
const field = (label) => {
  const el = doc.querySelector(`[aria-label="${label}"]`);
  if (!el) throw new Error(`no field labelled ${label} on this page`);
  return el;
};
const type = async (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
};

/** Put the board of a world in every machine's hand. Two are used: `busy`, both
 *  machines answering, which is what all but two of the artboards are drawn over;
 *  and `unreachable`, the second machine refusing the connection with its board
 *  still in hand, which is the state W10 and W12 say they are in. Neither is a
 *  choice about the page — they are the nearest two boards this repository's own
 *  fixtures have to the evening the frames drew. */
const world = async (name) => {
  const snaps = {};
  for (const e of WORLDS[name]) {
    const at = NOW - (e.age ?? 0);
    snaps[e.key] = e.error
      ? silent(answered(e.snap, at), e.error, !!e.old)
      : answered(e.snap, at);
  }
  await act(async () => { seed(useDivanStore, { snaps }); });
};

/** Back to the page the panel opens on, with nothing held over it, so that a
 *  variant is never looking at what the one before it left behind. */
const reset = async (theme) => {
  await act(async () => {
    setThemeChoice(theme);
    useDock.setState({ minimised: [], closed: {}, raised: [] });
  });
  await press('0');
  await click(button('All', header()));
};

/** Every question put away: the arrangement of the artboards that draw a page
 *  with nothing open over it, which is all of them but W1, W2, W3, W4 and W10. */
const putAway = async () => {
  const ids = [];
  for (const e of WORLDS.unreachable.concat(WORLDS.busy)) {
    for (const c of e.snap?.cards ?? []) ids.push(`${e.key}:${c.id}`);
  }
  await act(async () => { useDock.setState({ minimised: [...new Set(ids)], closed: {}, raised: [] }); });
};

// ── which page each artboard is ─────────────────────────────────────────────

/** For each variant: the world its board comes from, the theme it is drawn in,
 *  the pages of `src/screens/` it is a drawing of, and how the panel is driven
 *  there. `open` presses what a person would press, so the page under the bar is
 *  the page the bar says it is; `quiet` puts every conversation away first, which
 *  is the arrangement of every artboard but W1–W4 and W10.
 *
 *  W10 is one artboard with two of the panel's pages on it — the Machines table
 *  and the Executors table, side by side at a narrower width — so it is compared
 *  against both (`also` opens the second), which is the only honest reading of a
 *  drawing that carries two screens.
 *
 *  `screens` is also what the list at the end of the run is worked out from: a
 *  page under `src/screens/` that appears in no variant's list is a page no web
 *  artboard draws. */
const VARIANTS = [
  {
    id: 'W1', world: 'busy', theme: 'dark', screens: ['Overview.tsx'],
    open: async () => { /* the page the panel opens on */ },
  },
  {
    id: 'W2', world: 'busy', theme: 'dark', screens: ['Board.tsx'],
    open: async () => {
      await click(button('Quire', header()));
      await click(button('Board'));
    },
  },
  {
    id: 'W3', world: 'busy', theme: 'light', screens: ['Overview.tsx'],
    open: async () => {},
  },
  {
    id: 'W4', world: 'busy', theme: 'light', screens: ['Board.tsx'],
    open: async () => {
      await click(button('Quire', header()));
      await click(button('Board'));
    },
  },
  {
    id: 'W6', world: 'busy', theme: 'dark', screens: ['Project.tsx'], quiet: true,
    open: async () => { await click(button('Quire', header())); },
  },
  {
    id: 'W7', world: 'busy', theme: 'dark', screens: ['Branch.tsx'], quiet: true,
    open: async () => {
      await click(button('Quire', header()));
      await click(inside('Engineering'));
    },
  },
  {
    id: 'W8', world: 'busy', theme: 'dark', screens: ['Ticket.tsx'], quiet: true,
    open: async () => {
      await click(button('Quire', header()));
      await click(button('Board'));
      await click(inside('Webhook retry policy'));
    },
  },
  {
    id: 'W9', world: 'busy', theme: 'dark', screens: ['Board.tsx'], quiet: true,
    // Opened the way the artboard's own hint says to open it — `press N anywhere
    // on the board` — rather than by pressing the word in the head. That is the
    // state W9 draws, and it makes this run the evidence that the key is wired:
    // if N did not open a draft there would be no `Title` to type into and the
    // run would stop here rather than report a difference.
    open: async () => {
      await click(button('Quire', header()));
      await click(button('Board'));
      await tap('n');
      await type(field('Title'), 'Export client list as CSV');
    },
  },
  {
    id: 'W10', world: 'unreachable', theme: 'dark', screens: ['Machines.tsx', 'Executors.tsx'],
    open: async () => { await press('1'); },
    also: async () => { await press('3'); },
  },
  { id: 'W12', world: 'unreachable', theme: 'dark', screens: ['Machines.tsx', 'Machine.tsx'], quiet: true,
    open: async () => { await press('1'); } },
  { id: 'W13', world: 'busy', theme: 'dark', screens: ['Executors.tsx'], quiet: true,
    open: async () => { await press('3'); } },
  { id: 'W14', world: 'busy', theme: 'dark', screens: ['Terminal.tsx', 'Ustabasi.tsx'], quiet: true,
    // The frame draws a wall with tiles on it, so the tiles are put up: an
    // empty wall is a state of this page but it is not the one W14 drew.
    open: async () => { await press('4'); await click(inside('Add ')); } },
  { id: 'W15', world: 'busy', theme: 'dark', screens: ['Screen.tsx'], quiet: true,
    open: async () => { await press('5'); } },
  { id: 'W16', world: 'busy', theme: 'dark', screens: ['Accounts.tsx'], quiet: true,
    open: async () => { await press('7'); } },
  { id: 'W11', world: 'busy', theme: 'light', screens: ['Quota.tsx'], quiet: true,
    open: async () => { await press('8'); } },
  { id: 'W17', world: 'busy', theme: 'dark', screens: ['Admin.tsx'], quiet: true,
    open: async () => { await press('6'); } },
  { id: 'W18', world: 'busy', theme: 'dark', screens: ['Settings.tsx'], quiet: true,
    open: async () => { await press(','); } },
];

// ── the rules that explain a difference ─────────────────────────────────────

/** A rule is a pattern and the reason it is allowed to match. Nothing is dropped
 *  quietly: every unit a rule swallows is printed under its reason, so "waived"
 *  is a claim a reader can disagree with rather than a number that went missing.
 *
 *  There are two kinds of reason and no third.
 *
 *   · **Data.** The artboards are drawn on four made-up products, three made-up
 *     machines and one made-up evening. The panel draws whatever the computers it
 *     is paired with report, which in this run is the two boards of
 *     `scripts/overview-fixture.js` and the computer of `scripts/panel-fixture.js`.
 *     A name, a figure, a clock or a ticket title that differs is the fixture
 *     differing, not the page. On the panel's side these are listed outright —
 *     they are this repository's own fixtures. On the frames' side they are
 *     matched by shape or by provenance, and where a fragment has to be written
 *     down it is a fragment: nothing in here quotes an artboard's sentence.
 *   · **A gap the screen writes down.** Every one of these screens says in its
 *     own opening comment which part of its frame it does not draw and why —
 *     nothing carries the number, or the request does not exist. The reason
 *     quoted here is that comment, with the line, so the claim can be read at the
 *     source.
 *
 *  Anything that is neither is a difference, and differences are what this
 *  prints.
 */
const rx = (re, why) => ({ re, why });

const FRAME_DATA = 'the artboard’s own data — four invented products, three invented machines, '
  + 'one invented evening; the panel draws what its paired computers report, which in this run is '
  + 'scripts/overview-fixture.js';
const SUPPLIED = 'a value the artboard’s own renderVals() supplies — the board content, the roster '
  + 'and the conversation it invented; the panel draws what its paired computers report';
const BRIEF_WHY = 'the brief this run answers `divan.card.get` with, so that W8’s page is read with a '
  + 'brief on it rather than in its empty state (the fixture is in this file, BRIEF)';
const PANEL_DATA = 'the fixture’s own data — what scripts/overview-fixture.js and '
  + 'scripts/panel-fixture.js put on the two boards and the one computer this run is driven from';
const NO_FIGURES = 'what a product earns, the traffic under it and the fourteen-bar sparkline '
  + 'beside them: nothing carries any of those numbers, so the panel draws the two figures it has '
  + 'and no chart of figures it does not (src/screens/Overview.tsx:20-28)';
const NO_BRANCH_FACTS = 'the branch’s deploy chart, its test count, its version and the check '
  + 'marks beside a repository: nothing carries a day-by-day history, a test result or a deploy '
  + '(src/screens/Branch.tsx:12-20)';
const NO_CHATS = 'the conversations filed under a product, and the third tab over them: a chat '
  + 'carries a folder and nothing else on this daemon (src/screens/Project.tsx:11-16)';
const HEAD_IS_SHARED = 'the product head is one head for both tabs, and Web14 W6 draws this on it '
  + '— it is on the page, above the board (src/screens/Overview.tsx:70-74)';

/** Shape rules for the artboards' data. Deliberately about form and not about
 *  content: a figure, a clock, an age, a count, a monogram, a glyph, a state
 *  word. The invented *sentences* are caught by provenance instead (the
 *  `renderVals()` set above) or, in the four static artboards, by a named
 *  fragment rule under the variant. */
const SHAPES = (why) => [
  rx(/^(Kanji Daily|The Long Walk|Pebble|Mac Studio|Mac mini|Hetzner|cloud\b|Darwin|v[0-9])/, why),
  rx(/^[€$£]?[0-9][0-9 .,]*(k|%|MB|d|h|m|s| ?\/ ?[0-9.]+)?$/, why),
  rx(/^[▲▼][ ]?[0-9]/, why),
  rx(/^[+#]? ?[0-9][0-9.,]* ?(more|projects?|agents?|machines?|computers?|paired|tasks?|chats?|sessions?|conversations?|waiting|connected|open|folders?|roots?|keys?|active|days?|lines?|properties|repos|of [0-9]+|things?|in column|put up)\b/, why),
  rx(/^[0-9]{1,2}:[0-9]{2}( ?(overnight|–|-))?/, why),
  rx(/^([0-9]+[dhms] ?)+(ago)?$/, why),
  rx(/^[0-9]+ (min|minutes?|hours?|days?|weeks?) ago$/, why),
  // The bar's own clock is deliberately not in here: it differs in a way that is
  // not the fixture's doing, and it is reported.
  rx(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)? ?[0-9]{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/, why),
  rx(/^[A-Z][A-Za-z]?$/, why),
  rx(/^[^\p{L}]{1,4}$/u, why),
  rx(/^(yesterday|now|today|main|quota|Tonight|needs approval|no agents|quiet|idle|busy|unavailable|paused|stopped|listening|reachable|unreachable|signed out|not connected|Paused|Unknown|Done today|Nobody|Wake|Remove|Try again|Terminal|Screen|Folders|Open|Change|Manage|Details|Download|Export|Undo|Clear|Restore\.\.\.|Choose project\.\.\.)$/i, why),
  rx(/^(Coder|Coders|SEO|Analyst|An|Research|Divan|You|Branch|Engineering|Analytics|Marketing|Customers|API)(\b|$)/, why),
  rx(/(stuck|asking|running|working|waiting|silent|finished|moved|resets?|resume|expires?|next free|cannot be reached|all reachable|is unreachable|needs you|no machine|no display|no window has been measured|out of quota|Enough left|want you|Sign in|not signed in|own screen|own$)/i, why),
];

/** The panel's own fixture strings. Listed outright — they are in this
 *  repository, and naming them is how a reader checks that nothing else was
 *  swept in with them. */
const FIXTURE = (why) => [
  rx(/^(Webhook retry policy|Stripe keys|CSV export|Out-of-order deliveries|App Review reply|Safari login|Invoice PDF|Export client list as CSV)/, why),
  rx(/^(client portals for studios|live keys are in 1Password|Bulk invite is three checks in\.|The test keys work|The provider replays events|Picking up the webhook retry ticket|Trial-to-paid up since)/, why),
  rx(/^(Use the live ones now|Wait for the review)$/, why),
  rx(/^Quire · /, why),
  rx(/^(quire|quire-api|studio|mini|claude|claude-opus-5|yakup@|subscription ·|nothing yet ·|codex app-server|Claude Code|\.\.\.\/projects\/quire|starting\.\.\.)/, why),
  rx(/^(a dry run names the duplicates|the invite is idempotent per upload|more than 500 rows is refused|no new dependencies|Drafted from the chat it was asked in\.|Let a studio upload a CSV)/,
    BRIEF_WHY),
  ...SHAPES(why),
];

const WAIVED = {
  W1: {
    frame: [
      rx(/^(MRR|DAU|trials \/ wk|visits \/ 7d|SaaS|iOS|Content site|iOS · Android)$/, NO_FIGURES),
      rx(/^(Picking up the webhook|today 3 attempts|stripe up to|30d 41 events|Following Stripe means|Follow Stripe|Keep 3|Reply to Coder|Apple rejected 2\.4|guideline 3\.1\.2|now "Try Hush free"|proposed "Start 7-day|then €4\.99|I can resubmit tonight|Resubmit|Let me edit|Not yet|Reply\.\.\.|your call|Quire · Webhook retry policy|Hush · App Review|Webhook retries|Hush 2\.4 rejected|Gradle 8\.7 build)/,
        'the conversation the artboard invented, the answers it has its two workers propose, and '
        + 'the tabs of what was put away: the panel opens the worst two its own board carries, with '
        + 'that card’s own detail and the answers that worker offered (src/lib/sessions.ts:145-213)'),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^on studio, mini · /,
        'the fourth counter is whichever of three truths applies, worst first: agents on a quiet '
        + 'machine, agents stopped because the quota ran out, or what was finished today — which is '
        + 'the one W1 draws (src/lib/overview.ts:96-113)'),
      ...FIXTURE(PANEL_DATA),
    ],
  },
  W2: {
    frame: [
      rx(/^Chats [0-9]+$/, NO_CHATS),
      rx(/^(Picking up the webhook|today 3 attempts|stripe up to|30d 41 events|Following Stripe means|Follow Stripe|Keep 3|Reply to Coder|Quire · Webhook retry policy|Webhook retries|Hush 2\.4 rejected|Gradle 8\.7 build)/,
        'the conversation the artboard invented beside its board, and the tabs of what was put '
        + 'away: the panel opens the session its own board carries (src/lib/sessions.ts:145-213)'),
      rx(/^(SaaS · |branch agent · |research assistant$|you · no machine$|agents working$|someday$|next up$|this month)/, FRAME_DATA),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^\+ New ticket$/, HEAD_IS_SHARED),
      ...FIXTURE(PANEL_DATA),
    ],
  },
  W6: {
    frame: [
      rx(/^(MRR|trial→paid|churn|list|open rate|CSAT|clicks 28d|avg pos|indexed)$/, NO_FIGURES),
      rx(/^(open PRs|tests|deployed)$/, NO_BRANCH_FACTS),
      rx(/^(Chats [0-9]+|Conversations filed here|Newsletter cut to 250 words|Created QUI-142|Pricing test: annual-first|Moved custom domains)/, NO_CHATS),
      rx(/^\+ Add branch$/,
        'nothing creates a branch from a client — a product and its faces are made by saying so to '
        + 'the agent in a chat (src/screens/Project.tsx:17-21)'),
      rx(/^(SaaS · |Comparison pages, 9 of 14|October newsletter waits|2 tickets open, both answered|[0-9]+ Coders on [0-9]+ tickets|Coder asks about webhook)/,
        'the sentence the artboard writes under a product or a branch; the panel draws the sentence '
        + 'its own board carries, the worst card’s line where nothing wrote one, and *no source '
        + 'connected yet* where there is neither (src/screens/Branch.tsx:11-17)'),
      rx(/^(Webhook retries|Hush 2\.4 rejected|Gradle 8\.7 build)$/,
        'the tabs of what was put away, which on this run is every conversation '
        + '(src/lib/sessions.ts:145-213)'),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^(in progress|done|no source connected yet)$/,
        'what is on the page is the board’s own instead: how much is open on this face, what is in '
        + 'progress and what is done, and *no source connected yet* where a branch has neither a '
        + 'sentence nor a card (src/screens/Branch.tsx:11-25)'),
      rx(/^Repositories$/, NO_CHATS),
      ...FIXTURE(PANEL_DATA),
    ],
  },
  W7: {
    frame: [
      rx(/^(open PRs|tests|deployed|deploys per day · 30 days|■ failed checks|✓ checks|× 2 failing|× tests|◐ review|● live|● 3\/5)$/, NO_BRANCH_FACTS),
      rx(/^(quire-api|quire-web|Bulk invite from CSV|GBP price localisation|Invoice PDF redesign|a91f2c|7c03de|e41b98|batch commit in chunks|csv dry-run preview|fix: lower\(email\)|[0-9]+ Coders on [0-9]+ tickets)/, FRAME_DATA),
      rx(/^(Webhook retries|Hush 2\.4 rejected|Gradle 8\.7 build)$/,
        'the tabs of what was put away (src/lib/sessions.ts:145-213)'),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^(in progress|done)$/,
        'the counts the board can answer, where the frame puts its measured figures '
        + '(src/screens/Branch.tsx:22-25)'),
      ...FIXTURE(PANEL_DATA),
    ],
  },
  W8: {
    frame: [
      rx(/^(Board|Collapse)$/,
        'the breadcrumb’s board step and the brief’s own toggle are both on the page — the toggle '
        + 'reads `Open` while the brief is shut (src/screens/Ticket.tsx:183-193)'),
      rx(/^(QUI-142|Bulk invite clients from a CSV|Studios want to add a whole|Add POST \/clients\/import|DONE WHEN · |dry run valid\/duplicate|duplicates on lower\(email\)|501 rows → 422|○ commit idempotent|○ preview passes axe|pnpm test|pnpm e2e|No new deps|api\/src\/routes|by Coder$|pnpm test → 11 passed|e2e timeout at 501 rows|you: "batch the commit|now: batching commit)/,
        FRAME_DATA),
      rx(/^(Created$|Say one sentence to the Coder)/,
        'the `Created` row and the live half’s one-line input are both on the page, filled from the '
        + 'card in hand (src/lib/ticket.ts:203-227)'),
      rx(/^(Webhook retries|Hush 2\.4 rejected|Gradle 8\.7 build)$/,
        'the tabs of what was put away (src/lib/sessions.ts:145-213)'),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^(Nobody has written the sentences|Nothing has come back from|no ticket$)/,
        'a card nobody has written sentences for says so in the box rather than borrowing the '
        + 'agent’s goal, and a machine that cannot be reached says so where the brief would have '
        + 'been (src/screens/Ticket.tsx:12-27)'),
      ...FIXTURE(PANEL_DATA),
    ],
  },
  W9: {
    frame: [
      rx(/^Chats [0-9]+$/, NO_CHATS),
      rx(/^(Export client list as CSV|Zapier integration|Dark mode for client portal|Custom domains for client|Comparison page: Quire|Interview 3 churned|Fix portal login|Bulk invite clients|Pricing page A\/B test|✓ Shipped|● 3\/5)/, FRAME_DATA),
      rx(/^(Webhook retries|Hush 2\.4 rejected|Gradle 8\.7 build)$/,
        'the tabs of what was put away (src/lib/sessions.ts:145-213)'),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^\+ New ticket$/, HEAD_IS_SHARED),
      rx(/^(someday|next up)$/,
        'the column’s own subtitle, which Web12 W2 draws on the same columns — W9’s narrower '
        + 'artboard leaves it off (src/lib/board.ts)'),
      ...FIXTURE(PANEL_DATA),
    ],
  },
  W10: {
    frame: [
      rx(/^(Branch agents, assistant and you|Chat, filing, drafting tickets|Nothing assigned|QUI-1[0-9]+ |Quire · comparison pages|Onboarding email · Hush resubmit|Kanji Daily · Sept cohorts)/, FRAME_DATA),
      rx(/^warn 20% · pause 0%$/,
        'the panel’s two numbers are warn and stop: warning is this browser’s and stopping is this '
        + 'panel’s, while pausing a running agent is the machine’s own and is a fact with a fixed '
        + 'number on it rather than a setting that would do nothing (src/screens/Quota.tsx:8-19)'),
      rx(/^(Webhook retries|Hush 2\.4 rejected|Gradle 8\.7 build)$/,
        'the tabs of what was put away (src/lib/sessions.ts:145-213)'),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^(Terminals|Remote screen|Accounts & sign-ins|Quota thresholds|Admin|Settings)$/,
        'the drawer’s other rows: W10 is the narrow artboard with no drawer on it, and Web15 W12 '
        + 'draws all eight (src/lib/shell.ts:76-108)'),
      rx(/^(quota use today|stop 5%|Plan limits|Agent quota|64% left)$/,
        'the quota card and the column beside it, in the panel’s own two numbers '
        + '(src/screens/Machines.tsx:11-15, src/screens/Quota.tsx:8-19)'),
      rx(/^(Pair a new machine|Run this on the computer you want to add|remote-ai-chat pair|When a machine goes quiet|After$|minutes without an answer)/,
        'the two cards under the table, saying how pairing really works and what the merge really '
        + 'does with a quiet machine (src/screens/Machines.tsx:11-21)'),
      rx(/^(who can do work, where they are and what they are on|[0-9]+ · who can do work|executor|doing now)$/,
        'the Executors page’s own head and table, which Web15 W13 draws in full — W10 is the narrow '
        + 'artboard that draws the roster as a list (src/screens/Executors.tsx:16-19)'),
      rx(/^(Agents on this computer|A branch agent is a folder on a computer)/,
        'the card that stands in for the frame’s two (src/screens/Executors.tsx:10-15)'),
      ...FIXTURE(PANEL_DATA),
    ],
  },
  W12: {
    frame: [
      rx(/^(Run this on the computer you want to add|curl -fsSL divan\.run\/pair)/,
        'the frame’s pairing card counts a code down; `pair` prints a link with no clock on it, so '
        + 'the card says how pairing really works (src/screens/Machines.tsx:17-21)'),
      rx(/^(Change to 10 min|Move tasks automatically)$/,
        'the frame offers to move a quiet machine’s tasks elsewhere and to change the stale window; '
        + 'nothing moves work between machines and `STALE_AFTER_S` is the merge’s own rule '
        + '(src/screens/Machines.tsx:11-21)'),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^(Run this on the computer you want to add|remote-ai-chat pair)/,
        'the panel’s own pairing card, which says what `pair` really prints '
        + '(src/screens/Machines.tsx:17-21)'),
      rx(/^(Agent quota|64% left|warn 20%|stop 5%|Plan limits)$/,
        'the quota card: Web14 W10 draws it on this same page, and W12’s artboard ends on the '
        + 'pairing and the quiet machine instead (src/screens/Machines.tsx:11-15)'),
      ...FIXTURE(PANEL_DATA),
    ],
  },
  W13: {
    frame: [
      rx(/^(Branch agent · |The assistant · |The man himself · |Reads, interviews, summarises|QUI-1[0-9]+ |Quire · comparison pages|Onboarding email · Hush resubmit|Kanji Daily · Sept cohorts|[0-9]+ · who can do work)/, FRAME_DATA),
      rx(/^(Up to 2 per machine|Add a branch agent|For a new branch like Support|\+ Add$)/,
        'the frame ends on two cards that are settable from nowhere — the queue decides how many of '
        + 'its own workers to run, and a branch agent is a folder on a computer — so what is there '
        + 'instead is the one that is true (src/screens/Executors.tsx:10-15)'),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^(Agents on this computer|A branch agent is a folder on a computer)/,
        'the card that stands in for the frame’s two (src/screens/Executors.tsx:10-15)'),
      rx(/^(who can do work, where they are and what they are on|[0-9]+ · who can do work)$/,
        'the page head’s note and its count, which are the drawer row’s own words '
        + '(src/lib/shell.ts:80-83)'),
      ...FIXTURE(PANEL_DATA),
    ],
  },
  W14: {
    frame: [
      rx(/^(a shell on any reachable machine|studio · zsh|studio · Coder QUI-142|cloud · zsh|mini · unreachable|~\/code\/quire|\$ git status|## qui-142|M api\/src|M web\/src|\$ divan ps|AGENT TICKET|coder QUI-1|analyst KAN-088|Attach to an agent's session|New shell on cloud|sessions close after 30 min)/,
        'W14 draws a different product — tabs of a real shell on a reachable machine, a pty with '
        + '`git status` typed into it, an agent’s own session attached to. Nothing carries one: '
        + 'there is no request that opens a shell and none that writes to one, so the page is every '
        + 'chat at once with the ticket queue beside it, under the frame’s head '
        + '(src/screens/Terminal.tsx:25-30)'),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^(Chats|Ustabasi|New chat|All|Needs approval|Error|Done|every chat at once, and the ticket queue)$/,
        'the wall’s own chrome, which is what stands where the frame’s shell tabs are '
        + '(src/screens/Terminal.tsx:25-30)'),
      ...FIXTURE(PANEL_DATA),
    ],
  },
  W15: {
    frame: [
      rx(/^(live screen · studio · 2560|latency 38 ms|quality auto|audio off|nobody else is watching)/,
        'the frame’s status line under the picture — resolution, latency, a quality setting, audio, '
        + 'who else is watching. `screen.info` carries the displays and whether control is allowed '
        + 'and nothing else, so the line says what is known (src/screens/Screen.tsx:7-14)'),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^(Connect|Nothing is being watched)/,
        'the picture is asked for rather than running: nothing is streamed until somebody says so '
        + '(src/screens/Screen.tsx:449-453)'),
      ...FIXTURE(PANEL_DATA),
    ],
  },
  W16: {
    frame: [
      rx(/^(GitHub|App Store Connect|Google Play Console|Stripe|Search Console|Postmark|Hetzner Cloud|signed in as |API key · |service account · |restricted key · |server token · |project divan$|\+ Connect an account|Keys are stored on your machines)/,
        'the frame draws the seven services Divan is heading for; this panel’s sign-ins are the ones '
        + 'its agents actually work through — the Claude and Codex accounts on each paired computer, '
        + 'as `account.list` reports them (src/screens/Accounts.tsx:12-18)'),
      rx(/^(Coders · |Coder · |Divan · |Analyst, Coders · |SEO · |Machine cloud$)/,
        'what a third-party key is used by: the same gap, one column over '
        + '(src/screens/Accounts.tsx:12-18)'),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^(Where the keys are|what the agents work through, and which of them is expiring)$/,
        'the panel’s own note in place of the frame’s, saying the stronger thing: a sign-in never '
        + 'leaves the computer it is on (src/screens/Accounts.tsx:12-22)'),
      ...FIXTURE(PANEL_DATA),
    ],
  },
  W11: {
    frame: [
      rx(/^(When the agent quota gets low|quota resets daily at 04:00)/,
        'the same sentence in the panel’s own words, and the mono line under the sliders, which '
        + 'reads off the fleet rather than naming one plan (src/screens/Quota.tsx:4-20)'),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^(64% left|warn 20%|stop 5%|pause 0%)$/,
        'the panel states where the fleet stands against the two numbers, which is what makes them '
        + 'mean anything (src/screens/Quota.tsx:18-20)'),
      rx(/^(when a thin plan is said in amber|When the agent quota gets low|Every reading of the fleet|A card dropped into In Progress|The machines do this themselves|Where the fleet stands)/,
        'the panel’s own sentence and the note under each slider, saying what the number actually '
        + 'does here (src/screens/Quota.tsx:4-20)'),
      ...FIXTURE(PANEL_DATA),
    ],
  },
  W17: {
    frame: [
      rx(/^(Backups|Boards, tickets and chat · |Every step every agent took · kept|Data retention|Chat kept forever · |Usage this month|[0-9]+% of the monthly agent budget|Export everything|All projects, boards and chat as JSON|Remove a project|Archives its board and chat)/,
        'four of the frame’s rows have nothing behind them and are left off rather than faked — '
        + 'nightly backups to a cloud, agent logs offered as a download, retention as a setting, a '
        + 'monthly budget in euros — and `Remove a project` with them, because '
        + '`divan.project.delete` does not exist (src/screens/Admin.tsx:9-17)'),
      rx(/^(Divan API keys|[0-9]+ keys · used by the CLI)/,
        'the panel’s row for this is `Sign-ins and keys`: the keys it can actually read '
        + '(src/screens/Admin.tsx:9-17)'),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^(Update$|the update, the logs|the daemon on this computer|every step every agent took, on the wall|Sign-ins and keys|what the agents work through|the repositories on this computer|What an agent may open|the folders outside which|What this has cost|every session this computer holds|Everything above is on|itself\. The panel reads it)/,
        'every administrative fact this panel can actually answer, each row’s button opening the '
        + 'page that does that job (src/screens/Admin.tsx:9-17)'),
      ...FIXTURE(PANEL_DATA),
    ],
  },
  W18: {
    frame: [
      rx(/^(reaching you|Notifications|Push only when something needs you|Needs me|Stuck too|Never|Quiet hours|Haptics on drag and drop|iPhone|voice and language|Voice|Divan answers out loud|Calm|Brisk|Language and time|English · Europe\/Amsterdam)/,
        'the frame’s other two groups are left off rather than faked: *reaching you* is a phone’s — '
        + 'this panel has no push registration — and neither a voice for the daemon’s answers nor a '
        + 'language for this browser exists to be chosen (src/screens/Settings.tsx:10-18)'),
      rx(/^(Density|Comfortable|Compact|Running dot pulse|The only animation that repeats)$/,
        'nothing on any screen reads either, so they would be settings that do nothing '
        + '(src/screens/Settings.tsx:15-18)'),
      ...SHAPES(FRAME_DATA),
    ],
    app: [
      rx(/^(appearance, what a new chat opens with|Set by hand · |The chat list|every conversation on every paired|One computer|Every one|this computer · |What a new chat opens with|the tool, the model, how hard|Tools$|which CLIs are installed|What an agent may open|the folders outside which|About that computer|the daemon it is running|The theme is this browser)/,
        'the panel’s own two groups: what this browser keeps, and the way into what one computer '
        + 'keeps, each row opening the page that holds it (src/screens/Settings.tsx:1-9,37-40)'),
      ...FIXTURE(PANEL_DATA),
    ],
  },
};
WAIVED.W3 = WAIVED.W1;
WAIVED.W4 = WAIVED.W2;

/** A unit against the rules for its side: the first rule that matches owns it. */
const waiverFor = (unit, rules) => rules.find((r) => r.re.test(unit)) ?? null;

// ── the run ─────────────────────────────────────────────────────────────────

/** Which reasons are "the fixture differs" rather than "the page differs". A
 *  variant whose every difference is one of these draws its frame's page with
 *  other numbers in it; one with anything else against it does not. */
const DATA_WHYS = new Set([FRAME_DATA, PANEL_DATA, SUPPLIED, BRIEF_WHY]);

/** The two the bar itself differs by, and every artboard is under the bar. Named
 *  rather than counted, so that a light artboard's chip (`Dark`) and a dark one's
 *  (`Light`) are one finding and not two. */
const BAR = [/^(Light|Dark)$/,
             /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) [0-9]{1,2} [A-Z][a-z]+ · [0-9:]+$/];

const report = [];
for (const v of VARIANTS) {
  await reset(v.theme);
  await world(v.world);
  if (v.quiet) await putAway();
  await v.open();
  let app = textsOf(doc.body);
  if (v.also) { await v.also(); app = app.concat(textsOf(doc.body)); }

  const frame = frameTexts[v.id];
  const frameHay = ` ${frame.join(' ')} `;
  const appHay = ` ${app.join(' ')} `;

  const rules = WAIVED[v.id] ?? { frame: [], app: [] };
  // The artboard's own data, told from its chrome by where it came from: a unit
  // the frame's `renderVals()` supplied is a product, a card, a roster line or a
  // message it invented, and the panel draws what its computers report instead.
  const supplied = frameBound[v.id] ?? new Set();
  const frameRules = [
    { re: { test: (u) => supplied.has(u) }, why: SUPPLIED },
    ...(rules.frame ?? []),
  ];

  const bucket = (units, hay, side) => {
    const missing = [];
    const waived = new Map();
    for (const unit of [...new Set(units)]) {
      if (hay.includes(unit)) continue;
      const rule = waiverFor(unit, side === 'frame' ? frameRules : (rules.app ?? []));
      if (!rule) { missing.push(unit); continue; }
      if (!waived.has(rule.why)) waived.set(rule.why, []);
      waived.get(rule.why).push(unit);
    }
    return { missing, waived };
  };

  report.push({
    v, frame, app,
    frameOnly: bucket(frame, appHay, 'frame'),
    appOnly: bucket(app, frameHay, 'app'),
  });
}

// ── the bar, which every page is under ─────────────────────────────────────

const inBar = (u) => BAR.some((re) => re.test(u));
const split = (b) => ({
  own: b.missing.filter((u) => !inBar(u)),
  shared: b.missing.filter((u) => inBar(u)),
});

const show = (title, list, waived) => {
  if (list.length) {
    console.log(`   ${title}`);
    for (const u of list) console.log(`     · ${u}`);
  }
  for (const [why, units] of waived) {
    console.log(`   waived (${units.length}) — ${why}`);
    for (const u of units) console.log(`     ~ ${u}`);
  }
};

let same = 0;
for (const r of report) {
  const f = split(r.frameOnly);
  const a = split(r.appOnly);
  const gaps = [...r.frameOnly.waived.keys(), ...r.appOnly.waived.keys()]
    .filter((why) => !DATA_WHYS.has(why));
  // `birebir` is the strong reading of the word: nothing on either side is
  // unaccounted for, nothing about the page is a gap with a reason written down,
  // and the bar over it says the same thing too. Anything else is `farkli`, and
  // the lines under it say what.
  const own = f.own.length + a.own.length + f.shared.length + a.shared.length + gaps.length;
  if (!own) same++;
  console.log(`\n── ${r.v.id} · ${frameLabel[r.v.id]}`);
  console.log(`   ${own ? 'farkli' : 'birebir'} · ${r.v.screens.join(', ')} `
    + `· frame ${r.frame.length} texts, panel ${r.app.length} `
    + `· ${f.own.length} in the frame only, ${a.own.length} on the page only, `
    + `${gaps.length} gap${gaps.length === 1 ? '' : 's'} with a reason written down`
    + `${f.shared.length + a.shared.length ? `, and the bar's ${f.shared.length + a.shared.length}` : ''}`);
  show('in the frame, not on the page:', f.own, r.frameOnly.waived);
  show('on the page, not in the frame:', a.own, r.appOnly.waived);
  if (f.shared.length + a.shared.length) {
    console.log('   and the bar, which every page is under (below):');
    for (const u of [...f.shared, ...a.shared]) console.log(`     · ${u}`);
  }
}

console.log('\n── the bar, which every page is under');
for (const side of ['frameOnly', 'appOnly']) {
  const where = side === 'frameOnly' ? 'in the frame, not on the page' : 'on the page, not in the frame';
  for (const u of new Set(report.flatMap((r) => split(r[side]).shared))) {
    console.log(`   · ${where}: ${u}`);
  }
}

// ── the pages no artboard draws ────────────────────────────────────────────

const drawn = new Set(VARIANTS.flatMap((v) => v.screens));
const all = readdirSync(join(web, 'src', 'screens')).filter((f) => f.endsWith('.tsx')).sort();
console.log('\n── pages no web artboard draws');
for (const f of all) if (!drawn.has(f)) console.log(`   · src/screens/${f}`);

console.log(`\n${same} of ${report.length} variants had nothing said against them at all; `
  + `${report.length - same} differ from their frame in something.`);

await act(async () => { root.unmount(); });
process.exit(0);
