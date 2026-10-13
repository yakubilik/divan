/** A picture of New chat in the Chat place (#222): the empty composer the pen
 *  on the chat list opens, as the web's New chat there opens one.
 *
 *     node scripts/shot-chat-new.cjs <out.png> [dark|light]
 *
 *  Photographed the way `shot-chat-list.cjs` photographs the list. Not a
 *  check, and in no npm script. */
const os = require('os');
const path = require('path');
const { R } = require('./render-chat.cjs');
const machine = require('./test-handover-machine.cjs');
const { photograph } = require('./shot-dashboard.cjs');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'chat-new.png'));
const scheme = process.argv[3] === 'light' ? 'light' : 'dark';

(async () => {
  await machine.ready;
  R.words.real();
  machine.stand();
  const markup = R.render(scheme, R.React.createElement(require(path.join(root, 'app/chat/new.tsx')).default, {}));
  photograph(markup, scheme, out, 844);
  console.log(out);
})();
