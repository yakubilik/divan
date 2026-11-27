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

/** Print the one skip line the suites use, once per name. */
const told = new Set();
function skip(what) {
  if (told.has(what)) return;
  told.add(what);
  console.log(`  SKIP  ${what}: no language pack`);
}

module.exports = { langDir, load, skip };
