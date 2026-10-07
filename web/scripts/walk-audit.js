/** What `test-walk-ui.mjs` reads off a built page, run inside the page.
 *  Returns the offenders for each HANDOVER §2 rule; an empty list is a pass.
 *  `phone` turns on the 44px hit-area rule, which is a phone-layout rule. */
export const AUDIT = `
const phone = __PHONE__;
const out = { blur: [], contrast: [], small: [], unlabelled: [], emoji: [] };
const visible = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || e.getAttribute('aria-hidden') === 'true' || e.hidden) return false;
  }
  return true;
};
const name = (el) => (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')
  + ' "' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40) + '"');

for (const el of document.querySelectorAll('*')) {
  const s = getComputedStyle(el);
  if ((s.backdropFilter && s.backdropFilter !== 'none') || (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none')) out.blur.push(name(el));
}

// ── contrast: the text's colour, with every opacity above it, over the first
// opaque surface behind it, each translucent layer composited on the way.
const rgba = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
  const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const surface = (el) => {
  const layers = [];
  for (let e = el; e; e = e.parentElement) {
    const c = rgba(getComputedStyle(e).backgroundColor);
    if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
  }
  let base = rgba(getComputedStyle(document.getElementById('root')).getPropertyValue('--canvas').trim()
    .replace(/^#(..)(..)(..)$/, (m, r, g, b) => 'rgb(' + parseInt(r, 16) + ',' + parseInt(g, 16) + ',' + parseInt(b, 16) + ')')) || [24, 25, 28, 1];
  for (let i = layers.length - 1; i >= 0; i--) base = layers[i][3] >= 1 ? layers[i] : over(layers[i], base);
  return base;
};
for (const el of document.querySelectorAll('#root *')) {
  const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  if (!own || !visible(el) || el.closest('[disabled], [aria-disabled="true"]')) continue;
  const s = getComputedStyle(el);
  let fg = rgba(s.color); if (!fg) continue;
  let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
  const bg = surface(el);
  fg = over([fg[0], fg[1], fg[2], fg[3] * op], bg);
  const r = ratio(fg, bg);
  if (r < 4.5) out.contrast.push(name(el) + ' ' + r.toFixed(2) + ':1');
}

// ── interactive things
const interactive = [...document.querySelectorAll('#root button, #root a[href], #root input:not([type=hidden]), #root select, #root textarea, #root summary, #root [role=button], #root [role=tab], #root [role=switch]')]
  .filter((el) => visible(el) && !el.disabled);
for (const el of interactive) {
  const text = (el.textContent || '').trim() || (el.value || '').trim();
  const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
    || (el.id && document.querySelector('label[for="' + el.id + '"]')) || el.closest('label');
  if (!text && !labelled) out.unlabelled.push(name(el) + ' ' + el.outerHTML.slice(0, 120));
  if (!phone) continue;
  // The hit area, sampled: every point of the 44px square centred on the
  // target must land on the target (or what it holds).
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let hit = true;
  for (const [dx, dy] of [[-21, -21], [21, -21], [-21, 21], [21, 21], [0, -21], [0, 21], [-21, 0], [21, 0]]) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const at = document.elementFromPoint(x, y);
    if (!at || !(at === el || el.contains(at))) { hit = false; break; }
  }
  if (!hit && (r.width < 44 || r.height < 44)) out.small.push(name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
}

// ── emoji, anywhere in what the page says
const walker = document.createTreeWalker(document.getElementById('root'), NodeFilter.SHOW_TEXT);
const pict = /\\p{Extended_Pictographic}/u;
for (let n = walker.nextNode(); n; n = walker.nextNode()) {
  if (pict.test(n.textContent)) out.emoji.push(JSON.stringify(n.textContent.trim().slice(0, 40)));
}
for (const el of document.querySelectorAll('#root [aria-label], #root [title], #root [placeholder]')) {
  for (const a of ['aria-label', 'title', 'placeholder']) if (pict.test(el.getAttribute(a) || '')) out.emoji.push(a + ' ' + JSON.stringify(el.getAttribute(a)));
}
return out;
`;
