/** A message sent from the phone is never lost, and never run twice (#292).
 *
 *    1. The outbox's rules (`src/outbox.ts`), on a clock and a request of the
 *       test's own: a send with no connection waits as "sending", goes when the
 *       socket comes back, in order, and only a real refusal or two minutes
 *       with no connection at all gives up on it.
 *    2. The chat screen draws a waiting message as "Sending…", a given-up one
 *       as "Not sent · Tap to retry", and one the timeline already has once.
 *    3. Against a real daemon (soak_peer.py) behind a proxy that can cut it off,
 *       with the real store over the real socket client in a process of its
 *       own (outbox-live-child.cjs):
 *         a. sent while the computer is unreachable → waits in the outbox, on
 *            disk → the computer comes back → delivered exactly once, the
 *            bubble going sending → sent with no failure in between;
 *         b. the socket dies after the daemon accepted chat.send and before
 *            the answer → the phone resends after reconnecting → the daemon
 *            answers from the id → one user message in the transcript;
 *         c. the app is killed with a message waiting → a new app on the same
 *            disk → it reconnects and delivers it, once;
 *         d. a chat the computer no longer has → "not sent" at once.
 *
 *  Part 3 needs the daemon's Python (PY, else daemon/.venv, else
 *  ~/projects/divan/daemon/.venv312); without one it says SKIP, and
 *  `--require-daemon` makes that a failure.
 *
 *  Run: node scripts/test-outbox.cjs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { transform } = require('sucrase');

const root = path.join(__dirname, '..');
if (!require.extensions['.ts']) {
  require.extensions['.ts'] = (mod, filename) => mod._compile(transform(fs.readFileSync(filename, 'utf8'),
    { transforms: ['typescript', 'imports'], filePath: filename }).code, filename);
}

const checks = [];
const check = (name, ok, detail = '') => checks.push([name + (ok || !detail ? '' : `  — ${detail}`), !!ok]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };

// ── 1 · the rules ──────────────────────────────────────────────────────────
async function rules() {
  const { Outbox, GIVE_UP_MS, retryable, delivered } = require(path.join(root, 'src/outbox.ts'));
  const offline = () => Object.assign(new Error('not connected'), { code: 'offline' });
  function rig(o = {}) {
    let now = o.now ?? 1_000_000;
    let online = o.online ?? false;
    const disk = { text: o.disk ?? null };
    const calls = [];
    let answer = o.answer ?? (async () => { throw offline(); });
    const ob = new Outbox({
      call: (type, data) => { calls.push({ type, ...data }); return answer(data); },
      storage: { read: async () => disk.text, write: async (t) => { disk.text = t; } },
      host: () => 'h1', online: () => online, onChange: () => {}, now: () => now,
    });
    return { ob, calls, disk,
      setAnswer: (f) => { answer = f; }, setOnline: (v) => { online = v; }, at: (t) => { now = t; }, get now() { return now; } };
  }
  const ack = async (d) => ({ accepted: true, queued: false, client_id: d.client_id });

  {
    const r = rig();
    r.ob.link(false);
    const m = await r.ob.add('h1', 'c1', 'hello');
    await settle();
    const saved = JSON.parse(r.disk.text || '[]');
    check('rules: a message sent with no connection is on disk before anything else', saved.length === 1 && saved[0].client_id === m.client_id);
    check('rules: …and is "sending", not failed, when the send cannot get through', r.ob.items[0].state === 'sending', r.ob.items[0].state);
    check('rules: chat.send carries the client id', r.calls[0]?.type === 'chat.send' && r.calls[0].client_id === m.client_id && /^m-/.test(m.client_id));
    r.setAnswer(ack); r.setOnline(true);
    r.ob.link(true);
    await settle();
    check('rules: the socket coming back sends it, once', r.calls.length === 2 && r.ob.items[0]?.state === 'sent', JSON.stringify(r.ob.items));
    check('rules: an acknowledged message is off the disk', JSON.parse(r.disk.text).length === 0, r.disk.text);
    r.ob.seen([m.client_id]);
    check("rules: …and off the screen once the timeline's copy arrives", r.ob.items.length === 0);
    r.ob.link(true);
    await settle();
    check('rules: nothing is sent again after that', r.calls.length === 2);
    r.ob.stop();
  }
  {
    // The daemon writes the message into the timeline before it answers.
    let ob;
    const r = rig({ online: true, answer: async (d) => { ob.seen([d.client_id]); return ack(d); } });
    ob = r.ob;
    await r.ob.add('h1', 'c1', 'copy first, answer second');
    await settle();
    check("rules: the timeline's copy arriving before the answer leaves nothing behind", r.ob.items.length === 0, JSON.stringify(r.ob.items));
    r.ob.stop();
  }
  {
    const r = rig({ online: true, answer: async () => ({ accepted: true, queued: false }) });
    await r.ob.add('h1', 'c1', 'to an old daemon');
    await settle();
    check('rules: a daemon that does not name the message back (older) takes the bubble away at once', r.ob.items.length === 0);
    r.ob.stop();
  }
  {
    const r = rig({ online: true, answer: async () => { throw Object.assign(new Error('no such chat'), { code: 'no_chat' }); } });
    await r.ob.add('h1', 'gone', 'into a deleted chat');
    await settle();
    check('rules: a real refusal (the chat was deleted) is "failed", with the reason',
      r.ob.items[0]?.state === 'failed' && r.ob.items[0].error === 'no such chat', JSON.stringify(r.ob.items));
    r.ob.link(true);
    await settle();
    check('rules: …and is not resent on its own', r.calls.length === 1);
    check('rules: …but is kept on disk, failed', JSON.parse(r.disk.text)[0]?.state === 'failed');
    r.setAnswer(ack);
    await r.ob.retry(r.ob.items[0].client_id);
    await settle();
    check('rules: tapping it sends it again', r.calls.length === 2 && r.ob.items[0]?.state === 'sent');
    r.ob.stop();
  }
  {
    const r = rig();
    const t0 = r.now;
    r.ob.link(false);
    await r.ob.add('h1', 'c1', 'patience');
    await settle();
    r.at(t0 + GIVE_UP_MS - 1000); r.ob.tick();
    check('rules: just under two minutes with no connection it is still "sending"', r.ob.items[0].state === 'sending');
    r.at(t0 + GIVE_UP_MS + 1000); r.ob.tick();
    await settle();
    check('rules: past two minutes with no connection it is "not sent"', r.ob.items[0].state === 'failed');
    r.ob.stop();
  }
  {
    // An hour in the background: the message is old, the outage is new.
    const r = rig();
    const t0 = r.now;
    await r.ob.add('h1', 'c1', 'from before the nap');
    await settle();
    r.at(t0 + 3_600_000);
    r.ob.link(false);
    r.at(t0 + 3_600_000 + 5000); r.ob.tick();
    check('rules: an app back from an hour asleep is given its reconnect before anything is called failed', r.ob.items[0].state === 'sending');
    r.ob.stop();
  }
  {
    const order = [];
    let release;
    const r = rig({ online: true, answer: (d) => { order.push(d.text); return d.text === 'one' ? new Promise((res) => { release = () => res({ accepted: true, client_id: d.client_id }); }) : ack(d); } });
    await r.ob.add('h1', 'c1', 'one');
    await r.ob.add('h1', 'c1', 'two');
    await settle();
    check('rules: the second message waits for the first', order.join() === 'one');
    release();
    await settle();
    check('rules: …and goes after it', order.join() === 'one,two' && r.ob.items.every((m) => m.state === 'sent'));
    r.ob.stop();
  }
  {
    const r = rig({ online: true, answer: async () => { throw offline(); } });
    await r.ob.add('h1', 'c1', 'for the other computer');
    r.ob.items = r.ob.items.map((m) => ({ ...m, host: 'h2' }));
    r.setAnswer(ack);
    r.ob.link(true);
    await settle();
    check('rules: a message for another computer is not sent to this one', r.ob.items[0].state === 'sending' && r.calls.length === 1);
    r.ob.stop();
  }
  {
    const saved = JSON.stringify([{ client_id: 'm-old', host: 'h1', chat_id: 'c1', text: 'from last time', attachments: [], at: 1, state: 'sending' }]);
    const r = rig({ disk: saved, online: true, answer: ack });
    await r.ob.load();
    check('rules: a message the last run left waiting is back after a restart', r.ob.items[0]?.client_id === 'm-old');
    r.ob.link(true);
    await settle();
    check('rules: …and sent under its own id', r.calls[0]?.client_id === 'm-old' && r.ob.items[0].state === 'sent');
    r.ob.stop();
  }
  check('rules: a computer restarting is only "in a moment"', retryable({ code: 'restarting' }) && retryable({ code: 'offline' }) && !retryable({ code: 'no_chat' }));
  check('rules: the timeline names what it already has', delivered([{ event: 'message.user', data: { client_id: 'a' } }, { event: 'message.user', data: {} }]).has('a'));
}

// ── 2 · the bubble ─────────────────────────────────────────────────────────
async function bubble() {
  const { R } = require('./render-chat.cjs');
  const h = R.React.createElement;
  const Conversation = require(path.join(root, 'app/chat/[id].tsx')).Conversation;
  const NOW = Math.floor(Date.now() / 1000);
  const chat = { id: 'c1', group_id: null, title: 'Refunds', provider: 'claude', model: 'opus', effort: 'high',
    perm_mode: 'default', cwd: '/r', provider_session_id: 's', account_id: null, status: 'idle', last_preview: '',
    max_turns: null, max_budget_usd: null, total_cost_usd: 0, pinned: 0, archived: 0, created_at: NOW, updated_at: NOW, project_id: null };
  const out = (id, state, text) => ({ client_id: id, host: 'h1', chat_id: 'c1', text, attachments: [], at: 0, state, error: state === 'failed' ? 'no such chat' : null });
  const stand = (outbox, events = []) => {
    R.store.reset();
    R.store.set({
      hosts: [{ id: 'h1', name: 'studio', host: '127.0.0.1', port: 8790 }], activeHostId: 'h1', host: { id: 'h1', name: 'studio' },
      conn: 'offline', linkGen: 0, chats: { c1: chat }, events: { c1: events }, live: {}, thinking: {}, progress: {}, busy: {},
      loadedChats: { c1: true }, catalog: null, groups: [], accounts: [], accountsLoaded: true, hostInfo: null, limits: {},
      divan: {}, agentActivity: {}, prefs: { chatView: 'flat', voiceIds: {} }, outbox,
      openChat: async () => {}, send: async () => {}, retrySend: async () => {}, discardSend: async () => null,
      interrupt: async () => {}, respond: async () => {}, uploadAttachment: async () => null, updateChat: async () => {},
      deleteChat: async () => {}, createGroup: async () => ({ id: 'g' }), settleLive() {}, loadAccounts: async () => {},
      loadDivan() {},
    });
  };
  R.words.real();
  stand([out('m-1', 'sending', 'typed with no connection')]);
  let page = R.render('light', h(Conversation, { id: 'c1' }));
  check('bubble: a waiting message is drawn, with "Sending…"', page.includes('typed with no connection') && page.includes('Sending…'));
  check("bubble: …and no \"Couldn't send\" or \"Not sent\" anywhere", !page.includes("Couldn&#x27;t send") && !page.includes("Couldn't send") && !page.includes('Not sent'));
  stand([out('m-2', 'failed', 'into a deleted chat')]);
  page = R.render('light', h(Conversation, { id: 'c1' }));
  check('bubble: a given-up message says "Not sent · Tap to retry"', page.includes('Not sent · Tap to retry') && !page.includes('Sending…'));
  check('bubble: …and the words are something to tap', R.presses().some((p) => /Not sent/.test(p.text ?? '')));
  stand([out('m-3', 'sending', 'already there')],
        [{ event: 'message.user', chat_id: 'c1', seq: 1, ts: NOW, data: { text: 'already there', attachments: [], client_id: 'm-3' } }]);
  page = R.render('light', h(Conversation, { id: 'c1' }));
  check("bubble: a message the timeline already has is drawn once, as the timeline's",
    page.split('already there').length - 1 === 1 && !page.includes('Sending…'));
}

// ── 3 · against a real daemon ──────────────────────────────────────────────
async function live() {
  const kit = require('./ws-live-kit.cjs');
  const py = kit.python();
  if (!py) {
    console.log('  SKIP  live outbox checks: no daemon Python (set PY)');
    if (process.argv.includes('--require-daemon')) check('a daemon Python to run against', false);
    return;
  }
  const peer = await kit.peer(py, ['--tick-ms', '0', '--drop-ack']);
  const px = await kit.proxy(peer.port);
  const dirs = [];
  const phones = [];
  const newPhone = (dir) => { const p = kit.phone('outbox-live-child.cjs', { OUTBOX_DIR: dir }); phones.push(p); return p; };
  const until = async (pred, ms, what) => {
    const t0 = Date.now();
    for (;;) {
      const v = await pred();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`no ${what} in ${ms} ms`);
      await kit.wait(100);
    }
  };
  const users = async (p, id) => (await p.ask('transcript', { chat: peer.info.chat_id })).users.filter((u) => u.client_id === id);
  const states = (p, id) => p.heard.filter((m) => m.kind === 'out' && m.id === id).map((m) => m.state);
  try {
    const { token, chat_id: chat } = peer.info;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'divan-outbox-'));
    dirs.push(dir);
    const phone = newPhone(dir);
    await phone.ask('pair', { port: px.port, token });
    await until(async () => (await phone.ask('state')).link === 'online', 15000, 'connection');

    // ── a · sent while the computer is unreachable ────────────────────────
    px.block();
    await until(async () => (await phone.ask('state')).link !== 'online', 5000, 'lost connection');
    const a = await phone.ask('send', { chat, text: 'sent while the Mac was away' });
    await kit.wait(8000);                    // past ws.ts's six-second wait for a reconnect
    let st = await phone.ask('state');
    const waiting = st.outbox.find((m) => m.client_id === a.client_id);
    check('live a: sent with the computer unreachable, the message waits in the outbox as "sending"',
      waiting?.state === 'sending', JSON.stringify(st.outbox));
    check('live a: …written to the phone\'s disk', (st.disk ?? '').includes(a.client_id), st.disk);
    px.unblock();
    await until(async () => !(await phone.ask('state')).outbox.some((m) => m.client_id === a.client_id), 20000, 'delivery');
    const gotA = await users(phone, a.client_id);
    check('live a: the computer back, it is delivered exactly once', gotA.length === 1, JSON.stringify(gotA));
    // "sent" is the moment between the answer and the timeline's own copy, and
    // the copy usually arrives first: either way the waiting bubble gives way
    // to the delivered one, and nothing in between says it failed.
    const pathA = states(phone, a.client_id).join(' → ');
    check('live a: the bubble went sending → sent (the timeline\'s own bubble), never failed',
      pathA === 'sending → gone' || pathA === 'sending → sent → gone', pathA);

    // ── b · the answer is lost after the daemon accepted it ───────────────
    const mark = peer.log.length;
    const b = await phone.ask('send', { chat, text: 'the answer to this is lost [drop-ack]' });
    // Acknowledged: its live copy went down with the socket, so the bubble is
    // "sent" until the chat is next read (an open chat reads itself again on
    // every reconnect, which is what takes it out of the outbox).
    await until(async () => ['sent', undefined].includes((await phone.ask('state')).outbox.find((m) => m.client_id === b.client_id)?.state),
      20000, 'delivery');
    st = await phone.ask('state');
    const log = peer.log.slice(mark);
    const gotB = await users(phone, b.client_id);
    check('live b: the daemon accepted it and the socket died before the answer',
      log.some((l) => l.includes(`chat.send ${b.client_id} accepted; closing the socket`)), log.slice(-5).join(' | '));
    check('live b: the phone sent it again after reconnecting, and the daemon answered from the id',
      log.some((l) => l.includes(b.client_id) && /not run again/.test(l)), log.filter((l) => /chat\.send/.test(l)).join(' | '));
    check('live b: exactly one user message in the transcript', gotB.length === 1, JSON.stringify(gotB));
    check('live b: …and the bubble never said it failed', !states(phone, b.client_id).includes('failed'), states(phone, b.client_id).join(' → '));

    // ── c · the app is killed with a message waiting ──────────────────────
    px.block();
    await until(async () => (await phone.ask('state')).link !== 'online', 5000, 'lost connection');
    const c = await phone.ask('send', { chat, text: 'written just before the app was killed' });
    await until(async () => ((await phone.ask('state')).disk ?? '').includes(c.client_id), 5000, 'saved message');
    await phone.kill();
    const again = newPhone(dir);
    const back = await again.ask('init');
    check('live c: the new app finds the message where the old one left it',
      back.outbox.some((m) => m.client_id === c.client_id && m.state === 'sending'), JSON.stringify(back.outbox));
    px.unblock();
    await until(async () => !(await again.ask('state')).outbox.some((m) => m.client_id === c.client_id), 20000, 'delivery');
    const gotC = await users(again, c.client_id);
    check('live c: …reconnects and delivers it, once', gotC.length === 1, JSON.stringify(gotC));
    const disk = (await again.ask('state')).disk;
    check('live c: …and the disk no longer holds it', !(disk ?? '').includes(c.client_id), disk);

    // ── d · a chat the computer does not have ─────────────────────────────
    const d = await again.ask('send', { chat: 'no-such-chat', text: 'into nothing' });
    await until(async () => (await again.ask('state')).outbox.find((m) => m.client_id === d.client_id)?.state === 'failed', 10000, 'failure');
    check('live d: a chat that is not there makes it "not sent", without waiting', true);
  } catch (e) {
    // What each side last said, so a failure here can be read without a rerun.
    const last = phones.at(-1);
    const st = last ? await last.ask('state', {}, 5000).catch(() => null) : null;
    throw new Error(`${e?.message}\n    phone: ${JSON.stringify(st)?.slice(0, 1500)}`
      + `\n    heard: ${JSON.stringify(last?.heard.slice(-12))}\n    daemon: ${peer.log.slice(-15).join('\n      ')}`);
  } finally {
    for (const p of phones) await p.close().catch(() => {});
    await px.close();
    await peer.close();
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
}

const ready = (async () => {
  for (const [name, fn] of [['rules', rules], ['bubble', bubble], ['live', live]]) {
    try { await fn(); } catch (e) { check(`${name}: ran (${e?.stack || e})`, false); }
  }
})();

module.exports = { checks, ready };
if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) { console.log((ok ? '  ok    ' : '  FAIL  ') + name); if (!ok) bad++; }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  });
}
