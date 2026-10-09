#!/usr/bin/env node
/** A product's chat in a real browser, at desktop and phone width: it closes
 *  from an X beside the menu in its own head — no row above the head — by
 *  click and by keyboard, and reopened it is the same conversation.
 *
 *     CHROME=/path/to/chrome node scripts/test-chathead-ui.mjs
 *
 *  Pictures go to $USTABASI_SHOTS when it is set, else .test-build/chathead-ui/shots. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checker, launch } from './walk-browser.mjs';

const { ok, done } = checker();
const b = await launch('chathead-ui');
const shots = process.env.USTABASI_SHOTS || join(b.build, 'shots');
mkdirSync(shots, { recursive: true });
const CHAT = '/p/quire/chat/c1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Where the head, its title, its menu and its X sit, and what else is there. */
const layout = () => b.evaluate(`
  const pane = document.querySelector('[data-project-chat]');
  const head = pane?.querySelector('.dv-chathead');
  const menu = head?.querySelector('button[aria-label="Chat menu"]');
  const x = head?.querySelector('button[aria-label="Close chat"]');
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
  return {
    pane: pane && box(pane), head: head && box(head), menu: menu && box(menu), x: x && box(x),
    adjacent: !!x && menu?.nextElementSibling === x, title: x?.title ?? null,
    worded: [...document.querySelectorAll('button')].some((el) => el.textContent.trim() === 'Close chat'),
    page: document.documentElement.scrollWidth, width: innerWidth,
  };`);
const path = () => b.evaluate('return location.pathname;');
const history = () => b.evaluate(`return (document.querySelector('[data-project-chat]')?.textContent ?? '').includes('Fix the retries.');`);
const key = async (k, code, vk) => {
  await b.page('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text: k === 'Enter' ? '\r' : undefined });
  await b.page('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
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

try {
  for (const [width, mobile, name] of [[1440, false, 'desktop'], [390, true, 'narrow']]) {
    console.log(`── a product's chat, ${name} (${width}px)`);
    await b.size(width, mobile);
    await b.cold(CHAT);
    const l = await layout();
    ok('the chat’s own head is the top of the pane: no row above it',
      !!l.head && !!l.pane && Math.abs(l.head.t - l.pane.t) < 1, JSON.stringify({ pane: l.pane, head: l.head }));
    ok('no worded Close chat button anywhere', !l.worded);
    ok('an X labelled Close chat sits right after the menu, on its line, the same size, not overlapping it, inside the window',
      l.adjacent && l.title === 'Close chat' && l.x.l >= l.menu.r - 0.5 && Math.abs(l.x.h - l.menu.h) < 1 && Math.abs(l.x.t - l.menu.t) < 1
        && l.x.r <= l.width && l.page <= l.width,
      JSON.stringify(l));
    await tidy();
    await b.shot(join(shots, `chat-header-${name}.png`), width, mobile);

    // The menu beside it still opens.
    await b.evaluate(`document.querySelector('.dv-chathead button[aria-label="Chat menu"]').click();
      await new Promise((r) => setTimeout(r, 150));`);
    ok('the menu beside it still opens', await b.evaluate(
      `return /Delete/.test(document.querySelector('[data-project-chat]').textContent);`));
    await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));`);

    // Keyboard: focus the X and press Enter, as a real keypress.
    const before = await b.evaluate('return window.__asked.length;');
    await b.evaluate(`document.querySelector('.dv-chathead button[aria-label="Close chat"]').focus();`);
    await key('Enter', 'Enter', 13);
    const asked = await b.evaluate(`return window.__asked.slice(${before}).map((a) => a.type);`);
    ok('Enter on the X closes the chat to the product’s page, and asks nothing of the chat or its agent',
      (await path()) === '/p/quire' && !(await b.evaluate('return !!document.querySelector("[data-project-chat]");'))
        && !asked.some((t) => /delete|archive|interrupt|stop/.test(t)),
      `${await path()} · ${asked.join(',')}`);

    // Reopened from the list, it is the same conversation.
    await b.evaluate(`[...document.querySelectorAll('[data-project-page] .dv-chatlist button')]
      .find((el) => el.textContent.includes('Webhook retry policy')).click();
      await new Promise((r) => setTimeout(r, 250));`);
    ok('reopened, the chat is the same conversation, history and all',
      (await path()) === CHAT && (await history()), await path());

    // And a click closes it the same way.
    await b.evaluate(`document.querySelector('.dv-chathead button[aria-label="Close chat"]').click();
      await new Promise((r) => setTimeout(r, 200));`);
    ok('a click on the X closes it as well', (await path()) === '/p/quire');
  }
  const bad = b.drain();
  ok('no console errors on any of it', !bad.length, bad.join('\n    '));
} finally {
  b.close();
}
process.exit(done());
