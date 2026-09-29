#!/usr/bin/env node
/** The desktop Overview, and what needs a person arriving as conversations.
 *
 *     cd web && npm test
 *
 *  Four things this ticket promises, and each is driven rather than read:
 *
 *   · **the page is Web12 W1 and Web13 W3.** The head, the four counters, the
 *     products two abreast, the roster beside them, the bar across the bottom and
 *     the window in the corner are measured off the render — heights, corners,
 *     grids and which surface each sits on — and the two themes produce the *same
 *     markup*, which is the whole of what "W3 is W1 in the light" means.
 *   · **a question waiting on a person opens itself as a conversation.** The set
 *     is the daemon's own `waiting`, the answers under it are quoted out of the
 *     question, two windows open and the rest are tabs with a count. Pressing
 *     them — and what a press actually sends — is `test-drive.mjs`, in a document.
 *   · **the counters and the project cards agree with the phone's.** Both clients
 *     are compiled and handed the *same* boards, and every figure and every
 *     sentence on a counter, a project card and a roster line is compared. This is
 *     the criterion the whole check exists for: two clients that disagreed about
 *     how many things need you would be two products.
 *   · **the calm morning is a designed state**, and it is not drawn over a quiet
 *     machine or over agents that were stopped mid-task.
 *
 *  And the state matrix the constraint asks for: every one of eight boards —
 *  nothing paired, nothing answered, a daemon too old, an empty board, one
 *  machine quiet, one refusing, a dormant product, a product with no repository —
 *  rendered in both themes, with nothing thrown and no colour of its own.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'overview');
const src = (p) => readFileSync(join(web, p), 'utf8');
/** …and the phone's own files, which this check reads for the two lines its
 *  screen composes rather than its judgements. */
const appSrc = (p) => readFileSync(join(web, '..', p), 'utf8');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── build ───────────────────────────────────────────────────────────────────
// Both clients, into one tree: the panel's screens and the phone's judgements,
// with the repository root as the root so that the two sit side by side and can
// be handed the same board.

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'web/src/App.tsx', 'web/src/lib/divan.ts', 'web/src/lib/overview.ts', 'web/src/lib/sessions.ts',
  'web/src/lib/project.ts', 'web/src/lib/ticket.ts',
  'web/src/screens/Overview.tsx', 'web/src/screens/Project.tsx', 'web/src/screens/Branch.tsx',
  'web/src/screens/Ticket.tsx', 'web/src/components/Sessions.tsx', 'web/src/vite-env.d.ts',
  'app/src/divan.ts', 'app/src/dashboard.ts', 'app/src/project.ts', 'app/src/waiting.ts',
  'app/src/i18n.ts',
  '--outDir', out, '--rootDir', '.',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
], { cwd: resolve(web, '..'), stdio: 'inherit' });

for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => (
      spec.endsWith('.js') ? m : `${a}${spec}.js${z}`
    )));
}

// ── a browser, as far as a static render needs one ──────────────────────────

const html = { dataset: {} };
const query = { matches: false, addEventListener() {}, removeEventListener() {} };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = {
  documentElement: html, hidden: false,
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelectorAll: () => [],
};
globalThis.window = {
  matchMedia: () => query, addEventListener() {}, removeEventListener() {},
  location: { pathname: '/', search: '', hash: '' }, open() {}, alert() {},
};
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.location = globalThis.window.location;

const load = (p) => import(pathToFileURL(join(out, p)).href);

const K = await load('web/src/lib/theme.js');
const D = await load('web/src/lib/divan.js');
const OV = await load('web/src/lib/overview.js');
const PR = await load('web/src/lib/project.js');
const TK = await load('web/src/lib/ticket.js');
const S = await load('web/src/lib/sessions.js');
const OverviewUI = await load('web/src/screens/Overview.js');
const TicketUI = await load('web/src/screens/Ticket.js');
const SessionsUI = await load('web/src/components/Sessions.js');
const parts = await load('web/src/ui/divan.js');
// …and the phone, which is the answer this page is held to.
const PD = await load('app/src/divan.js');
const PH = await load('app/src/dashboard.js');
const PP = await load('app/src/project.js');
const { t } = await load('app/src/i18n.js');
const { createElement: h } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { boards } = await import(pathToFileURL(join(web, 'scripts', 'overview-fixture.js')).href);

/** A fixed clock: a fixture stamped "now" would put every board in a different
 *  state on a machine whose day is a different length. */
const NOW = 1_790_600_000;
const BOARDS = boards(NOW);

/** How long ago, in one form, handed to both clients — so that a comparison is
 *  about what they say and not about how either counts a minute. */
const ago = (s) => (s == null ? '' : `${Math.round(s / 60)}m`);

/** One host spec as each client keeps it. The two `answered`/`silent` pairs are
 *  each client's own, which is part of what is being compared. */
function state(M, spec) {
  if (!spec.snap) return M.silent(null, spec.error ?? 'not connected', !!spec.old);
  const was = M.answered(spec.snap, NOW - (spec.age ?? 0));
  return spec.error ? M.silent(was, spec.error) : was;
}

const view = (name) => D.merge(
  BOARDS[name].map((s) => ({ key: s.key, name: s.name, state: state(D, s) })), NOW);
const phone = (name) => PD.merge(
  BOARDS[name].map((s) => ({ id: s.key, name: s.name, state: state(PD, s) })), NOW);

const NAMES = Object.keys(BOARDS);

// ── the reading of a render ─────────────────────────────────────────────────

function styles(markup) {
  return [...markup.matchAll(/style="([^"]*)"/g)].map((m) => {
    const decl = {};
    for (const pair of m[1].split(';')) {
      const cut = pair.indexOf(':');
      if (cut > 0) decl[pair.slice(0, cut).trim()] = pair.slice(cut + 1).trim();
    }
    return decl;
  });
}
const anyStyle = (markup, pred) => styles(markup).some(pred);
const countStyles = (markup, pred) => styles(markup).filter(pred).length;
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|oklch\([^)]*\)|hsla?\([^)]*\)/g;
const v = (n) => `var(--dv-${n})`;

function paint(markup) {
  const vars = new Set();
  const literal = new Set();
  for (const decl of styles(markup)) {
    for (const value of Object.values(decl)) {
      for (const m of value.matchAll(/var\(--dv-([a-zA-Z0-9]+)\)/g)) vars.add(m[1]);
      for (const c of value.replace(/var\([^)]*\)/g, '').match(COLOUR) ?? []) literal.add(c);
    }
  }
  return { vars, literal };
}

/** A colour that belongs to what it is drawn on rather than to the page. */
const OWN = new Set([K.ON_COLOUR, ...K.MONOGRAM,
                     ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean),
                     ...Object.values(K.MEDIA)]);

const page = (name, props = {}) => renderToStaticMarkup(h(OverviewUI.Overview, {
  view: view(name), project: null, onProject() {}, onAsk() {}, ...props,
}));

// ── 1 · the counters and the cards are the phone's ─────────────────────────

group('the panel and the phone say the same thing about the same board');
{
  // The phone's own composition of the two lines it builds in the screen rather
  // than in `src/dashboard.ts` (`app/app/dashboard.tsx`, `Product` and
  // `Agents`), so that what is compared is the sentence a person reads on the
  // phone and not a fragment of it.
  const phoneFigure = (p, now) => (p.activity ? {
    value: p.activity.week,
    label: t('pfFinished'),
    moved: p.activity.at == null ? t('pfNeverMoved')
      : t('pfMoved', { d: ago(Math.max(0, now - p.activity.at)) }),
  } : null);
  const phoneAgentLine = (r, now) => {
    const detail = (r.agent.detail || '').trim();
    const when = r.agent.unknown
      ? t('pfLastSeen', { time: PH.clock(r.agent.since_contact) })
      : r.agent.since == null ? '' : ago(Math.max(0, now - r.agent.since));
    return [r.agent.title, detail || when].filter(Boolean).join(' · ');
  };

  // The two transcriptions above are the one part of this comparison that is a
  // copy rather than a call, so they are held to the file they were copied from:
  // a phone screen that changes how it writes those lines has to fail here
  // rather than quietly compare the panel against something nobody draws.
  const phoneScreen = appSrc('app/app/dashboard.tsx');
  ok('the two lines the phone composes in its screen are still composed that way',
    phoneScreen.includes("latest={latest(p.cards)}")
    && phoneScreen.includes("value: p.activity.week")
    && phoneScreen.includes("T('pfMoved', { d: ago(Math.max(0, now - p.activity.at)) })")
    && phoneScreen.includes("T('pfNeverMoved')")
    && phoneScreen.includes("T('pfLastSeen', { time: clock(r.agent.since_contact) })")
    && phoneScreen.includes("[r.agent.title, detail || when].filter(Boolean).join(' · ')"));

  const said = (x) => (x ? t(x.key, x.params) : null);
  /** One of the phone's two lines as its screen composes it: every clause, with
   *  the executor each names put into the reader's language. */
  const line = (x) => ({
    text: x.clauses
      .map((c) => t(c.said.key, c.who ? { ...c.said.params, who: t(c.who) } : c.said.params))
      .join(' '),
    tone: x.tone,
  });
  const differ = [];
  for (const name of NAMES) {
    const mine = view(name);
    const theirs = phone(name);
    const note = (what, a, b) => {
      if (eq(a, b)) return;
      differ.push(`${name} · ${what}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    };

    note('the totals', mine.totals, theirs.totals);
    note('what the fleet has left', mine.quota, theirs.quota);
    note('the four counters',
      OV.counters(mine),
      PH.counters(theirs).map((c) => ({
        label: t(c.key), value: c.value,
        ...(c.tone ? { tone: c.tone } : {}), ...(c.ring ? { ring: c.ring } : {}),
      })));
    note('whether the morning is calm', OV.calm(mine), PH.calm(theirs));
    note('the products, and their order',
      mine.projects.map((p) => p.key), theirs.projects.map((p) => p.key));

    for (let i = 0; i < mine.projects.length; i++) {
      const p = mine.projects[i];
      const q = theirs.projects[i];
      if (!q) continue;
      const card = `the card for ${p.key}`;
      note(`${card} · what it counts`,
        [p.name, p.kind, p.machines, p.repos, p.counts, p.running, p.waiting, p.unknown,
         p.paused, p.pausedUntil, p.activity, p.stale, p.lastSeen],
        [q.name, q.kind, q.machines, q.repos, q.counts, q.running, q.waiting, q.unknown,
         q.paused, q.pausedUntil, q.activity, q.stale, q.lastSeen]);
      note(`${card} · its corner`, OV.chip(p, mine.now, ago),
        (() => { const c = PH.chip(q, theirs.now, ago);
                 return { mark: c.mark, text: t(c.key, c.params), tone: c.tone }; })());
      note(`${card} · the line under its name`, OV.line(p, mine.now), said(PH.line(q, theirs.now)));
      note(`${card} · how fresh it is`, OV.freshness(p), said(PH.freshness(q)));
      note(`${card} · what git says`, OV.figure(p, mine.now, ago), phoneFigure(q, theirs.now));
      note(`${card} · the board's own marks`, OV.cardMarks(p), PH.marks(q));
      note(`${card} · the worst card's line`, OV.latest(p.cards), PH.latest(q.cards));
      note(`${card} · whether it is dormant`, OV.dormant(p, mine.now), PH.dormant(q, theirs.now));
      // The faces of a product, which the merge folds across machines: the
      // counts add up, and the summary of the machine that has a source behind
      // it survives the machine that has not.
      note(`${card} · its faces`,
        p.branches.map((b) => [b.kind, b.summary, b.summary_at, b.cards, b.open, b.machines]),
        q.branches.map((b) => [b.kind, b.summary, b.summary_at, b.cards, b.open, b.machines]));
      note(`${card} · what each face says`,
        PR.branchCards(p, mine.now).map((b) => [b.key, b.name, b.state, b.line,
          b.figures, b.refreshed]),
        PP.branchCards(q, theirs.now).map((b) => [b.key, b.name, b.state,
          b.said ? said(b.said) : b.text,
          b.figures.map((f) => ({ value: f.value, label: t(f.label) })),
          b.refreshed ? { text: said(b.refreshed.said), tone: b.refreshed.tone } : null]));
      note(`${card} · the two lines at the top`,
        [PR.nowLine(mine, p), PR.waitingLine(p)],
        [line(PP.nowWords(theirs, q)), line(PP.waitingWords(theirs, q))]);
      note(`${card} · whether its board has never been used`,
        [PR.blank(p), PR.blank(p) ? PR.blankBody(p) : null],
        [PP.blank(q), PP.blank(q) ? said(PP.blankBody(q)) : null]);
    }

    const rows = OV.agentRows(mine);
    const theirRows = PH.agentRows(theirs);
    note('who is at work',
      rows.map((r) => [r.mark, r.tone, r.who, r.index, OV.agentLine(r, mine.now, ago)]),
      theirRows.map((r) => [r.mark, r.tone, t(r.who), r.index, phoneAgentLine(r, theirs.now)]));
    note('the clock a card prints', OV.clock(mine.totals.asOf), PH.clock(theirs.totals.asOf));
  }
  ok('every figure and every sentence on the counters, the cards and the roster agrees',
    differ.length === 0, differ.slice(0, 8).join('\n    '));
  // …and the comparison reached something: a check that compared two empty
  // lists would pass for the wrong reason.
  const busy = view('busy');
  ok('…and it was a board with something on it',
    busy.projects.length === 2 && busy.agents.length === 2 && busy.cards.length === 5
    && OV.counters(busy).length === 4,
    `${busy.projects.length} products · ${busy.agents.length} agents · ${busy.cards.length} cards`);
  // …including the faces of a product that is on two machines, which is what
  // the branch comparison above is about: three from the studio and one only
  // the mini has, with the studio's summary surviving the mini's empty one.
  const faces = busy.projects.find((p) => p.key === 'quire').branches;
  ok('…and a product on two machines has every face either of them knows',
    faces.map((b) => b.kind).join(' ') === 'Engineering SEO Analytics API'
    && faces[0].summary === 'Bulk invite is three checks in.'
    && faces[0].cards.in_progress === 2 && faces[0].open === 3
    && faces.find((b) => b.kind === 'API').open === 1,
    faces.map((b) => `${b.kind}:${b.open}`).join(' '));
  ok('…including the three counters that only a fleet in trouble has',
    OV.counters(view('busy')).some((c) => c.label === 'Paused')
    && OV.counters(view('quiet')).some((c) => c.label === 'Unknown' && c.ring)
    && OV.counters(view('calm')).some((c) => c.label === 'Done today' && c.value === 9),
    OV.counters(view('busy')).map((c) => `${c.label} ${c.value}`).join(' · '));
  ok('…and a fourth counter nobody could measure is three counters',
    OV.counters(view('fresh')).length === 3
    && view('fresh').totals.doneToday === null);

  // The corner of a product whose only open card is a person's own: nothing on
  // it is stuck, asking or running, so the three states a card's line is usually
  // read off are all empty and the fourth clause of `latest` is the only one
  // that answers. A panel that stopped at the third would leave that corner
  // blank while the phone named the card — one rule, two spellings, and the
  // spelling that is wrong is on the screen nobody is holding up against the
  // other one.
  const hush = view('busy').projects.find((p) => p.key === 'hush');
  const theirs = phone('busy').projects.find((p) => p.key === 'hush');
  ok('a product waiting only on you still says what it is waiting on',
    hush.cards.length === 1
    && !hush.cards.some((c) => D.stuck(c) || c.agent_status === 'asking'
      || c.agent_status === 'running')
    && OV.latest(hush.cards) === 'App Review reply'
    && OV.latest(hush.cards) === PH.latest(theirs.cards),
    `${JSON.stringify(OV.latest(hush.cards))} vs ${JSON.stringify(PH.latest(theirs.cards))}`);
  ok('…and a run of cards with nothing said on any of them says nothing',
    OV.latest([]) === '' && OV.latest(view('calm').projects[0].cards) === '');

  // The one place the two lists are allowed to differ, and why: the holding
  // place for unclaimed work is not a product, and the panel drops it.
  const withHidden = D.merge([{ key: 's', name: 's', state: D.answered({
    machine: 's', at: NOW,
    projects: [{ id: 'p', name: 'Unfiled', slug: '', hidden: true, repos: [], counts: {},
                 running: 0, waiting: 0, updated_at: 0 }],
    cards: [], agents: [], queue: {},
  }, NOW) }], NOW);
  ok('the holding place for unclaimed work is never a product',
    withHidden.projects.length === 0);
}

// ── 2 · the page is the frames' page ───────────────────────────────────────

group('Web12 W1, and Web13 W3 which is the same page in the light');
{
  const busy = page('busy');
  const s = styles(busy);

  ok('one 28 pt head, with a mono aside saying how much of the page is true',
    anyStyle(busy, (d) => d['font-size'] === '28px' && d['font-weight'] === '600'
      && d['letter-spacing'] === '-.02em')
    && /2 projects · 2 agents/.test(busy), busy.slice(0, 400));
  ok('four counters, on the frames’ corner and padding',
    countStyles(busy, (d) => d['border-radius'] === `${K.RADIUS.tile}px`
      && d.padding === '14px 16px') === 4);
  ok('…the number in mono at 32 pt and its name 10 pt under it',
    countStyles(busy, (d) => d['font-size'] === '32px' && d['line-height'] === '1'
      && d['font-weight'] === '500') === 4
    && countStyles(busy, (d) => d['font-size'] === '13px' && d['margin-top'] === '10px') === 4);
  ok('…the first washed in the amber of what needs a person, the second in the red',
    anyStyle(busy, (d) => d.background === v('amberBg') && d.padding === '14px 16px')
    && anyStyle(busy, (d) => d.background === v('redBg') && d.padding === '14px 16px'));
  ok('the products are two abreast, beside a 380 pt column',
    anyStyle(busy, (d) => d['grid-template-columns'] === 'minmax(0, 1fr) 380px')
    && anyStyle(busy, (d) => d['grid-template-columns'] === 'repeat(2, minmax(0, 1fr))'));
  ok('…under a 15 pt head that says what the order is',
    /Projects/.test(busy) && /sorted by urgency/.test(busy)
    && anyStyle(busy, (d) => d['font-size'] === '15px' && d['font-weight'] === '600'));
  ok('a project card is a card, with its monogram at 34 pt and its name at 16',
    countStyles(busy, (d) => d.width === `${K.SIZE.monogram}px` && d.height === '34px') === 2
    && countStyles(busy, (d) => d['font-size'] === '16px' && d['font-weight'] === '600') === 2);
  ok('…the grey mono line under it, and the corner it says the worst thing in',
    countStyles(busy, (d) => d['font-size'] === '11.5px' && d.color === v('ink3')) >= 2
    && countStyles(busy, (d) => d['border-radius'] === `${K.RADIUS.chip}px`
      && d.padding === '4px 8px') === 2);
  ok('…what git says about it, at 24 pt in mono',
    anyStyle(busy, (d) => d['font-size'] === '24px' && d['letter-spacing'] === '-.02em')
    && /finished · 7d/.test(busy) && /moved [^<]+ ago/.test(busy));
  ok('…and a footer over a hairline, with the board’s marks and the worst card’s line',
    anyStyle(busy, (d) => d['border-top'] === `1px solid ${v('line')}`
      && d['padding-top'] === '10px')
    && /Out-of-order deliveries|gave up/.test(busy));
  ok('the roster is four columns so that the eye reads down them',
    countStyles(busy, (d) => d['grid-template-columns'] === '14px 52px 18px minmax(0,1fr)') === 2
    && /Agents/.test(busy) && /Coder/.test(busy));
  ok('…each line carrying the hue of the product it is work on, at 18 pt',
    countStyles(busy, (d) => d.width === '18px' && d.height === '18px') === 2);
  ok('the bar across the bottom is the frames’ own, and it opens what ⌘K opens',
    anyStyle(busy, (d) => d.width === `${K.SIZE.bar}px` && d.height === '52px'
      && d['border-radius'] === `${K.RADIUS.bar}px` && d.background === v('s2'))
    && /Tell Divan anything…/.test(busy) && /⌘K/.test(busy)
    && /onAsk=\{\(\) => setPalette\(true\)\}/.test(src('src/App.tsx')));
  ok('…and nothing of it is drawn where there is nothing to press',
    !/Tell Divan/.test(page('busy', { onAsk: undefined })));

  // The whole of the difference between W1 and W3.
  K.setThemeChoice('dark');
  const dark = page('busy');
  K.setThemeChoice('light');
  const light = page('busy');
  K.setThemeChoice('dark');
  ok('W3 is W1 in the other theme: the same markup, one attribute apart',
    dark === light, `${dark.length} vs ${light.length}`);
  ok('…and it is a page with colours in it, so that is worth something',
    paint(dark).vars.size >= 8, [...paint(dark).vars].join(', '));
  ok('nothing on the page is a colour of its own',
    [...paint(dark).literal].every((c) => OWN.has(c)), [...paint(dark).literal].join(', '));
  ok('…and every colour it names exists in both themes',
    [...paint(dark).vars].every((n) => K.DARK[n] !== undefined && K.LIGHT[n] !== undefined));
  ok('the page is composed of the parts and spells no style of its own',
    ['src/screens/Overview.tsx', 'src/components/Sessions.tsx',
     'src/screens/Project.tsx', 'src/screens/Branch.tsx', 'src/screens/Ticket.tsx']
      .every((f) => /from '\.\.\/ui\/divan'/.test(src(f))
        && !COLOUR.test(src(f).replace(/\/\*[\s\S]*?\*\//g, ''))));
  ok('…and none of the pages under a product reaches the chat',
    ['src/screens/Project.tsx', 'src/screens/Branch.tsx', 'src/screens/Ticket.tsx']
      .every((f) => !/from '[^']*(ChatView|Bubble|Timeline|ChatDetails|TicketChat|NewChat)'/
        .test(src(f))));
  for (const part of ['Note', 'Panel', 'PanelHead', 'Composer', 'Quoted', 'DockTab',
                      'DockMore', 'CommandBar', 'Tag', 'RosterRow']) {
    ok(`${part} is a part rather than something this screen invented`,
      new RegExp(`export function ${part}\\(`).test(src('src/ui/divan.tsx'))
      && typeof parts[part] === 'function');
  }
}

// ── 3 · a question opens as a conversation ─────────────────────────────────

group('what needs a person arrives as a chat session');
{
  const busy = view('busy');
  const list = S.sessions(busy);

  ok('the set is the daemon’s own: everything that needs a person and nothing else',
    list.length === busy.cards.filter(D.waiting).length && list.length === 3,
    list.map((x) => x.card.id).join(', '));
  ok('…worst first, and within a kind the one that has waited longest',
    eq(list.map((x) => [x.kind, x.card.id]),
      [['question', 'k2'], ['stuck', 'm1'], ['yours', 'h1']]),
    JSON.stringify(list.map((x) => [x.kind, x.card.id])));
  const q = list[0];
  ok('a question says who is asking and what they are asking for',
    q.who === 'Coder' && q.says === 'asks you' && q.face === 'coder' && q.asked);
  ok('…and the sentence is the worker’s own, never one composed here',
    q.said === busy.cards.find((c) => c.id === 'k2').agent_detail);
  ok('…over the line that says which product, which card and when it was asked',
    S.source(q, OV.clock) === `Quire · Stripe keys · ${OV.clock(q.at)}`, S.source(q, OV.clock));
  ok('the one that was turned down says it stopped, and is red rather than amber',
    list[1].says === 'stopped' && S.KIND_STATE[list[1].kind] === 'stuck');
  ok('…and a card that is nobody’s but yours is your call, and offers no answers',
    list[2].says === 'your call' && list[2].answers.length === 0 && list[2].who === 'Divan');

  ok('the answers under a question are quoted out of the question',
    eq(q.answers, ['Use the live ones now', 'Wait for the review']), JSON.stringify(q.answers));
  ok('…and a question that offers no such words gets none rather than a guessed pair',
    // Not a report, not a sentence whose halves are unequal, not a choice
    // between three things and not an essay: the narrow case only, because a
    // wrong button sends a wrong answer to a worker that will act on it.
    eq(S.answers('I gave up on this one.'), [])
    && eq(S.answers('Should we keep three attempts, or follow Stripe?'), [])
    && eq(S.answers('Postgres, or MySQL, or SQLite?'), [])
    && eq(S.answers(`${'x'.repeat(220)}, or the other one?`), []));
  ok('a card with a ticket behind it can be answered, and one without can only be read',
    q.ticket === 42 && list[2].ticket === null);

  // Two windows, and the rest as tabs with a count.
  const dock = S.arrange(list);
  ok('two windows open by themselves, nearest the corner first',
    eq(dock.panels.map((x) => x.card.id), ['k2', 'm1']) && S.PANELS === 2);
  ok('…and every one of them has a tab, which says which are open',
    eq(dock.tabs.map((x) => [x.session.card.id, x.open]),
      [['k2', true], ['m1', true], ['h1', false]]), JSON.stringify(dock.tabs.map((x) => x.open)));
  const five = [...list, { ...list[0], id: 'x:1' }, { ...list[0], id: 'x:2' }];
  const many = S.arrange(five);
  ok('…beyond three tabs the rest are a count, not a second list',
    many.tabs.length === S.TABS && many.more === 2);
  // …and the case that count must never be wrong about: the three at the top of
  // the list are put away, so the two windows on screen are the fourth and the
  // fifth. Tabs taken off the head of the list would draw three tabs for three
  // things that are not on screen and say `+2` about the two that are.
  const late = S.arrange(five, { minimised: five.slice(0, 3).map((x) => x.id), closed: {} });
  ok('every open window has a tab, wherever it sits in the list',
    eq(late.panels.map((x) => x.id), ['x:1', 'x:2'])
    && late.panels.every((p) => late.tabs.some((t) => t.session.id === p.id && t.open)),
    `${late.panels.map((x) => x.id).join(', ')} · tabs ${late.tabs.map((t) => `${t.session.id}${t.open ? '*' : ''}`).join(', ')}`);
  ok('…and what is counted as "more" is only what has no tab',
    late.more === late.live.length - late.tabs.length && late.more === 2
    && !late.tabs.some((t) => t.open && late.more === 0),
    `${late.tabs.length} tabs · +${late.more} of ${late.live.length}`);
  ok('…with the tabs in the order the list is in, rather than the windows first',
    eq(late.tabs.map((t) => t.session.id),
      five.filter((x) => late.tabs.some((t) => t.session.id === x.id)).map((x) => x.id)),
    late.tabs.map((t) => t.session.id).join(', '));
  const away = S.arrange(list, { minimised: ['studio:k2'], closed: {} });
  ok('one put away leaves its tab and lets the next window open',
    eq(away.panels.map((x) => x.card.id), ['m1', 'h1'])
    && away.tabs.find((x) => x.session.id === 'studio:k2').open === false);
  const shut = S.arrange(list, { minimised: [], closed: { 'studio:k2': S.at(list[0]) } });
  ok('…and one closed is gone, tab and all',
    !shut.live.some((x) => x.id === 'studio:k2') && shut.tabs.length === 2);
  ok('…until the card says something new, which is a new question and opens again',
    S.arrange(list, { minimised: [], closed: { 'studio:k2': S.at(list[0]) - 1 } })
      .panels.some((x) => x.id === 'studio:k2'));

  // …and the drawing of it.
  const drawn = renderToStaticMarkup(h(SessionsUI.Sessions, { view: busy }));
  ok('the window is the size the frames draw, on the first surface, ringed in amber',
    anyStyle(drawn, (d) => d.width === `${K.SIZE.panel}px` && d.height === '500px'
      && d.background === v('s1')
      && (d['box-shadow'] ?? '').startsWith(`inset 0 0 0 1px ${v('amberRing')}`)),
    styles(drawn).map((d) => d.width).join(' '));
  ok('…in the corner the frames put it in, and the second one to the left of it',
    anyStyle(drawn, (d) => d.position === 'fixed' && d.right === '24px')
    && anyStyle(drawn, (d) => d.position === 'fixed' && d.right === '384px'));
  ok('…with the question in it, the figures the worker quoted, and its answers',
    drawn.includes('Use the live ones now') && drawn.includes('live keys are in 1Password')
    && drawn.includes('Wait for the review'));
  ok('…the proposed answer filled amber and the rest outlined, as pills',
    countStyles(drawn, (d) => d.height === `${K.SIZE.pill}px`
      && d['border-radius'] === '16px' && d.background === v('amber')) === 1);
  ok('…a box to say something else in, addressed to whoever is asking',
    /placeholder="Reply to Coder…"/.test(drawn)
    && anyStyle(drawn, (d) => d.height === `${K.SIZE.field}px`
      && d['border-radius'] === `${K.RADIUS.field}px`));
  ok('…and the two things you can do to a window without answering it',
    /aria-label="Put this away"/.test(drawn) && /aria-label="Close"/.test(drawn));
  ok('the tabs are the size the frames draw, the open ones filled with the ink',
    countStyles(drawn, (d) => d.width === `${K.SIZE.tab}px` && d.height === '44px'
      && d['border-radius'] === `${K.RADIUS.tab}px`) === 3
    && countStyles(drawn, (d) => d.width === '136px' && d.background === v('ink')) === 2);
  // …on its own, because with three questions in hand it is the third and the
  // desktop opens two.
  const yours = D.merge([{ key: 'studio', name: 'studio', state: D.answered({
    machine: 'studio', at: NOW,
    projects: [{ id: 'p-hush', name: 'Hush', slug: 'hush', repos: [], counts: { in_progress: 1 },
                 running: 0, waiting: 1, updated_at: NOW }],
    cards: [{ id: 'h1', project_id: 'p-hush', branch: 'App Review', column: 'in_progress',
              position: 1, title: 'App Review reply', summary: '', executor: 'human',
              machine: null, repo: null, ustabasi_id: null, agent_status: null,
              agent_status_at: null, agent_detail: '', created_at: 0, updated_at: 0,
              moved_at: NOW - 7200 }],
    agents: [], queue: {},
  }, NOW) }], NOW);
  const mine = renderToStaticMarkup(h(SessionsUI.Sessions, { view: yours }));
  ok('a card with no queue behind it says so instead of offering a box',
    /nothing to send an answer to/.test(mine) && !/placeholder="Reply/.test(mine)
    && /your call/.test(mine));
  ok('the session of a machine that has gone quiet says what it is reading',
    renderToStaticMarkup(h(SessionsUI.Sessions, { view: view('quiet') }))
      .includes('mini has gone quiet'));
  ok('…and a board with nothing waiting draws no window at all',
    renderToStaticMarkup(h(SessionsUI.Sessions, { view: view('calm') })) === ''
    && S.sessions(view('calm')).length === 0);

  // The chat is the chat, and this is not it.
  ok('none of this reaches the chat',
    !/from '[^']*(ChatView|Bubble|Timeline|ChatDetails|TicketChat)'/
      .test(src('src/components/Sessions.tsx')));
  ok('…and what it sends is a note on the ticket that asked, to the machine that asked it',
    /ustabasi\.note/.test(src('src/lib/actions.ts'))
    && /ticketNote\(s\.host, s\.ticket, words\)/.test(src('src/components/Sessions.tsx')));
}

// ── 4 · the calm morning ───────────────────────────────────────────────────

group('a morning where nothing needs anybody is a designed state');
{
  const quiet = view('calm');
  ok('it is calm when nothing needs a person and nothing is being kept from them',
    OV.calm(quiet) === true);
  ok('…and the page says so in words, with what landed while nobody was looking',
    page('calm').includes('All clear. Nothing needs you.')
    && page('calm').includes('9 finished today'));
  ok('…in the green of work that is going well, washed rather than outlined',
    anyStyle(page('calm'), (d) => d.background === v('runBg')
      && d['border-radius'] === `${K.RADIUS.card}px`));
  ok('…and the counters are grey zeroes rather than three coloured noughts',
    countStyles(page('calm'), (d) => d.color === v('ink3') && d['font-size'] === '32px') === 3,
    OV.counters(quiet).map((c) => `${c.label} ${c.value}`).join(' · '));
  ok('it is not calm over agents nobody has heard from',
    OV.calm(view('quiet')) === false && !page('quiet').includes('All clear'));
  ok('…nor over work that stopped when a window closed',
    OV.calm(view('busy')) === false && view('busy').totals.paused === 1);
  ok('…nor on a panel that has nothing to be calm about',
    OV.calm(view('alone')) === false);
  // A machine paired and answering with an empty board *is* calm — there is
  // genuinely nothing waiting on anybody — and the page still does not say "all
  // clear" over it, because with no product on it there is no page to say it on:
  // what the reader meets is the empty state.
  ok('…and a board with nothing on it is an empty state rather than an all-clear',
    OV.calm(view('fresh')) === true && !page('fresh').includes('All clear')
    && page('fresh').includes('No products yet'));
  ok('…and the rule the page draws it by is the rule, not a second copy of it',
    /calm\(view\)/.test(src('src/screens/Overview.tsx'))
    && (src('src/screens/Overview.tsx').match(/needsYou === 0/g) ?? []).length === 0);
}

// ── 5 · the three pages under a product ───────────────────────────────────

group('Web14 W6, W7 and W8');
{
  const busy = view('busy');
  const quire = busy.projects.find((p) => p.key === 'quire');
  const scoped = (props) => renderToStaticMarkup(h(OverviewUI.Overview, {
    view: busy, project: quire, onProject() {}, ...props,
  }));
  const product = scoped({});
  const engineeringNow = () => scoped({ branch: 'Engineering' });
  const engineering = engineeringNow();
  const seo = scoped({ branch: 'SEO' });

  ok('the product page is the two lines, the branches, and their own numbers',
    /now/.test(product) && /waiting/.test(product)
    && product.includes('Branches') && product.includes('Engineering')
    && product.includes('SEO') && product.includes('open') && product.includes('done'));
  ok('…with the word that opens a new ticket at the end of its head',
    product.includes('+ New ticket'));

  // A branch with no source connected says so — on the grid, and on the page
  // the grid opens.
  ok('a branch with nothing connected behind it says so',
    product.includes(PR.NO_SOURCE) && seo.includes(PR.NO_SOURCE)
    && PR.branchCards(quire, busy.now).find((b) => b.kind === 'SEO').sourceless === true);
  ok('…and one that has a source says what it said instead',
    engineering.includes('Bulk invite is three checks in.')
    && !engineering.slice(engineering.indexOf('Engineering'), engineering.indexOf('Repositories'))
      .includes(PR.NO_SOURCE)
    && PR.branchCards(quire, busy.now).find((b) => b.kind === 'Engineering').sourceless === false);
  ok('…and one nothing is connected to but something was said on quotes that',
    PR.branchCards(quire, busy.now).find((b) => b.kind === 'API').line
      === 'The provider replays events out of order and I gave up.');
  ok('a branch page is that face’s numbers, its repositories and what was said on it',
    engineering.includes('Repositories') && engineering.includes('Cards')
    && engineering.includes('Recent activity') && engineering.includes('quire')
    // …and it is the branch's page rather than the product's with a name on it.
    && !engineering.includes('Branches'));
  ok('…and a card opens its own page under the same product',
    scoped({ card: 'studio:k2' }).includes('Agent brief')
    && !scoped({ card: 'studio:k2' }).includes('Branches'));

  // ── the ticket, and the rule its three faces are kept apart by ──
  const card = quire.cards.find((c) => c.id === 'k2');
  const AGENT = {
    goal: 'Add POST /clients/import accepting text/csv, max 500 rows.',
    done_criteria: ['dry run valid/duplicate/invalid', 'duplicates on lower(email)',
                    '501 rows → 422', 'commit idempotent per upload_id', 'preview passes axe'],
    verify_cmd: 'pnpm test clients/import',
    constraints: ['No new deps. Don’t touch billing/.'],
    paths: ['api/src/routes/clients/import.ts'],
    notes: 'The mailer is rate limited to 100 a minute.',
  };
  const QUEUE = {
    id: 42, title: card.title, status: 'running', stage: 'worker', round: 1, repo: '/w/quire',
    project: 'Quire', branch: 'Engineering', created_at: NOW - 7200, updated_at: NOW - 240,
    started_at: NOW - 3600, round_started_at: NOW - 1380, finished_at: null, git: null,
    goal: '', done_criteria: [], escalation: '', verdict: null, note_count: 1,
    notes: [{ ts: NOW - 300, from: 'user', text: 'batch the commit, 100 at a time' }],
    last_event: { ts: NOW - 240, kind: 'run', msg: 'e2e timeout at 501 rows' },
  };
  const opened = { full: { ...card, agent: AGENT }, ticket: QUEUE, error: null };
  const draw = (over = {}) => renderToStaticMarkup(h(TicketUI.TicketPage, {
    card, project: quire, index: 0, now: busy.now, onProject() {}, onBranch() {},
    opened, ...over,
  }));
  const page = draw();
  const LABEL = 'What to do · title + 3 sentences';
  const above = page.slice(0, page.indexOf(LABEL));

  ok('the ticket page is all three faces at once',
    page.includes(card.title) && page.includes(card.summary)
    && page.includes(AGENT.goal) && page.includes(AGENT.verify_cmd)
    && page.includes('Live') && page.includes('Executor'));
  // The one failure this page could have that nobody would notice: the box
  // reads perfectly well with the agent's goal in it, and it is the wrong text.
  ok('nothing an agent wrote is on the human face',
    [AGENT.goal, AGENT.verify_cmd, AGENT.notes, ...AGENT.done_criteria, ...AGENT.constraints]
      .every((text) => !above.includes(text))
    && TK.human({ ...card, ...AGENT }).summary === card.summary,
    above.slice(Math.max(0, above.length - 300)));
  ok('…and a card nobody wrote sentences for says so rather than borrowing the goal',
    TK.human({ title: 'x', summary: '' }).bare === true
    && TK.human({ title: 'x', summary: '' }).summary === ''
    && !draw({ card: { ...card, summary: '' } })
      .slice(0, draw({ card: { ...card, summary: '' } }).indexOf(LABEL)).includes(AGENT.goal));

  // The verifier answers the criteria in order and writes its own wording; a
  // verdict that answers four of five would put the fourth mark on the fifth
  // sentence, and a cross against the wrong criterion is a wrong answer to the
  // question the page exists to answer.
  const findings = (n) => ({ findings: Array.from({ length: n }, (_, i) => (
    { criterion: `c${i}`, status: i < 3 ? 'met' : 'unmet' })) });
  ok('a criterion is marked only when the verdict answers every one of them',
    TK.brief(opened.full, { ...QUEUE, verdict: findings(5) }).passed === '3/5'
    && TK.brief(opened.full, { ...QUEUE, verdict: findings(4) }).passed === null
    && TK.brief(opened.full, { ...QUEUE, verdict: findings(4) }).criteria
      .every((c) => c.met === null)
    && TK.brief(opened.full, QUEUE).passed === null);
  ok('a machine that has not handed the brief over says so, and the card is still readable',
    draw({ opened: { full: null, ticket: null, error: 'connection refused' } })
      .includes('did not hand the brief over')
    && draw({ opened: { full: null, ticket: null, error: 'connection refused' } })
      .includes(card.title));
  // The whole of the difference between a frame and its light twin, which is
  // the claim "in both themes" makes: one attribute on <html>, and not a line
  // of any of these four pages.
  const twins = {
    'W6 · the product': () => scoped({}),
    'W7 · a branch': () => engineeringNow(),
    'W8 · a ticket': () => draw(),
    'W9 · the board': () => scoped({ tab: 'board' }),
  };
  const differ = Object.entries(twins).filter(([, of]) => {
    K.setThemeChoice('dark');
    const dark = of();
    K.setThemeChoice('light');
    const light = of();
    return dark !== light;
  }).map(([what]) => what);
  K.setThemeChoice('dark');
  ok('each of the four is the same page in the light: the same markup, one attribute apart',
    differ.length === 0, differ.join(', '));

  ok('…and a card with no ticket behind it offers no box to answer one',
    !draw({ card: quire.cards.find((c) => c.id === 'k3'), opened: { full: null, ticket: null, error: null } })
      .includes('Say one sentence'));
}

// ── 6 · every board, both themes, nothing thrown ───────────────────────────

group('every state of the fleet, drawn');
{
  const broken = [];
  const strayed = [];
  const undeclared = [];
  let drawn = 0;
  for (const name of NAMES) {
    for (const scheme of ['dark', 'light']) {
      K.setThemeChoice(scheme);
      const fleet = view(name);
      const p = fleet.projects[0] ?? null;
      const face = p?.branches[0]?.kind ?? null;
      const one = p?.cards[0] ?? null;
      const screens = {
        Overview: [OverviewUI.Overview, { view: fleet, project: null, onProject() {}, onAsk() {} }],
        // The four pages of Web14, each as a reader meets it: inside the page
        // the product's head hangs over, with the same fleet under it.
        'W6 · the product': [OverviewUI.Overview, {
          view: fleet, project: p, onProject() {}, onAsk() {},
        }],
        'W9 · the board a card is written on': [OverviewUI.Overview, {
          view: fleet, project: p, tab: 'board', onProject() {}, onAsk() {},
        }],
        'W7 · a branch': [OverviewUI.Overview, {
          view: fleet, project: p, branch: face, onProject() {}, onAsk() {},
        }],
        'W8 · a ticket': [OverviewUI.Overview, {
          view: fleet, project: p, card: one ? `${one.host}:${one.id}` : null,
          onProject() {}, onAsk() {},
        }],
        'the sessions on their own': [SessionsUI.Sessions, { view: fleet }],
      };
      for (const [what, [node, props]] of Object.entries(screens)) {
        let markup;
        try { markup = renderToStaticMarkup(h(node, props)); }
        catch (e) { broken.push(`${name} · ${scheme} · ${what}: ${e.message.slice(0, 140)}`); continue; }
        drawn++;
        const { vars, literal } = paint(markup);
        for (const c of literal) if (!OWN.has(c)) strayed.push(`${name} ${what}: ${c}`);
        for (const n of vars) if (K.DARK[n] === undefined) undeclared.push(`${name} ${what}: ${n}`);
      }
    }
  }
  K.setThemeChoice('dark');
  ok('the page stands up on every board, in both themes', broken.length === 0,
    [...new Set(broken)].slice(0, 6).join('\n    '));
  ok('…and there were enough of them for that to mean something',
    drawn === NAMES.length * 2 * 6, `${drawn} renders`);
  ok('…none of them painting a value of its own', strayed.length === 0,
    [...new Set(strayed)].slice(0, 6).join(', '));
  ok('…so every colour on every one of them exists in both themes',
    undeclared.length === 0, [...new Set(undeclared)].slice(0, 6).join(', '));

  ok('a machine that has gone quiet keeps its products, and the page says how old it is',
    page('quiet').includes('quiet for') && page('quiet').includes('Quire')
    && page('quiet').includes('last seen'));
  ok('…and one that refuses the connection keeps the board it last handed over',
    page('unreachable').includes('Out-of-order deliveries')
    || page('unreachable').includes('Quire'));
  ok('a fleet that has never answered is a sentence rather than a blank',
    page('never').includes('No machine has answered'));
  ok('…as is one with no computer paired at all, and one with an empty board',
    page('alone').includes('No computer paired yet')
    && page('fresh').includes('No products yet'));
  ok('a product nobody has touched in a month says so, and one with nothing to read does not',
    page('slow').includes('quiet for 30 days')
    && OV.figure(view('slow').projects.find((p) => p.key === 'pebble'), NOW, ago) === null,
    page('slow').slice(page('slow').indexOf('quiet for') - 40, page('slow').indexOf('quiet for') + 30));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
