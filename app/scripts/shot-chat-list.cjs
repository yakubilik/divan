/** A picture of the phone's chat list over the fixture `test-chat-list.cjs`
 *  checks against the web's sidebar: the person card, the web's headings in
 *  the web's order with their counts, + and ... .
 *
 *     node scripts/shot-chat-list.cjs <out.png> [dark|light]
 *
 *  Photographed the way `shot-dashboard.cjs` photographs the Dashboard (layout
 *  and type, icons not drawn). Not a check, and in no npm script. */
const os = require('os');
const path = require('path');
const { R } = require('./render-chat.cjs');
const machine = require('./test-handover-machine.cjs');
const { photograph } = require('./shot-dashboard.cjs');
const { STUDIO } = require('./test-chat-list.cjs');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'chat-list.png'));
const scheme = process.argv[3] === 'light' ? 'light' : 'dark';

(async () => {
  await machine.ready;
  R.words.real();
  const Chats = require(path.join(root, 'app/chat/index.tsx')).default;
  machine.stand();
  R.store.set({ chats: Object.fromEntries(STUDIO.chats.map((c) => [c.id, c])), groups: STUDIO.groups, people: STUDIO.people,
    prefs: { chatView: 'grouped', voiceIds: {} }, projects: [{ path: '/Users/y/r/quire', name: 'quire', is_git: true }] });
  const markup = R.render(scheme, R.React.createElement(Chats, {}));
  photograph(markup, scheme, out, 1500);
  console.log(out);
})();
