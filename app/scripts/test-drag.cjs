/** Carrying a card between the board's columns, checked without a thumb: the
 *  350 ms hold, the tabs as drop targets, the haptics, the worker a drop starts,
 *  and the drag that is cancelled leaving nothing behind.
 *  Run: node scripts/test-drag.cjs  (also folded into test-ustabasi.cjs.)
 */
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;

const D = require(path.join(root, 'src/drag.ts'));
const B = require(path.join(root, 'src/board.ts'));
const K = require(path.join(root, 'src/tokens.ts'));
const parts = require(path.join(root, 'src/components/drag.tsx'));
const board = require(path.join(root, 'src/components/board.tsx'));

const checks = [];
/** The board screen's own source, for the two claims about it that are about
 *  there being one of something rather than about what it draws. */
const SCREEN = require('fs').readFileSync(path.join(root, 'app/dashboard.tsx'), 'utf8');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The four tabs, 46 high across a 390 wide phone, as the board measures them. */
const TABS = ['ice_box', 'queued', 'in_progress', 'done'].map((key, i) => ({
  key, rect: { x: 12 + i * 92, y: 120, w: 88, h: 46 },
}));
const ON = (col) => { const t = TABS.find((x) => x.key === col); return { x: t.rect.x + 44, y: 143 }; };
const OFF = { x: 195, y: 500 };
/** Where the board's own body starts on the glass: under the safe area, the
 *  project bar, the system line, the product's head and the segmented control. */
const BODY = { x: 0, y: 202 };

/** A card of the coding executor, nothing filed on it, third in Queued. */
const CARD = {
  id: 'q1', host: 'h1', column: 'queued', position: 2, title: 'Custom domains for client portals',
  executor: 'coding_agent', ustabasi_id: null, stale: false,
};
const carried = (o = {}) => D.carry({ ...CARD, ...o }, 'coder', 'exCoder');

/** Three cards 90 tall in the open column, all on the one machine. */
const ROWS = [0, 1, 2].map((i) => ({ host: 'h1', rect: { x: 16, y: 180 + i * 96, w: 358, h: 90 } }));

/** …and the same column on a product checked out on two computers: this phone's
 *  card is drawn third and is its own machine's second. */
const MIXED = [
  { host: 'h2', rect: ROWS[0].rect }, { host: 'h2', rect: ROWS[1].rect },
  { host: 'h1', rect: ROWS[2].rect },
];
/** …and this phone's card in it: drawn third, and its own machine's first. */
const MINE = () => carried({ position: 0 });
const MID = (i) => ROWS[i].rect.y + 80;

/** Replay a run of events and collect everything the screen was asked to do. */
function play(events, drag = null) {
  const effects = [];
  for (const e of events) {
    const r = D.step(drag, e);
    drag = r.drag;
    effects.push(...r.effects);
  }
  return { drag, effects };
}

const lift = (c = carried(), open = 'queued') => ({ do: 'lift', carried: c, open, at: { x: 195, y: 300 } });
const over = (p, now, col = null, slot = null, position = slot) =>
  ({ do: 'over', at: p, column: col, slot, position, now });
/** Aim at the open column's tab, then slide down among its cards to `y`, reading
 *  both places off real geometry the way the board does. */
const pick = (col, y, c, rows, now = 1000) => [
  lift(c, col),
  over(ON(col), now, col, ...Object.values(D.place(ON(col).y, col, c.host, rows))),
  { do: 'over', at: { x: 195, y }, column: null, ...D.place(y, col, c.host, rows), now: now + 50 },
];

// ── 1 · the gesture, D1 to D4 ───────────────────────────────────────────────

{
  const T0 = 1000;
  const onIP = ON('in_progress');
  const { drag, effects } = play([
    lift(),
    over(onIP, T0, 'in_progress', null),
    { do: 'tick', now: T0 + D.OPEN_MS },
    over({ x: onIP.x, y: ROWS[0].y + 80 }, T0 + 400, 'in_progress', 1),
    { do: 'drop' },
  ]);
  checks.push(
    ['a card is held for 350 ms, carried onto a tab, and the column under it opens after 300',
      D.HOLD_MS === 350 && D.OPEN_MS === 300
      && eq(effects.filter((e) => e.do === 'open'), [{ do: 'open', column: 'in_progress' }])],
    ['…and the release asks one computer to move one card, once, to the place the thumb picked',
      drag === null
      && eq(effects.filter((e) => e.do === 'move'),
            [{ do: 'move', carried: carried(), column: 'in_progress', position: 1, starts: true }])],
    ['resting on a tab for less than that opens nothing',
      play([lift(), over(onIP, T0, 'in_progress'), { do: 'tick', now: T0 + D.OPEN_MS - 1 }])
        .effects.every((e) => e.do !== 'open')],
    ['sliding from one tab to the next restarts the clock rather than opening at once',
      play([lift(), over(ON('ice_box'), T0, 'ice_box'),
            over(onIP, T0 + 290, 'in_progress'), { do: 'tick', now: T0 + 299 }])
        .effects.every((e) => e.do !== 'open')],
    ['a card that has not left its place yet is still lying in the column, not in the air',
      !D.airborne(play([lift(), over({ x: 195, y: 304 }, T0)]).drag)
      && D.airborne(play([lift(), over({ x: 195, y: 340 }, T0)]).drag)],
  );
}

// ── 2 · where the thumb is ──────────────────────────────────────────────────

checks.push(
  ['the four tabs are the drop targets, and the rest of the glass is not one',
    D.columnAt(ON('queued'), TABS) === 'queued'
    && D.columnAt(ON('done'), TABS) === 'done'
    && D.columnAt(OFF, TABS) === null
    && D.columnAt({ x: ON('queued').x, y: 119 }, TABS) === null],
  ['…and a card with nothing measured under it is over nothing rather than over the first',
    D.columnAt(ON('queued'), []) === null],
  ['a place in the open column is picked by which cards the thumb is past',
    D.slotAt(ROWS[0].rect.y - 10, ROWS) === 0 && D.slotAt(MID(0), ROWS) === 1
    && D.slotAt(MID(2), ROWS) === 3 && D.slotAt(400, []) === 0],
  ['…and on a board built out of two computers it is turned into a place on one of them',
    eq(D.place(MID(2), 'queued', 'h1', MIXED), { slot: 3, position: 1 })
    && eq(D.place(MID(0), 'queued', 'h1', MIXED), { slot: 1, position: 0 })
    && eq(D.place(MID(2), 'queued', 'h1', ROWS), { slot: 3, position: 3 })],
  ['Done has no place to point at, because it is drawn by when work finished',
    eq(D.place(MID(1), 'done', 'h1', ROWS), { slot: null, position: null })
    && B.arranged('done') === false && ['ice_box', 'queued', 'in_progress'].every(B.arranged)],
);

// ── 3 · the drop that starts a worker ───────────────────────────────────────

{
  const T0 = 1000;
  const drop = (c, col) => play([lift(c, col), over(ON(col), T0, col, 0), { do: 'drop' }])
    .effects.find((e) => e.do === 'move');
  /** A card held over the tab of the column the list is showing, pointing at a place in it. */
  const aimed = (col, slot) => ({ ...play([lift()]).drag, open: col, over: col, slot, position: slot });
  checks.push(
    ['In Progress on the coding executor starts a worker, and nothing else does',
      D.starts(carried(), 'in_progress') === true
      && D.starts(carried(), 'queued') === false
      && D.starts(carried({ ustabasi_id: 21 }), 'in_progress') === false
      && D.starts(carried({ executor: 'branch_agent' }), 'in_progress') === false
      && D.starts(carried({ executor: 'human' }), 'in_progress') === false],
    ['…and the release says so before the finger comes up, because the tab promised it',
      drop(carried(), 'in_progress').starts === true
      && drop(carried({ ustabasi_id: 21 }), 'in_progress').starts === false
      && drop(carried(), 'ice_box').starts === false],
    ['the hint over the cards says where it will land, and says "start" only where it will',
      eq(D.hint(play([lift(), over(ON('in_progress'), T0, 'in_progress', 1)]).drag,
                { others: 0 }).said, { key: 'dgOpen' })
      && eq(D.hint(aimed('in_progress', 1), { others: 5 }).said,
            { key: 'dgStart', params: { n: 2, of: 6 } })
      && eq(D.hint(aimed('ice_box', 1), { others: 5 }).said,
            { key: 'dgDrop', params: { n: 2, of: 6 } })
      && eq(D.hint(play([lift()]).drag, { others: 5 }).said, { key: 'dgHold' })],
    ['…and names no position where the board could not keep it: Done, or two machines',
      eq(D.hint(aimed('in_progress', 1), { others: 5, mixed: true }).said, { key: 'dgStartBare' })
      && eq(D.hint(aimed('ice_box', 1), { others: 5, mixed: true }).said, { key: 'dgRelease' })
      && eq(D.hint({ ...aimed('done', null), position: 0 }, { others: 5 }).said, { key: 'dgRelease' })],
  );
}

// ── 4 · what the card says once it has landed ───────────────────────────────

{
  const LANDED = { carried: carried(), column: 'in_progress', moved: true, started: true, error: '' };
  const landed = (o) => D.foot({ ...LANDED, started: false, ...o });
  checks.push(
    ['a card that started a worker says which one, and offers no way to undo it',
      eq(landed({ started: true }), { said: { key: 'dgStarted' }, who: 'exCoder', tone: 'run', undo: false })],
    ['…and it is said on the card where the card is on screen, and above them where it is not',
      D.announce(LANDED, ['q9', 'q1']) === 'card' && D.announce(LANDED, ['q9']) === 'line'],
    ['a release onto a tab before the column opens brings the list with it, so there is a card to say it on',
      eq(play([lift(), over(ON('in_progress'), 1000, 'in_progress'), { do: 'drop' }])
           .effects.filter((e) => e.do === 'open'), [{ do: 'open', column: 'in_progress' }])],
    ['a card the queue would not take moved anyway, says why nothing started, and can be put back',
      eq(landed({ error: 'ustabasi is not installed' }),
         { said: { key: 'dgNoStart', params: { why: 'ustabasi is not installed' } }, tone: 'amber', undo: true })],
    ['a move that never reached the computer says so, and offers nothing to undo',
      eq(landed({ moved: false, error: 'could not reach mini' }),
         { said: { key: 'dgNoMove', params: { why: 'could not reach mini' } }, tone: 'amber', undo: false })],
    ['…and an Undo is that same move, so a machine that has gone quiet is caught once and not twice',
      eq(D.back(LANDED), { carried: carried(), column: 'queued', position: 2 })
      && (SCREEN.match(/moveCard\(/g) ?? []).length === 1
      && /await moveCard\([\s\S]*?\} catch \(e: any\)/.test(SCREEN)],
    ['an ordinary move says where it went and can be taken back to exactly where it was',
      eq(landed({ column: 'done' }), { said: { key: 'dgMoved' }, col: 'bdDone', tone: 'ink2', undo: true })
      && eq(D.back({ carried: carried(), column: 'done', moved: true, started: false, error: '' }),
            { carried: carried(), column: 'queued', position: 2 })],
  );
}

// ── 5 · a drag that leads nowhere ───────────────────────────────────────────

{
  const T0 = 1000;
  const nothing = (r) => r.drag === null && r.effects.every((e) => e.do !== 'move');
  const moved = (r) => r.effects.find((e) => e.do === 'move') ?? {};
  checks.push(
    ['a release off the tabs asks nothing of any computer, and is not even felt',
      eq(play([lift(), over(OFF, T0), { do: 'drop' }]).effects, [{ do: 'haptic', weight: 'light' }])],
    ['a drag the phone took away asks nothing either, wherever the thumb had got to',
      nothing(play([lift(), over(ON('done'), T0, 'done', 0), { do: 'cancel' }]))],
    ['a card put back in its own column at its own place is not a move',
      nothing(play([lift(), over(ON('queued'), T0, 'queued', 2), { do: 'drop' }]))],
    ['…including on a board of two computers, where the place it lies at is not its index',
      eq(D.place(MID(1), 'queued', 'h1', MIXED), { slot: 2, position: 0 })
      && nothing(play([...pick('queued', MID(1), MINE(), MIXED), { do: 'drop' }]))
      && moved(play([...pick('queued', MID(2), MINE(), MIXED), { do: 'drop' }])).position === 1],
    ['…but moved within it, it is: position is priority on this board',
      play([lift(), over(ON('queued'), T0, 'queued', 0), { do: 'drop' }])
        .effects.find((e) => e.do === 'move').position === 0],
    ['and an event for a drag that has already ended is answered with nothing',
      nothing(play([{ do: 'drop' }])) && nothing(play([{ do: 'tick', now: T0 }]))],
  );
}

// ── 5b · picking the place, which is done below the tabs ────────────────────

{
  const T0 = 1000;
  const moved = (r) => r.effects.find((e) => e.do === 'move') ?? {};
  /** Over In Progress long enough to open it, then down among its cards. */
  const into = (y, rows) => [
    lift(MINE(), 'queued'),
    over(ON('in_progress'), T0, 'in_progress'),
    { do: 'tick', now: T0 + D.OPEN_MS },
    { do: 'over', at: { x: 195, y }, column: null,
      ...D.place(y, 'in_progress', 'h1', rows), now: T0 + 400 },
  ];
  checks.push(
    ['the tab stays the target while the thumb comes down among the cards to pick a place',
      D.target(play(into(MID(1), ROWS)).drag) === 'in_progress'
      && moved(play([...into(MID(1), ROWS), { do: 'drop' }])).column === 'in_progress'],
    ['…and a place picked there is sent as a place on the card’s own machine',
      moved(play([...into(MID(2), MIXED), { do: 'drop' }])).position === 1
      && D.place(MID(2), 'in_progress', 'h1', MIXED).slot === 3],
    ['a drag that never rested on a tab is aimed at nothing, wherever it is let go',
      D.target(play([lift(), over({ x: 195, y: MID(1) }, T0)]).drag) === null],
  );
}

// ── 6 · the haptics ─────────────────────────────────────────────────────────

{
  const T0 = 1000;
  const weights = (events) => play(events).effects.filter((e) => e.do === 'haptic').map((e) => e.weight);
  const source = require('fs').readFileSync(path.join(root, 'src/components/drag.tsx'), 'utf8');
  checks.push(
    ['the lift is felt, each tab the card crosses onto is felt, and the drop is felt harder',
      eq(weights([lift(), over(ON('queued'), T0, 'queued', 2), over(ON('done'), T0 + 50, 'done', 0),
                  { do: 'drop' }]),
         ['light', 'tick', 'tick', 'firm'])],
    ['…and a drop that changes nothing is not felt at all, which is how it says so',
      eq(weights([lift(), over(OFF, T0), { do: 'drop' }]), ['light'])
      && eq(weights([lift(), over(ON('queued'), T0, 'queued', 2), { do: 'drop' }]), ['light', 'tick'])],
    ['each of the three weights reaches the phone as a buzz of its own',
      /Haptics\.selectionAsync\(\)/.test(source)
      && /ImpactFeedbackStyle\.Medium/.test(source) && /ImpactFeedbackStyle\.Light/.test(source)],
  );
}

// ── 7 · the parts, in both themes ───────────────────────────────────────────

const SPECIMENS = {
  Hint: () => h(parts.DragHint, { text: 'Release to start · position 2 of 6', tone: 'run' }),
  Left: () => h(parts.DropSlot, {}),
  Landing: () => h(parts.DropSlot, { landing: true }),
  Float: () => h(parts.Float, { face: 'coder', who: 'Coder', title: 'Custom domains',
                                style: parts.floatAt({ x: 226, y: 270 }, BODY) }),
  Held: () => h(board.BoardCard, { face: 'coder', who: 'Coder', title: 'Custom domains', lifted: true }),
  Landed: () => h(board.BoardCard, { face: 'coder', who: 'Coder', title: 'Custom domains',
                                     landed: { text: 'Started · Coder', tone: 'run', action: 'Undo' } }),
  Told: () => h(parts.DragHint, { text: 'Started · Coder', tone: 'run' }),
};

for (const scheme of ['dark', 'light']) {
  const t = K.tokensFor(scheme);
  const drawn = {};
  let threw = null;
  for (const [name, make] of Object.entries(SPECIMENS)) {
    try { drawn[name] = R.render(scheme, make()); } catch (e) { threw = `${name}: ${e.message}`; break; }
  }
  const has = (name, pred) => R.styles(drawn[name]).some(pred);
  checks.push(
    [`${scheme}: every part of the gesture stands up${threw ? ` (${threw})` : ''}`, threw === null],
    [`${scheme}: the card in the air is on the raised surface, narrow enough to see the tab under it`,
      has('Float', (s) => s.backgroundColor === t.s2 && s.width === parts.FLOAT_W
                          && s.position === 'absolute')],
    [`${scheme}: …and it is drawn under the thumb, not under where the thumb would be on the window`,
      has('Float', (s) => s.top === 270 - BODY.y - parts.FLOAT_LIFT
                          && s.left === 226 - BODY.x - parts.FLOAT_W / 2)
      && parts.floatAt({ x: 226, y: 270 }, { x: 0, y: 0 }).top
         !== parts.floatAt({ x: 226, y: 270 }, BODY).top],
    [`${scheme}: the place it left is an outline, and the place it is going is a green one`,
      has('Left', (s) => s.borderStyle === 'dashed' && s.borderColor === t.line2
                         && s.backgroundColor === 'transparent')
      && has('Landing', (s) => s.borderStyle === 'dashed' && s.borderColor === t.run
                               && s.backgroundColor === K.toneColours(t, 'run').bg)],
    [`${scheme}: a card being held is lifted off the page and one that just landed is the only loud one`,
      has('Held', (s) => s.backgroundColor === t.sLift)
      && has('Landed', (s) => s.backgroundColor === K.toneColours(t, 'run').bg && s.borderColor === t.run)
      && drawn.Landed.includes('Started · Coder') && drawn.Landed.includes('Undo')
      && drawn.Told.includes('Started · Coder')],
    [`${scheme}: …and nothing in any of them is a colour this theme does not have`,
      Object.values(drawn).every((m) => [...R.paint(m)].every((c) => STRAY(c, t)))],
  );
}

/** Every colour a part painted has to be one of this theme's, a shadow made of
 *  them, or one of the executor faces' own (`components/divan ExecutorBadge`). */
function STRAY(colour, t) {
  const own = new Set([...Object.values(t), K.ON_COLOUR,
                       ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean),
                       K.EXEC_PENDING_INK, K.EXEC_PENDING_LINE]);
  const inside = colour.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|oklch\([^)]*\)/g) || [colour];
  return inside.every((c) => own.has(c));
}

// ── 8 · the board itself ────────────────────────────────────────────────────

{
  const fixture = require('./test-board.cjs');
  const Dashboard = require(path.join(root, 'app/dashboard.tsx')).default;
  /** The studio's board with two more cards on it, both filed with the queue and
   *  waiting their turn in it: one dragged into In Progress a moment ago, and one
   *  filed on an earlier drag and dragged back to Queued since. */
  const filedCard = (id, column, ticket) => ({
    ...fixture.HOSTS[0].state.snapshot.cards[0],
    id, column, position: 9, ustabasi_id: ticket, summary: '',
    title: `Custom domains ${id}`, agent_status: 'queued', agent_status_at: null,
  });
  const started = fixture.HOSTS.map((e) => (e.id !== 'h1' ? e : {
    ...e,
    state: { ...e.state, snapshot: { ...e.state.snapshot, cards: [
      ...e.state.snapshot.cards,
      filedCard('q8', 'in_progress', 44), filedCard('q9', 'queued', 45),
      filedCard('q10', 'in_progress', null),
    ] } },
  }));

  const draw = (hosts, params) => {
    R.store.reset();
    R.params.reset();
    R.store.set({
      hosts: hosts.map((e) => ({ id: e.id, name: e.name })),
      divan: Object.fromEntries(hosts.map((e) => [e.id, e.state])),
      host: { id: 'h1' }, conn: 'online', loadDivan() {}, moveCard: async () => ({ error: '' }),
      ustabasi: null, ustabasiOld: false, loadUstabasi() {},
    });
    R.params.set(params);
    return R.render('dark', h(Dashboard));
  };

  const board = draw(fixture.HOSTS, { project: 'quire', tab: 'board' });
  const card = R.holds().filter((p) => p.text.includes('Bulk invite clients'));
  card[0]?.hold({ nativeEvent: { pageX: 195, pageY: 300 } });
  const buzzed = R.buzzes();
  card[0]?.out();
  const filed = draw(started, { project: 'quire', tab: 'board' });

  checks.push(
    ['every card on the board can be picked up, after the 350 ms the frame asks for',
      R.holds().length >= 6 && R.holds().every((p) => p.delay === D.HOLD_MS)],
    ['…and picking one up reaches the phone, which is the whole of the gesture starting',
      card.length === 1 && eq(buzzed, ['light'])],
    ['a card the drop has filed with the queue says the agent has it, off the board itself',
      (filed.match(/● bdPickedUp/g) ?? []).length === 1 && !board.includes('bdPickedUp')],
    ['…and no other card claims it: not one still waiting its turn in Queued, not one with no ticket',
      !draw(started, { project: 'quire', tab: 'board', col: 'queued' }).includes('bdPickedUp')],
  );
}

R.store.reset();
R.params.reset();
R.nav.reset();

module.exports = { checks };

if (require.main === module) {
  let bad = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? '  ok    ' : '  FAIL  ') + name);
    if (!ok) bad++;
  }
  console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
  process.exit(bad ? 1 : 0);
}
