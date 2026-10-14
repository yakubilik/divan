/** The pen on the chat list (#176): one press opens a fresh chat, with no
 *  Dashboard and no sheet in between.
 *
 *  The list is stood up over the same fleet `test-handover-machine.cjs` uses,
 *  the pen is pressed, and the store calls it makes — which are the daemon
 *  requests — are read back with the route it pushes. The fresh chat is then
 *  opened, its first message typed and sent. A refused `chat.create` is pressed
 *  too: the list stays, the dialog says why, and both of its ways on work.
 *
 *  Run: node scripts/test-fresh-chat.cjs  (also folded into test-ustabasi.cjs.)
 */
const path = require('path');
const { R } = require('./render-chat.cjs');
const machine = require('./test-handover-machine.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const F = require(path.join(root, 'src/fresh-chat.ts'));
const overlay = require('../src/components/overlay');
const { useStore } = require('../src/store');
const current = () => useStore.getState();

const DEFAULTS = { provider: 'claude', model: 'sonnet', effort: 'high', perm_mode: 'default', cwd: '/r/quire',
  byProvider: { claude: { model: 'sonnet', effort: 'low', perm_mode: 'default', account_id: 'a2' } } };
const AGENTS = [{ id: 'hermes', name: 'hermes', label: 'Hermes', installed: true },
                { id: 'user:reviewer', name: 'reviewer', label: 'Reviewer', installed: true }];

let calls;
let dialogs;
/** The list over the fleet, with the computer answering `chat.create` the way
 *  the store does — the new chat put into `chats` — or refusing it. */
function stand({ refuse = false, defaults = DEFAULTS } = {}) {
  machine.stand({ defaults });
  R.nav.reset();
  calls = [];
  dialogs = [];
  const answer = { refuse };
  R.store.set({
    listAgents: async (...args) => { calls.push(['agent.list', args]); return AGENTS; },
    createChat: async (d) => {
      calls.push(['chat.create', d]);
      if (answer.refuse) throw Object.assign(new Error('No such folder: /r/quire'), { code: 'bad_cwd' });
      const chat = { ...current().chats.c2, id: 'n1', title: d.title ?? 'New chat', last_preview: '', ...d };
      R.store.set({ chats: { ...current().chats, n1: chat }, events: { ...current().events, n1: [] } });
      return chat;
    },
    send: async (id, text) => { calls.push(['chat.send', { id, text }]); },
  });
  return answer;
}
const list = () => R.render('dark', h(require(path.join(root, 'app/chat/index.tsx')).default, {}));
const pen = () => R.presses().filter((p) => p.label === 'New chat');
const made = () => calls.filter(([m]) => m === 'chat.create').map(([, d]) => d);

const checks = [];
const ready = (async () => {
  await machine.ready;
  R.words.real();
  const realAlert = overlay.alert;
  overlay.alert = (title, message, buttons) => dialogs.push({ title, message, buttons: buttons ?? [] });
  try {
    // 1 · one press: chat.create on the sheet's defaults, then that chat — and nothing else
    stand();
    list();
    const pens = pen();
    pens[0]?.press();
    await flush();
    const sent = made();
    checks.push([`new chat: the pen on the chat list sends one chat.create with the remembered folder, tool, model, effort, permission mode, sign-in and agent, and opens that chat without the Dashboard or a sheet — ${JSON.stringify({ sent, pushed: R.nav.pushed(), replaced: R.nav.replaced() })}`,
      pens.length === 1 && eq(sent, [{ provider: 'claude', model: 'sonnet', effort: 'low', perm_mode: 'default', cwd: '/r/quire',
        account_id: 'a2', agent_id: 'hermes', title: 'Hermes' }])
      && eq(calls.find(([m]) => m === 'agent.list')?.[1], ['a2', '/r/quire', 'claude'])
      && eq(R.nav.pushed(), ['/chat/n1']) && eq(R.nav.replaced(), []) && dialogs.length === 0]);

    // 2 · the fresh chat is empty, and the first message sent from it is its own
    const Conversation = require(path.join(root, 'app/chat/[id].tsx')).Conversation;
    const fresh = R.render('dark', h(Conversation, { id: 'n1' }));
    const empty = !fresh.includes('Students keep asking about refunds.') && !fresh.includes('Agreed. I put it in Ice Box.');
    // The harness draws markup and keeps no state between draws, so what typing
    // would have left in the composer is handed to its first `useState('')` —
    // the composer's text, the first hook of `Conversation` — for one draw. The
    // Send button only appears with text in the box, so finding it proves the
    // hand-over landed.
    const realUseState = R.React.useState;
    let typed = false;
    R.React.useState = (init) => {
      if (!typed && init === '') { typed = true; return [ 'first words', () => {} ]; }
      return realUseState(init);
    };
    try { R.render('dark', h(Conversation, { id: 'n1' })); } finally { R.React.useState = realUseState; }
    R.presses().find((p) => p.label === 'Send')?.press();
    await flush();
    const sends = calls.filter(([m]) => m === 'chat.send').map(([, d]) => d);
    checks.push([`new chat: the chat it opens shows none of the old conversation, and the first message typed there is sent to the new chat id — ${JSON.stringify(sends)}`,
      empty && eq(sends, [{ id: 'n1', text: 'first words' }])]);

    // 3 · refused: the list stays, the dialog says why, Try again and Choose settings both work
    const s = stand({ refuse: true });
    const before = list();
    pen()[0]?.press();
    await flush();
    const d = dialogs[0];
    const stayed = R.nav.pushed().length === 0 && R.nav.replaced().length === 0;
    const words = d && d.title === "Couldn't start" && d.message === 'No such folder: /r/quire'
      && eq(d.buttons.map((b) => b.text), ['Cancel', 'Choose settings', 'Try again']);
    d?.buttons.find((b) => b.text === 'Choose settings')?.onPress?.();
    await flush();
    const sheet = eq(R.nav.pushed(), ['/new-chat']);
    R.nav.reset();
    s.refuse = false;
    d?.buttons.find((b) => b.text === 'Try again')?.onPress?.();
    await flush();
    const retried = made().length === 2 && eq(R.nav.pushed(), ['/chat/n1']);
    checks.push([`new chat: a refused chat.create leaves the list where it was and says why, with Try again (which creates and opens it) and Choose settings (the New chat sheet) — ${JSON.stringify({ stayed, dialog: d && { title: d.title, message: d.message, buttons: d.buttons.map((b) => b.text) }, sheet, retried })}`,
      stayed && !!words && sheet && retried && before.includes('Refunds')]);

    // 4 · after that, a row still opens its own chat and a long press still opens the sheet
    R.nav.reset();
    list();
    R.presses().find((p) => p.text.startsWith('Safari login'))?.press();
    await flush();
    const row = eq(R.nav.pushed(), ['/chat/c2']);
    R.nav.reset();
    stand();
    list();
    R.holds().find((p) => p.label === 'New chat')?.hold();
    await flush();
    checks.push([`new chat: an existing chat still opens from its row, and holding the pen opens the New chat sheet without creating anything — ${JSON.stringify({ row, held: R.nav.pushed() })}`,
      row && eq(R.nav.pushed(), ['/new-chat']) && made().length === 0]);

    // 5 · the sheet's own rules for what is not on the screen: an explicit
    //     "No agent" stays none, and a sign-in that is gone is the computer's own
    const none = { ...DEFAULTS, lastAgent: null };
    const gone = { ...DEFAULTS, byProvider: { claude: { ...DEFAULTS.byProvider.claude, account_id: 'gone' } } };
    const accounts = current().accounts;
    stand({ defaults: none });
    list();
    pen()[0]?.press();
    await flush();
    checks.push(['new chat: after an explicit "No agent" the pen opens a chat with no agent and does not ask for the list; a remembered sign-in that is gone falls back to the computer\'s own; a remembered agent wins over Hermes',
      !calls.some(([m]) => m === 'agent.list') && made().length === 1 && !('agent_id' in made()[0])
      && F.freshAccount(gone, accounts) === '' && F.freshAccount(DEFAULTS, accounts) === 'a2'
      && F.freshAgent({ ...DEFAULTS, lastAgent: 'reviewer' }, AGENTS)?.id === 'user:reviewer'
      && F.freshAgent(DEFAULTS, AGENTS)?.id === 'hermes']);
  } finally {
    overlay.alert = realAlert;
    R.words.keys();
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
