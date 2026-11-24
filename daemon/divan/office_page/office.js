// The office page: one pixtuoid office (pixtuoid_web.js, MIT, with Divan's
// `live` mode) for every chat on this computer, fed the hook lines the daemon
// makes of them (office.py). Each product has a section of the one office: a
// block of desk pods its chats sit at, outlined in its colour, with its logo
// on a sign over it. The pixels are the engine's; the sections, signs and
// name tags are drawn here, and a click on a character opens its chat.
import init, { Office } from './pixtuoid_web.js?v=1795518000';

const token = new URLSearchParams(location.search).get('token') || '';
function report(what) {
  try { fetch('report?token=' + encodeURIComponent(token), { method: 'POST', body: String(what).slice(0, 1500) }); } catch (e) { /* nothing more */ }
}
addEventListener('error', (e) => report('error: ' + (e.message || e) + ' @' + (e.filename || '') + ':' + (e.lineno || '')));
addEventListener('unhandledrejection', (e) => report('rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));

const scroller = document.getElementById('scroller');
const stage = document.getElementById('stage');
const canvas = document.getElementById('office');
const ctx = canvas.getContext('2d');
const labelsEl = document.getElementById('labels');
const zonesEl = document.getElementById('zones');
const note = document.getElementById('note');
const FRAME_MS = 80;
const TERMINAL = 'Terminal', OTHER = 'Other';
// 1 = the whole office fills the window; it opens bigger than that, to be
// panned round like a real floor.
let zoom = Number(localStorage.getItem('divan.office.zoom2')) || 1.6;
let chats = {}, logos = {}, office = null, wasm = null, img = null, css = 1, shown = [], started = false, pending = [];
const sessionRoom = new Map();   // session id -> the product it is work on

// A product's colour, the same every time.
function hue(name) { let h = 7; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
const tone = (room) => `hsl(${hue(room)} 70% 62%)`;

// ── who sits where ──────────────────────────────────────────────────────
// The engine lays its desks out in 2×2 pods, in a grid of pod columns and pod
// rows (`desks_json`). A product gets whole pod columns, left to right, as
// many as its chats need; the office grows until every product has its own.
function podGrid(desks) {
  const cluster = (vals) => {
    const u = [...new Set(vals)].sort((a, b) => a - b);
    let step = Infinity;
    for (let i = 1; i < u.length; i++) step = Math.min(step, u[i] - u[i - 1]);
    const of = new Map();
    let g = 0;
    // Desks in a pod sit one desk apart; the next pod is further.
    u.forEach((v, i) => { if (i && v - u[i - 1] > step + 4) g++; of.set(v, g); });
    return { of, n: u.length ? g + 1 : 0 };
  };
  const cx = cluster(desks.map((d) => d[0])), cy = cluster(desks.map((d) => d[1]));
  return { cols: cx.n, rows: cy.n, col: (d) => cx.of.get(d[0]), row: (d) => cy.of.get(d[1]) };
}

function members() {
  // Every live session by product, each product's in the order they came.
  const by = new Map();
  for (const c of Object.values(chats)) {
    if (!by.has(c.room)) by.set(c.room, []);
    by.get(c.room).push({ id: c.id, since: c.since || 0 });
  }
  for (const [sid, room] of sessionRoom) {
    if (room !== TERMINAL) continue;
    if (!by.has(TERMINAL)) by.set(TERMINAL, []);
    by.get(TERMINAL).push({ id: sid, since: 0 });
  }
  for (const list of by.values()) list.sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
  return [...by.entries()].sort((a, b) => (a[0] === TERMINAL) - (b[0] === TERMINAL) || (a[0] === OTHER) - (b[0] === OTHER)
    || b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

let planned = { key: '', units: [0, 0], seats: new Map(), sections: [] };
const deskCache = new Map();
function desksAt(units) {
  const key = units.join('x');
  if (!deskCache.has(key)) deskCache.set(key, JSON.parse(office.desks_json(units[0], units[1])));
  return deskCache.get(key);
}

function plan() {
  const groups = members();
  const key = JSON.stringify(groups.map(([r, l]) => [r, l.map((m) => m.id)]));
  if (key === planned.key) return planned;
  const base = office.fit(1400, 860);
  let best = null;
  for (let k = 1.6; k <= 4.01 && !best; k += 0.1) {
    const units = [Math.round(base[0] * k), Math.round(base[1] * k)];
    const desks = desksAt(units);
    const g = podGrid(desks);
    if (!g.cols || !g.rows) continue;
    // Each column's desks; a product takes columns left to right until it
    // has a desk for every chat (an edge column can be half a pod).
    const colDesks = Array.from({ length: g.cols }, () => []);
    desks.forEach((d, i) => colDesks[g.col(d)].push({ i, d, row: g.row(d) }));
    const seats = new Map(), sections = [];
    let col = 0, fits = true;
    for (const [room, list] of groups) {
      const pool = [];
      do { if (col >= g.cols) { fits = false; break; } pool.push(...colDesks[col++]); } while (pool.length < list.length);
      if (!fits) break;
      // A section fills row by row across its columns, so a product with two
      // columns sits side by side, not down one column first.
      pool.sort((a, b) => a.row - b.row || a.d[1] - b.d[1] || a.d[0] - b.d[0]);
      list.forEach((m, n) => seats.set(m.id, pool[n].i));
      sections.push({ room, count: list.length, desks: pool.map((s) => s.d) });
    }
    if (!fits) continue;
    best = { key, units, seats, sections };
  }
  if (!best) {
    // More products than the biggest office has columns: one office, seated as they come.
    best = { key, units: [Math.round(base[0] * 4), Math.round(base[1] * 4)], seats: new Map(), sections: [] };
  }
  planned = best;
  return best;
}

function seatAll() {
  for (const [sid, idx] of planned.seats) office.seat(sid, idx);
}

function layout() {
  const units = plan().units;
  const fitW = (scroller.clientWidth - 48) / units[0], fitH = (scroller.clientHeight - 68) / units[1];
  return { units, css: Math.max(0.4, Math.min(fitW, fitH)) * zoom };
}

function landIn(room, t, line) {
  let body = null;
  try { body = JSON.parse(line); } catch (e) { /* not ours to read */ }
  const sid = body && body.session_id;
  if (sid && !sessionRoom.has(sid)) sessionRoom.set(sid, room || TERMINAL);
  try { office.send_hook(line, t); } catch (e) { /* a line no source names */ }
  if (sid && body.hook_event_name === 'SessionEnd') sessionRoom.delete(sid);
}

// ── drawing ─────────────────────────────────────────────────────────────
// A section's box: round the desks its product was given, a little out.
const DESK_W = 22, DESK_H = 12;
function sections() {
  const kids = zonesEl.children;
  let j = 0;
  for (const s of planned.sections) {
    if (!s.desks.length) continue;
    let el = kids[j];
    if (!el) {
      el = document.createElement('div');
      el.className = 'zone';
      el.innerHTML = '<div class="sign"><span class="logo"></span><b></b><i></i></div>';
      zonesEl.appendChild(el);
    }
    const xs = s.desks.map((d) => d[0]), ys = s.desks.map((d) => d[1]);
    const x0 = Math.min(...xs) - 5, x1 = Math.max(...xs) + DESK_W + 5;
    const y0 = Math.min(...ys) - 12, y1 = Math.max(...ys) + DESK_H + 8;
    el.style.left = x0 * css + 'px'; el.style.top = y0 * css + 'px';
    el.style.width = (x1 - x0) * css + 'px'; el.style.height = (y1 - y0) * css + 'px';
    el.style.setProperty('--tone', tone(s.room));
    el.style.borderWidth = Math.max(1, Math.round(0.5 * css)) + 'px';
    const sign = el.firstChild;
    sign.style.fontSize = Math.max(8, Math.round(2.4 * css)) + 'px';
    sign.querySelector('b').textContent = s.room;
    sign.querySelector('i').textContent = String(s.count);
    const logo = sign.querySelector('.logo');
    const src = logos[s.room] || '';
    if (logo.dataset.src !== src || !logo.firstChild) {
      logo.dataset.src = src;
      logo.replaceChildren();
      if (src) { const im = new Image(); im.src = src; im.alt = ''; logo.appendChild(im); }
      else logo.textContent = s.room === TERMINAL ? '>_' : s.room.slice(0, 1).toUpperCase();
    }
    j++;
  }
  while (kids.length > j) zonesEl.removeChild(kids[kids.length - 1]);
}

function overlay() {
  let data;
  try { data = JSON.parse(office.overlay_json()); } catch (e) { return; }
  const kids = labelsEl.children;
  shown = [];
  let i = 0;
  for (const L of data.labels) {
    const short = L.text.includes('·') ? L.text.split('·').pop() : L.text;
    const chat = chats[short] || null;
    const room = chat ? chat.room : TERMINAL;
    const text = chat ? chat.title.replace(/^[^·]{1,30} · /, '') : L.text;
    let el = kids[i];
    if (!el) { el = document.createElement('div'); el.className = 'lb'; labelsEl.appendChild(el); }
    if (el.textContent !== text) el.textContent = text;
    el.style.fontSize = Math.max(8, Math.round(2.2 * css)) + 'px';
    el.style.maxWidth = Math.round(26 * css) + 'px';
    el.style.color = L.ink;
    el.style.backgroundColor = L.plate;
    el.style.boxShadow = `inset 0 0 0 1px ${tone(room)}`;
    const x = L.x * css, y = L.y * css;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    shown.push({ x, y, chat });
    i++;
  }
  while (kids.length > i) labelsEl.removeChild(kids[kids.length - 1]);
  sections();
}

function size() {
  const { units, css: c } = layout();
  css = c;
  const cw = units[0] * css + 'px', ch = units[1] * css + 'px';
  if (canvas.style.width !== cw || canvas.style.height !== ch) {
    canvas.style.width = cw; canvas.style.height = ch; stage.style.width = cw; stage.style.height = ch;
  }
  return units;
}

let seatedKey = '';
function draw(now) {
  const units = size();
  if (planned.key !== seatedKey) { seatAll(); seatedKey = planned.key; }
  const written = office.step(now, units[0], units[1]);
  const scale = office.scale();
  const fw = units[0] * scale, fh = units[1] * scale;
  if (canvas.width !== fw || canvas.height !== fh) { canvas.width = fw; canvas.height = fh; img = null; }
  if (written || !img) {
    if (!img) img = new ImageData(fw, fh);
    img.data.set(new Uint8ClampedArray(wasm.memory.buffer, office.frame_ptr(), office.frame_len()));
    ctx.putImageData(img, 0, 0);
  }
  overlay();
}

// The character under a click: the nearest name tag, the sprite being just under it.
stage.addEventListener('click', (e) => {
  if (dragged) { dragged = false; return; }  // the end of a pan, not a click
  const box = canvas.getBoundingClientRect();
  const x = e.clientX - box.left, y = e.clientY - box.top;
  let best = null, bestD = 30 * css;
  for (const s of shown) {
    const d = Math.hypot(x - s.x, (y - (s.y + 11 * css)) * 0.8);
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
bubble.addEventListener('pointerdown', (e) => e.stopPropagation());
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
  if (pending.length) { for (const [t, l, r] of pending) landIn(r, t, l); pending = []; seatedKey = ''; }
  draw(Date.now());
}

// ── zoom and pan ────────────────────────────────────────────────────────
// Zoom keeps the spot under the pointer (or the window's middle) where it is.
function setZoom(z, cx = scroller.clientWidth / 2, cy = scroller.clientHeight / 2) {
  z = Math.max(0.5, Math.min(6, z));
  if (z === zoom) return;
  const before = stage.getBoundingClientRect(), port = scroller.getBoundingClientRect();
  const fx = (port.left + cx - before.left) / (before.width || 1), fy = (port.top + cy - before.top) / (before.height || 1);
  zoom = z;
  localStorage.setItem('divan.office.zoom2', String(zoom));
  if (!started) return;
  size();
  const after = stage.getBoundingClientRect();
  scroller.scrollLeft += after.left + fx * after.width - (port.left + cx);
  scroller.scrollTop += after.top + fy * after.height - (port.top + cy);
}
document.getElementById('zin').onclick = (e) => { e.stopPropagation(); setZoom(zoom * 1.25); };
document.getElementById('zout').onclick = (e) => { e.stopPropagation(); setZoom(zoom / 1.25); };
scroller.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;  // a plain wheel or two fingers pans
  e.preventDefault();
  const port = scroller.getBoundingClientRect();
  setZoom(zoom * Math.exp(-e.deltaY * 0.01), e.clientX - port.left, e.clientY - port.top);
}, { passive: false });

// Drag to pan with a mouse; a finger pans by itself.
let drag = null, dragged = false;
scroller.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, l: scroller.scrollLeft, t: scroller.scrollTop, id: e.pointerId };
  dragged = false;
});
addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!dragged && Math.hypot(dx, dy) < 5) return;
  if (!dragged) { dragged = true; scroller.classList.add('dragging'); }
  scroller.scrollLeft = drag.l - dx;
  scroller.scrollTop = drag.t - dy;
});
addEventListener('pointerup', () => { drag = null; scroller.classList.remove('dragging'); });

let pinch = null;
const dist = (e) => { const [a, b] = e.touches; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1; };
const mid = (e) => { const [a, b] = e.touches; const port = scroller.getBoundingClientRect();
  return [(a.clientX + b.clientX) / 2 - port.left, (a.clientY + b.clientY) / 2 - port.top]; };
scroller.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { d: dist(e), z: zoom }; }, { passive: true });
scroller.addEventListener('touchmove', (e) => {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  setZoom(pinch.z * dist(e) / pinch.d, ...mid(e));
}, { passive: false });
scroller.addEventListener('touchend', () => { pinch = null; }, { passive: true });

// ── the feed ────────────────────────────────────────────────────────────
// Polled, not streamed: a stream through the Cloudflare tunnel can sit in a
// buffer and leave the page empty.
let seq = 0, failures = 0, firstSize = true;
function setRooms(d) {
  chats = d.chats || {};
  logos = d.logos || {};
  const ids = new Set(Object.values(chats).map((c) => c.id));
  for (const c of Object.values(chats)) sessionRoom.set(c.id, c.room);
  // A chat that left the list leaves its product's count.
  for (const [sid, room] of sessionRoom) if (room !== TERMINAL && !ids.has(sid)) sessionRoom.delete(sid);
}
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
        const units = plan().units;
        office.step(kept.length ? kept[0][0] - 1 : Date.now(), units[0], units[1]);
        for (const [t, l, r] of kept) landIn(r, t, l);
        plan();
        seatAll();
        seatedKey = planned.key;
        started = true;
      }
    }
    for (const it of d.items || []) {
      if (it[0] === 'rooms') { setRooms(it[1]); continue; }
      pending.push([it[1], it[2], it[3]]);
    }
    seq = d.seq;
    failures = 0;
    note.textContent = Object.keys(chats).length ? '' : 'Quiet for now: a chat walks in when it starts.';
    if (started && firstSize) {
      firstSize = false;
      size();
      scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
      scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 3;
    }
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
