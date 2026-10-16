/** The phone's socket against a real daemon (#291), in the time a test suite
 *  can spare. The five-minute fault soak is soak-ws.cjs.
 *
 *    1. The bursts of iPhone sockets that lived 0.2 s and closed with 1000
 *       (daemon.log, 2026-10-16 01:46:10 … 01:56:01) are `callOnce`: every
 *       Divan screen reads every paired computer, once a minute and on every
 *       focus, and the ones the phone is not connected to are read on a socket
 *       of their own. Driven here the way loadDivan drives it, twenty times,
 *       beside the phone's live connection to the same daemon: the live socket
 *       is the same one throughout, nothing is announced on it, and the daemon
 *       writes none of them down as the phone disconnecting.
 *    2. The live socket killed with no close frame is back, and caught up, in
 *       well under three seconds, with no banner.
 *
 *  Needs the daemon's Python (PY, else daemon/.venv, else
 *  ~/projects/divan/daemon/.venv312); without one the checks say SKIP, and
 *  `--require-daemon` makes that a failure.
 *
 *  Run: node scripts/test-ws-live.cjs
 */
const kit = require('./ws-live-kit.cjs');

const checks = [];
const check = (name, ok, detail = '') => checks.push([name + (ok || !detail ? '' : `  — ${detail}`), !!ok]);

async function run() {
  const py = kit.python();
  if (!py) {
    console.log('  SKIP  live socket checks: no daemon Python (set PY)');
    if (process.argv.includes('--require-daemon')) checks.push(['a daemon Python to run against', false]);
    return;
  }
  const peer = await kit.peer(py);
  const phone = kit.phone();
  try {
    const { port, token, chat_id: chat } = peer.info;
    await phone.ask('connect', { port, token, chat });
    await phone.ask('check', {}, 20000);
    await kit.wait(1500);

    // ── 1 · the one-shot sockets ───────────────────────────────────────────
    const markHeard = phone.heard.length;
    const markLog = peer.log.length;
    const before = await phone.ask('report');
    const r = await phone.ask('once', { n: 20, port, token, gap: 150 }, 120000);
    await kit.wait(500);
    const after = await phone.ask('report');
    const log = peer.log.slice(markLog);
    const changes = phone.heard.slice(markHeard).filter((m) => m.kind === 'status' || m.kind === 'link');
    check('one-shot: twenty requests on sockets of their own are answered', r.out.every((x) => x === 'ok'), JSON.stringify(r.out));
    check('one-shot: they were one-shot sockets, and the live one was not replaced',
      after.opened.once - before.opened.once === 20 && after.opened.live === before.opened.live && after.opened.live === 1,
      JSON.stringify([before.opened, after.opened]));
    check('one-shot: the live connection never left online while they came and went', changes.length === 0, JSON.stringify(changes));
    check('one-shot: the daemon writes none of them down as the phone disconnecting',
      !log.some((l) => /device (dis)?connected: iPhone/.test(l)), log.filter((l) => /device/.test(l)).join(' | '));
    // React Native closes with 1000, Node's WebSocket with no code (1005).
    check('one-shot: …but as one-shot sockets, each with its close line',
      log.filter((l) => /one-shot socket closed: iPhone .* code=100[05] /.test(l)).length === 20,
      log.filter((l) => /one-shot/.test(l)).slice(0, 3).join(" | "));
    check('one-shot: every event of the chat reached the live socket meanwhile', after.missingCount === 0 && after.seen > before.seen,
      JSON.stringify(after.missing));

    // ── 2 · killed with no close frame ─────────────────────────────────────
    const px = await kit.proxy(port);
    const p2 = kit.phone();
    try {
      await p2.ask('connect', { port: px.port, token, chat });
      await p2.ask('check', {}, 20000);
      await kit.wait(1000);
      const mark = p2.heard.length;
      const t0 = Date.now();
      px.kill();
      const live = await new Promise((resolve) => {
        const iv = setInterval(() => {
          const m = p2.heard.slice(mark).find((x) => x.kind === 'live');
          if (m || Date.now() - t0 > 10000) { clearInterval(iv); resolve(m); }
        }, 20);
      });
      const shown = p2.heard.slice(mark).filter((m) => m.kind === 'status' && m.s !== 'online');
      check('killed: a socket reset with no close frame is back and caught up in under three seconds',
        live && live.at - t0 < 3000, live ? `${live.at - t0} ms` : 'never');
      check('killed: …and no banner was shown for it', shown.length === 0, JSON.stringify(shown));
      const rep = await p2.ask('report');
      check('killed: no event of the chat was lost across it', rep.missingCount === 0, JSON.stringify(rep.missing));
      check("killed: the daemon is told reason 'socket'", rep.reasons.some((x) => x.reason === 'socket' && x.code === 1006),
        JSON.stringify(rep.reasons));
    } finally {
      await p2.close();
      await px.close();
    }
  } finally {
    await phone.close();
    await peer.close();
  }
}

const ready = run().catch((e) => { checks.push([`live socket checks ran: ${e?.stack || e}`, false]); });
module.exports = { checks, ready };

if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) { console.log((ok ? '  ok    ' : '  FAIL  ') + name); if (!ok) bad++; }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  });
}
