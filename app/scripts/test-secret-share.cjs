/** A key an agent shares is a chip that copies it, for an hour, and is never
 *  shown (`src/secret-share.ts`, `src/components/secret-chip.tsx`,
 *  `daemon/divan/secret_share.py`).
 *
 *  The chat's real Markdown path, as in `test-diagram.cjs`; the daemon is a
 *  recorder of `client.call`, the clipboard a variable, and both clocks ours.
 *
 *   · `[secret-share rac-secret-… label]` in an answer → one chip, `🔑 label`,
 *     and no trace of the token or the service in the words on screen;
 *   · a tap asks `secret.copy` with the chat and the item, puts the answer on
 *     the clipboard, says so — and a minute later the clipboard is empty again,
 *     unless something else was copied over it;
 *   · an hour after the message the chip is grey and cannot be tapped, on time
 *     with nobody touching it; a daemon that says expired turns it grey too;
 *   · without a chat (a ticket report) it is a plain `🔒 label`;
 *   · every other link is still the library's link.
 *
 *  Run: node scripts/test-secret-share.cjs
 */
const Module = require('module');
const fs = require('fs');
const path = require('path');
const { transform } = require('sucrase');
const { R } = require('./render-chat.cjs');

const root = path.join(__dirname, '..');
const React = R.React;
const h = React.createElement;
const { act } = React;

const MD_SRC = path.join(path.dirname(require.resolve('react-native-markdown-display/package.json')), 'src');
const plainJs = require.extensions['.js'];
require.extensions['.js'] = (mod, filename) => {
  if (!filename.startsWith(MD_SRC)) return plainJs(mod, filename);
  const code = transform(fs.readFileSync(filename, 'utf8'),
    { transforms: ['jsx', 'imports'], jsxRuntime: 'classic', filePath: filename }).code;
  mod._compile(code, filename);
};
const realMd = {};
for (const [req, file] of [
  ['react-native-markdown-display', 'index.js'],
  ['react-native-markdown-display/src/lib/util/cleanupTokens', 'lib/util/cleanupTokens.js'],
  ['react-native-markdown-display/src/lib/util/groupTextTokens', 'lib/util/groupTextTokens.js'],
  ['react-native-markdown-display/src/lib/util/omitListItemParagraph', 'lib/util/omitListItemParagraph.js'],
]) realMd[req] = path.join(MD_SRC, file);

// ── the clipboard and the buzz ─────────────────────────────────────────────
let clipboard = '';
const buzzes = [];
const beneath = Module._load;
Module._load = function load(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(realMd, request)) return beneath.call(this, realMd[request], parent, isMain);
  if (request === 'react-native-webview') return { WebView: () => null };
  if (request === 'expo-clipboard') {
    return {
      setStringAsync: (s) => { clipboard = s; return Promise.resolve(true); },
      getStringAsync: () => Promise.resolve(clipboard),
    };
  }
  if (request === 'expo-haptics') {
    return {
      ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
      NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
      impactAsync: () => Promise.resolve(), selectionAsync: () => Promise.resolve(),
      notificationAsync: (k) => { buzzes.push(k); return Promise.resolve(); },
    };
  }
  return beneath.call(this, request, parent, isMain);
};
const RN = require('react-native');
RN.Image = RN.Image || RN.View;
RN.TouchableWithoutFeedback = RN.TouchableWithoutFeedback || RN.Pressable;
RN.Platform = RN.Platform || { OS: 'ios', select: (o) => o.ios ?? o.default };

// ── our clocks: timers, and the wall ───────────────────────────────────────
let now = 0;
let timers = [];
let nextTimer = 1;
const WALL0 = 1_800_000_000_000;
Date.now = () => WALL0 + now;
global.setTimeout = (fn, ms = 0) => { const id = nextTimer++; timers.push({ id, at: now + ms, fn }); return id; };
global.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
async function tick(ms) {
  const until = now + ms;
  for (;;) {
    const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    timers = timers.filter((t) => t !== due);
    now = due.at;
    await act(async () => { due.fn(); });
  }
  now = until;
}
const wallS = () => Date.now() / 1000;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const TR = require('react-test-renderer');
const { ForceScheme } = require(path.join(root, 'src/theme.ts'));
const WS = require(path.join(root, 'src/ws.ts'));
const S = require(path.join(root, 'src/secret-share.ts'));
const { AssistantText } = require(path.join(root, 'src/components/chat.tsx'));
const { SecretChip } = require(path.join(root, 'src/components/secret-chip.tsx'));

// ── the daemon ─────────────────────────────────────────────────────────────
const VALUE = 'sk-FAKE-do-not-show-0123';
let asked = [];
let answer = () => ({ value: VALUE, expires: wallS() + 3000 });
WS.client.call = async (type, data) => {
  asked.push([type, data]);
  return answer();
};

const checks = [];
const check = (name, ok, detail = '') => checks.push([name, !!ok, detail]);
function mount(el) {
  let r;
  act(() => { r = TR.create(h(ForceScheme, { scheme: 'light' }, el)); });
  return r;
}
const words = (r) => {
  const out = [];
  const walk = (n) => { if (typeof n === 'string') out.push(n); else if (n && n.children) n.children.forEach(walk); };
  walk(r.toJSON());
  return out.join(' ');
};
const chips = (r) => r.root.findAll((n) => n.type === SecretChip);
const pressable = (r) => r.root.findAll((n) => n.type !== SecretChip && typeof n.props?.onPress === 'function'
  && n.parent && n.parent.type === SecretChip);

const TOKEN = '[secret-share rac-secret-openai-prod OpenAI key]';
const TEXT = `Anahtar hazır: ${TOKEN}\n\nDokununca kopyalanır. Dokümanı da [buraya](https://example.com) koydum.`;

(async () => {
  // ── 1. drawn as a chip ───────────────────────────────────────────────────
  {
    const r = mount(h(AssistantText, { text: TEXT, chatId: 'chatA', sentAt: wallS() }));
    const cs = chips(r);
    const w = words(r);
    check('a share in an answer is one chip for that item, labelled with its name',
      cs.length === 1 && cs[0].props.share.service === 'rac-secret-openai-prod' && cs[0].props.share.chatId === 'chatA'
      && w.includes('🔑 OpenAI key'), `${cs.length} ${w}`);
    check('neither the token nor the keychain item is in the words on screen',
      !w.includes('secret-share') && !w.includes('rac-secret'), w);
    check('the chip runs out an hour after the message',
      cs.length === 1 && Math.abs(cs[0].props.share.until - (wallS() + 3600)) < 1);
    const links = r.root.findAll((n) => n.props && n.props.onPress && n.type !== SecretChip
      && !(n.parent && n.parent.type === SecretChip));
    check('an ordinary link in the same answer is still a link, not a chip',
      links.length >= 1 && w.includes('buraya'), `${links.length}`);

    // ── 2. a tap copies, says so, and the clipboard empties in a minute ─────
    asked = [];
    clipboard = 'eski';
    await act(async () => { await pressable(r)[0].props.onPress(); });
    check('a tap asks the daemon for this chat\'s item',
      asked.length === 1 && asked[0][0] === 'secret.copy'
      && JSON.stringify(asked[0][1]) === JSON.stringify({ chat_id: 'chatA', service: 'rac-secret-openai-prod' }),
      JSON.stringify(asked));
    check('the value goes on the clipboard and nowhere on screen',
      clipboard === VALUE && !words(r).includes(VALUE) && words(r).includes('secretCopied'), words(r));
    check('a success buzz', buzzes.includes('success'));
    await tick(2000);
    check('the chip says its name again after a moment', words(r).includes('🔑 OpenAI key'));
    await tick(58_500);
    check('a minute after the copy the clipboard is empty again', clipboard === '', JSON.stringify(clipboard));

    asked = [];
    await act(async () => { await pressable(r)[0].props.onPress(); });
    clipboard = 'something he copied after';
    await tick(61_000);
    check('…but not when something else was copied over it', clipboard === 'something he copied after');
    r.unmount();
  }

  // ── 3. an hour on, grey and inert, on time ────────────────────────────────
  {
    const r = mount(h(AssistantText, { text: TEXT, chatId: 'chatA', sentAt: wallS() - 3700 }));
    check('a share older than an hour is grey, says expired, and cannot be tapped',
      words(r).includes('🔒 OpenAI key · secretExpired') && pressable(r).length === 0, words(r));
    r.unmount();
  }
  {
    const r = mount(h(AssistantText, { text: TEXT, chatId: 'chatA', sentAt: wallS() - 3590 }));
    const before = pressable(r).length;
    await tick(15_000);
    check('with the chat open, the chip turns grey when the hour runs out',
      before === 1 && pressable(r).length === 0 && words(r).includes('secretExpired'), `${before} ${words(r)}`);
    r.unmount();
  }
  {
    answer = () => { const e = new Error('the share has expired'); e.code = 'secret_expired'; throw e; };
    const r = mount(h(AssistantText, { text: TEXT, chatId: 'chatA', sentAt: wallS() }));
    clipboard = 'kept';
    await act(async () => { await pressable(r)[0].props.onPress(); });
    await tick(2000);
    check('a daemon that refuses it as expired turns the chip grey, the clipboard untouched',
      words(r).includes('secretExpired') && pressable(r).length === 0 && clipboard === 'kept', words(r));
    r.unmount();
  }

  // ── 4. without a chat, a name ─────────────────────────────────────────────
  {
    const r = mount(h(AssistantText, { text: TEXT }));
    check('in a report (no chat) the share is a plain 🔒 name, no chip',
      chips(r).length === 0 && words(r).includes('🔒 OpenAI key') && !words(r).includes('rac-secret'), words(r));
    r.unmount();
  }

  // ── unit: the url round trip and odd input ────────────────────────────────
  {
    const s = { chatId: 'c1', service: 'rac-secret-a1', until: 1800003600, label: 'A & B / C?' };
    check('a share survives its own URL', JSON.stringify(S.parseShareUrl(S.shareUrl(s))) === JSON.stringify(s));
    check('other URLs are not shares',
      S.parseShareUrl('https://example.com') === null && S.parseShareUrl('divan-secret://share?c=x') === null);
    check('a share with no label is named by its item',
      S.shareMarkdown('[secret-share rac-secret-openai-prod]').includes('🔒 openai-prod'));
    check('the preamble\'s own example (capital NAME) is not a share',
      S.shareMarkdown('[secret-share rac-secret-NAME label]', 'c') === '[secret-share rac-secret-NAME label]');
  }

  let failed = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`);
    if (!ok) failed++;
  }
  console.log(`\n${checks.length - failed}/${checks.length} secret share checks passed`);
  process.exit(failed ? 1 : 0);
})();
