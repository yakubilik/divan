/** The pen on the chat list opens a fresh chat at once again (#266, undoing
 *  #222's empty composer page): no `/chat/new` in between, a second tap while
 *  the first `chat.create` is still out makes no second chat, and Back from the
 *  chat it opened is the list.
 *
 *  Stood up over the same fleet `test-fresh-chat.cjs` uses, with the computer
 *  holding its answer to `chat.create` until the test lets it go.
 *
 *  Run: node scripts/test-new-chat-pen.cjs
 */
const fs = require('fs');
const path = require('path');
const { R } = require('./render-chat.cjs');
const machine = require('./test-handover-machine.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const router = require('expo-router');
const { useStore } = require('../src/store');
const current = () => useStore.getState();

const DEFAULTS = { provider: 'claude', model: 'sonnet', effort: 'high', perm_mode: 'default', cwd: '/r/quire', lastAgent: null,
  byProvider: { claude: { model: 'sonnet', effort: 'low', perm_mode: 'default', account_id: '' } } };

let creates;
let answer;
function stand() {
  machine.stand({ defaults: DEFAULTS });
  R.nav.reset();
  creates = [];
  R.store.set({
    listAgents: async () => [],
    // The computer answers only when the test says so: the create is in flight until then.
    createChat: (d) => {
      creates.push(d);
      return new Promise((resolve) => {
        answer = () => {
          const chat = { ...current().chats.c2, id: 'n1', title: 'New chat', last_preview: '', ...d };
          R.store.set({ chats: { ...current().chats, n1: chat }, events: { ...current().events, n1: [] } });
          resolve(chat);
        };
      });
    },
  });
}
const list = () => R.render('dark', h(require(path.join(root, 'app/chat/index.tsx')).default, {}));

/** Every source file of the app, to look for a way to the old page. */
function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const checks = [];
const ready = (async () => {
  await machine.ready;
  R.words.real();
  const realUseRouter = router.useRouter;
  try {
    // 1 · two taps, one create: the second lands while the first is in flight
    stand();
    list();
    const pen = R.presses().find((p) => p.label === 'New chat');
    pen?.press();
    pen?.press();
    await flush();
    const whileOut = { creates: creates.length, pushed: R.nav.pushed() };
    answer?.();
    await flush();
    checks.push([`new chat pen: a second tap while chat.create is in flight sends nothing more, and the one chat opens at once — ${JSON.stringify({ whileOut, pushed: R.nav.pushed(), replaced: R.nav.replaced() })}`,
      whileOut.creates === 1 && eq(whileOut.pushed, []) && creates.length === 1
      && eq(R.nav.pushed(), ['/chat/n1']) && eq(R.nav.replaced(), [])]);

    // 2 · Back from that chat is the list: the chat was pushed over the list,
    //     so Back pops it; with nothing under it, Back is the list all the same
    const went = [];
    const stack = ['/chat', ...R.nav.pushed()];
    router.useRouter = () => ({ ...realUseRouter(),
      canGoBack: () => stack.length > 1,
      back: () => { stack.pop(); went.push(stack[stack.length - 1]); },
      replace: (to) => { stack.splice(0, stack.length, to); went.push(to); } });
    const Conversation = require(path.join(root, 'app/chat/[id].tsx')).Conversation;
    R.render('dark', h(Conversation, { id: 'n1' }));
    R.presses().find((p) => p.label === 'Back')?.press();
    await flush();
    checks.push([`new chat pen: Back from the chat it opened returns to the chat list — ${JSON.stringify(went)}`,
      eq(went, ['/chat'])]);
    router.useRouter = realUseRouter;

    // 3 · the empty composer page is gone, and nothing navigates to it
    const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
    const toIt = sources(path.join(root, 'app')).concat(sources(path.join(root, 'src')))
      .filter((f) => /['"`]\/chat\/new['"`]/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f));
    checks.push([`new chat pen: app/chat/new.tsx and its Stack.Screen are gone, and no file routes to /chat/new (${JSON.stringify(toIt)})`,
      !fs.existsSync(path.join(root, 'app/chat/new.tsx')) && !/name="chat\/new"/.test(layout) && toIt.length === 0]);
  } finally {
    router.useRouter = realUseRouter;
    R.store.reset();
    R.params.reset();
    R.nav.reset();
  }
})();

module.exports = { checks, ready };

if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) {
      console.log((ok ? '  ok    ' : '  FAIL  ') + name);
      if (!ok) bad++;
    }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  }, (e) => { console.error(e); process.exit(1); });
}
