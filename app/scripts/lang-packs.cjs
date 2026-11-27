/** The phone's language packs in a test: what `lang.get` would hand over.
 *
 *  `installTr()` puts every `tr/app/*` pack of this machine into src/lang.ts
 *  (the same module the code under test reads) and says whether there was one;
 *  `clear()` takes them away again, for the English checks. Without a pack
 *  (GitHub CI has none) the Turkish checks are skipped, by `skip(what)`.
 */
const path = require('path');
const lang = require('../../scripts/lang.cjs');

const L = require(path.join(__dirname, '..', 'src', 'lang.ts'));

function installTr() {
  const packs = lang.area('tr', 'app');
  L.resetPacks(packs ? { tr: packs } : {});
  return !!packs;
}

const clear = () => L.resetPacks({});

module.exports = { installTr, clear, load: lang.load, skip: lang.skip };
