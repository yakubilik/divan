#!/usr/bin/env node
/** The panel a daemon is serving right now, asked whether it carries the Divan
 *  seal: the page links the three icons, each one and the seal itself is a
 *  PNG that is there, and the bundle draws the seal. Run it after a merge and
 *  a rebuild; it says which commit the served bundle came from.
 *
 *     node scripts/check-live-brand.mjs [http://127.0.0.1:8790]
 */
const base = (process.argv[2] ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

const build = await fetch(`${base}/build.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
console.log(`── ${base}, built from ${build?.sha ?? 'an unknown commit'}`);
const html = await (await fetch(`${base}/`)).text();
const links = [...html.matchAll(/<link rel="(icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[2]);
ok('the page links the 32 and 64 px tab icons and the touch icon',
  ['/favicon-32.png', '/favicon-64.png', '/apple-touch-icon.png'].every((h) => links.includes(h)), links.join(', '));
for (const path of ['/divan-seal.png', '/favicon-32.png', '/favicon-64.png', '/apple-touch-icon.png']) {
  const r = await fetch(`${base}${path}`);
  ok(`${path} is served as a PNG`, r.ok && r.headers.get('content-type') === 'image/png',
    `${r.status} ${r.headers.get('content-type')}`);
}
const script = html.match(/<script type="module"[^>]*src="([^"]+)"/)?.[1];
const bundle = script ? await (await fetch(`${base}${script}`)).text() : '';
ok('the bundle draws the seal on the line', bundle.includes('/divan-seal.png'), script ?? 'no script tag');

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
