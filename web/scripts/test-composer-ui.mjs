#!/usr/bin/env node
/** A chat's own box, typed into in a real browser, and the keys that are the
 *  browser's rather than the panel's.
 *
 *     CHROME=/path/to/chrome node scripts/test-composer-ui.mjs
 *
 *  jsdom has no layout, so it cannot say where one line of text sits between
 *  the two discs, or whether a long message grows the box and then scrolls. And
 *  a key dispatched from a script is not the key a person presses: these go in
 *  through the browser's own input pipeline (`Input.dispatchKeyEvent`), and what
 *  is read back is whether the page cancelled them. With USTABASI_SHOTS set it
 *  leaves `chat-composer.png`, `chat-composer-multiline.png`,
 *  `chat-composer-narrow.png` and `chat-window-composer.png` there.
 */
import { join } from 'node:path';
import { checker, launch } from './walk-browser.mjs';

const { ok, done } = checker();
const b = await launch('composer');
const shots = process.env.USTABASI_SHOTS;

const FIELD = `document.querySelector('textarea[name="composer"]')`;
const CTRL = 2;
const META = 4;

/** Where the box, its one line and its discs are. `line` is the text's own
 *  line box: the field's top, its padding, and one line-height under that. */
const measure = () => b.evaluate(`
  const el = ${FIELD};
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const lh = parseFloat(cs.lineHeight);
  const top = r.top + parseFloat(cs.paddingTop);
  const box = el.parentElement.getBoundingClientRect();
  const discs = [...el.parentElement.querySelectorAll('button')].map((x) => {
    const d = x.getBoundingClientRect();
    return { label: x.getAttribute('aria-label') || x.title, left: d.left, right: d.right, top: d.top, bottom: d.bottom,
             mid: (d.top + d.bottom) / 2 };
  });
  return { value: el.value, left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height,
           line: (top + top + lh) / 2, lineHeight: lh, client: el.clientHeight, scroll: el.scrollHeight,
           scrollTop: el.scrollTop, box: { top: box.top, bottom: box.bottom, mid: (box.top + box.bottom) / 2,
           left: box.left, right: box.right }, discs, vw: innerWidth };`);

const focus = () => b.evaluate(`${FIELD}.focus(); return document.activeElement === ${FIELD};`);
const typeIn = async (text) => {
  await b.page('Input.insertText', { text });
  await new Promise((r) => setTimeout(r, 200));
};
/** One real key, down and up. */
const key = async (k, { modifiers = 0, code, vk, text } = {}) => {
  const base = { key: k, code: code ?? `Key${k.toUpperCase()}`, modifiers,
                 windowsVirtualKeyCode: vk ?? k.toUpperCase().charCodeAt(0) };
  await b.page('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}) });
  await b.page('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await new Promise((r) => setTimeout(r, 250));
};
const digit = (n, modifiers) => key(String(n), { modifiers, code: `Digit${n}`, vk: 48 + n });
/** Every keydown the page saw, and whether anything on it cancelled the
 *  browser's own answer — read a tick later, after every listener has run. */
const watch = () => b.evaluate(`
  window.__keys = [];
  if (!window.__watching) {
    window.__watching = true;
    window.addEventListener('keydown', (e) => {
      const seen = { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, trusted: e.isTrusted };
      window.__keys.push(seen);
      setTimeout(() => { seen.prevented = e.defaultPrevented; }, 0);
    }, true);
  }`);
const keys = () => b.evaluate('return window.__keys;');
const where = () => b.evaluate('return location.pathname + location.search;');
const asked = () => b.evaluate('return window.__asked.map((a) => ({ type: a.type, data: a.data }));');

/** The single line sits on the discs' centre and in the middle of the box. */
function centred(m) {
  const off = Math.max(...m.discs.map((d) => Math.abs(d.mid - m.line)), Math.abs(m.box.mid - m.line));
  return { off, good: off <= 1 };
}
/** The field ends before the first disc after it starts, and every disc is
 *  inside the box and the window. */
function clear(m) {
  const after = m.discs.filter((d) => d.left >= m.left);
  const before = m.discs.filter((d) => d.left < m.left);
  return after.every((d) => d.left >= m.right - 0.5) && before.every((d) => d.right <= m.left + 0.5)
    && m.discs.every((d) => d.top >= m.box.top && d.bottom <= m.box.bottom + 0.5 && d.right <= m.vw)
    && m.box.right <= m.vw;
}

try {
  // The chat screen's box, and the same box one size down in the window a chat
  // opens in on the Dashboard — which is opened here from its tab in the dock.
  for (const [name, width, mobile, small] of [['standard', 1440, false, false], ['narrow', 390, true, false],
                                               ['window', 1440, false, true], ['window-narrow', 390, true, true]]) {
    console.log(`── ${small ? 'the chat window\'s box' : 'the chat\'s box'} at ${width}`);
    const tallest = small ? 120 : 200;
    await b.size(width, mobile);
    await b.cold(small ? '/' : '/chats/c1');
    if (small) {
      await b.evaluate(`
        if (!${FIELD}) document.querySelector('[data-asking-tab="chat:studio:c3"]')?.firstElementChild?.click();
        for (let i = 0; i < 40 && !${FIELD}; i++) await new Promise((r) => setTimeout(r, 100));
        await new Promise((r) => setTimeout(r, 400));`);
    }
    const empty = await measure();
    ok('the box is on the page with its discs', !!empty && empty.discs.length >= 2, JSON.stringify(empty));
    if (!empty) continue;
    ok('…and its placeholder line is level with them', centred(empty).good, `off by ${centred(empty).off}px`);

    await focus();
    await typeIn('Ship the beta tonight');
    const one = await measure();
    ok('one typed line sits on the centre of the discs and of the box',
      one.value === 'Ship the beta tonight' && centred(one).good && one.client === one.scroll,
      `off by ${centred(one).off}px · ${JSON.stringify({ line: one.line, box: one.box.mid, discs: one.discs.map((d) => d.mid) })}`);
    ok('…and does not run under a control', clear(one), JSON.stringify(one));
    if (shots && name !== 'window-narrow') {
      await b.shot(join(shots, { standard: 'chat-composer.png', narrow: 'chat-composer-narrow.png',
                                 window: 'chat-window-composer.png' }[name]), width, mobile);
    }

    await b.evaluate(`${FIELD}.select();`);
    await typeIn('one\ntwo\nthree');
    const three = await measure();
    ok('three lines make the box three lines tall, with nothing to scroll',
      Math.abs(three.height - one.height - 2 * one.lineHeight) <= 1 && three.scroll <= three.client + 1,
      `${one.height} → ${three.height} · ${three.scroll}/${three.client}`);
    ok('…the discs stay at its foot and the text clear of them',
      clear(three) && three.discs.every((d) => Math.abs(d.bottom - three.bottom) <= 1),
      JSON.stringify(three));
    if (shots && name === 'standard') await b.shot(join(shots, 'chat-composer-multiline.png'), width, mobile);

    await b.evaluate(`${FIELD}.select();`);
    await typeIn(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n'));
    const many = await measure();
    ok('forty lines stop the box at its tallest and scroll inside it',
      many.height === tallest && many.scroll > many.client + 100 && clear(many),
      `${many.height} · ${many.scroll}/${many.client}`);
    const scrolled = await b.evaluate(`${FIELD}.scrollTop = 0; ${FIELD}.scrollTop = 120; return ${FIELD}.scrollTop;`);
    ok('…and it does scroll', scrolled === 120, String(scrolled));

    await b.evaluate(`${FIELD}.select();`);
    await typeIn(`Ship it from ${name}`);
    await focus();
    await key('Enter', { code: 'Enter', vk: 13, text: '\r' });
    const said = (await asked()).filter((a) => a.type === 'chat.send' && a.data?.text === `Ship it from ${name}`).pop();
    const after = await measure();
    ok('Enter sends what was typed, and the box is one centred line again',
      said?.data?.text === `Ship it from ${name}` && after.value === '' && after.height === empty.height
      && centred(after).good, `${JSON.stringify(said?.data)} · ${after.value} · ${after.height}`);
  }

  console.log('── the keys that are the browser\'s');
  await b.size(1440, false);
  for (const from of ['the box', 'the page']) {
    await b.cold('/chats/c1');
    await watch();
    if (from === 'the box') { await focus(); await typeIn('half a thought'); }
    else await b.evaluate(`document.activeElement?.blur(); document.body.focus();`);
    const start = await where();
    for (const mod of [CTRL, META]) for (let n = 0; n <= 9; n++) await digit(n, mod);
    const seen = await keys();
    const at = await where();
    const value = await b.evaluate(`return ${FIELD}?.value ?? null;`);
    ok(`from ${from}, Ctrl and ⌘ with 0–9 reach the page as real keys`,
      seen.length === 20 && seen.every((k) => k.trusted && (k.ctrl || k.meta)), JSON.stringify(seen.slice(0, 3)));
    ok('…none of them is cancelled, so the browser still switches its tab',
      seen.every((k) => k.prevented === false), JSON.stringify(seen.filter((k) => k.prevented !== false)));
    ok('…and none of them moves the panel or the words in the box',
      at === start && value === (from === 'the box' ? 'half a thought' : ''), `${start} → ${at} · ${value}`);
  }

  console.log('── the keys that are still the panel\'s');
  await b.cold('/chats/c1');
  await watch();
  await focus();
  await typeIn('still typing');
  await key('k', { modifiers: CTRL });
  const palette = await b.evaluate(`return !!document.querySelector('input[placeholder^="folder, chat, command"]');`);
  const taken = (await keys()).pop();
  ok('Ctrl K still opens the palette over a focused box', palette && taken?.prevented === true,
    JSON.stringify({ palette, taken }));
  await key('k', { modifiers: CTRL });
  await key(',', { modifiers: META, code: 'Comma', vk: 188 });
  ok('⌘, still opens Settings', (await where()) === '/machine/settings', await where());
  await b.cold('/chats/c1');
  await key('f', { modifiers: META });
  ok('⌘F still puts the cursor in the chat search',
    await b.evaluate(`return document.activeElement?.name === 'chat-search';`));
  await focus();
  await key('a', { text: 'a' });
  await key('1', { code: 'Digit1', vk: 49, text: '1' });
  ok('a letter and a bare digit are typed into the box',
    (await b.evaluate(`return ${FIELD}.value;`)) === 'a1', await b.evaluate(`return ${FIELD}.value;`));
  const errors = b.drain();
  ok('nothing was logged as an error on the way', errors.length === 0, errors.join('\n'));
} finally { b.close(); }
process.exit(done());
