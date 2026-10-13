#!/usr/bin/env node
/** The product's name in the middle of a chat's head, in a real browser: it is
 *  measured to be in the exact middle of the bar at every width it is drawn
 *  at, clear of the chat's name and of the chips, and gone where the head is
 *  too narrow for three things. Its menu opens under it, Escape and a press
 *  outside close it without a history entry, and Dashboard is one step to the
 *  product's page that Back undoes.
 *
 *     CHROME=/path/to/chrome node scripts/test-chatproject-ui.mjs
 *
 *  Pictures go to $USTABASI_SHOTS when it is set, else .test-build/chatproject-ui/shots. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checker, launch } from './walk-browser.mjs';

const { ok, done } = checker();
const b = await launch('chatproject-ui');
const shots = process.env.USTABASI_SHOTS || join(b.build, 'shots');
mkdirSync(shots, { recursive: true });
const CHAT = '/chats/c1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Where everything in the head is. The chat's name is measured by what is
 *  written in it, not by the room it was given. */
const layout = () => b.evaluate(`
  const head = document.querySelector('.dv-chathead');
  if (!head) return null;
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
  const name = head.querySelector('[data-chat-project-name]');
  const chips = [...head.querySelectorAll('.dv-chatchips > *')].map(box);
  const written = [...head.querySelectorAll('.dv-chatname [data-chat-title], .dv-chatname input, .dv-chatname > div:last-child > *, .dv-chatname button')].map(box);
  const sub = head.querySelector('.dv-chatname > div:last-child');
  const menu = head.querySelector('[role="menu"]');
  return {
    head: box(head), name: name && name.getBoundingClientRect().width ? box(name) : null, text: name?.textContent ?? null,
    nameRight: Math.max(...written.map((r) => r.r)), chipsLeft: Math.min(...chips.map((r) => r.l)),
    chipsRight: Math.max(...chips.map((r) => r.r)),
    size: name ? parseFloat(getComputedStyle(name).fontSize) : 0, weight: name ? Number(getComputedStyle(name).fontWeight) : 0,
    subSize: parseFloat(getComputedStyle(sub).fontSize), subWeight: Number(getComputedStyle(sub).fontWeight),
    titleSize: parseFloat(getComputedStyle(head.querySelector('.dv-chatname [data-chat-title], .dv-chatname input')).fontSize),
    menu: box(menu), items: [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map((el) => el.textContent.trim()),
    page: document.documentElement.scrollWidth, width: innerWidth,
  };`);
const path = () => b.evaluate('return location.pathname;');
const entries = () => b.evaluate('return history.length;');
const press = async (box) => {
  const x = (box.l + box.r) / 2, y = (box.t + box.b) / 2;
  await b.page('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await b.page('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(250);
};
const escape = async () => {
  await b.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await b.page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(250);
};
/** Put away the question windows the fixture opens over the page. */
const tidy = () => b.evaluate(`
  for (let i = 0; i < 6; i++) {
    const open = [...document.querySelectorAll('button[title^="Put "]')];
    if (!open.length) break;
    open[0].click();
    await new Promise((r) => setTimeout(r, 120));
  }`);
const centred = (l) => !!l.name && Math.abs((l.name.l + l.name.r) / 2 - (l.head.l + l.head.r) / 2) <= 1;
const clear = (l) => !!l.name && l.name.l >= l.nameRight && l.name.r <= l.chipsLeft
  && l.chipsRight <= l.head.r + 0.5 && l.page <= l.width;

try {
  for (const width of [1728, 1440, 1280, 1180]) {
    console.log(`── a chat filed under Quire, ${width}px`);
    await b.size(width, false);
    await b.cold(CHAT);
    await tidy();
    const l = await layout();
    ok('the head says Quire', l?.text === 'Quire' && !!l.name, JSON.stringify(l?.name));
    ok('in the exact middle of the bar', centred(l),
      `name ${(l.name.l + l.name.r) / 2} · bar ${(l.head.l + l.head.r) / 2}`);
    ok('clear of the chat’s name on its left and every chip on its right, nothing outside the window', clear(l),
      JSON.stringify({ nameRight: l.nameRight, name: l.name, chipsLeft: l.chipsLeft, chipsRight: l.chipsRight, head: l.head }));
    ok('larger and bolder than the line under the chat’s name, and larger than the name itself',
      l.size > l.subSize && l.weight > l.subWeight && l.size > l.titleSize,
      `${l.size}/${l.weight} vs ${l.subSize}/${l.subWeight} · title ${l.titleSize}`);
  }

  console.log('── the chat’s name being renamed (1440px)');
  await b.size(1440, false);
  await b.cold(CHAT);
  await tidy();
  await b.evaluate(`document.querySelector('.dv-chathead [data-chat-title]').click();
    await new Promise((r) => setTimeout(r, 150));
    const f = document.querySelector('.dv-chathead input[data-chat-title-input]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(f, 'A much longer name for the retry policy chat');
    f.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));`);
  const editing = await layout();
  ok('with the field, Save and Discard beside it, the product is still in the exact middle and clear of them',
    centred(editing) && clear(editing), JSON.stringify({ nameRight: editing.nameRight, name: editing.name }));
  await escape();

  console.log('── the menu (1440px)');
  await b.cold(CHAT);
  await tidy();
  const before = await entries();
  let l = await layout();
  await press(l.name);
  l = await layout();
  ok('a press on the name opens a menu under it with one row, Dashboard',
    l.items.join(',') === 'Dashboard' && !!l.menu && l.menu.t >= l.name.b
      && Math.abs((l.menu.l + l.menu.r) / 2 - (l.name.l + l.name.r) / 2) <= 1 && l.menu.r <= l.width && l.menu.l >= 0,
    JSON.stringify({ items: l.items, menu: l.menu }));
  await b.shot(join(shots, 'chat-header-project.png'), 1440, false);
  await escape();
  l = await layout();
  ok('Escape closes it: still the chat, no history entry', !l.menu && (await path()) === CHAT && (await entries()) === before,
    `${await path()} · ${before} → ${await entries()}`);
  await press(l.name);
  ok('open again', !!(await layout()).menu);
  await press({ l: 700, r: 720, t: 500, b: 520 });
  l = await layout();
  ok('a press outside closes it: still the chat, no history entry', !l.menu && (await path()) === CHAT && (await entries()) === before,
    `${await path()} · ${before} → ${await entries()}`);

  console.log('── Dashboard');
  await press(l.name);
  l = await layout();
  const row = await b.evaluate(`const r = document.querySelector('[data-chat-project-dashboard]').getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom };`);
  await press(row);
  await sleep(300);
  ok('Dashboard goes to the product’s own page', (await path()) === '/p/quire'
    && await b.evaluate(`return !!document.querySelector('[data-project-page]') && !document.querySelector('.dv-chathead')
      && /Quire/.test(document.querySelector('[data-project-page]').textContent);`), await path());
  ok('…as one history entry', (await entries()) === before + 1, `${before} → ${await entries()}`);
  await tidy();
  await b.shot(join(shots, 'chat-header-project-dashboard.png'), 1440, false);
  await b.evaluate(`history.back(); await new Promise((r) => setTimeout(r, 500));`);
  l = await layout();
  ok('Back is the same chat, the product in the middle of its head again',
    (await path()) === CHAT && l?.text === 'Quire' && centred(l)
      && await b.evaluate(`return document.querySelector('.dv-chathead [data-chat-title]').textContent === 'Webhook retry policy'
        && document.body.textContent.includes('Fix the retries.');`), await path());

  console.log('── on the product’s own page (1440px)');
  await b.cold('/p/quire/chat/c1');
  await tidy();
  l = await layout();
  ok('the chat read there has the name in the middle of its head too', l?.text === 'Quire' && centred(l) && clear(l),
    JSON.stringify(l?.name));
  await press(l.name);
  await press(await b.evaluate(`const r = document.querySelector('[data-chat-project-dashboard]').getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom };`));
  await sleep(300);
  ok('…and Dashboard from there is the product’s page', (await path()) === '/p/quire', await path());

  console.log('── a chat filed under nothing (1440px)');
  await b.cold('/chats/c2');
  await tidy();
  l = await layout();
  ok('no name in the middle', !!l && l.text === null && !l.name, JSON.stringify(l?.name));
  ok('…and the chips sit on one line at the right, as they did',
    await b.evaluate(`const c = [...document.querySelectorAll('.dv-chathead .dv-chatchips > *')].map((el) => el.getBoundingClientRect());
      return Math.max(...c.map((r) => r.top)) - Math.min(...c.map((r) => r.top)) < 8;`));

  for (const [width, mobile, name] of [[1100, false, 'narrow'], [390, true, 'phone']]) {
    console.log(`── too narrow for three things, ${name} (${width}px)`);
    await b.size(width, mobile);
    await b.cold(CHAT);
    await tidy();
    l = await layout();
    ok('the name in the middle is not drawn, and nothing runs outside the window',
      !!l && !l.name && l.chipsRight <= l.head.r + 0.5 && l.page <= l.width, JSON.stringify({ name: l?.name, page: l?.page, width: l?.width }));
    ok('the chat’s name and the chips do not overlap',
      await b.evaluate(`const t = document.querySelector('.dv-chathead .dv-chatname').getBoundingClientRect();
        const c = document.querySelector('.dv-chathead .dv-chatchips').getBoundingClientRect();
        return t.right <= c.left + 0.5 || t.bottom <= c.top + 0.5;`));
    if (name === 'narrow') await b.shot(join(shots, 'chat-header-project-narrow.png'), width, mobile);
  }
  const bad = b.drain();
  ok('no console errors on any of it', !bad.length, bad.join('\n    '));
} finally {
  b.close();
}
process.exit(done());
