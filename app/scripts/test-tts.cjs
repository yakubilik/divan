/** The phone's text frontend for EMA Lightning, against EMA's own Python.
 *
 *  `src/tts/` is a port of ema_lightning's frontend (normalizer-tr with its
 *  fallback policy, then the model's alphabet) and its chunker. There is no
 *  Python here, so the Python's answers are files: `fixtures/tts-frontend.json`
 *  (written by `tts/frontend_fixture.py`) and `tts/vectors.json` (ticket 1/3's
 *  test sentences). A mismatch is printed with both readings.
 *
 *  Run alone: node scripts/test-tts.cjs  — folded into test-ustabasi.cjs.
 */
const { transform } = require('sucrase');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
if (!require.extensions['.ts']) {
  require.extensions['.ts'] = (mod, filename) => mod._compile(transform(fs.readFileSync(filename, 'utf8'),
    { transforms: ['typescript', 'imports'], filePath: filename }).code, filename);
}
const F = require(path.join(root, 'src/tts/frontend.ts'));
const C = require(path.join(root, 'src/tts/chunker.ts'));

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/tts-frontend.json'), 'utf8'));
const vectors = JSON.parse(fs.readFileSync(path.join(root, '../tts/vectors.json'), 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const misses = [];
for (const c of fixture.cases) {
  const spoken = F.frontend(c.text);
  if (spoken !== c.spoken || !same(F.ids(spoken), c.ids)) misses.push({ ...c, got: spoken });
}
const rate = 1 - misses.length / fixture.cases.length;

const checks = [
  ['tts: the fixture has at least 150 inputs', fixture.cases.length >= 150],
  [`tts: normaliser + ids match Python on ${((rate) * 100).toFixed(1)}% of ${fixture.cases.length} inputs (bar 97%)`, rate >= 0.97],
  ['tts: the alphabet is the model\'s own', same(F.VOCAB, vectors.vocab)],
];
for (const category of ['number', 'date', 'time', 'money', 'percent']) {
  const cases = fixture.cases.filter((c) => c.category === category);
  const failed = misses.filter((c) => c.category === category);
  checks.push([`tts: ${category}: ${cases.length - failed.length}/${cases.length} match (at least 10 cases)`,
    cases.length >= 10 && failed.length === 0]);
}
const suffixed = fixture.cases.filter((c) => c.category === 'time' && /\d'/.test(c.text));
checks.push([`tts: ${suffixed.length} times carry a case suffix`, suffixed.length >= 10]);

for (const s of vectors.sentences) {
  const pieces = C.chunk(F.frontend(s.text), 1.0);
  checks.push([`tts: vectors.json ids for "${s.text}"`, pieces.length > 0 && same(F.ids(pieces[0].text), s.ids)]);
}

for (const c of fixture.chunks) {
  const pieces = C.chunk(F.frontend(c.text), c.speed).map((p) => [p.text, p.pause]);
  const ok = same(pieces, c.pieces);
  if (!ok) console.log(`  chunk mismatch (${c.text.length} chars, speed ${c.speed}):\n    py: ${JSON.stringify(c.pieces)}\n    ts: ${JSON.stringify(pieces)}`);
  checks.push([`tts: chunker, ${c.text.length} characters at speed ${c.speed} → ${c.pieces.length} pieces`, ok]);
}
const paragraph = fixture.chunks.find((c) => c.text.length >= 600 && c.speed === 1.0);
checks.push(['tts: a 600-character paragraph is in the chunker fixture', !!paragraph]);

// The port imports nothing that needs a phone.
for (const file of fs.readdirSync(path.join(root, 'src/tts'))) {
  const src = fs.readFileSync(path.join(root, 'src/tts', file), 'utf8');
  const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  checks.push([`tts: ${file} imports only its neighbours`, imports.every((m) => m.startsWith('./'))]);
}

for (const m of misses) console.log(`  tts mismatch [${m.category}] ${JSON.stringify(m.text)}\n    py: ${m.spoken}\n    ts: ${m.got}`);

module.exports = { checks, misses };

if (require.main === module) {
  let bad = 0;
  for (const [name, ok] of checks) { console.log((ok ? '  ok    ' : '  FAIL  ') + name); if (!ok) bad++; }
  console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
  process.exit(bad ? 1 : 0);
}
