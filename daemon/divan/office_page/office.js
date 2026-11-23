// The office page: one pixtuoid office (pixtuoid_web.js, MIT, with Divan's
// `live` mode) for every chat on this computer, fed the hook lines the daemon
// makes of them (office.py). The daemon seats each product's chats together,
// so a product is a corner of the room; its name stands over that corner here.
// The pixels are the engine's; the name tags are drawn here with the chat's
// title, and a click on a character opens its chat in whatever holds the page.
import init, { Office } from './pixtuoid_web.js?v=1795470718';

const token = new URLSearchParams(location.search).get('token') || '';
function report(what) {
  try { fetch('report?token=' + encodeURIComponent(token), { method: 'POST', body: String(what).slice(0, 1500) }); } catch (e) { /* nothing more */ }
}
addEventListener('error', (e) => report('error: ' + (e.message || e) + ' @' + (e.filename || '') + ':' + (e.lineno || '')));
addEventListener('unhandledrejection', (e) => report('rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));

const stage = document.getElementById('stage');
const canvas = document.getElementById('office');
const ctx = canvas.getContext('2d');
const labelsEl = document.getElementById('labels');
const zonesEl = document.getElementById('zones');
const note = document.getElementById('note');
const FRAME_MS = 80;
let zoom = Number(localStorage.getItem('divan.office.zoom1')) || 1;
let chats = {}, count = 0, office = null, wasm = null, img = null, css = 1, shown = [], started = false, pending = [];

// A product's colour, the same every time.
function hue(name) { let h = 7; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
const tone = (room) => `hsl(${hue(room)} 70% 62%)`;

// Laid out at a size that seats every chat on one floor, then only scaled to
// the window: the units decide the desks, so they grow with the chats, and the
// zoom only changes how big a unit is drawn. (fit() alone keeps the office
// about the same number of units tall whatever the window, so a busy office
// spilled onto floors nobody sees.)
const BASE_DESKS = 24;   // what fit() lays out for a 1400×860 window
function layout() {
  const dpr = window.devicePixelRatio || 1;
  const base = office.fit(1400, 860);
  const k = Math.sqrt(Math.max(1, (count * 1.7) / BASE_DESKS));
  const units = [Math.round(base[0] * k), Math.round(base[1] * k)];
  const scale = office.scale();
  const fitW = (innerWidth - 24) / units[0], fitH = (innerHeight - 24) / units[1];
  return { units, css: Math.max(0.5, Math.min(fitW, fitH)) * zoom, scale, dpr };
}

function land(t, line) { try { office.send_hook(line, t); } catch (e) { /* a line no source names */ } }

function overlay() {
  let data;
  try { data = JSON.parse(office.overlay_json()); } catch (e) { return; }
  const kids = labelsEl.children;
  shown = [];
  const groups = new Map();
  let i = 0;
  for (const L of data.labels) {
    const short = L.text.includes('·') ? L.text.split('·').pop() : L.text;
    const chat = chats[short] || null;
    const room = chat ? chat.room : 'Terminal';
    const text = chat ? chat.title.replace(/^[^·]{1,30} · /, '') : L.text;
    let el = kids[i];
    if (!el) { el = document.createElement('div'); el.className = 'lb'; labelsEl.appendChild(el); }
    if (el.textContent !== text) el.textContent = text;
    el.style.fontSize = Math.round(8 * Math.max(1, zoom)) + 'px';
    el.style.maxWidth = Math.round(96 * Math.max(1, zoom)) + 'px';
    el.style.color = L.ink;
    el.style.backgroundColor = L.plate;
    el.style.boxShadow = `inset 0 0 0 1px ${tone(room)}`;
    const x = L.x * css, y = L.y * css;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    shown.push({ x, y, chat });
    if (!groups.has(room)) groups.set(room, []);
    groups.get(room).push({ x, y });
    i++;
  }
  while (kids.length > i) labelsEl.removeChild(kids[kids.length - 1]);
  // A sign over each product's corner: centred over its people, above the highest.
  const zk = zonesEl.children;
  let j = 0;
  for (const [room, pts] of groups) {
    let el = zk[j];
    if (!el) { el = document.createElement('div'); el.className = 'zone'; zonesEl.appendChild(el); }
    const label = `${room} · ${pts.length}`;
    if (el.textContent !== label) el.textContent = label;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    // Over the first desk of the corner: the top row's leftmost person.
    const top = Math.min(...ys);
    const x = Math.min(...pts.filter((p) => p.y - top < 4).map((p) => p.x)), y = top - 14 * Math.max(1, zoom);
    el.style.borderColor = tone(room);
    el.style.color = tone(room);
    el.style.fontSize = Math.round(11 * Math.max(1, zoom)) + 'px';
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    j++;
  }
  while (zk.length > j) zonesEl.removeChild(zk[zk.length - 1]);
}

function draw(now) {
  const { units, css: c } = layout();
  css = c;
  void units;
  const written = office.step(now, units[0], units[1]);
  const scale = office.scale();
  const fw = units[0] * scale, fh = units[1] * scale;
  if (canvas.width !== fw || canvas.height !== fh) { canvas.width = fw; canvas.height = fh; img = null; }
  const cw = units[0] * css + 'px', ch = units[1] * css + 'px';
  if (canvas.style.width !== cw) { canvas.style.width = cw; canvas.style.height = ch; stage.style.width = cw; stage.style.height = ch; }
  if (written || !img) {
    if (!img) img = new ImageData(fw, fh);
    img.data.set(new Uint8ClampedArray(wasm.memory.buffer, office.frame_ptr(), office.frame_len()));
    ctx.putImageData(img, 0, 0);
  }
  overlay();
}

// The character under a click: the nearest name tag, the sprite being just under it.
stage.addEventListener('click', (e) => {
  const box = canvas.getBoundingClientRect();
  const x = e.clientX - box.left, y = e.clientY - box.top;
  let best = null, bestD = 60 * Math.max(1, zoom);
  for (const s of shown) {
    const d = Math.hypot(x - s.x, (y - (s.y + 22 * css)) * 0.8);
    if (d < bestD) { best = s; bestD = d; }
  }
  if (!best || !best.chat) { closeBubble(); return; }
  openBubble(best.chat);
});

// ── the speech bubble: what a chat is doing, and a line to write into it ──
const bubble = document.getElementById('bubble');
const bTitle = bubble.querySelector('.b-title'), bState = bubble.querySelector('.b-state');
const bLog = bubble.querySelector('.b-log'), bInput = bubble.querySelector('textarea');
let open = null, bTimer = null;

function openBubble(chat) {
  open = chat;
  bTitle.textContent = chat.title;
  bLog.innerHTML = '';
  bState.textContent = '';
  bubble.hidden = false;
  bInput.value = '';
  refresh();
  clearInterval(bTimer);
  bTimer = setInterval(refresh, 2500);
}
function closeBubble() { open = null; bubble.hidden = true; clearInterval(bTimer); }
bubble.querySelector('.b-close').onclick = (e) => { e.stopPropagation(); closeBubble(); };
bubble.addEventListener('click', (e) => e.stopPropagation());
bubble.querySelector('.b-open').onclick = () => {
  if (!open) return;
  const msg = { type: 'office-open', chat: open.id };
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  if (window.parent !== window) window.parent.postMessage(msg, '*');
};

async function refresh() {
  if (!open) return;
  const id = open.id;
  try {
    const res = await fetch(`chat?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (!res.ok || !open || open.id !== id) return;
    const d = await res.json();
    bState.textContent = d.status === 'idle' ? 'waiting for you' : 'working…';
    bState.dataset.busy = d.status === 'idle' ? '' : '1';
    const atEnd = bLog.scrollHeight - bLog.scrollTop - bLog.clientHeight < 30;
    bLog.replaceChildren(...d.items.map((it) => {
      const row = document.createElement('div');
      row.className = 'b-' + it.who;
      row.textContent = it.text;
      return row;
    }));
    if (atEnd) bLog.scrollTop = bLog.scrollHeight;
  } catch (e) { /* the next tick tries again */ }
}

async function send() {
  const text = bInput.value.trim();
  if (!open || !text) return;
  bInput.disabled = true;
  try {
    const res = await fetch(`send?token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: open.id, text, client_id: 'office-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }),
    });
    if (res.ok) { bInput.value = ''; setTimeout(refresh, 400); }
    else bState.textContent = 'not sent (' + res.status + ')';
  } catch (e) { bState.textContent = 'not sent'; }
  bInput.disabled = false;
  bInput.focus();
}
bubble.querySelector('.b-send').onclick = send;
bInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBubble(); });

let last = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (!started || now - last < FRAME_MS) return;
  last = now;
  if (pending.length) { for (const [t, l] of pending) land(t, l); pending = []; }
  draw(Date.now());
}

function setZoom(z) { zoom = Math.max(0.5, Math.min(4, z)); localStorage.setItem('divan.office.zoom1', String(zoom)); }
document.getElementById('zin').onclick = () => setZoom(zoom * 1.25);
document.getElementById('zout').onclick = () => setZoom(zoom / 1.25);
addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
let pinch = null;
const dist = (e) => { const [a, b] = e.touches; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1; };
addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { d: dist(e), z: zoom }; }, { passive: true });
addEventListener('touchmove', (e) => { if (pinch && e.touches.length === 2) setZoom(pinch.z * dist(e) / pinch.d); }, { passive: true });
addEventListener('touchend', () => { pinch = null; }, { passive: true });

// Polled, not streamed: a stream through the Cloudflare tunnel can sit in a
// buffer and leave the page empty.
let seq = 0, failures = 0;
function setRooms(d) { chats = d.chats || {}; count = d.count || Object.keys(chats).length; }
async function poll() {
  try {
    const res = await fetch(`poll?after=${seq}&token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (res.status === 404) { note.textContent = 'The office is off on this computer.'; return; }
    if (!res.ok) { if (failures === 2) report('poll ' + res.status); throw new Error(String(res.status)); }
    const d = await res.json();
    if (d.reset) {
      setRooms(d.rooms);
      if (!started) {
        const kept = d.backlog || [];
        const { units } = layout();
        office.step(kept.length ? kept[0][0] - 1 : Date.now(), units[0], units[1]);
        for (const [t, l] of kept) land(t, l);
        started = true;
      }
    }
    for (const it of d.items || []) {
      if (it[0] === 'rooms') { setRooms(it[1]); continue; }
      pending.push([it[1], it[2]]);
    }
    seq = d.seq;
    failures = 0;
    note.textContent = count ? '' : 'Quiet for now: a chat walks in when it starts.';
  } catch (e) {
    failures++;
    if (failures > 2) note.textContent = 'Lost the computer, trying again…';
  }
  setTimeout(poll, 1500);
}

try { wasm = await init(); } catch (e) { report('wasm: ' + (e && (e.stack || e.message) || e)); throw e; }
office = Office.live((Date.now() / 86400000) | 0);
requestAnimationFrame(loop);
poll();
