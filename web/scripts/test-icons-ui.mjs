#!/usr/bin/env node
/** Claude's and Codex's own icons in the built panel, in a real browser: the
 *  chat list, the new-chat picker, the command palette and Accounts & sign-ins,
 *  Night and Day, desktop and phone width, cold and reloaded.
 *
 *     CHROME=/path/to/chrome node scripts/test-icons-ui.mjs
 *
 *  Pictures go to $USTABASI_SHOTS when it is set, else .test-build/icons/shots. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checker, launch } from './walk-browser.mjs';

const { ok, done } = checker();
const b = await launch('icons');
const shots = process.env.USTABASI_SHOTS || join(b.build, 'shots');
mkdirSync(shots, { recursive: true });

/** Every provider icon on the page that is decoded, has a box, and is not
 *  hidden by itself or by anything above it. */
const icons = () => b.evaluate(`
  for (let i = 0; i < 40 && [...document.images].some((im) => !im.complete); i++) await new Promise((r) => setTimeout(r, 50));
  const seen = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width >= 16 && r.height >= 16;
  };
  return [...document.querySelectorAll('img[data-provider-icon]')].map((im) => ({
    provider: im.dataset.providerIcon, loaded: im.complete && im.naturalWidth > 0, seen: seen(im),
  }));`);
const check = (where, list, want) => {
  for (const p of want) {
    const mine = list.filter((x) => x.provider === p);
    ok(`${where}: ${p} icon drawn and loaded`, mine.length > 0 && mine.every((x) => x.loaded && x.seen),
      JSON.stringify(mine));
  }
};
/** A chat list with one chat on each tool. */
const codexChat = `const f = window.__fleet.getState(); const h = f.hosts.studio;
  const chats = h.chats.map((c, i) => i === 1 ? { ...c, provider: 'codex', model: 'gpt-5-codex' } : c);
  window.__fleet.setState({ hosts: { ...f.hosts, studio: { ...h, chats } } });
  await new Promise((r) => setTimeout(r, 300));`;
const click = (label) => b.evaluate(`
  const el = [...document.querySelectorAll('button')].find((e) => e.getAttribute('aria-label') === ${JSON.stringify(label)}
    || e.getAttribute('title') === ${JSON.stringify(label)} || e.textContent.trim() === ${JSON.stringify(label)});
  if (!el) return false; el.click(); await new Promise((r) => setTimeout(r, 400)); return true;`);

try {
  for (const [width, phone] of [[1440, false], [390, true]]) {
    await b.size(width, phone);
    for (const theme of ['dark', 'light']) {
      const at = `${theme} ${width}`;
      console.log(`── ${at}`);

      await b.cold('/chats', { theme });
      await b.evaluate(codexChat);
      check(`chat list ${at}`, await icons(), ['claude', 'codex']);
      if (!phone) await b.shot(join(shots, `icons-chats-${theme}.png`), width, phone);
      await b.reload();
      check(`chat list after reload ${at}`, await icons(), ['claude']);

      await b.cold('/machine/accounts', { theme });
      check(`accounts ${at}`, await icons(), ['claude', 'codex']);
      if (!phone) await b.shot(join(shots, `icons-accounts-${theme}.png`), width, phone);
      await b.reload();
      check(`accounts after reload ${at}`, await icons(), ['claude', 'codex']);
      if (phone && theme === 'dark') await b.shot(join(shots, 'icons-accounts-narrow.png'), width, phone);

      await b.cold('/chats', { theme });
      await b.evaluate(codexChat);
      await b.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));`);
      check(`palette ${at}`, await icons(), ['claude', 'codex']);
      ok(`palette ${at}: still answers a query`, await b.evaluate(`
        const input = document.querySelector('input[placeholder]:focus') || document.querySelector('[role=dialog] input');
        if (!input) return false;
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(input, 'Safari'); input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 300));
        return document.body.textContent.includes('Safari login');`));

      // The picker a chat is started from, opened from a section's own "+".
      await b.cold('/chats', { theme });
      await b.evaluate(`
        const plus = [...document.querySelectorAll('button')].find((e) => /new chat in/i.test(e.getAttribute('aria-label') || e.title || ''));
        plus?.click(); await new Promise((r) => setTimeout(r, 400));`);
      const picker = await icons();
      check(`new-chat picker ${at}`, picker, ['claude', 'codex']);
      // With Codex on that computer too, the tile under its icon still picks it.
      ok(`new-chat picker ${at}: choosing Codex still selects it`, await b.evaluate(`
        const f = window.__fleet.getState(); const h = f.hosts.studio;
        window.__fleet.setState({ hosts: { ...f.hosts, studio: { ...h, catalog: { ...h.catalog, codex: h.catalog.claude } } } });
        await new Promise((r) => setTimeout(r, 300));
        const tile = document.querySelector('img[data-provider-icon="codex"]')?.closest('button');
        if (!tile || tile.disabled) return false;
        tile.click(); await new Promise((r) => setTimeout(r, 300));
        return [...document.querySelectorAll('[role=dialog] *, body *')].some((e) => e.children.length === 0 && /^codex · /.test(e.textContent.trim()));`));
      if (!phone && theme === 'dark') await b.shot(join(shots, 'icons-new-chat.png'), width, phone);
    }
  }
  const problems = b.drain();
  ok('no console errors or failed loads', problems.length === 0, problems.join('\n    '));
} finally {
  b.close();
}
process.exit(done());
