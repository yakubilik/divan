// Turkish numerals, suffixes and the fixed word lists, ported from normalizer-tr 0.4.0
// (https://github.com/erdemtuna/normalizer-tr, Apache-2.0): numerals.rs, morphology.rs,
// domain/lexicon.rs and fallback/spelling.rs. Same names, same order, so a change upstream can be
// followed file by file. Integers are kept as digit strings: magnitudes go up to 10^18 - 1, past
// what a JS number holds exactly.

export type Inflection = 'ordinal' | 'accusative' | 'dative' | 'locative' | 'ablative' | 'genitive' | 'derivation';
type Harmony = 'backFlat' | 'frontFlat' | 'backRound' | 'frontRound';
type WordEnd = 'vowel' | 'voiced' | 'voiceless' | 'softens' | 'softensP' | 'possessive';

export type Word = { text: string; harmony: Harmony; end: WordEnd };
const word = (text: string, harmony: Harmony, end: WordEnd): Word => ({ text, harmony, end });

const HIGH: Record<Harmony, string> = { backFlat: 'ı', frontFlat: 'i', backRound: 'u', frontRound: 'ü' };
const LOW: Record<Harmony, string> = { backFlat: 'a', backRound: 'a', frontFlat: 'e', frontRound: 'e' };

/** The suffix as written after an apostrophe on a word with this ending. */
export function sourceSuffix(w: Word, inflection: Inflection): string {
  const high = HIGH[w.harmony];
  const low = LOW[w.harmony];
  const vowel = w.end === 'vowel' || w.end === 'possessive';
  const stop = w.end === 'voiceless' || w.end === 'softens' || w.end === 'softensP' ? 't' : 'd';
  if (w.end === 'possessive') {
    if (inflection === 'accusative') return `n${high}`;
    if (inflection === 'dative') return `n${low}`;
    if (inflection === 'locative') return `nd${low}`;
    if (inflection === 'ablative') return `nd${low}n`;
  }
  switch (inflection) {
    case 'ordinal': return vowel ? `nc${high}` : `${high}nc${high}`;
    case 'accusative': return vowel ? `y${high}` : high;
    case 'dative': return vowel ? `y${low}` : low;
    case 'locative': return `${stop}${low}`;
    case 'ablative': return `${stop}${low}n`;
    case 'genitive': return vowel ? `n${high}n` : `${high}n`;
    case 'derivation': return `l${high}k`;
  }
}

/** Spoken text and its last word, so a suffix is chosen from what is said, never re-read from text. */
export class Spoken {
  constructor(public text: string, public tail: Word) {}
  static lexical(text: string, tail: Word): Spoken { return new Spoken(text, { ...tail }); }
  static fromWords(words: Word[]): Spoken {
    const spoken = new Spoken('', word('sıfır', 'backFlat', 'voiced'));
    for (const w of words) spoken.appendWord(w);
    return spoken;
  }
  prefix(prefix: string) { this.text = prefix + this.text; }
  appendLiteral(text: string) { this.text += text; }
  appendWord(w: Word) {
    if (this.text) this.text += ' ';
    this.text += w.text;
    this.tail = { ...w };
  }
  sourceSuffix(inflection: Inflection): string { return sourceSuffix(this.tail, inflection); }
  inflect(inflection: Inflection) {
    const suffix = this.sourceSuffix(inflection);
    const vowelSuffix = inflection === 'ordinal' || inflection === 'accusative' || inflection === 'dative' || inflection === 'genitive';
    if (this.tail.end === 'softens' && vowelSuffix) this.text = popChar(this.text) + 'd';
    if (this.tail.end === 'softensP' && vowelSuffix) this.text = popChar(this.text) + 'b';
    this.text += suffix;
    if (inflection === 'ordinal') this.tail.end = 'vowel';
    else if (inflection === 'derivation') this.tail.end = 'voiceless';
  }
}

function popChar(text: string): string {
  const chars = Array.from(text);
  chars.pop();
  return chars.join('');
}

const CASES: Inflection[] = ['accusative', 'dative', 'locative', 'ablative', 'genitive'];

export function integerInflection(spoken: Spoken, suffix: string): Inflection | null {
  return (['ordinal', ...CASES] as Inflection[]).find((i) => spoken.sourceSuffix(i) === suffix) ?? null;
}
export function caseInflection(source: Word, suffix: string): Inflection | null {
  return CASES.find((i) => sourceSuffix(source, i) === suffix) ?? null;
}
export function spokenCase(spoken: Spoken, suffix: string): Inflection | null {
  return CASES.find((i) => spoken.sourceSuffix(i) === suffix) ?? null;
}

// ── numerals.rs ─────────────────────────────────────────────────────────────

const DIGITS: Word[] = [
  word('sıfır', 'backFlat', 'voiced'), word('bir', 'frontFlat', 'voiced'), word('iki', 'frontFlat', 'vowel'),
  word('üç', 'frontRound', 'voiceless'), word('dört', 'frontRound', 'softens'), word('beş', 'frontFlat', 'voiceless'),
  word('altı', 'backFlat', 'vowel'), word('yedi', 'frontFlat', 'vowel'), word('sekiz', 'frontFlat', 'voiced'),
  word('dokuz', 'backRound', 'voiced'),
];
const TENS: Word[] = [
  word('on', 'backRound', 'voiced'), word('yirmi', 'frontFlat', 'vowel'), word('otuz', 'backRound', 'voiced'),
  word('kırk', 'backFlat', 'voiceless'), word('elli', 'frontFlat', 'vowel'), word('altmış', 'backFlat', 'voiceless'),
  word('yetmiş', 'frontFlat', 'voiceless'), word('seksen', 'frontFlat', 'voiced'), word('doksan', 'backFlat', 'voiced'),
];
const HUNDRED = word('yüz', 'frontRound', 'voiced');
const SCALES: Word[] = [
  word('bin', 'frontFlat', 'voiced'), word('milyon', 'backRound', 'voiced'), word('milyar', 'backFlat', 'voiced'),
  word('trilyon', 'backRound', 'voiced'), word('katrilyon', 'backRound', 'voiced'),
];

/** Below 10^18, the bound every parser enforces. */
export const MAGNITUDE_DIGITS = 18;

export type Sign = '' | '+' | '-';

export type Num = { sign: Sign; integer: string; fraction: string; grouped: boolean };

const ascii = (s: string, re: RegExp) => s.length > 0 && re.test(s);
export const allDigits = (s: string) => ascii(s, /^[0-9]+$/);

/** An exact written number: sign, dot-grouped thousands, comma and 1-9 decimals. */
export function parseNumber(text: string, allowPadding = false): Num | null {
  let sign: Sign = '';
  let body = text;
  if (text[0] === '-' || text[0] === '+') { sign = text[0] as Sign; body = text.slice(1); }
  const parts = body.split(',');
  if (parts.length > 2) return null;
  const whole = parts[0];
  const fraction = parts.length === 2 ? parts[1] : null;
  if (fraction !== null && (fraction.length < 1 || fraction.length > 9 || !/^[0-9]*$/.test(fraction))) return null;
  const grouped = whole.includes('.');
  let integer = '';
  const groups = whole.split('.');
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    if (!allDigits(group)
      || (!allowPadding && index === 0 && group.length > 1 && group.startsWith('0'))
      || (grouped && index === 0 && group.length > 3)
      || (index > 0 && group.length !== 3)) return null;
    integer += group;
    integer = integer.replace(/^0+(?=.)/, '');
    if (integer.length > MAGNITUDE_DIGITS) return null;
  }
  return { sign, integer, fraction: fraction ?? '', grouped };
}

/** Minor units of an amount (0-99), or null past two decimals. */
export function minor(n: Num): number | null {
  if (n.fraction.length === 0) return 0;
  if (n.fraction.length === 1) return Number(n.fraction) * 10;
  if (n.fraction.length === 2) return Number(n.fraction);
  return null;
}

function pushGroup(value: number, words: Word[]) {
  if (value >= 100) {
    if (Math.floor(value / 100) > 1) words.push(DIGITS[Math.floor(value / 100)]);
    words.push(HUNDRED);
  }
  const rest = value % 100;
  if (rest >= 10) words.push(TENS[Math.floor(rest / 10) - 1]);
  if (rest % 10 !== 0) words.push(DIGITS[rest % 10]);
}

/** A non-negative integer (digit string or small number) read aloud. */
export function cardinal(value: string | number): Spoken {
  const digits = String(value).replace(/^0+(?=.)/, '');
  if (digits === '0') return Spoken.fromWords([DIGITS[0]]);
  const groups: number[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.push(Number(digits.slice(Math.max(0, end - 3), end)));
  const words: Word[] = [];
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index];
    if (group === 0) continue;
    if (index !== 1 || group !== 1) pushGroup(group, words);
    if (index > 0) words.push(SCALES[index - 1]);
  }
  return Spoken.fromWords(words);
}

export const signText = (sign: Sign) => (sign === '+' ? 'artı ' : sign === '-' ? 'eksi ' : '');

export function number(n: Num): Spoken {
  const spoken = cardinal(n.integer);
  spoken.prefix(signText(n.sign));
  if (n.fraction) {
    spoken.appendLiteral(' virgül');
    for (const d of n.fraction) spoken.appendWord(DIGITS[Number(d)]);
  }
  return spoken;
}

export function amount(sign: Sign, major: string, minorUnits: number, majorText: string, majorTail: Word, minorTail: Word): Spoken {
  const spoken = Spoken.lexical(`${signText(sign)}${cardinal(major).text} ${majorText}`, majorTail);
  if (minorUnits !== 0) {
    spoken.appendLiteral(` ${cardinal(minorUnits).text}`);
    spoken.appendWord(minorTail);
  }
  return spoken;
}

/** Digit by digit, `+` as "artı"; anything else is skipped. */
export function digits(text: string): string {
  const out: string[] = [];
  for (const ch of text) {
    if (ch === '+') out.push('artı');
    else if (ch >= '0' && ch <= '9') out.push(DIGITS[Number(ch)].text);
  }
  return out.join(' ');
}

export const digitName = (ch: string): string | null => (ch.length === 1 && ch >= '0' && ch <= '9' ? DIGITS[Number(ch)].text : null);

// ── domain/lexicon.rs ───────────────────────────────────────────────────────

export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/** Turkish lowercase for comparing against a fixed list; never applied to the text itself. */
export function lookupKey(text: string): string {
  let out = '';
  for (const ch of text) out += ch === 'I' ? 'ı' : ch === 'İ' ? 'i' : ch.toLowerCase();
  return out;
}

export type Lexeme = { output: string; source: Word; target: Word };
const same = (output: string, harmony: Harmony, end: WordEnd): Lexeme => {
  const w = word(output, harmony, end);
  return { output, source: w, target: w };
};
const distinct = (output: string, source: Word, target: Word): Lexeme => ({ output, source, target });

const UNITS: [string, Lexeme][] = [
  ['kg', same('kilogram', 'backFlat', 'voiced')],
  ['g', same('gram', 'backFlat', 'voiced')],
  ['gr', same('gram', 'backFlat', 'voiced')],
  ['mg', same('miligram', 'backFlat', 'voiced')],
  ['µg', same('mikrogram', 'backFlat', 'voiced')],
  ['μg', same('mikrogram', 'backFlat', 'voiced')],
  ['km', same('kilometre', 'frontFlat', 'vowel')],
  ['m', same('metre', 'frontFlat', 'vowel')],
  ['cm', same('santimetre', 'frontFlat', 'vowel')],
  ['mm', same('milimetre', 'frontFlat', 'vowel')],
  ['L', same('litre', 'frontFlat', 'vowel')],
  ['lt', same('litre', 'frontFlat', 'vowel')],
  ['mL', same('mililitre', 'frontFlat', 'vowel')],
  ['ml', same('mililitre', 'frontFlat', 'vowel')],
  ['dk', same('dakika', 'backFlat', 'vowel')],
  ['sn', same('saniye', 'frontFlat', 'vowel')],
  ['sa', same('saat', 'frontFlat', 'voiceless')],
  ['m²', same('metrekare', 'frontFlat', 'vowel')],
  ['cm²', same('santimetrekare', 'frontFlat', 'vowel')],
  ['km²', same('kilometrekare', 'frontFlat', 'vowel')],
  ['m³', same('metreküp', 'frontRound', 'softensP')],
];

export const unit = (symbol: string): Lexeme | null => UNITS.find(([key]) => key === symbol)?.[1] ?? null;

const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
export const unitMarker = (symbol: string) => UNITS.some(([key]) => asciiLower(key) === asciiLower(symbol));

export function rate(symbol: string): [Lexeme, Lexeme] | null {
  if (symbol === 'km/sa' || symbol === 'km/h') return [unit('sa')!, unit('km')!];
  if (symbol === 'm/s') return [unit('sn')!, unit('m')!];
  return null;
}

export function abbreviation(symbol: string): Lexeme | null {
  switch (symbol) {
    case 'Dr.': return same('doktor', 'backRound', 'voiced');
    case 'Prof.': return same('profesör', 'frontRound', 'voiced');
    case 'vb.': return distinct('ve benzeri', word('be', 'frontFlat', 'vowel'), word('benzeri', 'frontFlat', 'vowel'));
    case 'TBMM': return distinct('te be me me', word('me', 'frontFlat', 'vowel'), word('me', 'frontFlat', 'vowel'));
    case 'PTT': return distinct('pe te te', word('te', 'frontFlat', 'vowel'), word('te', 'frontFlat', 'vowel'));
    case 'NATO': return same('nato', 'backRound', 'vowel');
    case 'IBAN': return same('iban', 'backFlat', 'voiced');
    case 'KDV': return distinct('katma değer vergisi', word('ve', 'frontFlat', 'vowel'), word('vergisi', 'frontFlat', 'possessive'));
    default: return null;
  }
}

export type Currency = 'TRY' | 'USD' | 'EUR' | 'GBP';

export function currency(label: string): Currency | null {
  switch (label) {
    case 'TL': case 'TRY': case '₺': return 'TRY';
    case 'USD': case '$': return 'USD';
    case 'EUR': case '€': return 'EUR';
    case 'GBP': case '£': return 'GBP';
    default: return null;
  }
}

export function currencyLexeme(c: Currency, label: string): Lexeme {
  switch (c) {
    case 'TRY': return distinct('Türk lirası',
      label === 'TRY' ? word('ye', 'frontFlat', 'vowel') : label === '₺' ? word('lira', 'backFlat', 'vowel') : word('le', 'frontFlat', 'vowel'),
      word('lirası', 'backFlat', 'possessive'));
    case 'USD': return distinct('dolar',
      label === 'USD' ? word('de', 'frontFlat', 'vowel') : word('dolar', 'backFlat', 'voiced'), word('dolar', 'backFlat', 'voiced'));
    case 'EUR': return distinct('avro',
      label === 'EUR' ? word('re', 'frontFlat', 'vowel') : word('avro', 'backRound', 'vowel'), word('avro', 'backRound', 'vowel'));
    case 'GBP': return distinct('sterlin',
      label === 'GBP' ? word('pe', 'frontFlat', 'vowel') : word('sterlin', 'frontFlat', 'voiced'), word('sterlin', 'frontFlat', 'voiced'));
  }
}

export function currencyMinor(c: Currency): Lexeme {
  if (c === 'TRY') return same('kuruş', 'backRound', 'voiceless');
  if (c === 'GBP') return same('peni', 'frontFlat', 'vowel');
  return same('sent', 'frontFlat', 'voiceless');
}

// ── fallback/spelling.rs ────────────────────────────────────────────────────

const LETTERS: Record<string, string> = {
  a: 'a', b: 'be', c: 'ce', ç: 'çe', d: 'de', e: 'e', f: 'fe', g: 'ge', ğ: 'yumuşak ge', h: 'he', ı: 'ı', i: 'i',
  j: 'je', k: 'ke', l: 'le', m: 'me', n: 'ne', o: 'o', ö: 'ö', p: 'pe', q: 'kü', r: 're', s: 'se', ş: 'şe', t: 'te',
  u: 'u', ü: 'ü', v: 've', w: 'çift ve', x: 'iks', y: 'ye', z: 'ze',
};
const UPPER: Record<string, string> = { I: 'ı', İ: 'i', Ç: 'ç', Ğ: 'ğ', Ö: 'ö', Ş: 'ş', Ü: 'ü' };

export function letterName(ch: string): string | null {
  const lower = UPPER[ch] ?? (/^[A-Z]$/.test(ch) ? ch.toLowerCase() : ch);
  return LETTERS[lower] ?? null;
}

const SYMBOLS: Record<string, string> = {
  '.': 'nokta', ',': 'virgül', ':': 'iki nokta', ';': 'noktalı virgül', '/': 'eğik çizgi', '\\': 'ters eğik çizgi',
  '-': 'tire', '–': 'tire', '—': 'tire', '+': 'artı', '−': 'eksi', '=': 'eşittir', '×': 'çarpı işareti',
  '*': 'yıldız', '÷': 'bölme işareti', '%': 'yüzde', '&': 've', '@': 'et', '#': 'kare',
  '<': 'küçüktür işareti', '>': 'büyüktür işareti', '_': 'alt çizgi', '(': 'aç parantez', ')': 'kapat parantez',
  '[': 'aç köşeli parantez', ']': 'kapat köşeli parantez', '{': 'aç süslü parantez', '}': 'kapat süslü parantez',
  "'": 'kesme', '’': 'kesme', '"': 'tırnak', '“': 'tırnak', '”': 'tırnak', '!': 'ünlem', '?': 'soru işareti',
  '|': 'dikey çizgi', '¦': 'dikey çizgi', '`': 'ters kesme', '~': 'tilde', '^': 'şapka işareti', '…': 'üç nokta',
  '°': 'derece işareti', '₺': 'Türk lirası işareti', '$': 'dolar işareti', '€': 'avro işareti', '£': 'sterlin işareti',
  '¥': 'yen işareti', '©': 'telif işareti', '®': 'tescilli marka işareti', '™': 'marka işareti',
  '•': 'nokta işareti', '·': 'nokta işareti', '◦': 'nokta işareti', '▪': 'nokta işareti',
  '→': 'sağ ok', '⇒': 'sağ ok', '←': 'sol ok', '↑': 'yukarı ok', '↓': 'aşağı ok', '✓': 'onay işareti', '✔': 'onay işareti',
  '★': 'yıldız', '☆': 'yıldız', '⭐': 'yıldız', '≈': 'yaklaşık işareti', '≠': 'eşit değil işareti',
  '≤': 'küçük eşit işareti', '≥': 'büyük eşit işareti', '±': 'artı eksi işareti', '∞': 'sonsuzluk işareti',
  '‰': 'binde işareti', '√': 'karekök işareti', 'π': 'pi', '🙂': 'gülümseyen yüz',
};

export const symbolName = (ch: string): string | null => SYMBOLS[ch] ?? null;

const PROSE = new Set(['.', ',', ';', ':', '!', '?', '(', ')', '[', ']', '{', '}', '"', "'", '’', '“', '”', '…', '-', '–', '—']);
export const prosePunctuation = (ch: string) => PROSE.has(ch);
