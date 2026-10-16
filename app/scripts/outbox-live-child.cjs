/** The phone, for the outbox checks (#292): the real store (`src/store.ts`)
 *  over the real socket client (`src/ws.ts`), on Node's own WebSocket, talking
 *  to a real daemon.
 *
 *  Its disk is a folder (OUTBOX_DIR): the keychain the store pairs into and the
 *  document directory the outbox is written to both live there, so a second
 *  child started on the same folder is the same phone after the app was killed.
 *
 *  Driven by its parent over IPC (test-outbox.cjs). Every state a message goes
 *  through is reported as it happens, so the parent can tell "sending, then
 *  sent" from "sending, failed, sending, sent".
 */
const Module = require('module');
const fs = require('fs');
const path = require('path');

const DIR = process.env.OUTBOX_DIR;
if (!DIR) throw new Error('OUTBOX_DIR is not set');
fs.mkdirSync(DIR, { recursive: true });

require('./render-chat.cjs');

/** The two native stores the outbox and the pairing reach for, on real disk. */
const keychain = path.join(DIR, 'keychain.json');
const readKeys = () => { try { return JSON.parse(fs.readFileSync(keychain, 'utf8')); } catch { return {}; } };
const SECURE = {
  getItemAsync: async (k) => readKeys()[k] ?? null,
  setItemAsync: async (k, v) => { const all = readKeys(); all[k] = v; fs.writeFileSync(keychain, JSON.stringify(all)); },
  deleteItemAsync: async (k) => { const all = readKeys(); delete all[k]; fs.writeFileSync(keychain, JSON.stringify(all)); },
};
class File {
  constructor(dir, name) { this.uri = path.join(dir, name); }
  get exists() { return fs.existsSync(this.uri); }
  create() { fs.writeFileSync(this.uri, ''); }
  write(s) { fs.writeFileSync(this.uri, s); }
  async text() { return fs.readFileSync(this.uri, 'utf8'); }
}
const FILES = { File, Paths: { document: DIR, cache: DIR, bundle: DIR } };
const beneath = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'expo-secure-store') return SECURE;
  if (request === 'expo-file-system') return FILES;
  return beneath.call(this, request, parent, isMain);
};

const root = path.join(__dirname, '..');
// render-chat.cjs has already loaded the store once, on its own stubs; this
// one is loaded again on the disk above (the old one's listeners are let go
// the way Fast Refresh lets them go).
delete require.cache[path.join(root, 'src/store.ts')];
const { useStore } = require(path.join(root, 'src/store.ts'));
const { client } = require(path.join(root, 'src/ws.ts'));
console.warn = () => {};

const say = (m) => { try { process.send(m); } catch {} };

// Every state each message has been in, in order, as the screen would see it.
const history = {};
let last = {};
useStore.subscribe((s) => {
  const now = {};
  for (const m of s.outbox) now[m.client_id] = m.state;
  for (const [id, st] of Object.entries(now)) {
    if (last[id] !== st) { (history[id] ??= []).push(st); say({ kind: 'out', id, state: st, t: Date.now() }); }
  }
  for (const id of Object.keys(last)) {
    if (!(id in now)) { (history[id] ??= []).push('gone'); say({ kind: 'out', id, state: 'gone', t: Date.now() }); }
  }
  last = now;
});
client.onLink((s) => say({ kind: 'link', s, t: Date.now() }));

process.on('message', async (m) => {
  const re = m.id;
  try {
    const st = useStore.getState();
    if (m.cmd === 'pair') {
      await st.addHost({ host: '127.0.0.1', port: m.port, token: m.token, name: 'Mac', device_id: 'mac' });
      say({ re });
    } else if (m.cmd === 'init') {
      await st.init();
      say({ re, outbox: useStore.getState().outbox });
    } else if (m.cmd === 'send') {
      const before = new Set(useStore.getState().outbox.map((x) => x.client_id));
      await st.send(m.chat, m.text);
      const mine = useStore.getState().outbox.find((x) => !before.has(x.client_id));
      say({ re, client_id: mine?.client_id ?? null });
    } else if (m.cmd === 'state') {
      const ob = client.__outbox;
      say({ re, outbox: useStore.getState().outbox, history, attempts: ob?.attempts ?? 0,
            conn: useStore.getState().conn, link: client.status,
            disk: fs.existsSync(path.join(DIR, 'outbox.json')) ? fs.readFileSync(path.join(DIR, 'outbox.json'), 'utf8') : null });
    } else if (m.cmd === 'transcript') {
      // The daemon's own record: every user message in the chat.
      const r = await client.call('chat.get', { chat_id: m.chat, since_seq: 0, limit: 2000 });
      say({ re, users: r.events.filter((e) => e.event === 'message.user').map((e) => e.data) });
    } else if (m.cmd === 'tick') {
      client.__outbox.tick();
      say({ re });
    }
  } catch (e) {
    say({ re, error: String(e?.stack || e) });
  }
});

say({ kind: 'ready' });
process.on('SIGTERM', () => { client.disconnect(); process.exit(0); });
