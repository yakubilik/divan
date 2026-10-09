#!/usr/bin/env node
/** A ticket's page in a real browser: its time and usage while a run is going
 *  and after it ends, cold, reloaded and at phone width — and no Composer on
 *  it, with the line in Live still reaching the ticket.
 *
 *     CHROME=/path/to/chrome node scripts/test-usage-ui.mjs
 *
 *  Pictures go to $USTABASI_SHOTS when it is set, else .test-build/usage-ui/shots. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checker, launch } from './walk-browser.mjs';

const { ok, done } = checker();
const b = await launch('usage-ui');
const shots = process.env.USTABASI_SHOTS || join(b.build, 'shots');
mkdirSync(shots, { recursive: true });
const TICKET = '/p/quire/c/k1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The box as a person reads it: each row's label, scope, figure and tag. */
const box = () => b.evaluate(`
  const rows = {};
  for (const r of document.querySelectorAll('[data-usage] [data-row]')) {
    rows[r.dataset.row] = {
      label: r.querySelector('.l').firstChild.textContent, scope: r.querySelector('.s').textContent,
      value: r.querySelector('.v').textContent, tag: r.querySelector('[data-tag]')?.textContent ?? null,
      fine: r.querySelector('.f')?.textContent ?? null,
    };
  }
  return { rows, caveat: document.querySelector('[data-usage-caveat]')?.textContent ?? null,
           live: document.querySelector('[data-usage]')?.dataset.live === 'true' };`);
const seconds = (text) => {
  const m = /^(?:(\d+)h )?(?:(\d+)m )?(\d+)s$/.exec(text) || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
};
const composer = () => b.evaluate(`return document.querySelectorAll('.dv-composer, #composer-in, [data-picker]').length;`);
/** Put away the question windows the fixture's other cards open over the page,
 *  the way their own dock buttons do, so the picture is of the ticket. */
const tidy = () => b.evaluate(`
  for (let i = 0; i < 6; i++) {
    const open = [...document.querySelectorAll('button[title^="Put "]')];
    if (!open.length) break;
    open[0].click();
    await new Promise((r) => setTimeout(r, 120));
  }`);
const wide = () => b.evaluate(`
  const u = document.querySelector('[data-usage]').getBoundingClientRect();
  return { page: document.documentElement.scrollWidth, left: u.left, right: u.right, width: innerWidth };`);

try {
  console.log('── a ticket with a run going');
  await b.size(1440, false);
  await b.cold(TICKET, { fixture: 'running' });
  const first = await box();
  await sleep(2200);
  const second = await box();
  ok('the current run is named and timed from its own start, not from the day the ticket was opened',
    first.rows.run.label === 'Current run' && first.rows.run.scope === 'worker · round 2' && first.live
      && seconds(first.rows.run.value) >= 125 && seconds(first.rows.run.value) < 140, JSON.stringify(first.rows.run));
  ok('…and it counts up on the page, with active time beside it',
    seconds(second.rows.run.value) >= seconds(first.rows.run.value) + 2
      && seconds(second.rows.active.value) >= seconds(first.rows.active.value) + 2
      && /^whole ticket · 3 runs$/.test(second.rows.active.scope),
    `${first.rows.run.value} → ${second.rows.run.value}; ${first.rows.active.value} → ${second.rows.active.value}`);
  ok('tokens and cost are the whole ticket’s so far, the cost an estimate, and the run still going is said to be missing from them',
    first.rows.tokens.scope === 'whole ticket' && first.rows.tokens.value === '53k'
      && /^input 100 · cached input 50k · cache write 2\.0k · output 1\.0k$/.test(first.rows.tokens.fine)
      && first.rows.cost.value === '$1.00' && first.rows.cost.tag === 'estimate' && /nothing was charged/.test(first.rows.cost.fine)
      && /current run reports/.test(first.caveat ?? ''), JSON.stringify(first));
  ok('no Composer and none of its pickers on a ticket’s page', (await composer()) === 0);
  await tidy();
  await b.shot(join(shots, 'ticket-running.png'), 1440, false);

  // The line in Live, typed into and sent.
  const before = await b.evaluate(`return window.__asked.filter((a) => a.type === 'ustabasi.note').length;`);
  await b.evaluate(`
    const field = document.querySelector('#t-say');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'batch the commit');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    field.form.requestSubmit();
    await new Promise((r) => setTimeout(r, 400));`);
  const notes = await b.evaluate(`return window.__asked.filter((a) => a.type === 'ustabasi.note').map((a) => a.data);`);
  const chats = await b.evaluate(`return window.__asked.filter((a) => /^chat\\.(create|send)$/.test(a.type)).length;`);
  ok('the line in Live sends its sentence to that ticket, appears in Live, and starts no chat',
    before === 0 && notes.length === 1 && notes[0].id === 41 && notes[0].text === 'batch the commit' && chats === 0
      && await b.evaluate(`return document.querySelector('[data-live]').innerText.includes('You: batch the commit') && document.querySelector('#t-say').value === '';`),
    JSON.stringify({ before, notes, chats }));

  // The run ends on the computer; the page asks again on its own.
  await b.evaluate('window.__runEnds();');
  let ended = await box();
  for (let i = 0; i < 40 && ended.live; i++) { await sleep(500); ended = await box(); }
  await sleep(2200);
  const still = await box();
  ok('when the run ends the page picks it up by itself: the clock stops, and the run’s tokens and cost join the totals',
    !ended.live && ended.rows.run.label === 'Last run' && JSON.stringify(still) === JSON.stringify(ended)
      && ended.rows.tokens.value === '86k' && ended.rows.cost.value === '$1.50' && ended.caveat === null,
    JSON.stringify(ended));

  console.log('── a finished ticket');
  await b.cold(TICKET, { fixture: 'done' });
  const cold = await box();
  await sleep(2200);
  const later = await box();
  await b.reload();
  const reloaded = await box();
  ok('opened cold it shows the last run and the ticket’s final figures — 12m 35s of running on a ticket a day old',
    !cold.live && cold.rows.run.label === 'Last run' && cold.rows.run.value === '2m 5s' && cold.rows.active.value === '12m 35s'
      && cold.rows.tokens.value === '86k' && cold.rows.cost.value === '$1.50' && cold.rows.cost.tag === 'estimate',
    JSON.stringify(cold.rows));
  ok('…which do not move while it is read, and are the same after a reload',
    JSON.stringify(cold) === JSON.stringify(later) && JSON.stringify(cold) === JSON.stringify(reloaded), JSON.stringify(reloaded.rows));
  ok('run by run is there to open: three runs, the check with no tokens to report',
    await b.evaluate(`
      document.querySelector('.dv-usage-runs summary').click();
      const rows = [...document.querySelectorAll('.dv-usage-runs tr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim());
      return rows.length === 3 && rows[0] === 'worker · round 1 10m 0s 53k $1.00' && rows[1] === 'check · round 1 30s' && /^worker · round 2 2m 5s 33k \\$0\\.50$/.test(rows[2]);`));
  ok('no Composer here either', (await composer()) === 0);
  await tidy();
  await b.shot(join(shots, 'ticket-done.png'), 1440, false);

  console.log('── at phone width');
  await b.size(390, true);
  await b.cold(TICKET, { fixture: 'running' });
  const narrow = await box();
  const w = await wide();
  ok('the box is on the page, inside it, with nothing pushed off the side and the run still counting',
    narrow.live && narrow.rows.cost.value === '$1.00' && w.page <= w.width && w.left >= 0 && w.right <= w.width, JSON.stringify(w));
  ok('…and no Composer', (await composer()) === 0);
  await tidy();
  await b.shot(join(shots, 'ticket-narrow.png'), 390, true);
  await b.reload();
  const again = await box();
  ok('a reload of a running ticket draws it again, still running', again.live && again.rows.run.label === 'Current run', JSON.stringify(again.rows.run));

  console.log('── a ticket with no run on record, and where a chat is still started');
  await b.size(1440, false);
  await b.cold(TICKET);
  ok('figures nobody has are unavailable, and no zero is drawn in their place',
    await b.evaluate(`const t = document.querySelector('[data-usage]').innerText; return /unavailable/.test(t) && !/\\$0|\\b0s\\b/.test(t);`));
  for (const path of ['/', '/p/quire', '/p/quire/board']) {
    await b.cold(path);
    ok(`${path} keeps its Composer`, await b.evaluate(`return !!document.querySelector('.dv-composer #composer-in');`));
  }
  const bad = b.drain();
  ok('no console errors on any of it', !bad.length, bad.join('\n    '));
} finally {
  b.close();
}
process.exit(done());
