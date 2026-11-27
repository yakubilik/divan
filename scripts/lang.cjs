/** Language packs for the Node side (tests and tools of web/ and app/).
 *
 *  The same rule as the daemon's loader (daemon/divan/lang.py): the packs are
 *  in $DIVAN_LANG_DIR, else <$DIVAN_HOME or ~/.divan>/lang, one JSON file per
 *  name: <dir>/<lang>/<name>.json. A missing pack is null, never an error, so a
 *  test without one (GitHub CI has none) skips its Turkish part.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function langDir() {
  const env = (process.env.DIVAN_LANG_DIR || '').trim();
  if (env) return env.replace(/^~(?=$|\/)/, os.homedir());
  const home = (process.env.DIVAN_HOME || '').trim();
  return path.join(home ? home.replace(/^~(?=$|\/)/, os.homedir()) : path.join(os.homedir(), '.divan'), 'lang');
}

/** `<lang>/<name>.json` parsed, or null when it is not there or not readable. */
function load(lang, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(langDir(), lang, `${name}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** Every pack of `lang` under `area` (e.g. 'app'), as `lang.get` hands them
 *  over: `{ 'app/call': {...}, ... }`, or null when there is none. */
function area(lang, name) {
  const base = path.join(langDir(), lang);
  const out = {};
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) {
        try { out[path.relative(base, p).slice(0, -5).split(path.sep).join('/')] = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
      }
    }
  };
  walk(path.join(base, name));
  return Object.keys(out).length ? out : null;
}

/** Print the one skip line the suites use, once per name. */
const told = new Set();
function skip(what) {
  if (told.has(what)) return;
  told.add(what);
  console.log(`  SKIP  ${what}: no language pack`);
}

module.exports = { langDir, load, area, skip };
