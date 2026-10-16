/** The phone's connection under fire, for at least five minutes (#291).
 *
 *  The app's real socket client (`src/ws.ts`, in a process of its own, doing
 *  what the store and the open chat do — ws-live-child.cjs) against a real
 *  daemon (`daemon/scripts/soak_peer.py`: the Server under uvicorn with
 *  ws_ping_interval=None, a chat getting a numbered event every 200 ms),
 *  through a proxy that breaks the line. Round after round, each of:
 *
 *    stall       everything the daemon sends is held back for 12 s, then let
 *                through: the phone must ride it out — no reconnect — and be
 *                answering within 3 s of the stall ending;
 *    kill        the connection is reset with no close frame: back within 3 s;
 *    restart     the daemon is stopped and started again on the same home and
 *                port: back within 3 s of it accepting connections again;
 *    background  the line goes dead the way it does under a suspended app (the
 *                daemon's side torn down, the phone's left open and silent)
 *                and the phone is frozen with SIGSTOP for 60 s — no timer
 *                runs, nothing is read — then woken with a foreground: back,
 *                and caught up, within 2 s.
 *
 *  "Back" is a request answered on a live socket and, when the socket is a new
 *  one, the chat caught up from where the phone left off. After every fault
 *  the chat's events are compared, by sequence number, with what the daemon
 *  has: none may be missing. No request may time out. The banner the screen
 *  would show (`onStatus`) must never appear for a recovery under 3 s, and
 *  must be gone the moment the socket is back.
 *
 *  Any recovery over its limit fails the run.
 *
 *  Run: node scripts/soak-ws.cjs [--minutes 5] [--json out.json]
 *  Needs the daemon's Python (PY, else daemon/.venv, else ~/projects/divan/daemon/.venv312).
 */
const fs = require('fs');
const kit = require('./ws-live-kit.cjs');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MINUTES = Number(opt('--minutes', 5));
const OUT = opt('--json', null);
const ONLY = opt('--only', null)?.split(',') ?? null;     // for working on one fault: not a soak
const STEADY_MS = 20000;

const failures = [];
const results = [];
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;
function note(ok, what, detail = '') {
  console.log(`${stamp()}  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(what + (detail ? ` (${detail})` : ''));
}

async function main() {
  const py = kit.python();
  if (!py) { console.error('no daemon Python: set PY'); process.exit(2); }
  const peer = await kit.peer(py);
  const px = await kit.proxy(peer.port);
  const phone = kit.phone();
  const cleanup = async () => { await phone.close(); await px.close(); await peer.close(); };
  process.on('SIGINT', () => { void cleanup().then(() => process.exit(130)); });
  try {
    const { token, chat_id: chat } = peer.info;
    await phone.ask('connect', { port: px.port, token, chat });
    await phone.ask('check', {}, 20000);
    console.log(`${stamp()}  phone online through the proxy; daemon on ${peer.port}`);

    /** Run one fault; `end()` resolves when the fault is over. */
    async function fault(name, limitMs, run) {
      const mark = phone.heard.length;
      const began = Date.now();
      const endedAt = await run();
      const c = await phone.ask('check', {}, 30000);
      const back = Date.now();
      const took = back - endedAt;
      const during = phone.heard.slice(mark);
      // When the socket went down and came back, as the code under it saw it.
      const links = during.filter((m) => m.kind === 'link');
      const down = links.find((m) => m.s !== 'online');
      const up = [...links].reverse().find((m) => m.s === 'online');
      const outage = down && up ? up.t - down.t : 0;
      const shown = during.filter((m) => m.kind === 'status' && m.s !== 'online');
      const lastStatus = [...during].reverse().find((m) => m.kind === 'status');
      const rep = await phone.ask('report', {}, 60000);
      const r = { name, took, limit: limitMs, outage, reconnected: !!down, shown: shown.map((m) => m.s),
                  missing: rep.missingCount, calls: rep.calls, at: (began - t0) / 1000 };
      results.push(r);
      const ok = !c.error && took < limitMs;
      note(ok, `${name}: back in ${took} ms after the fault ended (limit ${limitMs})`,
        c.error ?? `outage ${outage} ms, ${down ? 'new socket' : 'same socket'}`);
      if (!ok) {
        console.log(`        what the phone saw, from the fault's end:`);
        for (const m of during) if (m.t >= endedAt - 15000) console.log(`        ${m.t - endedAt} ms  ${m.kind} ${m.s ?? ''}`);
      }
      note(rep.missingCount === 0, `${name}: no event lost (${rep.seen} seen, last seq ${rep.last})`,
        rep.missingCount ? `missing ${rep.missingCount}: ${rep.missing.join(',')}` : '');
      note(rep.calls.timeout === 0 && rep.calls.other === 0, `${name}: no request timed out or failed (${JSON.stringify(rep.calls)})`);
      if (outage && outage < 3000) note(shown.length === 0, `${name}: a ${outage} ms outage showed no banner`, JSON.stringify(r.shown));
      if (shown.length) {
        // Shown: only for an outage past 3 s, and gone the moment it was back.
        const firstShown = shown[0].t - (down?.t ?? shown[0].t);
        note(outage >= 3000 && firstShown >= 2900, `${name}: the banner came at ${firstShown} ms of a ${outage} ms outage, not before 3 s`);
        note(lastStatus?.s === 'online' && up && Math.abs(lastStatus.t - up.t) < 100,
          `${name}: …and went the moment the socket was back`);
      }
      return r;
    }

    const steady = async () => {
      await kit.wait(STEADY_MS);
    };

    let round = 0;
    while (Date.now() - t0 < MINUTES * 60000 || round < 1) {
      round++;
      console.log(`${stamp()}  ── round ${round}`);
      const want = (n) => !ONLY || ONLY.includes(n);
      if (want('stall')) await fault('stall', 3000, async () => { await px.stall(12000); return Date.now(); });
      if (want('stall') && results.at(-1).reconnected) note(false, 'stall: a 12 s stall was ridden out without a reconnect');
      if (want('stall')) await steady();
      if (want('kill')) { await fault('kill', 3000, async () => { px.kill(); return Date.now(); }); await steady(); }
      if (want('restart')) { await fault('restart', 3000, async () => { await peer.restart(); return Date.now(); }); await steady(); }
      if (want('background')) await fault('background', 2000, async () => {
        await phone.ask('pause');
        px.blackhole();
        phone.freeze();
        await kit.wait(60000);
        phone.thaw();
        const fg = Date.now();
        phone.send({ cmd: 'foreground' });
        return fg;
      });
      if (want('background')) { await phone.ask('resume'); await steady(); }
    }
    const final = await phone.ask('report', {}, 60000);
    const ran = (Date.now() - t0) / 1000;
    note(ran >= MINUTES * 60, `ran ${ran.toFixed(0)} s (at least ${MINUTES * 60})`);
    note(final.missingCount === 0, `the whole run: every one of ${final.theirs} events since the first was seen`);
    note(final.calls.timeout === 0 && final.calls.pending <= 1, `the whole run: ${final.calls.ok} requests answered, `
      + `${final.calls.dropped} refused with the socket while it was down, ${final.calls.timeout} timed out`);
    console.log(`${stamp()}  reasons the daemon was told: ${final.reasons.map((x) => `${x.reason}/${x.code ?? '-'} offline=${x.offline_s}s silent=${x.silent_s}s`).join('; ')}`);
    const disconnects = peer.log.filter((l) => /device (re)?connected|device disconnected/.test(l)).length;
    console.log(`${stamp()}  daemon log lines about the phone: ${disconnects}`);
    if (OUT) fs.writeFileSync(OUT, JSON.stringify({ minutes: ran / 60, results, final, failures }, null, 2));
  } finally {
    await cleanup();
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join('\n  ')}` : '\nall recoveries within their limits');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
