/** A chat opens from the phone's own copy, and asks the computer only for what
 *  was written since (`src/history.ts`).
 *
 *  On 27 Nov 2026 entering a chat took three to four seconds of skeleton: no
 *  transcript was kept on the phone, so every first open asked for the last
 *  five hundred events — 464 KB for one chat — over a link losing 3–6 % of its
 *  packets. What is held here:
 *
 *    1. The rules on their own: what a copy is, which copies are not trusted,
 *       how a page of older history is put on top, when a change is written.
 *    2. The real store (`src/store.ts`) over a daemon of the test's own:
 *         a. a chat never seen opens on a short tail, and is written down;
 *         b. the next launch draws it from disk before the computer answers,
 *            and asks forward from the copy's last event — no hole, even when
 *            a live event lands first;
 *         c. with no connection the copy is still drawn;
 *         d. a copy pages behind is dropped for the tail;
 *         e. scrolling up fetches the page above, to the top, and a computer
 *            too old to read back is asked for a longer tail once;
 *         f. a chat the computer no longer has takes its copy with it;
 *         g. a copy that cannot be trusted is not used.
 *
 *  Run: node scripts/test-history.cjs
 */
const path = require('path');
require('./render-chat.cjs');

const root = path.join(__dirname, '..');
const H = require(path.join(root, 'src/history.ts'));
const storeMod = require(path.join(root, 'src/store.ts'));
const { useStore, HISTORY_STORAGE, history } = storeMod;
const { client } = require(path.join(root, 'src/ws.ts'));

const checks = [];
const check = (name, ok, detail = '') => checks.push([name + (ok || !detail ? '' : `  — ${detail}`), !!ok]);
const ev = (chat, seq, text = `m${seq}`) => ({ event: 'message.assistant', chat_id: chat, seq, data: { segment: seq, text }, ts: seq });
const seqs = (list) => (list || []).map((e) => e.seq);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. the rules ─────────────────────────────────────────────────────────
function rules() {
  const many = range(1, H.KEEP + 40).map((n) => ev('c', n));
  const snap = H.snapshot({ id: 'c' }, [...many, { event: 'text.delta', chat_id: 'c', data: {} }], false, 5);
  check('copy: the end of the chat is what is kept', snap.events.length === H.KEEP && snap.events.at(-1).seq === H.KEEP + 40);
  check('copy: one cut short says there is history above it', snap.truncated === true);
  check('copy: an event with no seq is not history', snap.events.every((e) => e.seq != null));
  check('copy: a short chat is kept whole and not called cut', (() => {
    const s = H.snapshot({ id: 'c' }, many.slice(0, 3), false, 5); return s.events.length === 3 && s.truncated === false; })());

  const text = JSON.stringify(snap);
  check('copy: read back as written', same(seqs(H.parse(text, 'c').events), seqs(snap.events)));
  check('copy: nothing is no copy', H.parse(null, 'c') === null && H.parse('', 'c') === null);
  check('copy: a file cut short mid-write is no copy', H.parse(text.slice(0, text.length / 2), 'c') === null);
  check('copy: another version is no copy', H.parse(JSON.stringify({ ...snap, v: 2 }), 'c') === null);
  check("copy: another chat's events are no copy", H.parse(text, 'other') === null);
  check('copy: events out of order are no copy',
    H.parse(JSON.stringify({ ...snap, events: [ev('c', 2), ev('c', 1)] }), 'c') === null);
  check('copy: an empty one is no copy', H.parse(JSON.stringify({ ...snap, events: [] }), 'c') === null);

  const held = range(50, 60).map((n) => ev('c', n));
  const up = H.prepend(held, range(40, 49).map((n) => ev('c', n)));
  check('page back: goes on top, in order', same(seqs(up.events), range(40, 60)) && up.older === 10);
  const overlap = H.prepend(held, range(45, 60).map((n) => ev('c', n)));
  check('page back: a page that overlaps adds only what is above', same(seqs(overlap.events), range(45, 60)) && overlap.older === 5);
  const none = H.prepend(held, range(50, 60).map((n) => ev('c', n)));
  check('page back: the tail again adds nothing', none.older === 0 && none.events === held);

  check('name: a chat is kept under its computer', H.keyOf('h1', 'c') !== H.keyOf('h2', 'c'));
  check('name: safe as a file name', /^[A-Za-z0-9_.-]+$/.test(H.keyOf('100.1.2.3:8790/../x', '../../etc')));
}

async function writing() {
  // A clock and timers of the test's own.
  let now = 0;
  const timers = [];
  const disk = new Map();
  const storage = {
    read: async (k) => disk.get(k) ?? null,
    write: async (k, t) => { disk.set(k, t); },
    remove: async (k) => { disk.delete(k); },
    list: async () => [...disk.keys()].map((key, i) => ({ key, at: i })),
  };
  const h = new H.History({ storage, now: () => now,
    setTimer: (fn, ms) => { const t = { fn, at: now + ms, off: false }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.off = true; } });
  const run = async (to) => {
    now = to;
    for (const t of timers.filter((x) => !x.off && x.at <= now)) { t.off = true; t.fn(); }
    await new Promise((r) => setImmediate(r));
  };
  let events = [ev('c', 1)];
  const take = () => H.snapshot({ id: 'c' }, events, false, now);
  h.touch('h', 'c', take);
  await run(H.WRITE_DELAY_MS - 1);
  check('write: not at once', h.writes === 0);
  // A streaming turn: an event every second for half a minute.
  for (let s = 1; s <= 30; s++) { events = [...events, ev('c', s + 1)]; h.touch('h', 'c', take); await run(now + 1000); }
  check('write: a burst of events is a few writes, not one each', h.writes >= 2 && h.writes <= 4, `${h.writes}`);
  await run(now + H.WRITE_DELAY_MS);
  const saved = H.parse(disk.get(H.keyOf('h', 'c')), 'c');
  check('write: what is on disk is where the burst ended', saved && saved.events.at(-1).seq === 31);

  events = [...events, ev('c', 32)];
  h.touch('h', 'c', take);
  await h.flush();
  check('write: leaving the app writes what was waiting', H.parse(disk.get(H.keyOf('h', 'c')), 'c').events.at(-1).seq === 32);

  h.touch('h', 'gone', () => null);
  await h.flush();
  check('write: a chat no longer in hand writes nothing', !disk.has(H.keyOf('h', 'gone')));

  h.touch('h', 'c', take);
  await h.forget('h', 'c');
  await run(now + H.MAX_WAIT_MS);
  check('forget: the copy goes, and nothing waiting is written after it', !disk.has(H.keyOf('h', 'c')));

  for (let i = 0; i < H.MAX_CHATS + 5; i++) disk.set(H.keyOf('h', `c${i}`), '{}');
  disk.set(H.keyOf('other', 'x'), '{}');
  await h.prune();
  check('prune: only the most recently written are kept', disk.size === H.MAX_CHATS && disk.has(H.keyOf('other', 'x')));
  await h.forgetHost('h');
  check("unpair: a computer's copies go, and only its own", disk.size === 1 && disk.has(H.keyOf('other', 'x')));
}

// ── 2. the store ─────────────────────────────────────────────────────────
const disk = new Map();
HISTORY_STORAGE.read = async (k) => disk.get(k) ?? null;
HISTORY_STORAGE.write = async (k, t) => { disk.set(k, t); };
HISTORY_STORAGE.remove = async (k) => { disk.delete(k); };
HISTORY_STORAGE.list = async () => [...disk.keys()].map((key, i) => ({ key, at: i }));

/** The computer: every chat's events, and what was asked of it. */
const daemon = {};
const asked = [];
let gate = null;          // when set, chat.get waits on it
let oldDaemon = false;    // one that has never heard of before_seq
let offline = false;
const PAGE = 500;
client.call = async (type, data) => {
  if (type === 'chat.list') return { chats: [], groups: [], people: { names: [], me: null } };
  if (type !== 'chat.get') return {};
  asked.push({ ...data });
  if (offline) { const e = new Error('offline'); e.code = 'offline'; throw e; }
  if (gate) await gate;
  const all = daemon[data.chat_id];
  if (!all) { const e = new Error('no such chat'); e.code = 'no_chat'; throw e; }
  const limit = data.limit || PAGE;
  const chat = { id: data.chat_id, title: data.chat_id };
  if (data.before_seq && !oldDaemon) {
    const above = all.filter((e) => e.seq < data.before_seq);
    return { chat, events: above.slice(-limit), more: false, truncated: above.length > limit, busy: false };
  }
  if (!data.since_seq) return { chat, events: all.slice(-limit), more: false, truncated: all.length > limit, busy: false };
  const after = all.filter((e) => e.seq > data.since_seq);
  return { chat, events: after.slice(0, limit), more: after.length > limit, truncated: false, busy: false };
};
const frame = (e) => client.handle(JSON.stringify({ type: 'event', ...e }));
const st = () => useStore.getState();
/** The app was closed and opened again: nothing in memory, the disk as it was. */
async function relaunch() {
  await history.flush();
  useStore.setState({ activeHostId: 'h1', events: {}, loadedChats: {}, truncated: {}, earlier: {}, chats: {}, live: {}, busy: {} });
  asked.length = 0;
}

async function store() {
  useStore.setState({ activeHostId: 'h1' });
  client.setStatus('online');

  // a. A chat never seen here opens on a short tail, and is written down.
  daemon.a = range(1, 300).map((n) => ev('a', n));
  await st().openChat('a');
  check('cold: one request, for a screenful and not five hundred', asked.length === 1 && asked[0].limit === H.FIRST_PAGE && !asked[0].since_seq,
    JSON.stringify(asked));
  check('cold: the end of the chat is on screen', same(seqs(st().events.a), range(301 - H.FIRST_PAGE, 300)));
  check('cold: the phone knows there is history above', st().truncated.a === true);
  await history.flush();
  const saved = H.parse(disk.get(H.keyOf('h1', 'a')), 'a');
  check('cold: the chat is written to this phone', !!saved && saved.events.length === H.FIRST_PAGE && saved.truncated === true);

  // b. The next launch: from disk before the computer answers, then only the news.
  await relaunch();
  daemon.a.push(ev('a', 301), ev('a', 302), ev('a', 303));
  let open; gate = new Promise((r) => { open = r; });
  const opening = st().openChat('a');
  await new Promise((r) => setImmediate(r));
  check('warm: the chat is drawn before the computer has answered',
    st().loadedChats.a === true && same(seqs(st().events.a), range(301 - H.FIRST_PAGE, 300)));
  // A live event lands on the socket first — 303, with 301 and 302 not yet here.
  frame(daemon.a[302]);
  open(); gate = null;
  await opening;
  check('warm: the computer is asked from the last event of the copy, not from the start and not from the live one',
    asked.length === 1 && asked[0].since_seq === 300 && asked[0].limit === undefined, JSON.stringify(asked));
  check('warm: what was written while the phone was away is there, with no hole',
    same(seqs(st().events.a), range(301 - H.FIRST_PAGE, 303)), JSON.stringify(seqs(st().events.a).slice(-6)));
  check('warm: it still knows there is history above', st().truncated.a === true);
  await st().openChat('a');
  check('warm: once caught up, the next ask is from the newest', asked.at(-1).since_seq === 303);

  // c. No connection: the copy is drawn, and nobody is asked.
  await relaunch();
  offline = true;
  await st().peekChat('a');
  check('offline: the chat is drawn from the copy', st().loadedChats.a === true && st().events.a.at(-1).seq === 303);
  check('offline: without asking the computer anything', asked.length === 0);
  await st().openChat('a').then(() => check('offline: an open that cannot reach the computer says so', false),
    () => check('offline: an open that cannot reach the computer says so', true));
  check('offline: …and leaves the copy on screen', st().loadedChats.a === true && st().events.a.at(-1).seq === 303);
  offline = false;
  daemon.a.push(ev('a', 304));
  await st().openChat('a');
  check('offline: back online, asked from where the copy ended', asked.at(-1).since_seq === 303 && st().events.a.at(-1).seq === 304);

  // d. A copy pages behind is not walked through: the chat opens on its tail.
  await relaunch();
  const far = 304 + PAGE * (H.CATCH_UP_PAGES + 2);
  for (let n = 305; n <= far; n++) daemon.a.push(ev('a', n));
  await st().openChat('a');
  const forward = asked.filter((q) => q.since_seq).length;
  check('behind: at most a few pages are walked', forward === H.CATCH_UP_PAGES, `${forward}`);
  check('behind: then the tail is asked for', asked.at(-1).limit === H.FIRST_PAGE && !asked.at(-1).since_seq);
  check('behind: what is on screen is the tail alone, with no gap inside it',
    same(seqs(st().events.a), range(far - H.FIRST_PAGE + 1, far)), `${st().events.a.length} events from ${st().events.a[0].seq}`);
  check('behind: and there is history above it', st().truncated.a === true);

  // e. Scrolling up.
  await relaunch();
  daemon.b = range(1001, 1001 + H.FIRST_PAGE + H.BACK_PAGE + 49).map((n) => ev('b', n));
  const lastB = daemon.b.at(-1).seq;
  await st().openChat('b');
  asked.length = 0;
  await st().loadEarlier('b');
  check('earlier: the page above what is held is asked for',
    asked.length === 1 && asked[0].before_seq === lastB - H.FIRST_PAGE + 1 && asked[0].limit === H.BACK_PAGE, JSON.stringify(asked));
  check('earlier: it goes on top, in order, with no gap',
    same(seqs(st().events.b), range(lastB - H.FIRST_PAGE - H.BACK_PAGE + 1, lastB)));
  check('earlier: there is still more above', st().truncated.b === true);
  await st().loadEarlier('b');
  check('earlier: the last page reaches the first message', st().events.b[0].seq === 1001 && st().events.b.length === daemon.b.length);
  check('earlier: and that is the top', st().truncated.b === false);
  asked.length = 0;
  await st().loadEarlier('b');
  check('earlier: at the top nothing more is asked', asked.length === 0);
  await history.flush();
  check('earlier: the longer history is what is kept', H.parse(disk.get(H.keyOf('h1', 'b')), 'b').events.length === Math.min(H.KEEP, daemon.b.length));
  // The whole chat is in the copy now: the next launch has nothing above to ask for.
  await relaunch();
  await st().openChat('b');
  check('earlier: a chat kept whole opens knowing it is whole', st().truncated.b === false && st().events.b.length === daemon.b.length);
  // The list reaching its top fires more than once: one request.
  daemon.e = range(8001, 8600).map((n) => ev('e', n));
  await st().openChat('e');
  asked.length = 0;
  await Promise.all([st().loadEarlier('e'), st().loadEarlier('e')]);
  check('earlier: asked for twice at once is asked once', asked.filter((q) => q.before_seq).length === 1, JSON.stringify(asked));
  check('earlier: …and the page is on top once', same(seqs(st().events.e), range(8600 - H.FIRST_PAGE - H.BACK_PAGE + 1, 8600)));

  // …on a computer that has never heard of before_seq.
  await relaunch();
  oldDaemon = true;
  daemon.o = range(5001, 5001 + 899).map((n) => ev('o', n));
  await st().openChat('o');
  asked.length = 0;
  await st().loadEarlier('o');
  check('old computer: asked for a longer tail instead', asked.length === 2 && asked[1].limit === H.LEGACY_TAIL && !asked[1].before_seq,
    JSON.stringify(asked));
  check('old computer: the tail it gave is on screen, in order, once each',
    same(seqs(st().events.o), range(5900 - H.LEGACY_TAIL + 1, 5900)));
  check('old computer: and the phone stops asking', st().truncated.o === false);
  oldDaemon = false;

  // f. A chat the computer no longer has takes its copy with it.
  await relaunch();
  check('gone: there was a copy', disk.has(H.keyOf('h1', 'b')));
  delete daemon.b;
  await st().openChat('b').catch(() => {});
  await new Promise((r) => setImmediate(r));
  check('gone: the chat is not left on screen', !st().loadedChats.b && !st().events.b);
  check('gone: and its copy is deleted', !disk.has(H.keyOf('h1', 'b')));

  // g. A copy that cannot be trusted is not used.
  await relaunch();
  disk.set(H.keyOf('h1', 'a'), disk.get(H.keyOf('h1', 'a')).slice(0, 200));
  await st().peekChat('a');
  check('broken copy: not drawn', !st().loadedChats.a);
  await st().openChat('a');
  check('broken copy: the chat opens from the computer instead', asked.at(-1).limit === H.FIRST_PAGE && st().events.a.length === H.FIRST_PAGE);

  // A copy of one computer's chat is not another computer's.
  await history.flush();
  useStore.setState({ activeHostId: 'h2', events: {}, loadedChats: {}, truncated: {} });
  await st().peekChat('a');
  check("another computer: one computer's copy is not drawn for another", !st().loadedChats.a);
}

// ── 3. the chat list ─────────────────────────────────────────────────────
async function list() {
  const row = (id, title) => ({ id, title, status: 'idle', updated_at: 1 });
  check('list: read back as written', (() => {
    const l = H.parseList(JSON.stringify({ v: 1, chats: [row('x', 'X')], groups: [], people: null, at: 1 }));
    return !!l && l.chats[0].id === 'x' && same(l.agentMarks, {});
  })());
  check('list: a broken one is no list', H.parseList('{"v":1,"chats":[{}],"groups":[]}') === null
    && H.parseList('{"v":1,"chats":') === null && H.parseList(null) === null);

  // The real store, its socket's dialling taken out: what is left is what the
  // store does with a computer it has just been told to use.
  client.connect = () => {};
  client.disconnect = () => {};
  const hosts = [{ id: 'h1', host: 'one', port: 1, token: 't1', name: 'One' }, { id: 'h2', host: 'two', port: 2, token: 't2', name: 'Two' }];
  const lists = { h1: [row('p', 'Plan'), row('q', 'Quote')], h2: [row('z', 'Zed')] };
  let listGate = null;
  const call = client.call;
  client.call = async (type, data) => {
    if (type !== 'chat.list') return call(type, data);
    if (listGate) await listGate;
    return { chats: lists[st().activeHostId] ?? [], groups: [], people: { names: [], me: null } };
  };
  disk.clear();
  useStore.setState({ hosts, activeHostId: null, host: null, chats: {}, chatsLoaded: false, switching: false });
  await st().switchHost('h1');
  await st().refresh();
  await history.flush();
  check('list: the computer\'s answer is written to this phone', !!H.parseList(disk.get(H.listKeyOf('h1')))
    && same(H.parseList(disk.get(H.listKeyOf('h1'))).chats.map((c) => c.id).sort(), ['p', 'q']));

  // An event changes a row: the copy follows.
  frame({ event: 'chat.updated', data: { ...row('p', 'Plan, renamed') } });
  await history.flush();
  check('list: a row changed by an event is changed in the copy',
    H.parseList(disk.get(H.listKeyOf('h1'))).chats.find((c) => c.id === 'p').title === 'Plan, renamed');

  // To the second computer and back: its list is on screen from disk before
  // the computer has answered, and not dimmed while it waits.
  await st().switchHost('h2');
  await st().refresh();
  await history.flush();
  let open; listGate = new Promise((r) => { open = r; });
  const keptList = disk.get(H.listKeyOf('h1'));
  const writesBefore = history.writes;
  await st().switchHost('h1');
  await new Promise((r) => setImmediate(r));
  check('list: back on the first computer its chats are drawn before it answers',
    same(Object.keys(st().chats).sort(), ['p', 'q']) && st().chatsLoaded === false, JSON.stringify(Object.keys(st().chats)));
  check('list: …and not left dimmed behind the outgoing computer\'s', st().switching === false);
  frame({ event: 'chat.updated', data: { ...row('q', 'Quote, touched while only the copy is up') } });
  await history.flush();
  check('list: nothing is written back while only the copy is on screen',
    disk.get(H.listKeyOf('h1')) === keptList && history.writes === writesBefore, `${history.writes} writes, was ${writesBefore}`);
  lists.h1 = [row('p', 'Plan, renamed'), row('r', 'Reply')];
  const refreshed = st().refresh();
  open(); listGate = null;
  await refreshed;
  check('list: the computer\'s answer replaces the copy on screen',
    same(Object.keys(st().chats).sort(), ['p', 'r']) && st().chatsLoaded === true);

  // A computer that refuses this phone: its copy is not shown.
  await st().switchHost('h2');
  await new Promise((r) => setImmediate(r));
  check('list: the second computer\'s copy is drawn', same(Object.keys(st().chats), ['z']));
  client.setStatus('unauthorized');
  check('list: a computer that refuses this phone takes its list off the screen', Object.keys(st().chats).length === 0);

  // Unpaired: its copies go.
  client.setStatus('online');
  await st().removeHost('h2');
  await new Promise((r) => setImmediate(r));
  check('list: unpairing a computer deletes its list', !disk.has(H.listKeyOf('h2')) && disk.has(H.listKeyOf('h1')));
  client.call = call;
}

const ready = (async () => {
  rules();
  await writing();
  await store();
  await list();
})().catch((e) => check(`history: ran (${e?.stack || e})`, false));

module.exports = { checks, ready };
if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) { console.log((ok ? '  ok    ' : '  FAIL  ') + name); if (!ok) bad++; }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  });
}
