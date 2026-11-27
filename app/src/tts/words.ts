// Turkish numerals, suffixes and the fixed word lists, ported from normalizer-tr 0.4.0
// (https://github.com/erdemtuna/normalizer-tr, Apache-2.0): numerals.rs, morphology.rs,
// domain/lexicon.rs and fallback/spelling.rs. Same names, same order, so a change upstream can be
// followed file by file. The words themselves are the language pack's (lexicon.ts). Integers are kept
// as digit strings: magnitudes go up to 10^18 - 1, past what a JS number holds exactly.

import { type Harmony, type Inflection, type Lexeme, type Word, lex } from './lexicon';

export type { Inflection, Lexeme, Word } from './lexicon';

// The vowels a suffix takes by harmony: the high one (dotless i, i, u, u with diaeresis) and the low one.
const HIGH: Record<Harmony, string> = { backFlat: '\u0131', frontFlat: 'i', backRound: 'u', frontRound: '\u00fc' };
const LOW: Record<Harmony, string> = { backFlat: 'a', backRound: 'a', frontFlat: 'e', frontRound: 'e' };

/** The suffix as written after an apostrophe on a word with this ending. */
export function sourceSuffix(w: Word, inflection: Inflection): string {
  const L = lex();
  const vowel = w.end === 'vowel' || w.end === 'possessive';
  const stop = w.end === 'voiceless' || w.end === 'softens' || w.end === 'softensP' ? L.stops.voiceless : L.stops.voiced;
  const template = (w.end === 'possessive' ? L.possessive.get(inflection) : undefined) ?? L.suffixes[inflection][vowel ? 0 : 1];
  return template.replace(/\{H\}/g, HIGH[w.harmony]).replace(/\{A\}/g, LOW[w.harmony]).replace(/\{D\}/g, stop);
}

/** Spoken text and its last word, so a suffix is chosen from what is said, never re-read from text. */
export class Spoken {
  constructor(public text: string, public tail: Word) {}
  static lexical(text: string, tail: Word): Spoken { return new Spoken(text, { ...tail }); }
  static fromWords(words: Word[]): Spoken {
    const spoken = new Spoken('', { ...lex().digits[0] });
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
    if ((this.tail.end === 'softens' || this.tail.end === 'softensP') && vowelSuffix) {
      this.text = popChar(this.text) + lex().softened[this.tail.end];
    }
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
  const L = lex();
  if (value >= 100) {
    if (Math.floor(value / 100) > 1) words.push(L.digits[Math.floor(value / 100)]);
    words.push(L.hundred);
  }
  const rest = value % 100;
  if (rest >= 10) words.push(L.tens[Math.floor(rest / 10) - 1]);
  if (rest % 10 !== 0) words.push(L.digits[rest % 10]);
}

/** A non-negative integer (digit string or small number) read aloud. */
export function cardinal(value: string | number): Spoken {
  const L = lex();
  const digits = String(value).replace(/^0+(?=.)/, '');
  if (digits === '0') return Spoken.fromWords([L.digits[0]]);
  const groups: number[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.push(Number(digits.slice(Math.max(0, end - 3), end)));
  const words: Word[] = [];
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index];
    if (group === 0) continue;
    // a lone thousand is said without its "one"
    if (index !== 1 || group !== 1) pushGroup(group, words);
    if (index > 0) words.push(L.scales[index - 1]);
  }
  return Spoken.fromWords(words);
}

export const signText = (sign: Sign) => (sign === '+' ? `${lex().plus} ` : sign === '-' ? `${lex().minus} ` : '');

export function number(n: Num): Spoken {
  const L = lex();
  const spoken = cardinal(n.integer);
  spoken.prefix(signText(n.sign));
  if (n.fraction) {
    spoken.appendLiteral(` ${L.decimal}`);
    for (const d of n.fraction) spoken.appendWord(L.digits[Number(d)]);
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

/** Digit by digit, `+` as the word for plus; anything else is skipped. */
export function digits(text: string): string {
  const L = lex();
  const out: string[] = [];
  for (const ch of text) {
    if (ch === '+') out.push(L.plus);
    else if (ch >= '0' && ch <= '9') out.push(L.digits[Number(ch)].text);
  }
  return out.join(' ');
}

export const digitName = (ch: string): string | null => (ch.length === 1 && ch >= '0' && ch <= '9' ? lex().digits[Number(ch)].text : null);

// ── domain/lexicon.rs ───────────────────────────────────────────────────────

/** The month names, January first. */
export const months = (): string[] => lex().months;

// Turkish case folding of the two letters it differs on: capital I is dotless, dotted capital I is i.
const DOTLESS_I = '\u0131';
const DOTTED_CAPITAL_I = '\u0130';

/** Turkish lowercase for comparing against a fixed list; never applied to the text itself. */
export function lookupKey(text: string): string {
  let out = '';
  for (const ch of text) out += ch === 'I' ? DOTLESS_I : ch === DOTTED_CAPITAL_I ? 'i' : ch.toLowerCase();
  return out;
}

export function unit(symbol: string): Lexeme | null {
  return lex().units.find(([key]) => key === symbol)?.[1] ?? null;
}

const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
export const unitMarker = (symbol: string) => lex().units.some(([key]) => asciiLower(key) === asciiLower(symbol));

/** A rate such as kilometres per hour: [the unit it is per, the unit counted]. */
export function rate(symbol: string): [Lexeme, Lexeme] | null {
  const r = lex().rates.get(symbol);
  return r ? [unit(r[0])!, unit(r[1])!] : null;
}

export const abbreviation = (symbol: string): Lexeme | null => lex().abbreviations.get(symbol) ?? null;

/** An abbreviation that keeps its period when it ends a token. */
export const keepsPeriod = (text: string): boolean => lex().keepPeriod.includes(text);

/** A currency's code (TRY, USD, EUR, GBP), from any of its labels. */
export type Currency = string;

export const currency = (label: string): Currency | null => lex().currencyOf.get(label) ?? null;

export function currencyLexeme(c: Currency, label: string): Lexeme {
  const entry = lex().currencies.get(c)!;
  return { output: entry.output, source: entry.sources.get(label) ?? entry.target, target: entry.target };
}

export const currencyMinor = (c: Currency): Lexeme => lex().currencies.get(c)!.minor;

// ── fallback/spelling.rs ────────────────────────────────────────────────────

// Capital letters of the Turkish alphabet that ASCII lowercasing does not fold:
// I to dotless i, dotted capital I to i, and C cedilla, G breve, O and U with diaeresis, S cedilla.
const UPPER: Record<string, string> = {
  I: DOTLESS_I, [DOTTED_CAPITAL_I]: 'i', '\u00c7': '\u00e7', '\u011e': '\u011f', '\u00d6': '\u00f6', '\u015e': '\u015f', '\u00dc': '\u00fc',
};

export function letterName(ch: string): string | null {
  const lower = UPPER[ch] ?? (/^[A-Z]$/.test(ch) ? ch.toLowerCase() : ch);
  return lex().letters.get(lower) ?? null;
}

/** Each letter's name, space separated (an acronym spelled out). */
export const spell = (letters: string): string => Array.from(letters, (ch) => letterName(ch) ?? ch).join(' ');

export const symbolName = (ch: string): string | null => lex().symbols.get(ch) ?? null;

const PROSE = new Set(['.', ',', ';', ':', '!', '?', '(', ')', '[', ']', '{', '}', '"', "'", '’', '“', '”', '…', '-', '–', '—']);
export const prosePunctuation = (ch: string) => PROSE.has(ch);
