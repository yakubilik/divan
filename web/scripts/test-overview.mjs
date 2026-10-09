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
  'web/src/screens/Overview.tsx', 'web/src/screens/Project.tsx',
  'web/src/screens/Ticket.tsx', 'web/src/components/Sessions.tsx',
  'web/src/lib/tell.ts', 'web/src/components/ChatPanel.tsx', 'web/src/vite-env.d.ts',
  'web/src/lib/transcript.ts', 'app/src/transcript.ts', 'web/src/lib/ustabasi.ts',
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
const TD = await load('web/src/lib/today.js');
const TK = await load('web/src/lib/ticket.js');
const S = await load('web/src/lib/sessions.js');
const TL = await load('web/src/lib/tell.js');
const RUN = await load('web/src/lib/transcript.js');
const U = await load('web/src/lib/ustabasi.js');
const PRUN = await load('app/src/transcript.js');
const F = await load('web/src/lib/fleet.js');
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
const { host: fakeHost } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);

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
    for (const pair of m[1].replace(/&quot;/g, '"').split(';')) {
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
const OWN = new Set([K.ON_COLOUR,
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

  // The Dashboard of HANDOVER §4.1 draws neither of the two lines above any
  // more: a tile carries the worst card's own line, and Working now writes an
  // agent as its title over `project · executor · machine · time` — on the
  // panel both are a badge's tooltip. Both
  // screens are held to composing that row the same way.
  const phoneScreen = appSrc('app/app/dashboard.tsx');
  const panelScreen = readFileSync(join(web, 'src', 'screens', 'Dashboard.tsx'), 'utf8');
  ok('the panel and the phone compose a Working now row and a tile’s line the same way',
    phoneScreen.includes("[name, T(r.who), r.agent.machine || r.agent.hostName, when]")
    && panelScreen.includes("[name, r.who, r.agent.machine || r.agent.hostName, when]")
    && phoneScreen.includes("latest(p.cards) || p.summary")
    && panelScreen.includes("latest(p.cards) || p.summary"));

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
      note(`${card} · the two lines at the top`,
        [PR.nowLine(mine, p), PR.waitingLine(p)],
        [line(PP.nowWords(theirs, q)), line(PP.waitingWords(theirs, q))]);
      note(`${card} · whether its board has never been used`,
        [PR.blank(p), PR.blank(p) ? PR.blankBody() : null],
        [PP.blank(q), PP.blank(q) ? said(PP.blankBody()) : null]);
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

group('the Dashboard: greeting, Composer, Needs you, Projects, Working now');
{
  const busy = page('busy', { composer: h('section', { 'data-composer': '' }) });
  ok('a greeting, and one line under it counted off the boards',
    /<h1 class="dv-greet">Good (morning|afternoon|evening)\.<\/h1>/.test(busy)
    && busy.includes(`<b>${view('busy').totals.running}</b> working`));
  ok('the Composer the page is handed sits under the line', /data-composer=""/.test(busy)
    && busy.indexOf('data-composer') > busy.indexOf('dv-summary'));
  ok('what needs a person is a grid of wait cards under a small head',
    busy.includes('<h3 id="needs-you">Needs you</h3>') && (busy.match(/class="dv-glass dv-wait"/g) ?? []).length
      === view('busy').cards.filter((c) => S.kindOf(c)).length);
  ok('every product is a badge that is a link to its own page',
    view('busy').projects.every((p) => busy.includes(`href="/p/${encodeURIComponent(p.key)}"`)));
  ok('what is running is a badge per agent, each a link to its own ticket',
    OV.agentRows(view('busy')).length > 0 && OV.agentRows(view('busy')).every((r) =>
      busy.includes(`data-running="${r.agent.host}:${r.agent.card_id}" href="/p/`)));
  K.setThemeChoice('dark');
  const dark = page('busy');
  K.setThemeChoice('light');
  const light = page('busy');
  K.setThemeChoice('dark');
  ok('the two themes are the same markup, one attribute apart', dark === light);
  ok('nothing on the page is a colour of its own',
    [...paint(dark).literal].every((c) => OWN.has(c)), [...paint(dark).literal].join(', '));
  ok('the pages under a product still spell no style of their own',
    ['src/components/Sessions.tsx', 'src/screens/Project.tsx', 'src/screens/Ticket.tsx']
      .every((f) => !COLOUR.test(src(f).replace(/\/\*[\s\S]*?\*\//g, ''))));
  ok('…and none of the pages under a product reaches the chat',
    ['src/screens/Project.tsx', 'src/screens/Ticket.tsx']
      .every((f) => !/from '[^']*(ChatView|Bubble|Timeline|ChatDetails|TicketChat|NewChat)'/
        .test(src(f))));
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
  ok('a Turkish "A mı, B mi?" offers its two halves',
    eq(S.answers('Postgres mi, SQLite mı?'), ['Postgres', 'SQLite']));
  ok('…a Turkish yes-or-no offers only Evet, since a no needs saying in words',
    eq(S.answers('Bu iş bitti ama ana koda eklenemedi. Ben ekleyeyim mi?'), ['Evet'])
    && eq(S.answers('Postgres mi yoksa SQLite mı?'), []));
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
      && d['border-radius'] === `${K.RADIUS.pill}px` && d.background === v('amber')) === 1);
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

  // A question is not a chat: the window that answers one sends a note on the
  // ticket, and nothing about it reaches the chat screen. (The chats the
  // command bar starts are a different window in the same corner, and those
  // are the chat — `ChatPanel.tsx`, checked in the group below.)
  ok('answering a question never goes near the chat',
    !/from '[^']*(ChatView|Bubble|ChatDetails|TicketChat)'/
      .test(src('src/components/Sessions.tsx'))
    && !/Timeline/.test(src('src/components/Sessions.tsx').replace(/ChatPanel/g, '')));
  ok('…and what it sends is a note on the ticket that asked, to the machine that asked it',
    /ustabasi\.note/.test(src('src/lib/actions.ts'))
    && /ticketNote\(s\.host, s\.ticket, words\)/.test(src('src/components/Sessions.tsx')));
}

// ── 3b · a sentence in the bar ─────────────────────────────────────────────
// The other half of the corner: what the command bar does with a sentence, and
// where the chat it starts is read. Every judgement is `lib/tell.ts`, so it can
// be held here without a browser; `test-drive.mjs` types into the bar in one.

group('a sentence in the bar starts a chat on the page it was typed on');
{
  const busy = view('busy');
  ok('a chat is called what was typed, not "New chat"',
    TL.chatTitle('ship the beta tonight') === 'ship the beta tonight'
    && TL.chatTitle('  ship   the beta\n tonight ') === 'ship the beta tonight'
    && TL.chatTitle('') === 'New chat');
  const long = TL.chatTitle('look at the webhook retry policy again, and tell me what Stripe does');
  ok('…and a long one is cut on a word, with no comma left hanging',
    long.length <= TL.TITLE_CHARS + 1 && long.endsWith('…') && !/[\s,]…$/.test(long)
    && long.startsWith('look at the webhook retry policy again'), long);

  // What it opens on: the same values New chat would have shown, resolved the
  // same way — a bar that opened chats on a different model from the dialog
  // would be two meanings of "a new chat" on one computer.
  const slot = fakeHost();
  const opens = TL.toldDefaults(slot, {}, 'studio');
  ok('it opens on what that computer says a new chat opens on',
    opens.provider === 'claude' && opens.model === slot.catalog.claude.models[0].id
    && opens.perm_mode === 'default' && opens.account_id === '', JSON.stringify(opens));
  ok('…and a computer that has not said what it has yet is not sent a chat at all',
    TL.toldDefaults({ catalog: null }, {}, 'studio') === null
    && TL.toldDefaults(null, {}, 'studio') === null);

  // Nothing picks a sign-in for you. The bar opens the chat on the one this
  // computer's new chats are set to, and which subscription it spends is
  // changed in the window itself.
  ok('the sign-in is the stored one, and no rule of the panel’s own',
    TL.toldDefaults(fakeHost(), {}, 'studio').account_id === ''
    && !/utilization|rejected|limits/.test(src('src/lib/tell.ts')));
  ok('…and a stored one is taken at its word while the account list is not loaded',
    TL.toldDefaults({ ...fakeHost(), accounts: [] },
      { studio: { provider: 'claude', cwd: null,
                  byProvider: { claude: { model: null, effort: null, perm_mode: null, account_id: 'a2' } } } },
      'studio').account_id === 'a2');

  // A page about one product opens its chats in that product: on a machine
  // that has it, in a folder that machine actually has.
  const babysee = { name: 'babysee', repos: ['/Users/x/projects/babysee'], hosts: ['studio'] };
  const fleetOf = (over = {}) => ({ studio: { ...fakeHost(), ...over } });
  ok('a chat started from a product’s page opens in that product’s repository',
    eq(TL.whereFor(babysee, fleetOf({
      projects: [{ path: '/Users/x/projects/babysee', name: 'babysee', is_git: true }],
    }), 'studio'), { host: 'studio', cwd: '/Users/x/projects/babysee', project: 'babysee' }));
  ok('…on a machine that has that product, not on whichever one is in focus',
    TL.whereFor({ ...babysee, hosts: ['mini'] },
      { studio: fakeHost(), mini: { ...fakeHost(), status: 'online' } }, 'studio').host === 'mini');
  ok('…and never in a folder that machine does not have: a repo of one computer is a path to nothing on another',
    TL.whereFor({ ...babysee, repos: ['/elsewhere/babysee', '/Users/x/projects/babysee'] },
      fleetOf({ projects: [{ path: '/Users/x/projects/babysee', name: 'babysee', is_git: true }] }),
      'studio').cwd === '/Users/x/projects/babysee');
  ok('a product with no repository is still a product: it opens where new chats open, by name',
    eq(TL.whereFor({ name: 'Skola', repos: [], hosts: ['studio'] }, fleetOf(), 'studio'),
      { host: 'studio', cwd: null, project: 'Skola' }));
  ok('…and an unscoped page is the computer in focus and nothing said about it',
    eq(TL.whereFor(null, fleetOf(), 'studio'), { host: 'studio', cwd: null, project: null }));
  ok('the bar says which product the chat will be about, and not how that is done',
    TL.whereNote(TL.whereFor(babysee, fleetOf({
      projects: [{ path: '/Users/x/projects/babysee', name: 'babysee', is_git: true }],
    }), 'studio')) === 'babysee');
  ok('…which it says the same way for a product with no repository to open in',
    TL.whereNote(TL.whereFor({ name: 'Skola', repos: [], hosts: ['studio'] },
      fleetOf(), 'studio')) === 'Skola');
  ok('…and says nothing at all where there is no product',
    TL.whereNote(TL.whereFor(null, fleetOf(), 'studio')) === null);
  // A chat that could not open in the product is told which product it is
  // about, because the agent cannot see the chat's own title.
  ok('a product with no repository is said out loud in the first message instead',
    /\(This is about \$\{at\.project\}\.\)/.test(src('src/lib/tell.ts'))
    && /at\.project && !at\.cwd/.test(src('src/lib/tell.ts')));

  const NOWS = Math.floor(NOW);
  const told = (n, at = NOWS) => ({ host: 'studio', chatId: `c${n}`, title: `chat ${n}`, at });
  const three = [told(1), told(2), told(3)];
  ok('the chat just started has a window, and the corner still holds two',
    eq(TL.arrangeTold([told(1)]).panels.map((t) => t.chatId), ['c1'])
    && eq(TL.arrangeTold(three).panels.map((t) => t.chatId), ['c1', 'c2']));
  ok('…and the rest are tabs along the bottom, side by side',
    eq(TL.arrangeTold(three).tabs.map((t) => [t.told.chatId, t.open]),
      [['c1', true], ['c2', true], ['c3', false]]));
  ok('…past three of those the rest are a count, not a second list',
    TL.arrangeTold([...three, told(4), told(5)]).more === 2);
  ok('one put away leaves its tab and lets the next window open',
    eq(TL.arrangeTold(three, ['studio:c1']).panels.map((t) => t.chatId), ['c2', 'c3'])
    && TL.arrangeTold(three, ['studio:c1']).tabs[0].open === false);
  ok('…and with no room left for a window, every chat is a tab',
    TL.arrangeTold(three, [], 0).panels.length === 0
    && TL.arrangeTold(three, [], 0).tabs.length === S.TABS);

  // The chats take their windows first: one of them is a sentence typed a
  // moment ago, and a question that has waited since last night can wait as a
  // tab. So the question dock is asked for what is left rather than for two.
  const list = S.sessions(busy);
  ok('a question keeps its window only where a chat has not taken it',
    S.arrange(list, S.NO_DOCK, 1).panels.length === 1
    && S.arrange(list, S.NO_DOCK, 0).panels.length === 0
    && S.arrange(list, S.NO_DOCK, 0).tabs.length === Math.min(S.TABS, list.length),
    `${S.arrange(list, S.NO_DOCK, 0).tabs.length} tabs`);

  // A window about a chat that is not there any more is a window about
  // nothing; one whose computer cannot be reached is not that.
  const hosts = { studio: { ...fakeHost(), chats: [{ id: 'c1', created_at: NOWS }] } };
  const old = NOWS - TL.TOLD_GRACE - 1;
  ok('a chat the computer still lists keeps its window',
    TL.liveTold([{ ...told(1), at: old }], hosts, NOWS).length === 1);
  ok('…one it no longer lists loses it, once it has had a moment to say so',
    TL.liveTold([{ ...told(9), at: old }], hosts, NOWS).length === 0
    && TL.liveTold([told(9)], hosts, NOWS).length === 1);
  ok('…and one on a computer that cannot be reached keeps it, because "I cannot see it" is not "it is gone"',
    TL.liveTold([{ ...told(9), at: old }],
      { studio: { ...hosts.studio, status: 'offline' } }, NOWS).length === 1
    && TL.liveTold([{ ...told(9), at: old }], {}, NOWS).length === 0);

  // A window is furniture: where it stands is its own, and what happens to the
  // one beside it — opening, closing, dropping out of a poll — does not move
  // it. That is what a place written down at birth buys, and what positioning
  // by a list index cost.
  ok('a new window takes the first slot nothing is standing in',
    eq(TL.freeSlot([]), TL.slot(0))
    && eq(TL.freeSlot([TL.slot(0)]), TL.slot(1))
    && eq(TL.freeSlot([TL.slot(1)]), TL.slot(0)),
    JSON.stringify(TL.freeSlot([TL.slot(1)])));
  ok('…and one dragged somewhere of its own leaves both slots free',
    eq(TL.freeSlot([{ right: 600, bottom: 300, width: 350, height: 500 }]), TL.slot(0)));
  ok('…with every window the dock has room for getting one of its own',
    new Set([TL.slot(0), TL.slot(1), TL.slot(2)].map((p) => p.right)).size === 3);

  // A window that has been moved or pulled bigger stays inside the screen: one
  // dragged past an edge is one that cannot be dragged back.
  const screen = { width: 1440, height: 900 };
  const put = TL.inView({ right: 9999, bottom: 9999, width: 350, height: 500 }, screen);
  ok('a window cannot be pushed off the screen',
    put.right === screen.width - 350 && put.bottom === screen.height - 500);
  const small = TL.inView({ right: 24, bottom: 78, width: 10, height: 10 }, screen);
  ok('…nor made smaller than something that fits in it',
    small.width === TL.MIN_W && small.height === TL.MIN_H
    && small.right === 24 && small.bottom === 78, JSON.stringify(small));
  ok('…nor larger than the screen it is on',
    TL.inView({ right: 0, bottom: 0, width: 5000, height: 5000 }, screen).width
      === screen.width - 16);

  // …and the drawing of it, in the same corner as the questions.
  // Both sides of each store, the way `test-drive.mjs` seeds them: `setState`
  // for the live copy, and the initial state, because that is what a first
  // render is handed.
  const seed = (store, patch) => {
    Object.assign(store.getInitialState(), patch);
    store.setState(patch);
  };
  seed(F.useFleet, { hosts: { studio: fakeHost() }, order: ['studio'], focus: 'studio', ready: true });
  // Started just now, on a chat id that computer has never heard of: a window
  // is drawn from what `chat.create` answered, before the chat list catches up.
  seed(TL.useTold, {
    chats: [{ host: 'studio', chatId: 'told1', title: 'ship the beta tonight',
              at: Math.floor(Date.now() / 1000) }],
    minimised: [],
  });
  const withChat = renderToStaticMarkup(h(SessionsUI.Sessions, { view: busy }));
  ok('the chat opens as a window on the page it was typed on, nearest the corner',
    withChat.includes('ship the beta tonight')
    && anyStyle(withChat, (d) => d.position === 'fixed' && d.right === '24px'),
    withChat.slice(0, 200));
  ok('…with the two window buttons on it, and a way to open it out',
    /aria-label="Put this away"/.test(withChat) && /aria-label="Close"/.test(withChat)
    && /Open it in the middle of the screen/.test(withChat));
  ok('…and a tab of its own in the row along the bottom',
    countStyles(withChat, (d) => d.width === `${K.SIZE.tab}px` && d.height === '44px') >= 3
    && (withChat.match(/ship the beta tonight/g) ?? []).length >= 2);
  ok('…drawn from what chat.create answered, before that computer’s list catches up',
    !/Webhook retry policy/.test(withChat));

  // …and the same window on a chat that computer does list: the five settings
  // the chat screen draws as chips in its head, in the room this one has.
  seed(TL.useTold, {
    chats: [{ host: 'studio', chatId: 'c1', title: 'ship the beta tonight',
              at: Math.floor(Date.now() / 1000) }],
    minimised: [],
  });
  const settled = renderToStaticMarkup(h(SessionsUI.Sessions, { view: busy }));
  ok('a window on a chat the computer knows says what that chat is set to',
    ['this computer', 'Opus 5', 'high', 'default', 'projects/quire']
      .every((word) => settled.includes(word)),
    ['this computer', 'Opus 5', 'high', 'default', 'projects/quire']
      .filter((w) => !settled.includes(w)).join(', '));
  ok('…and every one of them can be pressed for the list behind it',
    (settled.match(/aria-expanded="false"/g) ?? []).length === 5
    && /Account — press to change/.test(settled) && /Model — press to change/.test(settled));
  ok('…while the question beside it is still open: one corner, both kinds',
    withChat.includes('Use the live ones now') && withChat.includes('asks you'));
  seed(TL.useTold, { chats: [], minimised: [] });
  ok('a Dashboard with no chat started and nothing waiting draws neither',
    renderToStaticMarkup(h(SessionsUI.Sessions, { view: view('calm') })) === '');

  // The chat window is the chat: the panel's own timeline, the panel's own
  // send. Nothing about it is a second, smaller chat written for this corner.
  ok('the window in the corner is the real chat, drawn out of the real parts',
    /from '\.\/Timeline'/.test(src('src/components/ChatPanel.tsx'))
    && /<ChatComposer/.test(src('src/components/ChatPanel.tsx'))
    && /send\(told\.host, told\.chatId, words, attachments\)/.test(src('src/components/ChatPanel.tsx'))
    && !/ustabasi/.test(src('src/components/ChatPanel.tsx')));
  ok('…and closing it closes the window, never the chat',
    /close: \(id\) => set/.test(src('src/lib/tell.ts'))
    && !/deleteChat/.test(src('src/lib/tell.ts'))
    && !/deleteChat/.test(src('src/components/ChatPanel.tsx')));
}

// ── 3c · what a worker is printing ─────────────────────────────────────────
// The run log is one file on one computer read by two clients, so the reading
// is held to the phone's, record for record, against a real recording — the
// same one `app/scripts/test-ustabasi.cjs` and the daemon's own check use. A
// log written by hand agrees with its reader by construction; the shapes that
// break a reader are the ones nobody would think to write.

group('the panel reads a run exactly as the phone does');
{
  // Both places a ticket is opened in this panel read it, and both read it
  // through the one module: the wall's ticket window and the card's own Live
  // box. A second reading of the same file is a second thing to keep in step.
  ok('every place the panel shows a run reads it the same way',
    /from '\.\.\/lib\/run'/.test(src('src/components/TicketChat.tsx'))
    && /from '\.\.\/lib\/run'/.test(src('src/screens/Ticket.tsx'))
    && /RunLog/.test(src('src/screens/Ticket.tsx')));

  const raw = readFileSync(join(web, '..', 'app/scripts/fixtures/run.log'), 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());
  // The daemon's own reading of a line, in the shape it puts on the wire.
  const CUT = 2000;
  const records = [];
  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch { records.push({ k: 'other', type: 'unparsable' }); continue; }
    if (d.type === 'assistant' || d.type === 'user') {
      for (const b of (d.message || {}).content || []) {
        if (b.type === 'text') records.push({ k: 'text', text: b.text });
        else if (b.type === 'thinking') records.push({ k: 'thinking', text: b.thinking });
        else if (b.type === 'tool_use') records.push({ k: 'tool', id: b.id, name: b.name, input: b.input });
        else if (b.type === 'tool_result') {
          const body = typeof b.content === 'string' ? b.content
            : (b.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
          records.push({ k: 'result', id: b.tool_use_id, text: body.slice(0, CUT),
                         error: !!b.is_error, ...(body.length > CUT ? { clipped: true } : {}) });
        }
      }
    } else if (d.type === 'system') records.push({ k: 'system', subtype: d.subtype });
    else if (d.type === 'result') records.push({ k: 'done', error: !!d.is_error, cost: d.total_cost_usd });
    else records.push({ k: 'other', type: d.type });
  }

  ok('the recording is a real run, not three lines',
    lines.length > 90 && new Set(records.map((r) => r.k)).size >= 6);

  const here = RUN.turns(records);
  const phone = PRUN.turns(records);
  ok('every turn the phone reads out of it, the panel reads the same way',
    eq(here.turns, phone.turns) && here.next === phone.next,
    `${here.turns.length} vs ${phone.turns.length}`);
  ok('…including what each tool call was called on, which is the line a person reads',
    eq(here.turns.filter((t) => t.kind === 'did').map((t) => t.summary),
      phone.turns.filter((t) => t.kind === 'did').map((t) => t.summary)));
  ok('…and the several hundred lines nobody opened the ticket to see are dropped by both',
    here.turns.length < records.length
    && !here.turns.some((t) => t.kind === 'say' && /hook_|thinking_tokens/.test(t.text)));

  // Paged the way the daemon pages it: a reader that numbered the second page
  // from the length of the first gave two turns on screen the same key.
  const cut = Math.floor(records.length / 2);
  const first = RUN.turns(records.slice(0, cut));
  const second = RUN.turns(records.slice(cut), first.next);
  const keys = [...first.turns, ...second.turns].map((t) => t.id);
  ok('a run read a page at a time never draws two turns under one key',
    new Set(keys).size === keys.length, `${keys.length - new Set(keys).size} shared`);
  ok('…and an answer that arrived on a later page lands on the call it belongs to',
    RUN.attach(first.turns, second.answers)
      .filter((t) => t.kind === 'did' && t.output != null).length
      >= first.turns.filter((t) => t.kind === 'did' && t.output != null).length);
  ok('…and a long run is kept to its end rather than all of it',
    RUN.trim(new Array(RUN.MAX_TURNS + 30).fill(0).map((_, i) => ({ kind: 'say', id: `r${i}`, text: 'x' })))
      .length === RUN.MAX_TURNS);

  // Where the log goes in the page: between what was said before the run began
  // and what has been said since, which is where it happened.
  const msgs = [{ id: 'a', ts: 100, from: 'you', text: 'do it' },
                { id: 'b', ts: 300, from: 'worker', text: 'done' },
                { id: 'c', ts: 50, from: 'worker', text: 'asking', tail: true }];
  const split = U.around(msgs, 200);
  ok('the run is drawn where it happened: after what was said before it',
    eq(split.before.map((m) => m.id), ['a']) && eq(split.after.map((m) => m.id), ['b', 'c']));
  ok('…and a ticket that has never run reads exactly as it did before there was a log',
    eq(U.around(msgs, null).before.map((m) => m.id), ['a', 'b', 'c'])
    && U.around(msgs, null).after.length === 0);
}

// ── 4 · the calm morning ───────────────────────────────────────────────────

group('a morning where nothing needs anybody is a designed state');
{
  const quiet = view('calm');
  ok('it is calm when nothing needs a person and nothing is being kept from them',
    OV.calm(quiet) === true);
  ok('…and the line says so in words rather than in zeroes',
    page('calm').includes('nothing needs you') && page('calm').includes('nothing is stuck'));
  ok('…and the Needs you section is not drawn at all', !page('calm').includes('Needs you'));
  ok('…and a board with nothing on it is an empty state rather than an all-clear',
    page('fresh').includes('No products yet'));
}

// ── 5 · the three pages under a product ───────────────────────────────────

group('Web14 W6 and W8, with no branch on either');
{
  const busy = view('busy');
  const quire = busy.projects.find((p) => p.key === 'quire');
  const scoped = (props) => renderToStaticMarkup(h(OverviewUI.Overview, {
    view: busy, project: quire, onProject() {}, ...props,
  }));
  const product = scoped({});

  // The product page is one screen: what was done on it today, the board in
  // four numbers and what is in progress. Nothing to switch between — no
  // segment over it, and no second way to write a ticket beside the Composer.
  ok('the product page is what it is, today, and what is in progress',
    product.includes('live since') && product.includes('In progress now') && product.includes('id="p-today"'));
  ok('…with no tabs over it and no New ticket',
    !product.includes('dv-seg') && !product.includes('New ticket') && !product.includes('aria-pressed'));
  // Branches are gone from the panel (ustabasi #147). Quire has four of them,
  // with a summary written on one, and the page names none of them — no
  // section, no way to a branch's page, nothing to pick one with.
  ok('a product with branches draws no Branches section, branch link or branch picker',
    quire.branches.length === 4
    && !product.includes('Branches') && !product.includes('Everything on')
    && !product.includes('/branches"') && !/href="[^"]*\/b\//.test(product)
    && !product.includes('Bulk invite is three checks in.')
    && !quire.branches.some((b) => product.includes(`>${b.name}<`)),
    quire.branches.map((b) => b.name).join(' '));
  // …and what the branches tab used to be the way to — the repositories — is
  // on the product page itself, next to Still open.
  ok('…and its repositories are on the product page, beside Still open',
    product.includes('id="p-repos"') && quire.repos.length > 0
    && quire.repos.every((r) => product.includes(`data-repo="${r}"`))
    && product.indexOf('Still open') < product.indexOf('id="p-repos"'));
  ok('…while its board, chats, status and Still open are all still reachable',
    product.includes(`href="/p/quire/board"`) && product.includes('data-counts')
    && product.includes('data-project-page') && product.includes('data-meta')
    && product.includes('Still open'));

  // Today is what was done, not who did it: the lines the computer wrote on
  // the chats that moved since midnight, latest first, and no row for a chat
  // nothing has come of.
  {
    const at = busy.now;
    const chat = (id, over) => ({ id, archived: 0, updated_at: at - 60, done: '', ...over });
    const did = TD.today([
      chat('old', { updated_at: at - 3 * 86_400, done: 'Shipped last week' }),
      chat('mail', { done: 'Added the DNS records\nSent a test\n' }),
      chat('empty', { updated_at: at - 10 }),
      chat('page', { updated_at: at - 30, done: 'Removed the tabs' }),
    ], at, at - 3600);
    ok('today is what was done in the chats that moved today, latest first, and nothing for a chat with nothing done',
      did.map((d) => d.text).join('|') === 'Removed the tabs|Sent a test|Added the DNS records',
      did.map((d) => d.text).join('|'));
  }

  // The third panel: what the product is waiting for. The board holds work an
  // agent can be handed and these are the other kind — a key somebody has to
  // make, a registrar sitting on a transfer — so a product could read `live`
  // with nothing on the page saying what it could not do yet.
  ok('the product page says what it is still waiting on',
    product.includes('Still open') && product.includes('Payment provider keys')
    && product.includes('Custom domain approval'));
  // Blocked first, then waiting, then to-do: the first is stopping other work,
  // the second is a reminder to chase, the third is a list.
  const open = PR.openRows(quire, busy.now, (s) => `${Math.round(s / 86_400)}d`);
  ok('…worst first, with whose it is in the label rather than beside it',
    open.map((o) => o.state).join() === 'blocked,waiting,todo,done'
    && open[1].label === 'Waiting on the registrar');
  ok('…and the line beside the heading counts the three that are not settled',
    PR.openLine(open) === '1 blocked · 1 waiting · 1 to do');
  // A thread with two voices in it, and the card says which is which: a finding
  // from the assistant read as a decision is how the wrong thing gets done.
  ok('a settled one stays on the page, and a thread keeps its voices',
    product.includes('1 settled') && open[1].comments.map((m) => m.who).join() === 'hermes,you');

  // What is promised has not happened: it is on the same line as what has, and
  // it is drawn as a ring rather than as a fact.
  const line = PR.timeline(quire, busy.now);
  ok('a date that has not arrived is a promise on the same line',
    line[0].title === 'v4.0 · Custom domains' && line[0].future === true
    && line.some((m) => m.today) && line[line.length - 1].kind === 'start');
  ok('…and the three dates beside the rail are read off it, never invented',
    PR.facts(quire, busy.now).map((f) => f.label).join(' · ')
      === 'Started · Live since · Next milestone');

  // A product nobody has written a stage or a history for draws neither, and
  // says so rather than drawing an empty rail.
  const hush = busy.projects.find((p) => p.key === 'hush');
  ok('a product nobody has said any of that about draws no rail and no line',
    PR.rail(hush) === null && PR.timeline(hush, busy.now).length === 0
    && PR.facts(hush, busy.now).length === 0);

  ok('…and a card opens its own page under the same product',
    scoped({ card: 'studio:k2' }).includes('in column')
    && !scoped({ card: 'studio:k2' }).includes('Branches'));
  // A press hands over the merged key; an address hands over the id alone
  // (`/p/quire/c/k2`), which is what a reload and a cold link arrive with. Both
  // have to open the card — matching only the first drew the board instead.
  ok('…and its own address opens it too, which is what a reload arrives with',
    scoped({ card: 'k2' }).includes('in column')
    && !scoped({ card: 'k2' }).includes('Ice Box'));

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
    card, project: quire, index: 0, now: busy.now, onProject() {},
    opened, ...over,
  }));
  const page = draw();
  // Everything above the Agent face: the human face, the question and Live.
  const above = page.slice(0, page.indexOf('data-agent-face'));
  const shut = page.match(/<details[^>]*data-agent-face[^>]*>/)?.[0] ?? '';

  // HANDOVER §4.4: the human face, Live, and the agent face in a shut
  // <details> that names itself.
  ok('the ticket page is the human face and the live half, with the agent shut',
    page.includes(card.title) && page.includes(card.summary)
    && page.includes('Live') && page.includes('Executor')
    && page.includes('Agent face') && !!shut && !/\sopen(=|\s|>)/.test(shut)
    && !above.includes(AGENT.goal) && !above.includes(AGENT.verify_cmd));
  // The one failure this page could have that nobody would notice: the box
  // reads perfectly well with the agent's goal in it, and it is the wrong text.
  ok('nothing an agent wrote is on the human face',
    [AGENT.goal, AGENT.verify_cmd, AGENT.notes, ...AGENT.done_criteria, ...AGENT.constraints]
      .every((text) => !above.includes(text))
    && TK.human({ ...card, ...AGENT }).summary === card.summary,
    above.slice(Math.max(0, above.length - 300)));
  const bare = draw({ card: { ...card, summary: '' } });
  ok('…and a card nobody wrote sentences for says so rather than borrowing the goal',
    TK.human({ title: 'x', summary: '' }).bare === true
    && TK.human({ title: 'x', summary: '' }).summary === ''
    && bare.includes('Nobody has written the sentences for this one yet.')
    && !bare.slice(0, bare.indexOf('data-agent-face')).includes(AGENT.goal));

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
      .includes('did not hand the agent face over')
    && draw({ opened: { full: null, ticket: null, error: 'connection refused' } })
      .includes(card.title));
  // The whole of the difference between a frame and its light twin, which is
  // the claim "in both themes" makes: one attribute on <html>, and not a line
  // of any of these three pages.
  const twins = {
    'W6 · the product': () => scoped({}),
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
  ok('each of the three is the same page in the light: the same markup, one attribute apart',
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
    drawn === NAMES.length * 2 * 5, `${drawn} renders`);
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
    page('slow').includes('Quiet for 4 weeks. Nothing queued.')
    && OV.figure(view('slow').projects.find((p) => p.key === 'pebble'), NOW, ago) === null,
    page('slow').slice(page('slow').indexOf('quiet for') - 40, page('slow').indexOf('quiet for') + 30));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
