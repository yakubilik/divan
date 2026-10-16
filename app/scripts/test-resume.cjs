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
  if (type === 'chat.get') {
    asked.push(data.since_seq);
    const events = daemon.filter((e) => e.seq > data.since_seq);
    return { chat: { id: 'c1', title: 'c1' }, events, more: false, busy: false };
  }
  if (type === 'chat.list') return { chats: [], groups: [], people: { names: [], me: null } };
  return {};
};
const frame = (e) => client.handle(JSON.stringify({ type: 'event', ...e }));
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
