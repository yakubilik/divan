/** A chat row swiped left to archive or delete stays a swipe (20 Nov 2026).
 *
 *  On the phone a sideways drag on a chat row turned into a scroll of the list
 *  halfway through: the finger always drifts up or down a little, the list
 *  started scrolling, the row handed its gesture over (PanResponder's default
 *  is to give it up when asked) and snapped shut. Checked here:
 *
 *    1. `SwipeActions` keeps a drag it has started — it refuses to hand it over;
 *    2. it tells the list around it when a drag starts and when it ends, on a
 *       release and on a gesture taken from it alike, so the list is never left
 *       unable to scroll;
 *    3. the chat list listens: it stops scrolling while a row is swiped, and
 *       locks a drag to one direction.
 *
 *  Run: node scripts/test-swipe-row.cjs
 */
const fs = require('fs');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const RN = require('react-native');

const checks = [];

const panPrev = RN.PanResponder.create;
let pans = [];
RN.PanResponder.create = (cfg) => { pans.push(cfg); return { panHandlers: {} }; };

const told = [];
const actions = [{ key: 'delete', label: 'Delete', color: '#f00', icon: () => null, onPress: () => {} }];
R.render('light', h(R.ui.SwipeScrollLock.Provider, { value: (v) => told.push(v) },
  h(R.ui.SwipeActions, { actions }, h(RN.View, null))));
const pan = pans[0];

checks.push(['a row has a pan of its own', !!pan]);
checks.push(['a sideways drag is the row\'s', pan.onMoveShouldSetPanResponder({}, { dx: 30, dy: 6 }) === true]);
checks.push(['an up-and-down one is the list\'s', pan.onMoveShouldSetPanResponder({}, { dx: 10, dy: 30 }) === false]);
checks.push(['once the row has the drag it does not hand it to the list',
  typeof pan.onPanResponderTerminationRequest === 'function' && pan.onPanResponderTerminationRequest() === false]);

pan.onPanResponderGrant({}, { dx: 0, dy: 0 });
checks.push(['the list is told to stop scrolling when the drag starts', told.join() === 'true']);
pan.onPanResponderRelease({}, { dx: -120, dy: 10, vx: -0.8 });
checks.push(['…and to scroll again when the finger lifts', told.join() === 'true,false']);
pan.onPanResponderGrant({}, { dx: 0, dy: 0 });
pan.onPanResponderTerminate({}, { dx: 0, dy: 0 });
checks.push(['…and when the drag is taken away anyway', told.join() === 'true,false,true,false']);

// Outside a list that listens, a row still swipes.
pans = [];
R.render('light', h(R.ui.SwipeActions, { actions }, h(RN.View, null)));
checks.push(['a row with no list listening still swipes', (() => {
  try { pans[0].onPanResponderGrant({}, {}); pans[0].onPanResponderRelease({}, { dx: 0, dy: 0, vx: 0 }); return true; }
  catch { return false; }
})()]);

RN.PanResponder.create = panPrev;

// The chat list: the stub list does not hold state, so its wiring is read off
// the screen's source.
const screen = fs.readFileSync(path.join(root, 'app/chat/index.tsx'), 'utf8');
checks.push(['the chat list hands its rows a way to stop it scrolling',
  /<SwipeScrollLock\.Provider value=\{setSwiping\}>/.test(screen)]);
checks.push(['…and stops scrolling while one is swiped', /scrollEnabled=\{!swiping\}/.test(screen)]);
checks.push(['…and locks a drag to one direction', /\bdirectionalLockEnabled\b/.test(screen)]);

let bad = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) bad++;
}
console.log(bad ? `\n${bad} of ${checks.length} failed` : `\nall ${checks.length} passed`);
process.exit(bad ? 1 : 0);
