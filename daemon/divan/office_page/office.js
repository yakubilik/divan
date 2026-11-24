// The office page: one office of rooms side by side, a room per product, each
// room its own pixtuoid office (pixtuoid_web.js, MIT, with Divan's `live` mode) fed the
// hook lines the daemon makes of that product's chats (office.py). Over each
// room hangs a sign with the product's logo. The pixels are the engine's; the
// name tags and signs are drawn here, and a click on a character opens a
// speech bubble with its chat.
import init, { Office } from './pixtuoid_web.js?v=1795518000';

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
  el.innerHTML = '<canvas></canvas><div class="labels"></div><div class="says"></div><div class="sign"><span class="logo"></span><b></b><i></i></div>';
  floor.appendChild(el);
  const r = {
    name, el, canvas: el.querySelector('canvas'), labels: el.querySelector('.labels'), says: el.querySelector('.says'),
    sign: el.querySelector('.sign'), office: Office.live(day + rooms.size * 7919), img: null,
    units: [0, 0], at: [0, 0], people: 0, shown: [], pending: [], primed: false,
  };
  r.ctx = r.canvas.getContext('2d');
  r.sign.querySelector('b').textContent = name;
  r.sign.style.setProperty('--tone', tone(name));
  el.addEventListener('click', (e) => clickRoom(r, e));
  rooms.set(name, r);
  return r;
}

function dropRoom(r) { r.el.remove(); try { r.office.free(); } catch (e) { /* gone */ } rooms.delete(r.name); }

function land(r, t, line) {
  if (!r.primed) { r.office.step(t - 1, ...(r.units[0] ? r.units : roomUnits(r))); r.primed = true; }
  try { r.office.send_hook(line, t); } catch (e) { /* a line no source names */ }
  hear(line, t);
}

// ── what each one is doing: a small bubble beside its name for a moment ──
// The words are the chat screen's step strip's (web/src/lib/steps.ts, WORK,
// SHELL, SERVERS, BUILT_IN), in Turkish, the language the chats are in.
// audit: language-data — the office's copy of the step strip's Turkish words
const DOING = {
  think: 'Düşünüyorum', read: 'Dosyaları okuyorum', search: 'Kodda arıyorum', edit: 'Dosyaları düzenliyorum',
  git: 'Değişikliklere bakıyorum', commit: 'Değişiklikleri kaydediyorum', push: 'Değişiklikleri gönderiyorum',
  github: 'GitHub’a bakıyorum', test: 'Testleri çalıştırıyorum', build: 'Projeyi derliyorum', install: 'Paketleri kuruyorum',
  deploy: 'Yayına alıyorum', cloud: 'Sunucu tarafına bakıyorum', data: 'Veritabanına bakıyorum',
  request: 'Bir servise istek atıyorum', script: 'Bir script çalıştırıyorum', files: 'Dosyalara bakıyorum',
  ticket: 'Ticket kuyruğuyla ilgileniyorum', run: 'Terminalde komut çalıştırıyorum',
  browser: 'Tarayıcıda sayfayı kontrol ediyorum', shot: 'Ekran görüntüsü alıyorum', websearch: 'İnternette arıyorum',
  webread: 'Bir web sayfasını okuyorum', agent: 'Yardımcı ajana iş veriyorum', wait: 'Arka plandaki işi bekliyorum',
  message: 'Başka bir chate mesaj bırakıyorum', skill: 'Nasıl yapılacağına bakıyorum', plan: 'Planı güncelliyorum',
  memory: 'Not alıyorum', mail: 'Maillere bakıyorum', calendar: 'Takvime bakıyorum', docs: 'Dokümanla ilgileniyorum',
  design: 'Tasarımla ilgileniyorum', media: 'Görsel üretiyorum', tool: 'Bir araç kullanıyorum', ask: 'Senden izin bekliyorum',
};
// audit: end-language-data
const SHELL = [
  [/\bustabasi\b/, 'ticket'],
  [/\bgit\s+(-\S+\s+)*push\b/, 'push'],
  [/\bgit\s+(-\S+\s+)*(commit|merge|rebase|cherry-pick)\b/, 'commit'],
  [/\b(vercel|firebase\s+deploy|eas\s+(build|submit|update)|terraform\s+apply|cdk\s+deploy|wrangler\s+(deploy|publish)|launchctl\s+(kickstart|bootstrap|load))\b/, 'deploy'],
  [/\b(pytest|vitest|jest|maestro|playwright\s+test|go\s+test|cargo\s+test)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bscripts\/test[-_]|\btest_\w+\.py\b/, 'test'],
  [/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(build|typecheck)\b|\b(tsc|vite\s+build|xcodebuild|gradlew?|cargo\s+build|make)\b|\bexpo\s+(prebuild|export)\b/, 'build'],
  [/\b(npm|pnpm|yarn|bun)\s+(install|i|add|ci)\b|\b(pip3?|uv)\s+(pip\s+)?(install|sync|add)\b|\bbrew\s+install\b|\bpod\s+install\b/, 'install'],
  [/\bgh\s/, 'github'],
  [/\bgit\s/, 'git'],
  [/\b(aws|gcloud|az|kubectl|docker|ssh|terraform)\s/, 'cloud'],
  [/\b(sqlite3|psql|mysql|redis-cli)\b/, 'data'],
  [/\b(curl|wget|http)\s/, 'request'],
  [/\b(python3?|node|npx|uv\s+run|ruby|deno|bun)\b/, 'script'],
  [/\b(ls|cat|head|tail|sed|awk|grep|rg|find|wc|stat|tree|du|file|jq|diff)\b/, 'files'],
];
const SERVERS = [
  [/screenshot/, 'shot'], [/chrome|playwright|browser|puppeteer|firecrawl/, 'browser'], [/gmail|mail/, 'mail'],
  [/calendar/, 'calendar'], [/docs|drive|notion/, 'docs'], [/firebase|firestore|postgres|supabase/, 'data'],
  [/livepeer|image|video/, 'media'], [/github/, 'github'],
];
const BUILT_IN = {
  Read: 'read', NotebookRead: 'read', Grep: 'search', Glob: 'search', ToolSearch: 'search',
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', WebSearch: 'websearch', WebFetch: 'webread',
  Agent: 'agent', Task: 'agent', Workflow: 'agent', Monitor: 'wait', TaskStop: 'wait', TaskOutput: 'wait',
  ScheduleWakeup: 'wait', SendMessage: 'message', ListAgents: 'message', Skill: 'skill', TodoWrite: 'plan',
  ExitPlanMode: 'plan', DesignSync: 'design',
};
function workOf(name, input) {
  if (name === 'Bash' || name === 'shell') {
    const cmd = String((input && input.command) || '');
    for (const [re, w] of SHELL) if (re.test(cmd)) return w;
    return 'run';
  }
  if (BUILT_IN[name]) return BUILT_IN[name];
  if (/\/memory\//.test(String((input && input.file_path) || ''))) return 'memory';
  const lower = String(name || '').toLowerCase();
  for (const [re, w] of SERVERS) if (re.test(lower)) return w;
  return 'tool';
}

const SAY_MS = 4500;                // how long a bubble stays before it fades
const saying = new Map();           // session id -> { text, until }
function hear(line, t) {
  if (Date.now() - t > SAY_MS) return;  // an old line, replayed as the page opens
  let b;
  try { b = JSON.parse(line); } catch (e) { return; }
  const sid = b.session_id;
  if (!sid) return;
  let work = null;
  if (b.hook_event_name === 'PreToolUse') work = workOf(b.tool_name, b.tool_input);
  else if (b.hook_event_name === 'UserPromptSubmit') work = 'think';
  else if (b.hook_event_name === 'PermissionRequest') work = 'ask';
  else if (b.hook_event_name === 'Stop' || b.hook_event_name === 'SessionEnd') { saying.delete(sid); return; }
  if (work) saying.set(sid, { text: DOING[work] + '…', until: t + SAY_MS });
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
    r.sign.style.fontSize = Math.max(9, Math.round(2.6 * css)) + 'px';
  }
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
  }
  overlay(r);
}

function overlay(r) {
  let data;
  try { data = JSON.parse(r.office.overlay_json()); } catch (e) { return; }
  const kids = r.labels.children;
  r.shown = [];
  let i = 0;
  for (const L of data.labels) {
    const short = L.text.includes('·') ? L.text.split('·').pop() : L.text;
    const chat = chats[short] || null;
    const text = chat ? chat.title.replace(/^[^·]{1,30} · /, '') : L.text;
    let el = kids[i];
    if (!el) { el = document.createElement('div'); el.className = 'lb'; r.labels.appendChild(el); }
    if (el.textContent !== text) el.textContent = text;
    el.style.fontSize = Math.max(8, Math.round(2.6 * css)) + 'px';
    el.style.maxWidth = Math.round(40 * css) + 'px';
    el.style.color = L.ink;
    el.style.backgroundColor = L.plate;
    el.style.boxShadow = `inset 0 0 0 1px ${tone(r.name)}`;
    const x = L.x * css, y = L.y * css;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    r.shown.push({ x, y, chat, w: el.offsetWidth, sid: chat ? chat.id : null });
    i++;
  }
  while (kids.length > i) r.labels.removeChild(kids[kids.length - 1]);
  // The bubbles, beside the name they belong to; one past its time fades out.
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
    el.style.fontSize = Math.max(9, Math.round(2.4 * css)) + 'px';
    el.style.transform = `translate(${s.x + s.w / 2 + 4}px, ${s.y}px) translate(0, -100%)`;
    if (now > say.until + 800) saying.delete(s.sid);
    j++;
  }
  while (bubbles.length > j) r.says.removeChild(bubbles[bubbles.length - 1]);
  if (r.name === TERMINAL) r.visitors = i;
  r.sign.querySelector('i').textContent = String(r.name === TERMINAL ? i : r.people);
}

// The character under a click: the nearest name tag, the sprite being just under it.
function clickRoom(r, e) {
  if (dragged) { dragged = false; return; }  // the end of a pan, not a click
  e.stopPropagation();
  const box = r.canvas.getBoundingClientRect();
  const x = e.clientX - box.left, y = e.clientY - box.top;
  let best = null, bestD = 30 * css;
  for (const s of r.shown) {
    const d = Math.hypot(x - s.x, (y - (s.y + 11 * css)) * 0.8);
    if (d < bestD) { best = s; bestD = d; }
  }
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
  for (const r of rooms.values()) if (r.pending.length) { for (const [t, l] of r.pending) land(r, t, l); r.pending = []; }
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
    const logo = r.sign.querySelector('.logo');
    const src = logos[r.name] || '';
    if (logo.dataset.src !== src) {
      logo.dataset.src = src;
      logo.replaceChildren();
      if (src) { const img = new Image(); img.src = src; img.alt = ''; logo.appendChild(img); }
      else logo.textContent = r.name === TERMINAL ? '>_' : r.name.slice(0, 1).toUpperCase();
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
