#!/usr/bin/env node
/** Photos and videos in a chat: the size of the bubble (#607, the web twin of
 *  the phone's #552). A phone video stays upright, a landscape one stays wide,
 *  a square stays square, and only a shape more extreme than the frame (1:4,
 *  4:1) is clamped — the one case that crops. What the bubbles look like in a
 *  browser is `test-media-ui.mjs`.
 *
 *     cd web && npm test
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'media');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/lib/media-size.ts', '--outDir', out, '--rootDir', '.',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--strict', '--skipLibCheck',
], { cwd: web, stdio: 'inherit' });
const S = await import(pathToFileURL(join(out, 'src/lib/media-size.js')));

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const B = S.BUBBLE;
const portrait = S.bubbleSize(1080, 1920);
const landscape = S.bubbleSize(1920, 1080);
const square = S.bubbleSize(1200, 1200);
const tall = S.bubbleSize(500, 2000);
const wide = S.bubbleSize(2000, 500);
const unknown = S.bubbleSize(undefined, 0);
const ratio = (b) => b.width / b.height;
const inside = (b) => b.width <= B.maxW && b.height <= B.maxH && b.width >= B.minW && b.height >= B.minH;
const show = (b) => JSON.stringify(b);

console.log('── the size of the bubble');
ok('a 9:16 phone video is a portrait bubble', portrait.height > portrait.width, show(portrait));
ok('…as tall as the frame allows, its whole frame in it (not cropped)',
  portrait.height === B.maxH && !portrait.cropped && Math.abs(ratio(portrait) - 9 / 16) < 0.01, show(portrait));
ok('a 16:9 video is a landscape bubble, as wide as the frame, uncropped',
  landscape.width > landscape.height && landscape.width === B.maxW && !landscape.cropped
  && Math.abs(ratio(landscape) - 16 / 9) < 0.02, show(landscape));
ok('a square is square', square.width === square.height && square.width === B.maxW && !square.cropped, show(square));
ok('an extreme 1:4 is clamped to the narrowest bubble and cropped',
  eq(tall, { width: B.minW, height: B.maxH, cropped: true }), show(tall));
ok('an extreme 4:1 is clamped to the shortest bubble and cropped',
  eq(wide, { width: B.maxW, height: B.minH, cropped: true }), show(wide));
ok('every box stays inside the frame', [portrait, landscape, square, tall, wide, unknown].every(inside));
ok('a small picture is drawn at the frame, not at its pixel size',
  eq(S.bubbleSize(90, 160), S.bubbleSize(1080, 1920)));
ok('a size not known yet gets a 4:3 placeholder',
  eq(unknown, { width: B.maxW, height: Math.round(B.maxW * 0.75), cropped: true }), show(unknown));
ok('nonsense sizes are the placeholder too',
  eq(S.bubbleSize(NaN, 100), unknown) && eq(S.bubbleSize(100, Infinity), unknown) && eq(S.bubbleSize(-5, 10), unknown));
ok('the same frame as the phone app, so both draw the same bubble',
  eq(B, { maxW: 250, maxH: 330, minW: 120, minH: 100 }), show(B));

console.log('── what the viewer pages through');
ok('photos and videos are told apart by kind, then by name',
  S.isPhoto({ kind: 'image' }) && S.isPhoto({ name: 'a.HEIC' }) && !S.isPhoto({ kind: 'video', name: 'a.png' })
  && S.isVideo({ kind: 'video' }) && S.isVideo({ name: 'clip.MOV' }) && !S.isVideo({ name: 'a.jpg' })
  && !S.isVideo({ kind: 'audio', name: 'a.mp4' }));
const url = (p) => `u:${p}`;
ok('the viewer reads the original first, the kept copy after',
  eq(S.viewerSources({ path: '/o.jpg', view: '/v.jpg' }, url), ['u:/o.jpg', 'u:/v.jpg']));
ok('…and once when they are the same file',
  eq(S.viewerSources({ path: '/o.jpg', view: '/o.jpg' }, url), ['u:/o.jpg']));
ok('…and nothing from a computer that gives no address',
  eq(S.viewerSources({ path: '/o.jpg' }, () => ''), []));

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
