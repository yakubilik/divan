/** Ticket notices in a phone chat (#159), held to the web's contract (#158).
 *
 *  The reader is checked against the web's own (`web/src/lib/notice.ts`) on the
 *  web's fixtures, copied from stored events. The chat screen is then mounted
 *  live — `react-test-renderer`, because a tap has to re-render — over a
 *  history with a done, a blocked and a failed notice, a steered one, the
 *  controls and an attachment; the #157 notice is tapped open and shut, a new
 *  one arrives, and the screen is mounted again.
 *
 *  Run: node scripts/test-notice.cjs  (also folded into test-ustabasi.cjs.)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { transform } = require('sucrase');
const { R } = require('./render-chat.cjs');
const machine = require('./test-handover-machine.cjs');

const root = path.join(__dirname, '..');
const web = path.join(root, '..', 'web');
const h = R.React.createElement;

/** A web module, as CommonJS. */
function esm(file) {
  const js = transform(fs.readFileSync(file, 'utf8'), { transforms: ['typescript', 'imports'] }).code;
  const out = path.join(os.tmpdir(), 'rac-web-' + path.basename(file).replace(/\W/g, '-') + '.cjs');
  fs.writeFileSync(out, js);
  delete require.cache[out];
  return require(out);
}
const WEB = esm(path.join(web, 'src/lib/notice.ts'));
const F = esm(path.join(web, 'scripts/notice-fixture.js'));
const N = require(path.join(root, 'src/notice.ts'));

const INSTRUCTION = /You filed this ticket|Tell them|Tell him|ustabasi show/;
const checks = [];

// ── the reader: the web's answers, word for word ────────────────────────────
const SAMPLES = {
  ...F,
  OTHER_TICKET: F.DONE_157.replace('`ustabasi show 157`', '`ustabasi show 158`'),
  NO_INSTRUCTION: F.DONE_157.split('\n\nYou filed')[0],
  EMPTY_REPORT: '🔔 ustabasi #9 is done: Nothing said\n\nYou filed this ticket from this chat and the person is waiting here for it. `ustabasi show 9` has the details.',
  EMPTY: '',
};
const differ = Object.entries(SAMPLES)
  .filter(([, s]) => JSON.stringify(N.ticketNotice(s)) !== JSON.stringify(WEB.ticketNotice(s))).map(([k]) => k);
checks.push([`notice: the phone reads every web fixture and edge exactly as the web does${differ.length ? ` — differs on ${differ}` : ''}`,
  differ.length === 0]);
const n157 = N.ticketNotice(F.DONE_157);
checks.push(['notice: #157 reads as done, its title, a report with the build limits and the merge/branch facts, no instruction',
  n157?.state === 'done' && n157.ticket === 157 && n157.title === 'Match mobile chat grouping to the web'
  && /built before those merges/.test(n157.report) && /not installed because the phone was unreachable/.test(n157.report)
  && n157.facts.length === 2 && !INSTRUCTION.test(JSON.stringify(n157))]);
checks.push(['notice: #139 is blocked and #161 failed; a person\'s words, a quote and a mismatched ticket are not notices',
  N.ticketNotice(F.BLOCKED_139)?.state === 'blocked' && N.ticketNotice(F.FAILED)?.state === 'failed'
  && [F.CONTROL, F.QUOTED, SAMPLES.OTHER_TICKET, SAMPLES.NO_INSTRUCTION].every((s) => N.ticketNotice(s) === null)]);

// ── the chat screen, mounted ────────────────────────────────────────────────
const TR = require('react-test-renderer');
const { act } = R.React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The suite's static renders share contexts with this live one, and the live
// renderer is deprecated in React 19; neither says anything about a notice.
for (const k of ['error', 'warn']) {
  const real = console[k];
  console[k] = (...a) => { if (!/multiple renderers|react-test-renderer is deprecated/.test(String(a[0]))) real(...a); };
}

const NOW = Math.floor(Date.now() / 1000);
const ev = (seq, data) => ({ event: 'message.user', chat_id: 'c1', seq, ts: NOW - 600 + seq, data });
const said = (seq, text) => ({ event: 'message.assistant', chat_id: 'c1', seq, ts: NOW - 600 + seq, data: { text } });
const HISTORY = [
  ev(1, { text: F.CONTROL, attachments: [] }),
  said(2, 'Filed it.'),
  ev(3, { text: F.DONE_157, attachments: [] }),
  ev(4, { text: F.BLOCKED_139, attachments: [] }),
  ev(5, { text: F.FAILED, attachments: [], queued: true }),
  ev(6, { text: F.STEERED_152, attachments: [] }),
  ev(7, { text: F.QUOTED, attachments: [] }),
  ev(8, { text: F.DONE_157, attachments: [{ path: '/tmp/shot.png', name: 'shot.png', kind: 'image' }] }),
];

/** Every string the tree draws, in order. */
function words(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(words).join(' ');
  return words(node.children);
}
/** The host nodes carrying `pred`, from the rendered JSON. */
function hosts(node, pred, out = []) {
  if (!node || typeof node === 'string') return out;
  if (Array.isArray(node)) { node.forEach((n) => hosts(n, pred, out)); return out; }
  if (pred(node)) out.push(node);
  (node.children ?? []).forEach((n) => hosts(n, pred, out));
  return out;
}
/** What the notices put on screen: the page without the two controls that are
 *  drawn in full on purpose (a quote of a head, a notice sent with a picture). */
const own = (text) => text.replace(F.DONE_157, '').replace(F.QUOTED, '');
const style = (n) => JSON.parse(n.props['data-style'] ?? '{}');

const ready = (async () => {
  await machine.ready;
  R.words.real();
  machine.stand();
  // Mounted for real, the screen's effects run: opening the chat is a request.
  R.store.set({ events: { c1: HISTORY, c2: [] }, openChat: async () => {}, closeChat() {}, markRead() {} });
  const { Conversation } = require(path.join(root, 'app/chat/[id].tsx'));
  const screen = () => h(R.theme.ForceScheme, { scheme: 'dark' }, h(Conversation, { id: 'c1' }));
  let page;
  await act(async () => { page = TR.create(screen()); });
  const json = () => page.toJSON();
  /** The notice rows, by their button. */
  const rows = () => page.root.findAll((n) => typeof n.props.onPress === 'function'
    && /^(Done|Needs an answer|Failed) #\d+: /.test(n.props.accessibilityLabel ?? '') && typeof n.type !== 'string');
  const row = (n) => rows().find((r) => r.props.accessibilityLabel.includes(`#${n}:`));
  const details = () => hosts(json(), (n) => /^Ticket #\d+ report$/.test(n.props['data-label'] ?? ''));
  const tap = async (n) => { await act(async () => { row(n).props.onPress(); }); };

  // Collapsed, from history.
  const first = words(json());
  const labels = rows().map((r) => r.props.accessibilityLabel);
  checks.push([`notice (phone): the history's done, blocked and failed notices are one line each — ${JSON.stringify(labels)}`,
    labels.length === 4 && labels.includes('Done #157: Match mobile chat grouping to the web')
    && labels.includes('Needs an answer #139: Private notes and personal paths out of the public tree')
    && labels.includes('Failed #161: Rebuild the panel bundle')
    && labels.includes('Done #152: Practice policy and tool outcome checks on retail tasks')]);
  const titles = hosts(json(), (n) => n.props['data-lines'] === '1' && /Match mobile chat grouping/.test(words(n)));
  const line = titles[0] && style(titles[0]);
  checks.push(['notice (phone): collapsed, the #157 row holds state, number and title, the title on one truncating line',
    titles.length === 1 && line.flex === 1 && /Done/.test(first) && /#157/.test(first)]);
  checks.push(['notice (phone): collapsed, no report, fact line or agent instruction is drawn anywhere',
    details().length === 0 && !/phone was unreachable|merged into main \(1664073\)|ontrolden geçti|npm test exited/.test(own(first))
    && !INSTRUCTION.test(own(first))]);
  checks.push(['notice (phone): the failed notice that arrived mid-turn says queued; done and blocked do not',
    /Rebuild the panel bundle\s+queued/.test(first) && (first.match(/\bqueued\b/g) ?? []).length === 1]);
  checks.push(['notice (phone): a person\'s words, a quote and a notice with a picture stay ordinary bubbles, picture included',
    first.includes(F.CONTROL) && first.includes('what does this mean?') && first.includes('bunun senle ne alakası var')
    && hosts(json(), (n) => n.props['data-rn'] === 'Image').length >= 1
    && first.includes('Note: the delivered .ipa was built before those merges')]);

  // Tapped open, then shut.
  await tap(157);
  const open = words(json());
  const shown = details().map(words).join(' ');
  checks.push(['notice (phone): tapping #157 opens its report inline with the build and install limits and the facts',
    details().length === 1 && row(157).props.accessibilityState?.expanded === true
    && shown.includes('the delivered .ipa was built before those merges, so it does not contain the #150 voice work')
    && shown.includes('It was delivered but not installed because the phone was unreachable.')
    && shown.includes('🔀 merged into main (1664073)') && shown.includes('branch ustabasi/157-match-mobile-chat-grouping-to-the-web')]);
  const selectable = hosts(details()[0], (n) => n.props['data-rn'] === 'TextInput');
  checks.push(['notice (phone): the opened report is selectable text and carries no agent instruction',
    selectable.length >= 1 && /phone was unreachable/.test(words(selectable)) && !INSTRUCTION.test(shown)
    && !INSTRUCTION.test(own(open))]);
  await tap(157);
  checks.push(['notice (phone): tapping #157 again closes it',
    details().length === 0 && row(157).props.accessibilityState?.expanded === false
    && !/phone was unreachable/.test(own(words(json())))]);
  await tap(139);
  await tap(161);
  const both = details().map(words).join(' ');
  checks.push(['notice (phone): blocked opens its question and failed its error, like the web',
    details().length === 2 && both.includes('Ben ekleyeyim mi?') && both.includes('npm test exited 1') && !INSTRUCTION.test(both)]);

  // A live arrival, drawn as history is; then the chat opened again.
  R.store.set({ events: { c1: [...HISTORY, ev(9, { text: F.DONE_157.replace(/157/g, '170'), attachments: [] })], c2: [] } });
  await act(async () => { page.update(screen()); });
  checks.push(['notice (phone): a notice arriving live is one line too, and the open ones stay open',
    !!row(170) && details().length === 2]);
  await act(async () => { page.unmount(); });
  await act(async () => { page = TR.create(screen()); });
  checks.push(['notice (phone): reopening the chat starts with every notice collapsed',
    rows().length === 5 && details().length === 0]);
  await act(async () => { page.unmount(); });
})();

if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) { console.log((ok ? '  ok    ' : '  FAIL  ') + name); if (!ok) bad++; }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  });
}

module.exports = { checks, ready };
