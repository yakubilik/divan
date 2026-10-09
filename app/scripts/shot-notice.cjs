/** Pictures of ticket notices in a phone chat (#159): collapsed, #157 tapped
 *  open, and collapsed again on a narrow (320 pt) screen.
 *
 *     node scripts/shot-notice.cjs <out-dir>
 *
 *  The chat screen is mounted live as in `test-notice.cjs`, tapped, and its
 *  tree photographed the way `shot-dashboard.cjs` photographs the Dashboard.
 *  Not a check, and in no npm script. */
const os = require('os');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const { R } = require('./render-chat.cjs');
const machine = require('./test-handover-machine.cjs');
const { photograph } = require('./shot-dashboard.cjs');

const root = path.join(__dirname, '..');
const web = path.join(root, '..', 'web');
const dir = path.resolve(process.argv[2] || os.tmpdir());
const h = R.React.createElement;
const TR = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const k of ['error', 'warn']) {
  const real = console[k];
  console[k] = (...a) => { if (!/multiple renderers|react-test-renderer is deprecated/.test(String(a[0]))) real(...a); };
}
const { transform } = require('sucrase');
const fs = require('fs');
const fixture = path.join(os.tmpdir(), 'rac-shot-notice-fixture.cjs');
fs.writeFileSync(fixture, transform(fs.readFileSync(path.join(web, 'scripts/notice-fixture.js'), 'utf8'), { transforms: ['imports'] }).code);
const F = require(fixture);

const NOW = Math.floor(Date.now() / 1000);
const ev = (seq, event, data) => ({ event, chat_id: 'c1', seq, ts: NOW - 600 + seq, data });
const HISTORY = [
  ev(1, 'message.user', { text: 'File the grouping fix and tell me when it lands.', attachments: [] }),
  ev(2, 'message.assistant', { text: 'Filed as #157. I will tell you here when it ends.' }),
  ev(3, 'message.user', { text: F.DONE_157, attachments: [] }),
  ev(4, 'message.assistant', { text: '#157 is merged. The build it delivered predates the voice work, and it is not on your phone yet.' }),
  ev(5, 'message.user', { text: F.BLOCKED_139, attachments: [] }),
  ev(6, 'message.user', { text: F.FAILED, attachments: [], queued: true }),
];

/** The live tree as markup; a one-line text keeps to one line, as on the phone. */
function markup(node) {
  if (node == null || typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(markup);
  const props = { ...node.props };
  if (props['data-lines'] === '1') {
    // First: the photographer's quoted font family closes the style attribute.
    props['data-style'] = JSON.stringify({ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      ...JSON.parse(props['data-style'] ?? '{}') });
  }
  return h(node.type, props, ...(node.children ?? []).map(markup));
}

(async () => {
  await machine.ready;
  R.words.real();
  machine.stand();
  R.store.set({ events: { c1: HISTORY, c2: [] }, openChat: async () => {}, closeChat() {}, markRead() {} });
  // The transcript column as the chat screen draws its rows, without the
  // screen's sheets and list windowing around it.
  const { UserBubble, AssistantText } = require(path.join(root, 'src/components/chat.tsx'));
  const { View } = require('react-native');
  const rows = HISTORY.map((e) => (e.event === 'message.user'
    ? h(UserBubble, { key: e.seq, text: e.data.text, attachments: e.data.attachments, queued: e.data.queued })
    : h(AssistantText, { key: e.seq, text: e.data.text })));
  const { act } = R.React;
  let page;
  await act(async () => { page = TR.create(h(R.theme.ForceScheme, { scheme: 'dark' },
    h(View, { style: { paddingHorizontal: 16, paddingVertical: 20, gap: 14 } }, rows))); });
  const shot = (name, width = 390) => {
    const html = renderToStaticMarkup(h('div', { 'data-rn': 'View', 'data-style': JSON.stringify({ width }) }, markup(page.toJSON())));
    console.log(photograph(html, 'dark', path.join(dir, name), 900));
  };
  fs.mkdirSync(dir, { recursive: true });
  shot('chat-notices.png');
  shot('chat-notices-320.png', 320);
  const row = page.root.findAll((n) => typeof n.props.onPress === 'function' && /^Done #157:/.test(n.props.accessibilityLabel ?? '')
    && typeof n.type !== 'string')[0];
  await act(async () => { row.props.onPress(); });
  shot('chat-notice-open.png');
  // A ticket the chat filed, tapped open: it stays in the chat, Go details leaves.
  const { CardLink } = require(path.join(root, 'src/components/chat.tsx'));
  await act(async () => { page.update(h(R.theme.ForceScheme, { scheme: 'dark' },
    h(View, { style: { paddingHorizontal: 16, paddingVertical: 20, gap: 14 } },
      h(AssistantText, { text: 'Filed it as #177.' }),
      h(CardLink, { ticket: 177, column: 'Queued', title: 'Show pending agent questions as a floating chat on the dashboard', onPress() {} })))); });
  const chip = page.root.findAll((n) => typeof n.props.onPress === 'function' && /^Queued: /.test(n.props.accessibilityLabel ?? '')
    && typeof n.type !== 'string')[0];
  await act(async () => { chip.props.onPress(); });
  shot('chat-ticket-link-open.png');
  process.exit(0);
})();
