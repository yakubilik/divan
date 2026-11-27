/** A tap the send button never answered still sends, once, and is reported
 *  (`src/press.ts`).
 *
 *  27 Nov 2026: about ten taps on the send button did nothing, and the message
 *  went only after a newline was typed. The cause is not known, so the button
 *  is watched from underneath: what is held here is the watching — which
 *  touches are a tap, when a press is given up on, and that one tap never
 *  sends twice whichever order its press turns up in.
 *
 *  Run: node scripts/test-press.cjs
 */
const fs = require('fs');
const path = require('path');
const { transform } = require('sucrase');

const root = path.join(__dirname, '..');
if (!require.extensions['.ts']) {
  require.extensions['.ts'] = (mod, filename) => mod._compile(transform(fs.readFileSync(filename, 'utf8'),
    { transforms: ['typescript', 'imports'], filePath: filename }).code, filename);
}
const P = require(path.join(root, 'src/press.ts'));

const checks = [];
const check = (name, ok, detail = '') => checks.push([name + (ok || !detail ? '' : `  — ${detail}`), !!ok]);

/** A button under a clock of the test's own. `sent` is what the screen would
 *  have sent: by the button's press, or by the watch on a lost one. */
function button() {
  let now = 0;
  const timers = [];
  const lost = [];
  let sent = 0;
  const w = new P.PressWatch({
    onLost: (seen) => { lost.push(seen); sent++; },
    now: () => now,
    setTimer: (fn, ms) => { const t = { fn, at: now + ms, off: false }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.off = true; },
  });
  const wait = (ms) => { now += ms; for (const t of timers.filter((x) => !x.off && x.at <= now)) { t.off = true; t.fn(); } };
  const press = () => { if (w.press()) sent++; };
  return { w, wait, press, lost, sent: () => sent };
}

// A tap that works: the press arrives with the lift, and the watch says nothing.
{
  const b = button();
  b.w.touchStart(100, 500); b.w.pressIn(); b.wait(70);
  b.press(); b.w.touchEnd(101, 500);
  b.wait(1000);
  check('a tap the button answers sends once and reports nothing', b.sent() === 1 && b.lost.length === 0, `${b.sent()} sent`);
}
// …the same, with the lift handed over before the press.
{
  const b = button();
  b.w.touchStart(100, 500); b.w.pressIn(); b.wait(70);
  b.w.touchEnd(100, 500); b.press();
  b.wait(1000);
  check('…in either order', b.sent() === 1 && b.lost.length === 0, `${b.sent()} sent`);
}
// The fault: the touch lands and lifts, and no press ever follows.
{
  const b = button();
  b.w.touchStart(100, 500); b.wait(90); b.w.touchEnd(100, 500);
  b.wait(P.WAIT_MS - 1);
  const early = b.sent();
  b.wait(1);
  check('a tap no press follows is not acted on before the press has had its moment', early === 0);
  check('…and then it sends', b.sent() === 1);
  check('…and says the button never took the touch', b.lost.length === 1 && b.lost[0].pressIn === false && b.lost[0].ms === 90,
    JSON.stringify(b.lost));
}
// The other suspect: the press began and was cancelled as "left the button".
{
  const b = button();
  b.w.touchStart(100, 500); b.w.pressIn(); b.w.touchMove(103, 502); b.w.pressOut(); b.wait(120); b.w.touchEnd(103, 502);
  b.wait(P.WAIT_MS);
  check('a press that began and was dropped sends too, and says it had begun',
    b.sent() === 1 && b.lost[0].pressIn === true && b.lost[0].pressOut === true && b.lost[0].moved === 4, JSON.stringify(b.lost));
}
// Ten dead taps in a row are one message: the first one sent it.
{
  const b = button();
  b.w.touchStart(100, 500); b.wait(80); b.w.touchEnd(100, 500); b.wait(P.WAIT_MS);
  check('the first dead tap is the one that sends', b.sent() === 1);
}
// A press that turns up late, after the lost tap was acted on, is the same tap.
{
  const b = button();
  b.w.touchStart(100, 500); b.wait(80); b.w.touchEnd(100, 500); b.wait(P.WAIT_MS);
  b.wait(200); b.press();
  check('a press arriving after its tap was already acted on does not send again', b.sent() === 1, `${b.sent()} sent`);
  b.wait(P.SAME_TAP_MS + 1);
  b.w.touchStart(100, 500); b.wait(60); b.press(); b.w.touchEnd(100, 500);
  check('…and the next real tap sends as usual', b.sent() === 2, `${b.sent()} sent`);
}
// Not taps.
{
  const b = button();
  b.w.touchStart(100, 500); b.w.touchMove(100, 500 - P.TAP_SLOP - 1); b.wait(100); b.w.touchEnd(100, 480);
  b.wait(1000);
  check('a finger that slid off the button is a change of mind, not a tap', b.sent() === 0 && b.lost.length === 0);
}
{
  const b = button();
  b.w.touchStart(100, 500); b.wait(P.TAP_MAX_MS + 1); b.w.touchEnd(100, 500);
  b.wait(1000);
  check('a finger held on the button is not a tap', b.sent() === 0);
}
{
  const b = button();
  b.w.touchStart(100, 500); b.wait(50); b.w.touchCancel(); b.w.touchEnd(100, 500);
  b.wait(1000);
  check('a touch the system took away is not a tap', b.sent() === 0);
}
{
  const b = button();
  b.w.touchStart(100, 500); b.wait(50); b.w.touchEnd(100, 500); b.w.stop();
  b.wait(1000);
  check('a button that is gone sends nothing', b.sent() === 0);
}
// A second touch before the first was settled starts over.
{
  const b = button();
  b.w.touchStart(100, 500); b.wait(40); b.w.touchEnd(100, 500);
  b.wait(20);
  b.w.touchStart(100, 500); b.wait(40); b.press(); b.w.touchEnd(100, 500);
  b.wait(1000);
  check('two quick taps of which the second is answered send once', b.sent() === 1, `${b.sent()} sent`);
}

// The screen uses it: the send button reports its phases, its press goes
// through the watch, and the mic is a different button.
const screen = fs.readFileSync(path.join(root, 'app/chat/[id].tsx'), 'utf8');
check('screen: the send button is watched from a plain View under it',
  /<View key="send"[^>]*onTouchStart=[\s\S]{0,400}onTouchEnd=/.test(screen));
check('screen: its press asks the watch before sending', /onPress=\{\(\) => \{ if \(sendWatch\.current\?\.press\(\) \?\? true\) void onSend\(\); \}\}/.test(screen));
check('screen: a lost tap sends and is reported as send.lost', /onLost:[\s\S]{0,700}onSendRef\.current\(\)[\s\S]{0,700}'send\.lost'/.test(screen));
check('screen: the mic is its own button, not the send button with other handlers', /<Pressable key="mic"/.test(screen));

let bad = 0;
for (const [name, ok] of checks) { console.log((ok ? '  ok    ' : '  FAIL  ') + name); if (!ok) bad++; }
console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
process.exit(bad ? 1 : 0);
