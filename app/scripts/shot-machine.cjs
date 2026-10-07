/** Pictures of the phone's Machine tabs, the chat and a branch.
 *
 *     node scripts/shot-machine.cjs <out-dir> [dark|light]
 *
 *  Stood up off `test-handover-machine.cjs`'s own fixture, with the real words,
 *  and photographed the way `shot-dashboard.cjs` photographs the Dashboard. Not
 *  a check, and in no npm script. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('./test-handover-machine.cjs');
const { R } = require('./render-chat.cjs');
const { photograph } = require('./shot-dashboard.cjs');

const root = path.join(__dirname, '..');
const dir = path.resolve(process.argv[2] || os.tmpdir());
const scheme = process.argv[3] === 'light' ? 'light' : 'dark';
const suffix = scheme === 'light' ? '-light' : '';
const h = R.React.createElement;
const screen = (f, name = 'default') => require(path.join(root, f))[name];

T.ready.then(() => {
  R.words.real();
  fs.mkdirSync(dir, { recursive: true });
  const shoot = (name, element, params, height) => {
    T.stand({ params });
    console.log(photograph(R.render(scheme, element), scheme, path.join(dir, `${name}-phone${suffix}.png`), height));
  };
  shoot('machine', h(screen('app/machine.tsx')), {}, 2000);
  shoot('executors', h(screen('app/executors.tsx')), {}, 1500);
  shoot('terminal', h(screen('app/terminal.tsx')), {}, 1200);
  shoot('settings', h(screen('app/settings.tsx')), {}, 2400);
  shoot('chat', h(screen('app/chat/[id].tsx', 'Conversation'), { id: 'c1' }), {}, 1800);
  shoot('branch', h(screen('app/branch/[id].tsx')), { id: 'engineering', project: 'quire' }, 1800);
  process.exit(0);
});
