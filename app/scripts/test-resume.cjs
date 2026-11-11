/** A reconnect catches the open chat up from where it was when the socket
 *  went, not from the newest event in hand (#291).
 *
 *  The new socket delivers live events the moment it is up, before the open
 *  chat has asked for what it missed. Asking forward from the newest of those
 *  skipped everything written while there was no socket: the fault soak
 *  (scripts/soak-ws.cjs) lost the dozen events a restarting daemon wrote while
 *  it shut down, every round. The real store (`src/store.ts`) over the real
 *  socket client (`src/ws.ts`), whose requests are answered here.
 *
 *  Run: node scripts/test-resume.cjs
 */
const path = require('path');
require('./render-chat.cjs');

const root = path.join(__dirname, '..');
const { useStore } = require(path.join(root, 'src/store.ts'));
const { client } = require(path.join(root, 'src/ws.ts'));

const checks = [];
const ev = (seq, text) => ({ event: 'message.assistant', chat_id: 'c1', seq, data: { text }, ts: seq });
const daemon = Array.from({ length: 12 }, (_, i) => ev(i + 1, `m${i + 1}`));
const asked = [];
client.call = async (type, data) => {
  if (type === 'chat.get' && data.chat_id !== 'c1') {
    const t = turns[data.chat_id];
    return { chat: { id: data.chat_id, title: data.chat_id }, events: t.events.filter((e) => e.seq > data.since_seq),
             more: false, busy: t.busy };
  }
  if (type === 'chat.get') {
    asked.push(data.since_seq);
    const events = daemon.filter((e) => e.seq > data.since_seq);
    return { chat: { id: 'c1', title: 'c1' }, events, more: false, busy: false };
  }
  if (type === 'chat.list') return { chats: [], groups: [], people: { names: [], me: null } };
  return {};
};
const frame = (e) => client.handle(JSON.stringify({ type: 'event', ...e }));
// A turn whose end the phone never heard live (2026-11-07): iOS took the socket
// away after the first word had streamed, and the answer and `turn.done` came
// back through chat.get. The first word stayed under the finished answer as a
// live line ("Son ▌") until the next turn.
const said = (cid, seq, text) => ({ event: 'message.assistant', chat_id: cid, seq, data: { segment: 0, text }, ts: seq });
const turns = {
  c2: { busy: false, events: [said('c2', 1, 'earlier'), said('c2', 2, 'My last message came in.'),
                               { event: 'turn.done', chat_id: 'c2', seq: 3, data: {}, ts: 3 }] },
  c3: { busy: true, events: [said('c3', 1, 'earlier'), said('c3', 2, 'My last message came in.')] },
  // Still streaming its first segment: the last thing written is the prompt.
  c4: { busy: true, events: [said('c4', 1, 'earlier answer'),
                             { event: 'message.user', chat_id: 'c4', seq: 2, data: { text: 'next' }, ts: 2 }] },
};
const link = (s) => client.setStatus(s);       // what the socket's own open and close do

const ready = (async () => {
  link('online');
  await useStore.getState().openChat('c1');
  // The phone has 1..5; then the socket goes.
  useStore.setState({ events: { c1: daemon.slice(0, 5) } });
  link('offline');
  // 6..9 are written while there is no socket. A new one comes up and the
  // first thing on it is a live event, 10 — before the chat asks.
  link('connecting');
  link('online');
  frame(daemon[9]);
  const live = useStore.getState().events.c1.map((e) => e.seq);
  asked.length = 0;
  await useStore.getState().openChat('c1');
  const after = useStore.getState().events.c1.map((e) => e.seq);
  checks.push(['resume: a live event on the new socket lands before the chat catches up', live.at(-1) === 10]);
  checks.push(['resume: the chat is caught up from where it was when the socket went (5), not from 10', asked[0] === 5]);
  checks.push(['resume: …so nothing written while there was no socket is missing',
    JSON.stringify(after) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])]);
  asked.length = 0;
  await useStore.getState().openChat('c1');
  checks.push(['resume: once caught up, the next ask is from the newest again', asked[0] === 12]);

  for (const cid of ['c2', 'c3']) {
    const t = turns[cid];
    const full = t.events;
    t.events = full.slice(0, 1);
    await useStore.getState().openChat(cid);
    frame({ event: 'turn.started', chat_id: cid, data: {} });
    frame({ event: 'text.delta', chat_id: cid, data: { segment: 0, text: 'Son' } });
    frame({ event: 'turn.progress', chat_id: cid, data: {} });   // flushes the buffered word
    const streaming = useStore.getState().live[cid]?.text;
    link('offline');                                             // the rest goes down with the socket
    t.events = full;
    link('connecting');
    link('online');
    await useStore.getState().openChat(cid);
    const st = useStore.getState();
    checks.push([`resume (${cid}): the first word had streamed before the socket went`, streaming === 'Son']);
    checks.push([`resume (${cid}): an answer caught up through chat.get leaves no half-typed live line behind`, !st.live[cid]]);
    checks.push([`resume (${cid}): …and the chat is busy exactly when the computer says so`, st.busy[cid] === t.busy]);
  }
  {
    frame({ event: 'turn.started', chat_id: 'c4', data: {} });
    frame({ event: 'text.delta', chat_id: 'c4', data: { segment: 0, text: 'Writing' } });
    frame({ event: 'turn.progress', chat_id: 'c4', data: {} });
    await useStore.getState().openChat('c4');
    checks.push(['resume (c4): a segment still streaming is not cleared because an older answer had the same number',
      useStore.getState().live.c4?.text === 'Writing']);
  }
})().catch((e) => checks.push([`resume: ran (${e?.stack || e})`, false]));

module.exports = { checks, ready };
if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) { console.log((ok ? '  ok    ' : '  FAIL  ') + name); if (!ok) bad++; }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  });
}
