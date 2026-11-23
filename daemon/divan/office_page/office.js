// The office page: pixtuoid's web build (pixtuoid_web.js, MIT, with Divan's
// `live` mode) fed the hook lines this daemon taps (office.py). The pixels are
// the engine's; the names over the desks and the wall board are drawn here,
// as pixtuoid's own site does, so they stay sharp at any zoom.
import init, { Office } from './pixtuoid_web.js';

const canvas = document.getElementById('office');
const labelsEl = document.getElementById('labels');
const boardEl = document.getElementById('board');
const note = document.getElementById('note');
const ctx = canvas.getContext('2d');
const token = new URLSearchParams(location.search).get('token') || '';
// A phone held upright gets a tall, narrow office at the engine's own zoom;
// laying it out on a surface this many times bigger shows more of the room.
const ZOOM_OUT = 2;

function say(text) { note.textContent = text || ''; }

const wasm = await init();
const office = Office.live((Date.now() / 86400000) | 0);
let img = null, started = false, pending = [], css = 1;

function box() {
  const dpr = window.devicePixelRatio || 1;
  const fit = office.fit(Math.round(innerWidth * dpr * ZOOM_OUT), Math.round(innerHeight * dpr * ZOOM_OUT));
  return { dpr, units: [fit[0], fit[1]], ppu: fit[2] };
}

function land(t, line) {
  try { office.send_hook(line, t); } catch (e) { /* a line no source names */ }
}

function seg(s) {
  const span = document.createElement('span');
  span.textContent = s.text;
  span.style.color = s.color;
  return span;
}

function overlay() {
  let data;
  try { data = JSON.parse(office.overlay_json()); } catch (e) { return; }
  const kids = labelsEl.children;
  let i = 0;
  for (const L of data.labels) {
    let el = kids[i];
    if (!el) { el = document.createElement('div'); el.className = 'lb'; labelsEl.appendChild(el); }
    if (el.textContent !== L.text) el.textContent = L.text;
    el.style.color = L.ink;
    el.style.backgroundColor = L.plate;
    el.style.boxShadow = `inset 0 0 0 1px ${L.ring}`;
    el.style.transform = `translate(${L.x * css}px, ${L.y * css}px) translate(-50%, -100%)`;
    i++;
  }
  while (kids.length > i) labelsEl.removeChild(kids[kids.length - 1]);
  const b = data.board;
  if (!b) { boardEl.style.display = 'none'; return; }
  boardEl.style.display = 'flex';
  Object.assign(boardEl.style, { left: b.rect.x * css + 'px', top: b.rect.y * css + 'px',
    width: b.rect.w * css + 'px', height: b.rect.h * css + 'px' });
  const rows = [[b.brand, b.star], b.mood, b.context];
  const key = JSON.stringify(rows);
  if (boardEl.dataset.key === key) return;
  boardEl.dataset.key = key;
  boardEl.replaceChildren(...rows.map((row) => {
    const line = document.createElement('div');
    for (const s of row) if (s && s.text) line.appendChild(seg(s)), line.appendChild(document.createTextNode(' '));
    return line;
  }));
}

function draw(now) {
  const { dpr, units, ppu } = box();
  const written = office.step(now, units[0], units[1]);
  const scale = office.scale();
  const fw = units[0] * scale, fh = units[1] * scale;
  css = ppu / dpr / ZOOM_OUT;
  if (canvas.width !== fw || canvas.height !== fh) {
    canvas.width = fw; canvas.height = fh; img = null;
    canvas.style.width = units[0] * css + 'px';
    canvas.style.height = units[1] * css + 'px';
  }
  if (written || !img) {
    if (!img) img = new ImageData(fw, fh);
    img.data.set(new Uint8ClampedArray(wasm.memory.buffer, office.frame_ptr(), office.frame_len()));
    ctx.putImageData(img, 0, 0);
  }
  overlay();
}

function loop() {
  if (pending.length) { for (const [t, l] of pending) land(t, l); pending = []; }
  draw(Date.now());
  requestAnimationFrame(loop);
}

function connect() {
  const es = new EventSource('stream?token=' + encodeURIComponent(token));
  es.addEventListener('backlog', (e) => {
    const kept = JSON.parse(e.data);
    if (!started) {
      // The clock and the desks first, a moment before the oldest line, so
      // every replayed SessionStart has a seat to take.
      const { units } = box();
      office.step(kept.length ? kept[0][0] - 1 : Date.now(), units[0], units[1]);
      for (const [t, l] of kept) land(t, l);
      started = true;
      requestAnimationFrame(loop);
    }
    say(kept.length ? '' : 'Quiet for now: an agent walks in when it starts working.');
  });
  es.onmessage = (e) => { const [t, l] = JSON.parse(e.data); pending.push([t, l]); say(''); };
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) { say('Lost the computer, trying again…'); setTimeout(connect, 3000); }
  };
}

connect();
