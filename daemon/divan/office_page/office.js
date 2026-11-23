// The office page: one pixtuoid office (pixtuoid_web.js, MIT, with Divan's
// `live` mode) per product, fed the hook lines the daemon makes of its chats
// (office.py). The pixels are the engine's; the names over the desks are drawn
// here, the chat's title rather than pixtuoid's `cc·<folder>`. A click on a
// character opens its chat in whatever holds this page.
import init, { Office } from './pixtuoid_web.js';

const roomsEl = document.getElementById('rooms');
const note = document.getElementById('note');
const token = new URLSearchParams(location.search).get('token') || '';
const FRAME_MS = 80;           // ~12 frames a second is plenty for a pixel office
const BASE_W = 460;            // a room's width at zoom 1, in CSS px
let zoom = Number(localStorage.getItem('divan.office.zoom')) || 1;
let chats = {};                // short id -> { id, title, room }
let roomOrder = [];
const rooms = new Map();       // room name -> { office, el, canvas, ctx, labels, img, css, pending, started, count }
let wasm = null, kept = null;

const seed = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

function room(name) {
  let r = rooms.get(name);
  if (r) return r;
  const el = document.createElement('section');
  el.className = 'room';
  el.innerHTML = '<h2><b></b><span></span></h2><div class="wrap"><canvas></canvas><div class="labels"></div></div>';
  el.querySelector('b').textContent = name;
  const canvas = el.querySelector('canvas');
  r = { name, el, canvas, ctx: canvas.getContext('2d'), labels: el.querySelector('.labels'), img: null, css: 1,
        office: Office.live(seed(name)), pending: [], started: false, shown: [] };
  el.querySelector('.wrap').addEventListener('click', (e) => pick(r, e));
  rooms.set(name, r);
  place();
  return r;
}

function place() {
  const names = [...rooms.keys()].sort((a, b) => {
    const ia = roomOrder.indexOf(a), ib = roomOrder.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
  for (const n of names) roomsEl.appendChild(rooms.get(n).el);
}

// The layout is worked out at zoom 1, on a room big enough for its chats, and
// zoom only scales the picture: laid out at the zoomed size, pixtuoid picks a
// bigger pixel and fewer desks, and chats fall onto a floor nobody sees.
function size(r) {
  const dpr = window.devicePixelRatio || 1;
  const n = Object.values(chats).filter((c) => c.room === r.name).length;
  const w = Math.min(BASE_W * Math.min(2, Math.sqrt(Math.max(1, n / 4))), (innerWidth - 30) / zoom);
  const h = w * 0.62;
  const fit = r.office.fit(Math.round(w * dpr), Math.round(h * dpr));
  return { dpr, units: [fit[0], fit[1]], ppu: fit[2] };
}

function land(r, t, line) {
  try { r.office.send_hook(line, t); } catch (e) { /* a line no source names */ }
}

function nameOf(text) {
  const short = text.includes('·') ? text.split('·').pop() : text;
  const c = chats[short];
  return c ? c : null;
}

function drawLabels(r) {
  let data;
  try { data = JSON.parse(r.office.overlay_json()); } catch (e) { return; }
  const kids = r.labels.children;
  r.shown = [];
  let i = 0;
  for (const L of data.labels) {
    const chat = nameOf(L.text);
    // A chat's title starts with its folder (`divan · …`); the room already says that.
    const text = chat ? chat.title.replace(/^[^·]{1,30} · /, '') : L.text;
    let el = kids[i];
    if (!el) { el = document.createElement('div'); el.className = 'lb'; r.labels.appendChild(el); }
    if (el.textContent !== text) el.textContent = text;
    el.style.fontSize = Math.round(8 * Math.max(1, zoom)) + 'px';
    el.style.maxWidth = Math.round(96 * Math.max(1, zoom)) + 'px';
    el.style.color = L.ink;
    el.style.backgroundColor = L.plate;
    el.style.boxShadow = `inset 0 0 0 1px ${L.ring}`;
    const x = L.x * r.css, y = L.y * r.css;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    r.shown.push({ x, y, chat });
    i++;
  }
  while (kids.length > i) r.labels.removeChild(kids[kids.length - 1]);
  r.el.querySelector('h2 span').textContent = data.labels.length ? String(data.labels.length) : '';
}

function draw(r, now) {
  const { dpr, units, ppu } = size(r);
  const written = r.office.step(now, units[0], units[1]);
  const scale = r.office.scale();
  const fw = units[0] * scale, fh = units[1] * scale;
  r.css = ppu / dpr * zoom;
  if (r.canvas.width !== fw || r.canvas.height !== fh) {
    r.canvas.width = fw; r.canvas.height = fh; r.img = null;
  }
  r.canvas.style.width = units[0] * r.css + 'px';
  r.canvas.style.height = units[1] * r.css + 'px';
  if (written || !r.img) {
    if (!r.img) r.img = new ImageData(fw, fh);
    r.img.data.set(new Uint8ClampedArray(wasm.memory.buffer, r.office.frame_ptr(), r.office.frame_len()));
    r.ctx.putImageData(r.img, 0, 0);
  }
  drawLabels(r);
}

// The character under a click: the nearest name tag, the sprite being just
// under its tag.
function pick(r, e) {
  const box = r.canvas.getBoundingClientRect();
  const x = e.clientX - box.left, y = e.clientY - box.top;
  let best = null, bestD = 60 * Math.max(1, zoom);
  for (const s of r.shown) {
    const d = Math.hypot(x - s.x, (y - (s.y + 22 * r.css)) * 0.8);
    if (d < bestD) { best = s; bestD = d; }
  }
  if (!best || !best.chat) return;
  const msg = { type: 'office-open', chat: best.chat.id };
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  if (window.parent !== window) window.parent.postMessage(msg, '*');
}

let last = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (now - last < FRAME_MS) return;
  last = now;
  const t = Date.now();
  for (const r of rooms.values()) {
    if (!r.started) continue;
    if (r.pending.length) { for (const [ts, l] of r.pending) land(r, ts, l); r.pending = []; }
    const b = r.el.getBoundingClientRect();
    if (b.bottom < -50 || b.top > innerHeight + 50) continue; // out of sight
    draw(r, t);
  }
}

function start(r, firstMs) {
  const { units } = size(r);
  r.office.step(firstMs, units[0], units[1]);
  r.started = true;
}

function setZoom(z) {
  zoom = Math.max(0.5, Math.min(3, z));
  localStorage.setItem('divan.office.zoom', String(zoom));
}
document.getElementById('zin').onclick = () => setZoom(zoom * 1.25);
document.getElementById('zout').onclick = () => setZoom(zoom / 1.25);
addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
let pinch = null;
addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { d: dist(e), z: zoom }; }, { passive: true });
addEventListener('touchmove', (e) => { if (pinch && e.touches.length === 2) setZoom(pinch.z * dist(e) / pinch.d); }, { passive: true });
addEventListener('touchend', () => { pinch = null; }, { passive: true });
function dist(e) { const [a, b] = e.touches; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1; }

function connect() {
  const es = new EventSource('stream?token=' + encodeURIComponent(token));
  es.addEventListener('rooms', (e) => {
    const d = JSON.parse(e.data);
    chats = d.chats || {};
    roomOrder = d.rooms || [];
    for (const name of roomOrder) if (name !== 'Terminal') room(name);
    place();
  });
  es.addEventListener('backlog', (e) => {
    if (kept) return; // a reconnect: the offices already hold what happened
    kept = JSON.parse(e.data);
    const first = kept.length ? kept[0][0] - 1 : Date.now();
    const byRoom = new Map();
    for (const [t, l, rn] of kept) { if (!byRoom.has(rn)) byRoom.set(rn, []); byRoom.get(rn).push([t, l]); }
    for (const [rn, lines] of byRoom) {
      const r = room(rn);
      start(r, first);
      for (const [t, l] of lines) land(r, t, l);
    }
    for (const r of rooms.values()) if (!r.started) start(r, Date.now());
    note.textContent = rooms.size ? '' : 'Quiet for now: a chat walks in when it starts.';
  });
  es.onmessage = (e) => {
    const [t, l, rn] = JSON.parse(e.data);
    const r = room(rn);
    if (!r.started) start(r, t - 1);
    r.pending.push([t, l]);
    note.textContent = '';
  };
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) { note.textContent = 'Lost the computer, trying again…'; setTimeout(connect, 3000); } };
}

wasm = await init();
requestAnimationFrame(loop);
connect();
