/** The Divan seal as the app's icon and splash, read the way prebuild reads it:
 *  the effective Expo config (app.json through app.config.js), and the pixels
 *  of the images it names. Each must be the one seal — square-drawn, clear of
 *  the platform's mask, with the iOS icon opaque.
 *
 *  Run: node scripts/test-brand.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { getConfig } = require('@expo/config');

const root = path.join(__dirname, '..');
const { exp } = getConfig(root, { skipSDKVersionRequirement: true });

/** An 8-bit, non-interlaced RGB or RGBA PNG, as rows of RGBA. */
function decode(file) {
  const buf = fs.readFileSync(path.join(root, file));
  let w, h, type, idat = [];
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at), kind = buf.toString('latin1', at + 4, at + 8), data = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9];
      assert.equal(data[8], 8, `${file}: 8-bit`); assert.equal(data[12], 0, `${file}: not interlaced`);
    }
    if (kind === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const n = { 2: 3, 6: 4 }[type];
  assert.ok(n, `${file}: RGB or RGBA, got colour type ${type}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * n, px = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= n ? line[i - n] : 0, b = prev[i], c = i >= n ? prev[i - n] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[i] = (line[i] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) px[(y * w + x) * 4 + k] = k < n ? line[x * n + k] : 255;
    prev = line;
  }
  return { w, h, alpha: n === 4, px };
}

/** Where the turquoise ink lies: its bounding box and farthest reach from centre. */
function ink(img) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1, reach = 0, count = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const i = (y * img.w + x) * 4, [r, g, b, a] = img.px.subarray(i, i + 4);
    if (a < 128 || b - r < 80 || g - r < 80) continue;   // turquoise: blue and green well over red
    count++;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    reach = Math.max(reach, Math.hypot(x + 0.5 - img.w / 2, y + 0.5 - img.h / 2));
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, reach, count };
}

const checks = [];
const ok = (name, fn) => { try { fn(); checks.push(['ok', name]); } catch (e) { checks.push(['FAIL', `${name}: ${e.message}`]); } };

// The seal's own proportions, from the in-app copy cut to the drawing at full
// size: every placed copy must keep them (a stretched seal is not the seal).
const seal = ink(decode('assets/divan-seal.png'));
const RATIO = seal.w / seal.h;
const undistorted = (box, what) =>
  assert.ok(Math.abs(box.w / box.h / RATIO - 1) < 0.02, `${what}: seal ${box.w}x${box.h}, ratio ${(box.w / box.h).toFixed(3)} vs ${RATIO.toFixed(3)}`);

ok('the in-app seal is the turquoise seal, cut to the drawing and nearly round', () => {
  assert.ok(Math.abs(RATIO - 1) < 0.04, `ratio ${RATIO}`);
  assert.ok(seal.count > 10000, `${seal.count} ink pixels`);
});

ok('iOS icon: 1024 square, opaque, the seal centred with margin for the mask', () => {
  const img = decode(exp.ios?.icon ?? exp.icon);
  assert.deepEqual([img.w, img.h], [1024, 1024]);
  assert.equal(img.alpha, false, 'no alpha channel');
  const box = ink(img);
  undistorted(box, 'icon');
  // The rounded-square mask cuts ~22% corners; the round seal must stay
  // inside a circle inscribed well within it.
  assert.ok(box.reach <= 0.42 * 1024, `reach ${box.reach}`);
  assert.ok(Math.min(box.x0, box.y0, 1023 - box.x1, 1023 - box.y1) >= 60, 'margin ≥ 60 px each side');
  assert.ok(Math.abs((box.x0 + box.x1) / 2 - 511.5) < 4 && Math.abs((box.y0 + box.y1) / 2 - 511.5) < 4, 'centred');
});

ok('splash: the seal on a transparent square over the dark splash ground', () => {
  assert.equal(exp.splash.resizeMode, 'contain');
  assert.equal(exp.splash.backgroundColor, '#0F0E0C');
  const img = decode(exp.ios?.splash?.image ?? exp.splash.image);
  assert.equal(img.w, img.h);
  assert.ok(img.alpha && img.px[3] === 0, 'transparent corner');
  undistorted(ink(img), 'splash');
});

ok('Android adaptive icon: the seal inside the 66% safe circle, on the icon ground', () => {
  const img = decode(exp.android.adaptiveIcon.foregroundImage);
  assert.deepEqual([img.w, img.h], [1024, 1024]);
  assert.ok(img.alpha && img.px[3] === 0, 'transparent foreground');
  const box = ink(img);
  undistorted(box, 'adaptive');
  assert.ok(box.reach <= 0.33 * 1024, `reach ${box.reach}`);
  const ios = decode(exp.icon);
  const ground = '#' + [...ios.px.subarray(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  assert.equal(exp.android.adaptiveIcon.backgroundColor, ground);
});

ok('favicon: the seal, small and opaque', () => {
  const img = decode(exp.web.favicon);
  assert.deepEqual([img.w, img.h, img.alpha], [48, 48, false]);
  assert.ok(ink(img).count > 200);
});

for (const [mark, name] of checks) console.log(`  ${mark.padEnd(5)} ${name}`);
const failed = checks.filter(([m]) => m !== 'ok');
if (failed.length) { console.error(`${failed.length} brand checks failed`); process.exit(1); }
console.log(`all ${checks.length} brand checks passed`);
