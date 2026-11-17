// Nothing a person sees in the app or its store listing carries the name the
// product had before it was called Divan.
//
// The old name survives in exactly three kinds of place, none of them shown to
// anyone: the bundle id (App Store identity, it cannot change), the legacy
// link scheme pair.ts still accepts on input, and test fixtures that use a
// placeholder bundle id. Every hit is matched against that list; anything
// else fails the run with its file and line.
//
// The built app's Info.plist files are checked the same way when a build is
// passed in: `node scripts/test-no-old-name.cjs --app path/to/Divan.app`.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Spelled in pieces, so this file is not itself a hit for scripts/test_no_old_name.py.
const LEGACY = 'remote' + 'aichat';
const OLD = new RegExp('remote[\\s_-]?' + 'ai[\\s_-]?chat', 'i');
const APP = path.resolve(__dirname, '..');
const ROOT = path.resolve(APP, '..');

let failed = 0;
function fail(msg) { failed++; console.error('FAIL ' + msg); }
function ok(msg) { console.log('ok   ' + msg); }

// Hits that are not visible text, by file and by what the line holds.
const ALLOWED = [
  { file: 'app/src/pair.ts', line: new RegExp(`^export const LEGACY_SCHEME = '${LEGACY}';$`), why: 'legacy scheme, accepted on input only' },
  { file: 'app/app.json', line: new RegExp(`"bundleIdentifier": "com\\.example\\.${LEGACY}"`), why: 'placeholder bundle id' },
  { file: 'app/scripts/test-share.cjs', line: new RegExp(`com\\.example\\.${LEGACY}`), why: 'test fixture: placeholder bundle id' },
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    // identity.local.json is the real bundle id, kept out of git on purpose.
    if (e.name === 'identity.local.json' || e.name === 'node_modules' || e.name === 'ios' || e.name === 'android' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?|cjs|mjs|json|plist|strings|swift|m|h|txt|md)$/.test(e.name)) out.push(p);
  }
  return out;
}

// 1. Source, i18n, config, plugins, native modules, scripts — everything in app/.
const files = [...walk(APP), ...['localizations.json', 'app-infos.json', 'review-notes.txt'].map((f) => path.join(ROOT, 'store', f))];
let explained = 0;
for (const f of files) {
  const rel = path.relative(ROOT, f);
  fs.readFileSync(f, 'utf8').split('\n').forEach((text, i) => {
    if (!OLD.test(text)) return;
    const a = ALLOWED.find((x) => x.file === rel && x.line.test(text.trim()));
    if (a) { explained++; return; }
    fail(`${rel}:${i + 1}: ${text.trim()}`);
  });
}
ok(`${files.length} files in app/ and store/ read; ${explained} hits, each a bundle id, the legacy scheme or a fixture`);

// 2. What the app is called: the home screen name, the share sheet name, and
// every permission prompt in app.json.
const app = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8')).expo;
if (app.name !== 'Divan') fail(`app.json name is ${app.name}`);
const shown = [app.name, ...Object.entries(app.ios.infoPlist).filter(([k]) => /UsageDescription$/.test(k)).map(([, v]) => v),
  ...app.plugins.filter(Array.isArray).flatMap(([, o]) => Object.values(o || {}).filter((v) => typeof v === 'string'))];
for (const s of shown) if (OLD.test(s)) fail(`app.json shows "${s}"`);
const share = fs.readFileSync(path.join(APP, 'plugins', 'with-share-extension.js'), 'utf8');
if (!/CFBundleDisplayName: 'Divan'/.test(share)) fail('the share extension is not shown as Divan');
ok(`app name, share extension name and ${shown.length - 1} permission texts say Divan`);

// 3. The store listing names the product Divan.
const infos = JSON.parse(fs.readFileSync(path.join(ROOT, 'store', 'app-infos.json'), 'utf8'));
for (const [loc, v] of Object.entries(infos)) if (!/^Divan\b/.test(v.name)) fail(`store name (${loc}) is ${v.name}`);
ok('store name starts with Divan');

// 4. A built .app, when given: every Info.plist inside it, extensions included.
const at = process.argv.indexOf('--app');
if (at > 0) {
  const bundle = path.resolve(process.argv[at + 1]);
  const plists = execFileSync('find', [bundle, '-name', 'Info.plist']).toString().trim().split('\n').filter(Boolean);
  const bundleId = new RegExp(`^com\\.[a-z0-9]+\\.${LEGACY}(\\.[a-z]+)?$`);
  for (const p of plists) {
    const json = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', p]).toString());
    for (const [k, v] of Object.entries(json)) {
      const s = JSON.stringify(v);
      if (!OLD.test(s)) continue;
      // The bundle id, and the URL type that registers the legacy scheme.
      if (k === 'CFBundleIdentifier' && bundleId.test(v)) { console.log(`     ${path.relative(bundle, p)} ${k}=${v} (bundle id)`); continue; }
      // Expo Router's Handoff activity type, named after the bundle id; never shown.
      if (k === 'NSUserActivityTypes' && v.every((x) => !OLD.test(x) || bundleId.test(x.split('.').slice(0, 3).join('.')))) { console.log(`     ${path.relative(bundle, p)} ${k}=${v.join(',')} (bundle id)`); continue; }
      if (k === 'CFBundleURLTypes') {
        const schemes = v.flatMap((t) => t.CFBundleURLSchemes || []);
        if (schemes.every((x) => !OLD.test(x) || x === LEGACY || bundleId.test(x))) { console.log(`     ${path.relative(bundle, p)} ${k}=${schemes.join(',')} (link schemes)`); continue; }
      }
      fail(`${path.relative(bundle, p)} ${k}: ${s}`);
    }
  }
  ok(`${plists.length} Info.plist files in ${path.basename(bundle)} read`);
}

if (failed) { console.error(`${failed} visible use(s) of the old name`); process.exit(1); }
console.log('no visible old name');
