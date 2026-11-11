/** A link shared to Divan from another app's share sheet (#333).
 *
 *    1. The link out of what was shared (`src/share.ts`): a bare URL, the
 *       words Instagram, X and YouTube send with a link inside them, and words
 *       with no link at all — which are turned away out loud and open nothing.
 *    2. The chat it opens: `chat.create` on what the pen would have opened
 *       (remembered tool, model, sign-in, the computer's default folder, Hermes
 *       by the sheet's agent rule — `src/fresh-chat.ts`), then the link as
 *       `chat.send`, the first message.
 *    3. A share that arrives before the app can act on it: on a cold start,
 *       with no computer paired, with the computer not answering. The link is
 *       held, the person is told (once, and only after a reconnect's grace),
 *       and the chat is opened the moment the app connects; a refused
 *       `chat.create` puts it back.
 *    4. The share extension the config plugin generates: target, activation
 *       rule, embedding, and that the Swift side builds the same deep link.
 *
 *  Run: node scripts/test-share.cjs
 */
const fs = require('fs');
const path = require('path');
const { transform } = require('sucrase');

const root = path.join(__dirname, '..');
if (!require.extensions['.ts']) {
  require.extensions['.ts'] = (mod, filename) => mod._compile(transform(fs.readFileSync(filename, 'utf8'),
    { transforms: ['typescript', 'imports'], filePath: filename }).code, filename);
}
const S = require(path.join(root, 'src/share.ts'));

const checks = [];
const check = (name, ok, detail = '') => checks.push([name + (ok || !detail ? '' : `  — ${detail}`), !!ok]);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1 · the link out of what was shared ────────────────────────────────────
const IG = 'https://www.instagram.com/reel/DPx3kQ1jA7b/?igsh=MWQ1ZGUxMzBkMA==';
const cases = [
  ['a bare URL', { url: 'https://www.instagram.com/p/C9abc123/' }, 'https://www.instagram.com/p/C9abc123/'],
  ['a bare URL handed over as text', { text: '  https://youtu.be/dQw4w9WgXcQ\n' }, 'https://youtu.be/dQw4w9WgXcQ'],
  ['Instagram share text with the link inside it', { text: `Check out this reel by @divan.app ${IG}` }, IG],
  ['an X post shared as words, with a link that ends a sentence',
    { text: 'Big news from the team. https://x.com/divan/status/1846612345678901234?s=46.' },
    'https://x.com/divan/status/1846612345678901234?s=46'],
  ['a link inside brackets keeps its own closing bracket only',
    { text: '(see https://en.wikipedia.org/wiki/Divan_(furniture)) for more' }, 'https://en.wikipedia.org/wiki/Divan_(furniture)'],
  ['the deep link query as expo-router hands it, an array', { url: ['https://www.youtube.com/watch?v=abc'] }, 'https://www.youtube.com/watch?v=abc'],
];
for (const [name, p, want] of cases) {
  const got = S.sharedLink(p);
  check(`link: ${name} → ${want}`, eq(got, { url: want }), JSON.stringify(got));
}
for (const [name, p] of [
  ['words with no link', { text: 'A lovely caption with no link at all' }],
  ['a link that is not the web', { text: 'mailto:yakup@example.com or ftp://files.example.com/x' }],
  ['a scheme with nothing after it', { text: 'https:// ' }],
  ['nothing', {}],
]) check(`link: ${name} is refused`, eq(S.sharedLink(p), { error: 'noLink' }), JSON.stringify(S.sharedLink(p)));

{
  // The deep link round trip: what the extension opens, read back the way the route reads it.
  const link = S.shareLink({ url: IG });
  const q = new URL(link).searchParams;
  check(`deep link: a URL goes to divan://share?url=…, encoded, and reads back whole — ${link}`,
    link.startsWith('divan://share?url=') && eq(S.sharedLink({ url: q.get('url') }), { url: IG }));
  const t = S.shareLink({ text: `Look ${IG}` });
  check('deep link: words go as ?text=… and the link is found in them',
    t.startsWith('divan://share?text=') && eq(S.sharedLink({ text: new URL(t).searchParams.get('text') }), { url: IG }));
}

// ── 2 + 3 · the chat it opens, and a share the app cannot act on yet ───────
const DEFAULTS = { provider: 'claude', model: 'sonnet', effort: 'high', perm_mode: 'default', cwd: '/r/DevTrace-main',
  byProvider: { claude: { model: 'sonnet', effort: 'low', perm_mode: 'default', account_id: 'a2' } } };
const AGENTS = [{ id: 'hermes', name: 'hermes', label: 'Hermes', installed: true },
                { id: 'user:reviewer', name: 'reviewer', label: 'Reviewer', installed: true }];
const HOST_INFO = { default_cwd: '/r/home', roots: ['/r'] };

function rig(o = {}) {
  let now = 1_000_000;
  const pen = new S.Shares(() => now);
  const calls = [];
  const said = [];
  const opened = [];
  const st = {
    ready: true, locked: false, paired: true, conn: 'online', hostInfo: HOST_INFO,
    defaults: o.defaults ?? DEFAULTS, accounts: null, catalog: null,
    listAgents: async (...args) => { calls.push(['agent.list', args]); return AGENTS; },
    createChat: async (d) => {
      calls.push(['chat.create', d]);
      if (st.refuse) throw new Error('No such folder: /r/home');
      return { id: `n${calls.filter(([m]) => m === 'chat.create').length}`, ...d };
    },
    send: async (id, text) => { calls.push(['chat.send', { id, text }]); },
    ...o.st,
  };
  const out = { opened: (c) => opened.push(c.id), say: (s) => said.push(s) };
  return { pen, calls, said, opened, st, out,
    deliver: () => S.deliver(pen, st, out),
    receive: (p) => S.receive(pen, p, (s) => said.push(s)),
    later: (ms) => { now += ms; },
    made: () => calls.filter(([m]) => m === 'chat.create').map(([, d]) => d),
    sent: () => calls.filter(([m]) => m === 'chat.send').map(([, d]) => d) };
}
const HERMES_CHAT = { provider: 'claude', model: 'sonnet', effort: 'low', perm_mode: 'default', cwd: '/r/home',
  account_id: 'a2', agent_id: 'hermes', title: 'Hermes' };

(async () => {
  {
    // Connected: one chat.create on the pen's choices with Hermes, then the link as the first message.
    const r = rig();
    r.receive({ text: `Check out this reel by @divan.app ${IG}` });
    const res = await r.deliver();
    check(`chat: a shared Instagram link opens one chat.create on the pen's defaults with agent_id hermes, then chat.send with the link, and opens that chat — ${JSON.stringify(r.calls)}`,
      res === 'opened' && eq(r.made(), [HERMES_CHAT]) && eq(r.sent(), [{ id: 'n1', text: IG }])
      && r.calls.map(([m]) => m).join() === 'agent.list,chat.create,chat.send' && eq(r.opened, ['n1']) && r.said.length === 0);
    const again = await r.deliver();
    check('chat: the link is spent once its chat is open — asking again opens nothing', again === 'none' && r.made().length === 1);
    r.receive({ text: `Check out this reel by @divan.app ${IG}` });
    check('chat: the same share reported twice in a moment (launch URL and event) opens one chat',
      (await r.deliver()) === 'none' && r.made().length === 1);
  }
  {
    // The agent rule is the pen's: after an explicit "No agent", no agent and no agent.list.
    const r = rig({ defaults: { ...DEFAULTS, lastAgent: null } });
    r.receive({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    await r.deliver();
    const d = r.made()[0] ?? {};
    check(`chat: the agent is the pen's rule, not a second one — after "No agent" none is asked for — ${JSON.stringify(r.calls)}`,
      d.agent_id === undefined && !r.calls.some(([m]) => m === 'agent.list') && eq(r.sent(), [{ id: 'n1', text: 'https://youtu.be/dQw4w9WgXcQ' }]));
    check('chat: the chat request names no account the remembered one does not, so the pool still picks (no second picker)',
      d.account_id === 'a2' && !('pool' in d));
  }
  {
    // No link: refused out loud, nothing created, a held link left alone.
    const r = rig();
    const got = r.receive({ text: 'A lovely caption with no link at all' });
    const res = await r.deliver();
    check(`no link: words without a link are refused with a visible message and open no chat — ${JSON.stringify({ got, said: r.said, calls: r.calls })}`,
      eq(got, { error: 'noLink' }) && eq(r.said, [{ kind: 'noLink' }]) && res === 'none' && r.calls.length === 0);
  }
  {
    // Not connected: held, told after the grace (not before), sent once the socket is up.
    const r = rig({ st: { conn: 'connecting', hostInfo: null } });
    r.receive({ url: IG });
    const first = await r.deliver();
    const quiet = r.said.length === 0;
    r.later(S.CONNECT_GRACE_MS);
    await r.deliver();
    const told = eq(r.said, [{ kind: 'connect' }]);
    r.later(10_000);
    await r.deliver();
    const once = r.said.length === 1;
    check(`offline: a link shared while the computer is not connected is held, opens nothing, and is said to be waiting once, after the reconnect grace — ${JSON.stringify({ first, said: r.said })}`,
      first === 'held' && quiet && told && once && r.calls.length === 0 && r.pen.held === IG);
    r.st.conn = 'online';
    r.st.hostInfo = HOST_INFO;
    const res = await r.deliver();
    check(`offline: once connected the held link opens its Hermes chat and is sent as the first message — ${JSON.stringify(r.calls)}`,
      res === 'opened' && eq(r.made(), [HERMES_CHAT]) && eq(r.sent(), [{ id: 'n1', text: IG }]) && r.pen.held === null);
  }
  {
    // Cold start: not ready / locked says nothing and keeps the link.
    const r = rig({ st: { ready: false } });
    r.receive({ url: IG });
    r.later(60_000);
    const a = await r.deliver();
    r.st.ready = true; r.st.locked = true;
    const b = await r.deliver();
    r.st.locked = false;
    const c = await r.deliver();
    check(`cold start: before the store is loaded and while Face ID is up the link waits in silence, then opens — ${JSON.stringify([a, b, c, r.said])}`,
      a === 'held' && b === 'held' && c === 'opened' && r.said.length === 0 && r.made().length === 1);
  }
  {
    // Never paired: told at once, kept, opened once a computer is paired and online.
    const r = rig({ st: { paired: false, conn: 'idle', hostInfo: null } });
    r.receive({ url: IG });
    await r.deliver();
    const told = eq(r.said, [{ kind: 'pair' }]);
    Object.assign(r.st, { paired: true, conn: 'online', hostInfo: HOST_INFO });
    const res = await r.deliver();
    check(`unpaired: a link shared to a phone with no computer says "pair first" at once, is kept, and opens after pairing — ${JSON.stringify(r.said)}`,
      told && res === 'opened' && eq(r.sent(), [{ id: 'n1', text: IG }]));
  }
  {
    // Refused chat.create: put back, the reason said, the next try opens it.
    const r = rig({ st: { refuse: true } });
    r.receive({ url: IG });
    const res = await r.deliver();
    const held = r.pen.held;
    r.st.refuse = false;
    const retry = await r.deliver();
    check(`refused: a chat.create the computer refuses keeps the link and says why; Try again opens it — ${JSON.stringify({ res, said: r.said, retry })}`,
      res === 'failed' && held === IG && eq(r.said, [{ kind: 'failed', message: 'No such folder: /r/home' }])
      && retry === 'opened' && eq(r.sent(), [{ id: 'n2', text: IG }]));
    r.receive({ url: 'https://x.com/a/status/1' });
    r.pen.discard();
    check('refused: Discard drops the link, on purpose', r.pen.held === null);
  }
  {
    // A newer share replaces the one still waiting; a share with no link leaves it alone.
    const r = rig({ st: { conn: 'offline' } });
    r.receive({ url: IG });
    r.receive({ url: 'https://x.com/a/status/2' });
    r.receive({ text: 'no link here' });
    check('pen: the newest link wins, and a share with no link does not cost the waiting one',
      r.pen.held === 'https://x.com/a/status/2');
  }

  // ── 4 · the extension the plugin generates ───────────────────────────────
  {
    const plugin = require(path.join(root, 'plugins/with-share-extension.js'));
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
    check('plugin: registered in app.json', app.plugins.includes('./plugins/with-share-extension.js'));
    const plist = plugin.infoPlist({ version: '1.0.0', buildNumber: '6' });
    const rule = plist.NSExtension.NSExtensionAttributes.NSExtensionActivationRule;
    check(`plugin: the extension is shown as "Divan", for a web URL or text — ${JSON.stringify(rule)}`,
      plist.CFBundleDisplayName === 'Divan' && plist.NSExtension.NSExtensionPointIdentifier === 'com.apple.share-services'
      && rule.NSExtensionActivationSupportsWebURLWithMaxCount === 1 && rule.NSExtensionActivationSupportsText === true);
    // LEGACY NAME BLOCK: begin — app.json's bundle id is an identity, kept under the old name
    check('plugin: the extension is a bundle id under the main app\'s, which is left alone',
      plugin.extensionBundleId('com.example.remoteaichat') === 'com.example.remoteaichat.share'
      && app.ios.bundleIdentifier === 'com.example.remoteaichat');
    // LEGACY NAME BLOCK: end
    const swift = fs.readFileSync(path.join(root, 'plugins/share-extension/ShareViewController.swift'), 'utf8');
    check('plugin: the Swift side reads public.url and public.plain-text and opens divan://share?url=… / ?text=…',
      swift.includes('UTType.url.identifier') && swift.includes('UTType.plainText.identifier')
      && swift.includes('"divan"') && swift.includes('"share"') && swift.includes('"url"') && swift.includes('"text"'));
  }

  let bad = 0;
  for (const [name, ok] of checks) { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) bad++; }
  console.log(`\n${checks.length - bad}/${checks.length} share checks passed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
