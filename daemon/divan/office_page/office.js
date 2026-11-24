// The office page: one office of rooms side by side, a room per product, each
// room its own pixtuoid office (pixtuoid_web.js, MIT, with Divan's `live` mode) fed the
// hook lines the daemon makes of that product's chats (office.py). Over each
// room's whiteboard carries the product's logo. The pixels are the engine's; the
// name tags and logos are drawn here, and a click on a character opens a
// speech bubble with its chat.
import init, { Office } from './pixtuoid_web.js?v=1795538000';

const token = new URLSearchParams(location.search).get('token') || '';
function report(what) {
  try { fetch('report?token=' + encodeURIComponent(token), { method: 'POST', body: String(what).slice(0, 1500) }); } catch (e) { /* nothing more */ }
}
addEventListener('error', (e) => report('error: ' + (e.message || e) + ' @' + (e.filename || '') + ':' + (e.lineno || '')));
addEventListener('unhandledrejection', (e) => report('rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));

const scroller = document.getElementById('scroller');
const floor = document.getElementById('stage');
const note = document.getElementById('note');
const FRAME_MS = 80;
const TERMINAL = 'Terminal', OTHER = 'Other';
// 1 = the whole floor fits the window; it opens bigger than that, to be
// panned round like a real floor.
let zoom = Number(localStorage.getItem('divan.office.zoom2')) || 1.6;
let chats = {}, logos = {}, wasm = null, css = 1, started = false, day = (Date.now() / 86400000) | 0;
const rooms = new Map();   // product name -> its room

// A product's colour, the same every time.
function hue(name) { let h = 7; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
const tone = (room) => `hsl(${hue(room)} 70% 62%)`;

// ── a room ──────────────────────────────────────────────────────────────
// Every room is as tall as the others, so the rooms stand side by side as one
// office: one window wall end to end, one floor, a room's walls the only line
// between two products. A room is as wide as it needs to seat its chats.
let roomH = 0;
function roomUnits(r) {
  if (!roomH) roomH = Math.round(r.office.fit(1400, 860)[1] * 1.1);
  const n = Math.max(1, r.people);
  r.widths = r.widths || new Map();
  if (r.widths.has(n)) return [r.widths.get(n), roomH];
  let w = Math.round(roomH * 0.75);
  while (w < roomH * 8 && JSON.parse(r.office.desks_json(w, roomH)).length < n) w += 8;
  r.widths.set(n, w);
  return [w, roomH];
}

function makeRoom(name) {
  const el = document.createElement('section');
  el.className = 'room';
  el.innerHTML = '<canvas></canvas><div class="labels"></div><div class="says"></div>';
  floor.appendChild(el);
  const r = {
    name, el, canvas: el.querySelector('canvas'), labels: el.querySelector('.labels'), says: el.querySelector('.says'),
    office: Office.live(day + rooms.size * 7919), img: null,
    units: [0, 0], at: [0, 0], people: 0, shown: [], pending: [], primed: false,
  };
  r.ctx = r.canvas.getContext('2d');
  el.addEventListener('click', (e) => clickRoom(r, e));
  el.addEventListener('pointermove', (e) => hoverRoom(r, e));
  el.addEventListener('pointerleave', () => { hot = null; });
  rooms.set(name, r);
  return r;
}

function dropRoom(r) { r.el.remove(); try { r.office.free(); } catch (e) { /* gone */ } rooms.delete(r.name); }

function land(r, t, line, live = false) {
  if (!r.primed) { r.office.step(t - 1, ...(r.units[0] ? r.units : roomUnits(r))); r.primed = true; }
  try { r.office.send_hook(line, t); } catch (e) { /* a line no source names */ }
  if (live) hear(line);
}

// ── what each one is doing: a small bubble beside its name ──────────────
// In the chat screen's own words: its step strip's module (web/src/lib/steps.ts,
// built to /office-steps.js beside the panel), fed the steps of each chat's
// current turn. While it works the bubble says what it is doing now and how
// many steps so far; when it stops, what the turn was, for a moment.
let STEPS = null;
import('../office-steps.js?v=1795536000').then((m) => { STEPS = m; }, (e) => report('office-steps: ' + e));

const SAY_MS = 5000;                // how long the closing summary stays
const saying = new Map();           // session id -> { text, until }
const turns = new Map();            // session id -> the steps of its turn so far
function sayNow(sid) {
  const steps = turns.get(sid) || [];
  const n = steps.length;
  const text = n ? STEPS.tell(steps, true, 'tr').text : STEPS.doingNow([], 'tr');
  saying.set(sid, { text: n ? `${text} · ${STEPS.counted(n, 'tr')}` : text, until: Infinity });
}
// Only lines that arrive while the page is open speak, timed by this page's
// own clock: a line's stamp is the daemon's, and another computer's clock or
// a slow tunnel would make every line look old.
function hear(line) {
  if (!STEPS) return;
  let b;
  try { b = JSON.parse(line); } catch (e) { return; }
  const sid = b.session_id;
  if (!sid) return;
  const ev = b.hook_event_name;
  if (ev === 'UserPromptSubmit') {
    if (!turns.has(sid) || saying.get(sid)?.until !== Infinity) turns.set(sid, []);
    sayNow(sid);
  } else if (ev === 'PreToolUse') {
    if (!turns.has(sid)) turns.set(sid, []);
    turns.get(sid).push({ kind: 'tool', id: b.tool_use_id || String(Math.random()), tool: b.tool_name || 'Tool',
      input: b.tool_input || {}, running: true, isError: false });
    sayNow(sid);
  } else if (ev === 'PostToolUse') {
    const step = (turns.get(sid) || []).find((s) => s.running && (!b.tool_use_id || s.id === b.tool_use_id));
    if (step) step.running = false;
  } else if (ev === 'PermissionRequest') {
    saying.set(sid, { text: 'Senden izin bekliyorum…', until: Infinity });
  } else if (ev === 'Stop') {
    const steps = turns.get(sid) || [];
    turns.delete(sid);
    if (!steps.length) { saying.delete(sid); return; }
    const told = STEPS.tell(steps, false, 'tr');
    saying.set(sid, { text: `${told.text} · ${STEPS.counted(steps.length, 'tr')}`, until: Date.now() + SAY_MS });
  } else if (ev === 'SessionEnd') {
    turns.delete(sid);
    saying.delete(sid);
  }
}

function roomFor(name) { return rooms.get(name) || makeRoom(name); }

// ── the floor plan ──────────────────────────────────────────────────────
// One row, biggest product first, the rooms touching.
function plan() {
  const list = [...rooms.values()].filter((r) => r.people > 0 || r.name === TERMINAL && r.visitors > 0);
  for (const r of rooms.values()) r.el.hidden = !list.includes(r);
  if (!list.length) return [0, 0];
  for (const r of list) r.units = roomUnits(r);
  list.sort((a, b) => (a.name === TERMINAL) - (b.name === TERMINAL) || (a.name === OTHER) - (b.name === OTHER)
    || b.people - a.people || a.name.localeCompare(b.name));
  let x = 0;
  for (const r of list) { r.at = [x, 0]; x += r.units[0]; }
  return [x, roomH];
}

// Sizes everything to the zoom; the pixels underneath stay the engine's.
let floorUnits = [0, 0];
function size() {
  floorUnits = plan();
  const fitW = (scroller.clientWidth - 48) / (floorUnits[0] || 1), fitH = (scroller.clientHeight - 48) / (floorUnits[1] || 1);
  css = Math.max(0.3, Math.min(fitW, fitH)) * zoom;
  floor.style.width = floorUnits[0] * css + 'px';
  floor.style.height = floorUnits[1] * css + 'px';
  for (const r of rooms.values()) {
    if (r.el.hidden) continue;
    const s = r.el.style;
    s.left = r.at[0] * css + 'px'; s.top = r.at[1] * css + 'px';
    s.width = r.units[0] * css + 'px'; s.height = r.units[1] * css + 'px';
  }
}

// Where a room's logo goes: the piece of furniture it is painted onto, as
// its box in units [left, top, width, height] and what it is. The rolling
// whiteboard by the wall is placed by its top-left, an aisle one by its
// centre; both are 14×11. Without one, the screen on the wall (14×12), then
// the cork board (10×6).
function boardSpot(r) {
  const key = r.units.join('x');
  if (r.spotKey === key) return r.spot;
  let items = [];
  try { items = JSON.parse(r.office.decor_json(r.units[0], r.units[1])); } catch (e) { /* none */ }
  const wall = items.find((d) => d[0] === 'WallWhiteboard');
  const aisle = items.find((d) => d[0] === 'Whiteboard');
  const screen = items.find((d) => d[0] === 'WallMeetingScreen');
  const cork = items.find((d) => d[0] === 'WallBulletinBoard');
  r.spot = wall ? { kind: 'board', box: [wall[1], wall[2], 14, 11] }
    : aisle ? { kind: 'board', box: [aisle[1] - 7, aisle[2] - 5.5, 14, 11] }
    : screen ? { kind: 'screen', box: [screen[1], screen[2], 14, 12] }
    : cork ? { kind: 'cork', box: [cork[1], cork[2], 10, 6] }
    : null;
  r.spotKey = key;
  r.face = null;
  return r.spot;
}

// The face the logo is painted on, found in the frame itself: a whiteboard's
// white, a screen's display (its bluish dark), a cork board's brown. In art
// pixels, with the face's own colour.
function findFace(r) {
  const spot = boardSpot(r);
  if (!spot || !r.img) return null;
  const k = r.office.scale(), W = r.img.width, H = r.img.height, d = r.img.data;
  const [bx, by, bw, bh] = spot.box.map((v) => Math.round(v * k));
  const isFace = spot.kind === 'board' ? (R, G, B) => R > 175 && G > 175 && B > 175
    : spot.kind === 'screen' ? (R, G, B) => B > R + 12 && R + G + B < 330
    : (R, G, B) => R > G + 20 && G > B && R > 120;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, sr = 0, sg = 0, sb = 0, n = 0;
  for (let y = Math.max(0, by); y < Math.min(H, by + bh); y++) {
    for (let x = Math.max(0, bx); x < Math.min(W, bx + bw); x++) {
      const o = (y * W + x) * 4;
      if (!isFace(d[o], d[o + 1], d[o + 2])) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      sr += d[o]; sg += d[o + 1]; sb += d[o + 2]; n++;
    }
  }
  if (n < 20 || x1 - x0 < 6 || y1 - y0 < 4) return null;
  const bg = spot.kind === 'screen' ? '#141a26' : `rgb(${sr / n | 0},${sg / n | 0},${sb / n | 0})`;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, bg };
}

// The logo painted into the room's own pixels, the way the art would have it:
// the whole face cleared to its colour, the logo as big as it holds, at the
// art's resolution with hard edges.
function paintLogo(r) {
  if (!r.logoImg || !r.logoImg.complete || !r.logoImg.naturalWidth) return;
  if (!r.face) r.face = findFace(r);
  const f = r.face;
  if (!f) return;
  const c = r.ctx;
  c.fillStyle = f.bg;
  c.fillRect(f.x, f.y, f.w, f.h);
  const side = Math.max(4, Math.min(f.w, f.h) - 2);
  if (!r.logoArt || r.logoArt.width !== side) r.logoArt = pixelLogo(r.logoImg, side, r.spot.kind === 'screen');
  c.drawImage(r.logoArt, f.x + ((f.w - side) >> 1), f.y + ((f.h - side) >> 1));
}

// The logo shrunk to `px` art pixels, with hard alpha: pixel art has no
// half-clear edge. On a screen its white ground goes, so it lights the
// display instead of sitting on it as a card.
function pixelLogo(img, px, dropWhite = false) {
  const cv = document.createElement('canvas');
  cv.width = px; cv.height = px;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, px, px);
  const d = g.getImageData(0, 0, px, px);
  for (let k = 3; k < d.data.length; k += 4) {
    const white = d.data[k - 3] > 225 && d.data[k - 2] > 225 && d.data[k - 1] > 225;
    d.data[k] = d.data[k] < 110 || (dropWhite && white) ? 0 : 255;
  }
  g.putImageData(d, 0, 0);
  return cv;
}

// ── drawing ─────────────────────────────────────────────────────────────
function drawRoom(r, now) {
  const written = r.office.step(now, r.units[0], r.units[1]);
  const scale = r.office.scale();
  const fw = r.units[0] * scale, fh = r.units[1] * scale;
  if (r.canvas.width !== fw || r.canvas.height !== fh) { r.canvas.width = fw; r.canvas.height = fh; r.img = null; }
  if (written || !r.img) {
    if (!r.img) r.img = new ImageData(fw, fh);
    r.img.data.set(new Uint8ClampedArray(wasm.memory.buffer, r.office.frame_ptr(), r.office.frame_len()));
    r.ctx.putImageData(r.img, 0, 0);
    paintLogo(r);
  }
  overlay(r);
}

// Two boxes [left, top, right, bottom] that overlap, with a pixel to spare.
const hits = (p, q) => p[0] < q[2] + 1 && q[0] < p[2] + 1 && p[1] < q[3] + 1 && q[1] < p[3] + 1;
// Lift `box` until it overlaps none of `placed`; returns how far it went up.
function lift(box, placed) {
  let up = 0;
  for (let guard = 0; guard < 12; guard++) {
    const b = [box[0], box[1] - up, box[2], box[3] - up];
    const clash = placed.find((q) => hits(b, q));
    if (!clash) return up;
    up += b[3] - clash[1] + 1;
  }
  return up;
}

// A desk is 22 units from the next: a name tag is never wider than that, so
// neighbours' tags sit side by side instead of on top of each other. The
// whole name is the hover's.
const TAG_W = 20;
// audit: end-language-data

function overlay(r) {
  let data;
  try { data = JSON.parse(r.office.overlay_json()); } catch (e) { return; }
  const kids = r.labels.children;
  const placed = [];
  r.shown = [];
  let i = 0;
  // Top rows first, so a lifted tag only ever moves into free space above.
  const labels = [...data.labels].sort((p, q) => p.y - q.y || p.x - q.x);
  for (const L of labels) {
    const short = L.text.includes('·') ? L.text.split('·').pop() : L.text;
    const chat = chats[short] || null;
    const text = chat ? chat.title.replace(/^[^·]{1,30} · /, '') : L.text;
    let el = kids[i];
    if (!el) { el = document.createElement('div'); el.className = 'lb'; r.labels.appendChild(el); }
    if (el.textContent !== text) el.textContent = text;
    el.style.fontSize = Math.max(8, Math.round(2.2 * css)) + 'px';
    el.style.maxWidth = Math.round(TAG_W * css) + 'px';
    el.style.color = L.ink;
    el.style.backgroundColor = L.plate;
    el.style.boxShadow = `inset 0 0 0 1px ${tone(r.name)}`;
    el.style.setProperty('--ring', tone(r.name));
    const key = chat ? chat.id : L.text;
    el.classList.toggle('hot', hot === key);
    const x = L.x * css;
    const w = el.offsetWidth, h = el.offsetHeight;
    let y = L.y * css;
    y -= lift([x - w / 2, y - h, x + w / 2, y], placed);
    placed.push([x - w / 2, y - h, x + w / 2, y]);
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    r.shown.push({ x, y, chat, w, h, key, sid: chat ? chat.id : null, ink: L.ink, plate: L.plate });
    i++;
  }
  while (kids.length > i) r.labels.removeChild(kids[kids.length - 1]);

  // The bubbles: just over the name they belong to, clear of every tag and of
  // each other; one past its time fades out.
  const now = Date.now();
  const bubbles = r.says.children;
  let j = 0;
  for (const s of r.shown) {
    const say = s.sid && saying.get(s.sid);
    if (!say) continue;
    let el = bubbles[j];
    if (!el) { el = document.createElement('div'); el.className = 'say'; r.says.appendChild(el); }
    if (el.textContent !== say.text) el.textContent = say.text;
    el.classList.toggle('gone', now > say.until);
    // In the name tag's own type and colours, the product's line round it.
    el.style.fontSize = Math.max(8, Math.round(2.2 * css)) + 'px';
    el.style.color = s.ink;
    el.style.backgroundColor = s.plate;
    el.style.boxShadow = `inset 0 0 0 1px ${tone(r.name)}`;
    el.style.setProperty('--ring', tone(r.name));
    const w = el.offsetWidth, h = el.offsetHeight;
    let y = s.y - s.h - 3;
    y -= lift([s.x - w / 2, y - h, s.x + w / 2, y], placed);
    placed.push([s.x - w / 2, y - h, s.x + w / 2, y]);
    el.style.transform = `translate(${s.x}px, ${y}px) translate(-50%, -100%)`;
    if (now > say.until + 800) saying.delete(s.sid);
    j++;
  }
  while (bubbles.length > j) r.says.removeChild(bubbles[bubbles.length - 1]);
  if (r.name === TERMINAL) r.visitors = i;
}

// The one under the pointer: its name tag if the pointer is on one (the last
// drawn, the one on top), else the nearest character, the sprite being just
// under its tag.
function under(r, e) {
  const box = r.canvas.getBoundingClientRect();
  const x = e.clientX - box.left, y = e.clientY - box.top;
  for (let i = r.shown.length - 1; i >= 0; i--) {
    const s = r.shown[i];
    if (Math.abs(x - s.x) <= s.w / 2 && y <= s.y && y >= s.y - s.h) return s;
  }
  let best = null, bestD = 30 * css;
  for (const s of r.shown) {
    const d = Math.hypot(x - s.x, (y - (s.y + 11 * css)) * 0.8);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best;
}

// Whoever the mouse is over comes to the front, its whole name lit.
let hot = null;
function hoverRoom(r, e) {
  if (drag && dragged) return;
  const s = under(r, e);
  hot = s ? s.key : null;
  r.el.style.cursor = s && s.chat ? 'pointer' : '';
}

function clickRoom(r, e) {
  if (dragged) { dragged = false; return; }  // the end of a pan, not a click
  e.stopPropagation();
  const best = under(r, e);
  if (!best || !best.chat) { closeBubble(); return; }
  openBubble(best.chat);
}
scroller.addEventListener('click', () => { if (dragged) { dragged = false; return; } closeBubble(); });

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
  for (const r of rooms.values()) if (r.pending.length) { for (const [t, l] of r.pending) land(r, t, l, true); r.pending = []; }
  size();
  const t = Date.now();
  for (const r of rooms.values()) if (!r.el.hidden || r.name === TERMINAL) drawRoom(r, t);
}

// ── zoom and pan ────────────────────────────────────────────────────────
// Zoom keeps the spot under the pointer (or the window's middle) where it is.
function setZoom(z, cx = scroller.clientWidth / 2, cy = scroller.clientHeight / 2) {
  z = Math.max(0.5, Math.min(6, z));
  if (z === zoom) return;
  const before = floor.getBoundingClientRect(), port = scroller.getBoundingClientRect();
  const fx = (port.left + cx - before.left) / (before.width || 1), fy = (port.top + cy - before.top) / (before.height || 1);
  zoom = z;
  localStorage.setItem('divan.office.zoom2', String(zoom));
  if (!started) return;
  size();
  const after = floor.getBoundingClientRect();
  scroller.scrollLeft += after.left + fx * after.width - (port.left + cx);
  scroller.scrollTop += after.top + fy * after.height - (port.top + cy);
}
document.getElementById('zin').onclick = (e) => { e.stopPropagation(); setZoom(zoom * 1.25); };
document.getElementById('zout').onclick = (e) => { e.stopPropagation(); setZoom(zoom / 1.25); };
scroller.addEventListener('wheel', (e) => {
  // The wheel zooms, round the pointer; moving round is the drag's.
  e.preventDefault();
  const port = scroller.getBoundingClientRect();
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;  // lines, from some mice
  setZoom(zoom * Math.exp(-Math.max(-60, Math.min(60, dy)) * (e.ctrlKey ? 0.01 : 0.004)), e.clientX - port.left, e.clientY - port.top);
}, { passive: false });

// Drag to pan with a mouse or a finger.
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

// Who sits in which room. A chat filed under another product moves room: the
// floor is rebuilt from the daemon's whole picture rather than walked across.
function setRooms(d) {
  const moved = Object.entries(d.chats || {}).some(([s, c]) => chats[s] && chats[s].room !== c.room);
  chats = d.chats || {};
  logos = d.logos || {};
  const people = {};
  for (const c of Object.values(chats)) people[c.room] = (people[c.room] || 0) + 1;
  for (const name of Object.keys(people)) roomFor(name);
  for (const r of rooms.values()) {
    r.people = people[r.name] || 0;
    const src = logos[r.name] || '';
    if (r.logoSrc !== src) {
      r.logoSrc = src;
      r.logoImg = null; r.logoArt = null;
      if (src) { const im = new Image(); im.src = src; r.logoImg = im; }
    }
  }
  return moved;
}

function rebuild() {
  for (const r of [...rooms.values()]) dropRoom(r);
  chats = {};
  started = false;
  seq = 0;
}

async function poll() {
  try {
    const res = await fetch(`poll?after=${seq}&token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (res.status === 404) { note.textContent = 'The office is off on this computer.'; return; }
    if (!res.ok) { if (failures === 2) report('poll ' + res.status); throw new Error(String(res.status)); }
    const d = await res.json();
    if (d.reset) {
      if (started) rebuild();
      setRooms(d.rooms);
      for (const [t, l, room] of d.backlog || []) land(roomFor(room), t, l);
      started = true;
    }
    for (const it of d.items || []) {
      if (it[0] === 'rooms') { if (setRooms(it[1])) { rebuild(); break; } continue; }
      roomFor(it[3] || TERMINAL).pending.push([it[1], it[2]]);
    }
    if (seq !== 0 || d.reset) seq = d.seq;
    failures = 0;
    note.textContent = Object.keys(chats).length ? '' : 'Quiet for now: a chat walks in when it starts.';
    if (started && firstSize) {
      firstSize = false;
      size();
      scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
      scroller.scrollTop = 0;
    }
  } catch (e) {
    failures++;
    if (failures > 2) note.textContent = 'Lost the computer, trying again…';
  }
  setTimeout(poll, 1500);
}

try { wasm = await init(); } catch (e) { report('wasm: ' + (e && (e.stack || e.message) || e)); throw e; }
requestAnimationFrame(loop);
poll();
