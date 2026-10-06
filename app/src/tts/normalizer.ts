// Turkish text normalisation for speech: a TypeScript port of normalizer-tr 0.4.0
// (https://github.com/erdemtuna/normalizer-tr, Apache-2.0), the library EMA Lightning's frontend calls,
// with its "fallback" policy — notation it cannot resolve is read literally rather than kept as written.
//
// Ported: pipeline.rs, source_map.rs, classify/** and fallback/**. Not ported, because the frontend never
// uses them: caller hints, the preserve and reject policies, cancellation and the 512 KiB result budget.
// Offsets are JS string indices, not UTF-8 bytes; the rules that count bytes only ever count ASCII.

import {
  allDigits, cardinal, digitName, letterName, lookupKey, number as numberWords, parseNumber, prosePunctuation, symbolName,
  unit, unitMarker, abbreviation, currency, currencyLexeme,
} from './words';
import {
  type Category, type Clock, type DateValue, type Numeric, type NumericPreference, type Value,
  automatic, baseOf, dateSpoken, hashtag, isFailure, label, lexicalReading, looksElectronic, parseClock, parseDate,
  parseElectronic, parseIban, parseNumeric, parseQuantity, parseRange, parseRoman, parseTelephone, percent,
  rangeNoun, render, renderNumeric, splitClock, splitSuffix, timeSpoken, unsupportedLabel,
} from './values';

export const MAX_INPUT_BYTES = 32 * 1024;
const MAX_CANDIDATES = 4096;

type Range = { start: number; end: number };
type Token = { range: Range; text: string };

// ── characters, as Rust's char predicates ───────────────────────────────────

const ALPHABETIC = /^\p{Alphabetic}$/u;
const NUMERIC = /^\p{N}$/u;
const UPPERCASE = /^\p{Uppercase}$/u;
const WHITESPACE = /^\p{White_Space}$/u;
const isAlphabetic = (c: string) => ALPHABETIC.test(c);
const isNumeric = (c: string) => NUMERIC.test(c);
const isAlphanumeric = (c: string) => isAlphabetic(c) || isNumeric(c);
const isWhitespace = (c: string) => WHITESPACE.test(c);
const isAsciiDigit = (c: string) => c.length === 1 && c >= '0' && c <= '9';
const chars = (s: string) => Array.from(s);
const anyChar = (s: string, f: (c: string) => boolean) => chars(s).some(f);
const allBytes = (s: string, re: RegExp) => re.test(s);
const hasAsciiDigit = (s: string) => /[0-9]/.test(s);
const lastChar = (s: string) => chars(s).pop() ?? '';

function trimStartWhile(s: string, f: (c: string) => boolean): string {
  let i = 0;
  for (const c of s) { if (!f(c)) break; i += c.length; }
  return s.slice(i);
}
function trimEndWhile(s: string, f: (c: string) => boolean): string {
  const cs = chars(s);
  while (cs.length && f(cs[cs.length - 1])) cs.pop();
  return cs.join('');
}
const among = (set: string) => (c: string) => set.includes(c);
const utf8Length = (s: string) => {
  let n = 0;
  for (const c of s) { const p = c.codePointAt(0)!; n += p < 0x80 ? 1 : p < 0x800 ? 2 : p < 0x10000 ? 3 : 4; }
  return n;
};

// ── graphemes ───────────────────────────────────────────────────────────────
// Extended grapheme clusters, close enough for this text: a base plus its marks, joiners, variation
// selectors and skin tones; ZWJ emoji sequences; flag pairs; CR LF. (Hermes has no Intl.Segmenter.)

const EXTEND = /^[\p{M}\u200c\u200d\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]$/u;
const PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u;
const REGIONAL = /^\p{Regional_Indicator}$/u;

/** End index of the grapheme starting at `start`, never past `end`. */
function graphemeEnd(text: string, start: number, end = text.length): number {
  if (start >= end) return start;
  const first = String.fromCodePoint(text.codePointAt(start)!);
  let i = start + first.length;
  if (first === '\r' && text[i] === '\n' && i < end) return i + 1;
  if (first === '\r' || first === '\n') return i;
  let previous = first;
  let regional = REGIONAL.test(first) ? 1 : 0;
  while (i < end) {
    const c = String.fromCodePoint(text.codePointAt(i)!);
    const joined = previous === '\u200d' && PICTOGRAPHIC.test(c);
    const pair = regional === 1 && REGIONAL.test(c);
    if (!EXTEND.test(c) && !/^\p{Mc}$/u.test(c) && !joined && !pair) break;
    if (pair) regional = 2;
    previous = c;
    i += c.length;
  }
  return i;
}

function graphemeStarts(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i = graphemeEnd(text, i)) out.push(i);
  return out;
}

// ── source_map.rs ───────────────────────────────────────────────────────────

class SourceMap {
  text: string;
  private bounds: number[]; // grapheme boundaries in `text`
  private originals: number[]; // the same boundaries in the input

  constructor(input: string) {
    const starts = graphemeStarts(input);
    const ends = [...starts.slice(1), input.length];
    this.bounds = [0];
    this.originals = [0];
    if (input.normalize('NFC') === input) {
      this.text = input;
      this.bounds.push(...ends);
      this.originals = this.bounds;
      return;
    }
    let text = '';
    starts.forEach((start, i) => {
      text += input.slice(start, ends[i]).normalize('NFC');
      this.bounds.push(text.length);
      this.originals.push(ends[i]);
    });
    this.text = text;
  }

  /** The range widened to whole graphemes. */
  cover(range: Range): Range {
    const start = partition(this.bounds, (b) => b <= range.start) - 1;
    const end = partition(this.bounds, (b) => b < range.end);
    return { start: this.bounds[start], end: this.bounds[end] };
  }

  original(range: Range): Range {
    const lookup = (offset: number) => {
      const i = partition(this.bounds, (b) => b < offset);
      if (this.bounds[i] !== offset) throw new Error('internal: offset inside a grapheme');
      return this.originals[i];
    };
    return { start: lookup(range.start), end: lookup(range.end) };
  }

  /** Start of the input's grapheme that ends at `end`, an original grapheme boundary. */
  originalBefore(end: number): number {
    return this.originals[Math.max(0, partition(this.originals, (b) => b < end) - 1)];
  }
}

function partition<T>(list: T[], f: (x: T) => boolean): number {
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (f(list[mid])) lo = mid + 1; else hi = mid; }
  return lo;
}

// ── classify/scan.rs ────────────────────────────────────────────────────────

const whitespaceBetween = (text: string, start: number, end: number) =>
  start < end && chars(text.slice(start, end)).every(isWhitespace);
const cueWhitespace = (text: string, start: number, end: number) => start === end || whitespaceBetween(text, start, end);

const delimiter = among(';!?(){}[]«»"');

function trimmedRange(text: string, offset: number): Range | null {
  const leading = trimStartWhile(text, (c) => delimiter(c) || c === ',' || c === '…');
  let body = trimEndWhile(leading, (c) => delimiter(c) || c === '…');
  if (body.endsWith(',') && !body.endsWith(',,')) body = body.slice(0, -1);
  if (body.endsWith('.') && !body.endsWith('..') && body !== 'Dr.' && !/^[0-9]*$/.test(body.slice(0, -1))) body = body.slice(0, -1);
  const start = offset + text.length - leading.length;
  return body ? { start, end: start + body.length } : null;
}

const romanLetters = (s: string) => /^[IVXLCDM]*$/.test(s);
const lexicalPeriod = (text: string) => abbreviation(baseOf(text)) !== null;

function expressionRange(text: string, offset: number): Range | null {
  if (text.startsWith('"') && text.includes('@')) {
    const body = trimEndWhile(text, among(',;!'));
    return { start: offset, end: offset + body.length };
  }
  const leading = trimStartWhile(text, among('([{«"'));
  if (looksElectronic(leading)) {
    let body = trimEndWhile(leading, among('.,;!»"'));
    const count = (s: string, c: string) => s.split(c).length - 1;
    while (body.endsWith(')') && count(body, ')') > count(body, '(')) body = body.slice(0, -1);
    body = trimEndWhile(body, among(']}'));
    const start = offset + text.length - leading.length;
    return body ? { start, end: start + body.length } : null;
  }
  const range = trimmedRange(text, offset);
  if (!range) return null;
  const raw = text.slice(range.start - offset);
  const without = trimEndWhile(raw, (c) => delimiter(c) || c === ',' || c === '…');
  const roman = trimEndWhile(baseOf(without), (c) => c === '.');
  const retain = lexicalPeriod(without) || (roman !== '' && romanLetters(roman));
  return retain ? { start: range.start, end: range.start + without.length } : range;
}

function numericParenthesisCompound(raw: string): boolean {
  const body = raw.startsWith('(') && raw.endsWith(')') && raw.length >= 2 ? raw.slice(1, -1) : raw;
  return /[()]/.test(body) && !anyChar(body, isAlphabetic) && body.split(/[^0-9]/).filter(Boolean).length > 1;
}

const DATE_CUES = ['tarih', 'tarihi'];
const TIME_CUES = ['saat'];
const cueKey = (text: string) => lookupKey(text.endsWith(':') ? text.slice(0, -1) : text);
const isCueWord = (text: string) => { const k = cueKey(text); return DATE_CUES.includes(k) || TIME_CUES.includes(k); };
const isClockWord = (text: string) => !text.includes(':') && TIME_CUES.includes(cueKey(text));
function inlinePrefix(text: string): number | null {
  const at = text.indexOf(':');
  if (at < 0) return null;
  const word = text.slice(0, at);
  return isCueWord(word) && isAsciiDigit(text[at + 1] ?? '') ? at + 1 : null;
}

const TOKEN = /[^\p{White_Space}]+/gu;
const QUOTED_EMAIL = /"[^"\r\n]{0,128}"@[^\p{White_Space}]+/uy;
const PHONE_LIKE = /(?:\+?[0-9]{1,3})(?:[ \t]+(?:\([0-9]{2,}\)|[0-9]{2,})){2,}/g;

function tokenize(source: SourceMap): Token[] {
  const text = source.text;
  const tokens: Token[] = [];
  const append = (range: Range) => {
    const r = source.cover(range);
    tokens.push({ range: r, text: text.slice(r.start, r.end) });
  };
  let skipUntil = 0;
  for (const m of text.matchAll(TOKEN)) {
    const mStart = m.index!;
    const mEnd = mStart + m[0].length;
    if (mStart < skipUntil) continue;
    const raw = m[0];
    if (raw.startsWith('"')) {
      QUOTED_EMAIL.lastIndex = mStart;
      const address = QUOTED_EMAIL.exec(text);
      if (address) {
        const body = trimEndWhile(address[0], among(',;!'));
        append({ start: mStart, end: mStart + body.length });
        skipUntil = mStart + address[0].length;
        continue;
      }
    }
    if (numericParenthesisCompound(raw)) { append({ start: mStart, end: mEnd }); continue; }
    const range = expressionRange(raw, mStart);
    if (!range) continue;
    const body = text.slice(range.start, range.end);
    if (looksElectronic(body) || lexicalPeriod(body) || romanLetters(trimEndWhile(body, (c) => c === '.'))) {
      append(range);
      continue;
    }
    let prefix = inlinePrefix(body);
    if (prefix === null && body.startsWith(':') && isAsciiDigit(body[1] ?? '')) {
      const previous = tokens[tokens.length - 1];
      if (previous && !previous.text.includes(':') && isCueWord(previous.text) && whitespaceBetween(text, previous.range.end, range.start)) prefix = 1;
    }
    if (prefix !== null) {
      const bodyStart = range.start + prefix;
      const bodyRange = trimmedRange(text.slice(bodyStart, mEnd), bodyStart);
      if (!bodyRange) throw new Error('internal: empty cue body');
      append({ start: range.start, end: range.start + prefix });
      append(bodyRange);
      continue;
    }
    if (identifier(body)) { append(range); continue; }
    let start = 0;
    for (let offset = 0; offset < raw.length; offset++) {
      if (!delimiter(raw[offset])) continue;
      const r = trimmedRange(raw.slice(start, offset), mStart + start);
      if (r) append(r);
      start = offset + 1;
    }
    const r = trimmedRange(raw.slice(start), mStart + start);
    if (r) append(r);
  }
  return tokens;
}

function phones(text: string, tokens: Token[]): Range[] {
  const out: Range[] = [];
  const starts = new Set(tokens.map((t) => t.range.start));
  const ends = new Set(tokens.map((t) => t.range.end));
  for (const m of text.matchAll(PHONE_LIKE)) {
    const range = { start: m.index!, end: m.index! + m[0].length };
    if (starts.has(range.start) && ends.has(range.end)) out.push(range);
  }
  return out;
}

const MATH = new Set(['/', '-', '–', '—', ':', 'x', '×', '^', '+', '=', '*', '÷', '<', '>', '≤', '≥', '≈', '±']);
const mathOperator = (text: string) => MATH.has(text);

function spacedCompound(text: string, tokens: Token[], index: number): number | null {
  if (!hasAsciiDigit(tokens[index].text)) return null;
  let end = index;
  for (;;) {
    const operator = tokens[end + 1], num = tokens[end + 2];
    if (!operator || !num || !mathOperator(operator.text) || !hasAsciiDigit(num.text)
      || !whitespaceBetween(text, tokens[end].range.end, operator.range.start)
      || !whitespaceBetween(text, operator.range.end, num.range.start)) break;
    end += 2;
  }
  return end > index ? end : null;
}

function identifier(text: string): boolean {
  if (text.includes('@') || text.includes('://') || text.startsWith('www.')) return true;
  const base = baseOf(text);
  const letters = anyChar(base, (c) => isAlphabetic(c) && !isNumeric(c));
  const digits = anyChar(base, isNumeric);
  return digits && (letters || base.includes('_'));
}

function unknownAbbreviation(text: string): boolean {
  const letters = chars(baseOf(text)).filter(isAlphabetic);
  return letters.length >= 2 && letters.every((c) => UPPERCASE.test(c));
}

// ── classify/boundaries.rs ──────────────────────────────────────────────────

function quantityTail(text: string): boolean {
  if (/^['’]/.test(text)) return true;
  const base = baseOf(text);
  return label(base) || unsupportedLabel(base) || unsupportedLabel(base.replace(/[a-z]/g, (c) => c.toUpperCase()))
    || (base.length === 3 && /^[A-Z]{3}$/.test(base) && abbreviation(base) === null)
    || unitMarker(base) || base === '%';
}

// ── the readers (classify/readers/*.rs) ─────────────────────────────────────

type Attempt = [Value | Category, number];
type FallbackClass = 'number' | 'percent' | 'date' | 'time' | 'quantity' | 'abbreviation' | 'identifier'
  | 'roman' | 'electronic' | 'expression' | 'symbol';

type Prepared =
  | { kind: 'number'; preference: NumericPreference }
  | { kind: 'date'; date: DateValue; locative: boolean }
  | { kind: 'time'; clock: Clock; locative: boolean }
  | { kind: 'dateSurface'; day: number; month: string; year: number }
  | { kind: 'timeSurface'; hour: number; minute: number }
  | { kind: 'literal'; spell: boolean };

type Reading = { resolved: Value } | { fallback: Prepared };

const isCategory = (v: Value | Category): v is Category => typeof v === 'string';

/** fallback/mod.rs Request::unresolved: what a span is read as when it could not be resolved. */
function unresolved(source: string, cls: FallbackClass): Reading {
  const prepared = cls === 'date' ? dateSurface(source) : cls === 'time' ? timeSurface(source) : null;
  const spell = cls === 'identifier' || cls === 'abbreviation' || cls === 'roman' || cls === 'electronic';
  return { fallback: prepared ?? { kind: 'literal', spell } };
}

function dateSurface(text: string): Prepared | null {
  const parts = text.split(text.includes('.') ? '.' : '-');
  if (parts.length !== 3) return null;
  const [day, month, year] = text.includes('.') ? parts : [parts[2], parts[1], parts[0]];
  if (day.length < 1 || day.length > 2 || month.length < 1 || month.length > 2 || year.length !== 4
    || ![day, month, year].every(allDigits)) return null;
  const name = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][Number(month) - 1];
  return name ? { kind: 'dateSurface', day: Number(day), month: name, year: Number(year) } : null;
}

function timeSurface(text: string): Prepared | null {
  const split = splitClock(text);
  if (!split) return null;
  const [hour, minute] = split;
  if (hour.length < 1 || hour.length > 2 || minute.length !== 2 || !/^[0-9]*$/.test(hour + minute)) return null;
  return { kind: 'timeSurface', hour: Number(hour), minute: Number(minute) };
}

class Context {
  constructor(public text: string, public tokens: Token[], public phoneLike: Range[]) {}

  cue(index: number, allowed: string[]): boolean {
    if (index < 1) return false;
    const previous = this.tokens[index - 1];
    return cueWhitespace(this.text, previous.range.end, this.tokens[index].range.start) && allowed.includes(cueKey(previous.text));
  }
  contextualCueWord(index: number): boolean {
    const token = this.tokens[index];
    const key = cueKey(token.text);
    const next = this.tokens[index + 1];
    return isCueWord(token.text)
      || (['telefon', 'tel', 'web', 'site'].includes(key) && !!next
        && whitespaceBetween(this.text, token.range.end, next.range.start)
        && (next.text.includes('.') || hasAsciiDigit(next.text)));
  }
  romanAnchorEnd(index: number): number | null {
    const token = this.tokens[index];
    if (!token.text.endsWith('.')) return null;
    const next = this.tokens[index + 1];
    if (!next || !whitespaceBetween(this.text, token.range.end, next.range.start)) return null;
    const key = lookupKey(next.text);
    if (key === 'yüzyıl') return index + 2;
    if (key === 'dünya') {
      const last = this.tokens[index + 2];
      return last && lookupKey(last.text) === 'savaşı' && whitespaceBetween(this.text, next.range.end, last.range.start) ? index + 3 : null;
    }
    return null;
  }
  phoneAt(start: number): Range | null { return this.phoneLike.find((p) => p.start === start) ?? null; }
  nextAt(end: number): number { return partition(this.tokens, (t) => t.range.start < end); }
}

/** readers/mod.rs `read`: fixed precedence; a matched span that fails is sealed, not passed on. */
function read(ctx: Context, index: number, contextualRole: boolean): [Reading, number] | null {
  const annotate = ([value, end]: Attempt, cls: FallbackClass): [Reading, number] => {
    const source = ctx.text.slice(ctx.tokens[index].range.start, ctx.tokens[end].range.end);
    return [isCategory(value) ? unresolved(source, cls) : { resolved: value }, end];
  };
  let a: Attempt | null;
  if ((a = electronicWhole(ctx, index))) return annotate(a, 'electronic');
  if ((a = lexical(ctx, index))) return annotate(a, 'abbreviation');
  if ((a = electronicContextual(ctx, index))) return annotate(a, 'electronic');
  if ((a = identifiers(ctx, index))) return annotate(a, 'identifier');
  const n = numeric(ctx, index);
  if (n) return annotate(n[0], n[1]);
  if ((a = quantities(ctx, index))) return annotate(a, 'quantity');
  const phone = ctx.phoneAt(ctx.tokens[index].range.start);
  if (phone) return annotate(['unsupported', ctx.nextAt(phone.end) - 1], 'identifier');
  const compound = spacedCompound(ctx.text, ctx.tokens, index);
  if (compound !== null) return annotate(['unsupported', compound], 'expression');
  if ((a = unsupportedQuantity(ctx, index))) return annotate(a, 'quantity');
  const t = token(ctx, index, contextualRole);
  return t ? [t, index] : null;
}

function electronicWhole(ctx: Context, index: number): Attempt | null {
  const source = ctx.tokens[index].text;
  if (!looksElectronic(source)) return null;
  const spoken = parseElectronic(source, false);
  return [spoken !== null ? { kind: 'electronic', spoken } : 'unsupported', index];
}

function electronicContextual(ctx: Context, index: number): Attempt | null {
  const source = ctx.tokens[index].text;
  if (source.includes('.') && ctx.cue(index, ['web', 'site'])) {
    const spoken = parseElectronic(source, true);
    return [spoken !== null ? { kind: 'electronic', spoken } : 'unsupported', index];
  }
  if (source.includes('.') && !anyChar(source, isNumeric)
    && source.split('.').every((part) => part !== '' && chars(part).every((c) => isAlphanumeric(c) || c === '-'))) {
    return [parseElectronic(source, true) !== null ? 'ambiguous' : 'unsupported', index];
  }
  return null;
}

function lexical(ctx: Context, index: number): Attempt | null {
  const source = ctx.tokens[index].text;
  if (source === '&') return [{ kind: 'symbol', text: 've' }, index];
  if (source.startsWith('#')) {
    const text = hashtag(source);
    return [text !== null ? { kind: 'symbol', text } : 'unsupported', index];
  }
  const next = ctx.tokens[index + 1];
  if (!(next && label(source) && hasAsciiDigit(next.text))) {
    const reading = lexicalReading(source);
    if (reading !== null) return [typeof reading === 'string' ? reading : { kind: 'lexical', ...reading }, index];
  }
  return null;
}

const allAsciiDigits = (s: string) => /^[0-9]+$/.test(s);

function identifiers(ctx: Context, index: number): Attempt | null {
  const { text, tokens } = ctx;
  const token = tokens[index];
  const source = token.text;
  const fourDigits = (t?: Token) => !!t && t.text.length === 4 && allAsciiDigits(t.text);
  const numericGroupContext = fourDigits(tokens[index + 1]) && fourDigits(tokens[index + 2]);
  const tail = source.slice(2);
  const ibanLike = (source.length >= 4 && /^[A-Za-z]{2}[A-Za-z0-9]*$/.test(source)
      && (((source.startsWith('TR') || source.startsWith('tr'))
        && (allAsciiDigits(tail) || source.length === 26 || (source.length === 4 && (hasAsciiDigit(tail) || numericGroupContext))))
        || (source.length === 4 && allAsciiDigits(tail) && numericGroupContext)))
    || (source === 'TR' && !!tokens[index + 1] && tokens[index + 1].text.length === 2 && allAsciiDigits(tokens[index + 1].text));
  if (ibanLike) {
    const end = ibanEnd(text, tokens, index);
    const canonical = parseIban(text.slice(token.range.start, tokens[end].range.end));
    return [canonical !== null ? { kind: 'iban', canonical } : 'protected', end];
  }
  const zeroGroupSignal = source === '0'
    && !!tokens[index + 1] && tokens[index + 1].text.length === 3 && allAsciiDigits(tokens[index + 1].text)
    && !!tokens[index + 2] && tokens[index + 2].text.length >= 2 && allAsciiDigits(tokens[index + 2].text);
  const telephoneCue = hasAsciiDigit(source) && ctx.cue(index, ['telefon', 'tel']);
  const quantityContext = telephoneCue && !!tokens[index + 1] && (label(tokens[index + 1].text) || rangeNoun(tokens[index + 1].text));
  if (source.startsWith('+90')
    || (source.startsWith('0') && source !== '0' && hasAsciiDigit(source))
    || zeroGroupSignal
    || (source === '0' && ctx.cue(index, ['telefon', 'tel']))
    || (telephoneCue && !quantityContext && allBytes(source, /^[0-9]*$/))
    || (source.length === 10 && allAsciiDigits(source) && ctx.cue(index, ['telefon', 'tel']))) {
    const end = groupEnd(text, tokens, index);
    const whole = text.slice(token.range.start, tokens[end].range.end);
    const digitCount = (whole.match(/[0-9]/g) ?? []).length;
    const writtenPrefix = source.split(/[-(]/)[0];
    const nationalShape = source.startsWith('0')
      && ((source.length === 4 && allAsciiDigits(source))
        || (writtenPrefix.length === 4 && allAsciiDigits(writtenPrefix))
        || (source.length >= 10 && allAsciiDigits(source))
        || zeroGroupSignal
        || (source.startsWith('0-') && digitCount === 11)
        || telephoneCue);
    const contextualRange = !!tokens[index + 1] && parseRange(source, tokens[index + 1].text) !== null;
    if (!contextualRange && !quantityContext
      && ((source.startsWith('+90') && (end > index || digitCount === 12)) || nationalShape || telephoneCue)) {
      const phone = parseTelephone(whole, telephoneCue);
      return [phone ? { kind: 'telephone', value: phone } : 'invalid', end];
    }
  }
  return null;
}

const numberGroup = (t: string) => t !== '' && /^[0-9+\-()]*$/.test(t);

function groupEnd(text: string, tokens: Token[], index: number): number {
  let end = index;
  for (let next = tokens[end + 1]; next; next = tokens[end + 1]) {
    if (!(numberGroup(next.text) || (next.text.length <= 4 && /^[0-9][A-Za-z0-9]*$/.test(next.text)))
      || !/^[\p{White_Space}()-]*$/u.test(text.slice(tokens[end].range.end, next.range.start))) break;
    end++;
  }
  return end;
}

function ibanEnd(text: string, tokens: Token[], index: number): number {
  let end = index;
  let count = tokens[index].text.length;
  for (let next = tokens[end + 1]; next; next = tokens[end + 1]) {
    const after = tokens[end + 2];
    if (abbreviation(next.text) !== null || label(next.text)
      || (allBytes(next.text, /^[0-9]*$/) && !!after && label(after.text) && whitespaceBetween(text, next.range.end, after.range.start))) break;
    if (!whitespaceBetween(text, tokens[end].range.end, next.range.start) || next.text === ''
      || !/^[0-9A-Z]*$/.test(next.text)
      || (!hasAsciiDigit(next.text) && next.text.length > 4)
      || (count >= 26 && !/^[0-9]*$/.test(next.text))) break;
    count += next.text.length;
    end++;
  }
  return end;
}

function numeric(ctx: Context, index: number): [Attempt, FallbackClass] | null {
  const { text, tokens } = ctx;
  const token = tokens[index];
  const source = token.text;
  const p = percent(source);
  if (p !== null) return [[typeof p === 'string' ? p : { kind: 'percent', number: p.number, case: p.case }, index], 'percent'];
  if (baseOf(source).endsWith('.') || /['’]/.test(source)) {
    const n = parseNumeric(source, false);
    if (n) return [[{ kind: 'numeric', value: n }, index], 'number'];
  }
  const romanBase = trimEndWhile(baseOf(source), (c) => c === '.');
  if (romanBase !== '' && romanLetters(romanBase)) {
    const next = tokens[index + 1];
    const contextual = source.endsWith('.') && !!next && whitespaceBetween(text, token.range.end, next.range.start)
      && (lookupKey(next.text) === 'yüzyıl'
        || (lookupKey(next.text) === 'dünya' && !!tokens[index + 2] && lookupKey(tokens[index + 2].text) === 'savaşı'
          && whitespaceBetween(text, next.range.end, tokens[index + 2].range.start)));
    let value: Value | Category = 'ambiguous';
    if (contextual) {
      const r = parseRoman(source);
      value = r ? { kind: 'roman', value: r } : 'invalid';
    }
    return [[value, index], 'roman'];
  }
  return null;
}

const MONEY = '₺$€£';

function quantities(ctx: Context, index: number): Attempt | null {
  const { text, tokens } = ctx;
  const token = tokens[index];
  const source = token.text;
  const labelAfter = (i: number) => {
    const tail = tokens[i + 1];
    return !!tail && label(tail.text) && whitespaceBetween(text, tokens[i].range.end, tail.range.start);
  };
  const quantity = (n: string, l: string): Value | Category => {
    const q = parseQuantity(n, l);
    return q ? { kind: 'quantity', value: q } : 'invalid';
  };
  const first = chars(source)[0] ?? '';
  if (MONEY.includes(first)) {
    const end = quantityMathEnd(text, tokens, index);
    if (end !== null) return ['unsupported', end];
    if (labelAfter(index)) return ['invalid', index + 1];
    const [n, kase] = splitSuffix(source.slice(first.length)) ?? ['', null];
    return [quantity(n, first + (kase !== null ? `'${kase}` : '')), index];
  }
  const [symbolBase, symbolCase] = splitSuffix(source) ?? [source, null];
  const last = lastChar(symbolBase);
  if (last && MONEY.includes(last)) {
    const end = quantityMathEnd(text, tokens, index);
    if (end !== null) return ['unsupported', end];
    if (labelAfter(index)) return ['invalid', index + 1];
    return [quantity(symbolBase.slice(0, -last.length), last + (symbolCase !== null ? `'${symbolCase}` : '')), index];
  }
  const next = tokens[index + 1];
  if (!next || !whitespaceBetween(text, token.range.end, next.range.start)) return null;
  const digit = hasAsciiDigit(source);
  if (digit && /[-–]/.test(source) && (unit(next.text) !== null || rangeNoun(next.text))) {
    const end = quantityMathEnd(text, tokens, index + 1);
    if (end !== null) return ['unsupported', end];
    const r = parseRange(source, next.text);
    return [r ? { kind: 'range', value: r } : 'invalid', index + 1];
  }
  if (label(next.text) && digit) {
    const end = quantityMathEnd(text, tokens, index + 1);
    if (end !== null) return ['unsupported', end];
    if (labelAfter(index + 1)) return ['invalid', index + 2];
    return [quantity(source, next.text), index + 1];
  }
  if (digit && unit(next.text.replace(/[A-Z]/g, (c) => c.toLowerCase())) !== null) return ['unsupported', index + 1];
  if (digit && isAlphabetic(chars(next.text)[0] ?? '')
    && (/[/^²³]/.test(next.text) || ['Μg', 'μG', 'µG', 'ug', 'oz', 'cl', 'dl', 'ms'].includes(next.text))) return ['unsupported', index + 1];
  if (label(source) && hasAsciiDigit(next.text)) return [quantity(next.text, source), index + 1];
  return null;
}

function quantityMathEnd(text: string, tokens: Token[], start: number): number | null {
  let end = start;
  for (;;) {
    const operator = tokens[end + 1], num = tokens[end + 2];
    if (!operator || !num || !mathOperator(operator.text) || !hasAsciiDigit(num.text)
      || !whitespaceBetween(text, tokens[end].range.end, operator.range.start)
      || !whitespaceBetween(text, operator.range.end, num.range.start)) break;
    end += 2;
    const tail = tokens[end + 1];
    if (tail && label(tail.text) && whitespaceBetween(text, tokens[end].range.end, tail.range.start)) end++;
  }
  return end > start ? end : null;
}

function unsupportedQuantity(ctx: Context, index: number): Attempt | null {
  const { text, tokens } = ctx;
  const token = tokens[index];
  const next = tokens[index + 1];
  const spaced = !!next && whitespaceBetween(text, token.range.end, next.range.start);
  if (['%', '+', '-', '√', '∛'].includes(token.text) && spaced && anyChar(next.text, isNumeric)) return ['unsupported', index + 1];
  if (unsupportedLabel(token.text) && spaced && hasAsciiDigit(next.text)) return ['unsupported', index + 1];
  if (token.text.startsWith('¥') || token.text.endsWith('¥')) return ['unsupported', index];
  if (hasAsciiDigit(token.text) && spaced && quantityTail(next.text)) return ['unsupported', index + 1];
  return null;
}

function token(ctx: Context, index: number, contextualRole: boolean): Reading | null {
  const t = ctx.tokens[index];
  if (identifier(t.text)) return unresolved(t.text, 'identifier');
  if (/[:.-]/.test(t.text) && anyChar(t.text, isNumeric)) {
    return temporal(ctx.text, ctx.tokens, index) ?? automaticNumber(t.text);
  }
  if (t.text.startsWith('%') || anyChar(t.text, isNumeric)) return automaticNumber(t.text);
  return unknownAbbreviation(t.text) && !contextualRole && !ctx.contextualCueWord(index) ? unresolved(t.text, 'abbreviation') : null;
}

function automaticNumber(source: string): Reading {
  const v = automatic(source);
  if (!isFailure(v)) return { resolved: { kind: 'numeric', value: v } };
  return v.preference ? { fallback: { kind: 'number', preference: v.preference } } : unresolved(source, 'number');
}

// ── classify/temporal.rs ────────────────────────────────────────────────────

type Temporal = Value | { category: Category; preference: Prepared | null };

function date(text: string, permitted: boolean): Temporal {
  const split = splitSuffix(text);
  const d = split && parseDate(split[0]);
  if (!split || !d) return { category: 'invalid', preference: null };
  const suffix = split[1];
  if (suffix !== null && !d.dotted) return { category: 'unsupported', preference: null };
  if (suffix !== null && dateSpoken(d).sourceSuffix('locative') !== suffix) return { category: 'invalid', preference: null };
  if (!permitted) return { category: 'ambiguous', preference: { kind: 'date', date: d, locative: suffix !== null } };
  return { kind: 'date', date: d, locative: suffix !== null };
}

function time(text: string, permitted: boolean): Temporal {
  const split = splitSuffix(text);
  const c = split && parseClock(split[0]);
  if (!split || !c) return { category: 'invalid', preference: null };
  const suffix = split[1];
  if (suffix !== null && timeSpoken(c).sourceSuffix('locative') !== suffix) return { category: 'invalid', preference: null };
  if (!permitted) return { category: 'ambiguous', preference: { kind: 'time', clock: c, locative: suffix !== null } };
  return { kind: 'time', clock: c, locative: suffix !== null };
}

function temporalCue(text: string, tokens: Token[], index: number, allowed: string[]): boolean {
  let previous = index - 1;
  if (previous < 0) return false;
  if (!cueWhitespace(text, tokens[previous].range.end, tokens[index].range.start)) return false;
  if (tokens[previous].text === ':') {
    const wordIndex = previous - 1;
    if (wordIndex < 0) return false;
    if (!whitespaceBetween(text, tokens[wordIndex].range.end, tokens[previous].range.start) || tokens[wordIndex].text.includes(':')) return false;
    previous = wordIndex;
  }
  return allowed.includes(cueKey(tokens[previous].text));
}

function frame(text: string, tokens: Token[], index: number): boolean {
  const [d, cue, t] = [tokens[index], tokens[index + 1], tokens[index + 2]];
  if (!d || !cue || !t) return false;
  const dv = date(d.text, true);
  const tv = time(t.text, true);
  return 'kind' in dv && dv.kind === 'date' && dv.locative && dv.date.dotted
    && isClockWord(cue.text)
    && 'kind' in tv && tv.kind === 'time' && tv.locative
    && whitespaceBetween(text, d.range.end, cue.range.start)
    && whitespaceBetween(text, cue.range.end, t.range.start);
}

function temporal(text: string, tokens: Token[], index: number): Reading | null {
  const source = tokens[index].text;
  const split = splitSuffix(source);
  if (!split) return null;
  const base = split[0];
  const dots = base.split('.').length - 1;
  const hyphens = base.split('-').length - 1;
  let result: Temporal, cls: FallbackClass;
  if (dots === 2 || (hyphens === 2 && base.length >= 8)) {
    if (dots === 2 && parseNumber(base)?.grouped && !temporalCue(text, tokens, index, DATE_CUES)) return null;
    result = date(source, frame(text, tokens, index) || temporalCue(text, tokens, index, DATE_CUES));
    cls = 'date';
  } else if (base.includes(':') || (dots === 1 && temporalCue(text, tokens, index, TIME_CUES))) {
    result = time(source, temporalCue(text, tokens, index, TIME_CUES));
    cls = 'time';
  } else return null;
  if ('kind' in result) return { resolved: result };
  return result.preference ? { fallback: result.preference } : unresolved(source, cls);
}

// ── classify/mod.rs and classify/symbols.rs ─────────────────────────────────

type Candidate = { range: Range; reading: Reading };

function collect(source: SourceMap): Candidate[] {
  const text = source.text;
  const tokens = tokenize(source);
  const ctx = new Context(text, tokens, phones(text, tokens));
  const candidates: Candidate[] = [];
  let roleUntil = 0;
  for (let index = 0; index < tokens.length;) {
    const r = read(ctx, index, index < roleUntil);
    if (!r) { index++; continue; }
    const [reading, end] = r;
    if ('resolved' in reading && reading.resolved.kind === 'roman') roleUntil = ctx.romanAnchorEnd(index) ?? roleUntil;
    if (candidates.length === MAX_CANDIDATES) throw new Error('limit: candidates');
    candidates.push({ range: { start: tokens[index].range.start, end: tokens[end].range.end }, reading });
    index = end + 1;
  }
  return candidates;
}

const EMOTICONS = [':D', ':)', ':(', ';)', ':P', '<3'];
const emoticonLength = (s: string) => EMOTICONS.find((e) => s.startsWith(e))?.length ?? null;

function needsReading(grapheme: string, withinWord: boolean): boolean {
  const cs = chars(grapheme);
  if (cs.some((c) => symbolName(c) !== null && !prosePunctuation(c) && !(withinWord && isAlphabetic(c)))) return true;
  const hasLetter = cs.some(isAlphabetic);
  return cs.some((c) => !isAlphabetic(c) && !(hasLetter && /^\p{M}$/u.test(c)) && !isWhitespace(c) && !prosePunctuation(c));
}

/** Unclaimed symbols, emoticons and other notation become spans that fallback reads aloud. */
function supplement(source: SourceMap, candidates: Candidate[]) {
  const text = source.text;
  const added: Candidate[] = [];
  const scan = (start: number, end: number) => {
    let open: number | null = null;
    for (let cursor = start; cursor < end;) {
      const gEnd = graphemeEnd(text, cursor, end);
      const grapheme = text.slice(cursor, gEnd);
      const emoticon = emoticonLength(text.slice(cursor, end));
      const length = emoticon !== null ? source.cover({ start: cursor, end: cursor + emoticon }).end - cursor : grapheme.length;
      if (length > end - cursor) throw new Error('internal: emoticon past its gap');
      const withinWord = isAlphabetic(lastChar(text.slice(0, cursor))) || isAlphabetic(chars(text.slice(gEnd, gEnd + 2))[0] ?? '');
      if (emoticon !== null || needsReading(grapheme, withinWord)) open ??= cursor;
      else if (open !== null) { added.push({ range: { start: open, end: cursor }, reading: { fallback: { kind: 'literal', spell: true } } }); open = null; }
      cursor += length;
    }
    if (open !== null) added.push({ range: { start: open, end }, reading: { fallback: { kind: 'literal', spell: true } } });
  };
  let start = 0;
  for (const c of candidates) { scan(start, c.range.start); start = c.range.end; }
  scan(start, text.length);
  if (candidates.length + added.length > MAX_CANDIDATES) throw new Error('limit: candidates');
  candidates.push(...added);
  candidates.sort((a, b) => a.range.start - b.range.start);
}

// ── fallback/literal.rs ─────────────────────────────────────────────────────

class Output {
  text = '';
  append(s: string) { this.text += s; }
  word(s: string) {
    if (this.text && !isWhitespace(lastChar(this.text))) this.text += ' ';
    this.text += s;
  }
}

function codePoint(scalar: string, out: Output) {
  out.word('unikod u artı');
  const hex = scalar.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
  for (const h of hex) out.word(digitName(h) ?? letterName(h)!);
}

function literal(source: string, spell: boolean, out: Output) {
  const emitLetters = (letters: string) => {
    for (const l of letters) {
      const name = letterName(l) ?? symbolName(l);
      if (name) out.word(name); else codePoint(l, out);
    }
  };
  const emitDigits = (ds: string) => { for (const d of ds) out.word(digitName(d)!); };
  for (let cursor = 0; cursor < source.length;) {
    const rest = source.slice(cursor);
    const first = chars(rest)[0];
    if (isWhitespace(first)) {
      const length = rest.length - trimStartWhile(rest, isWhitespace).length;
      out.append(rest.slice(0, length));
      cursor += length;
      continue;
    }
    if (isAsciiDigit(first)) {
      const notation = rest.length - trimStartWhile(rest, (c) => isAsciiDigit(c) || c === '.' || c === ',').length;
      const written = !spell ? parseNumber(rest.slice(0, notation)) : null;
      if (written) { out.word(numberWords(written).text); cursor += notation; continue; }
      const length = rest.length - trimStartWhile(rest, isAsciiDigit).length;
      const ds = rest.slice(0, length);
      const n = !spell ? parseNumber(ds) : null;
      if (n) out.word(numberWords(n).text); else emitDigits(ds);
      cursor += length;
      continue;
    }
    if (isAlphabetic(first) && symbolName(first) === null) {
      const length = rest.length - trimStartWhile(rest, isAlphabetic).length;
      const word = rest.slice(0, length);
      if (spell) emitLetters(word);
      else {
        const c = currency(word);
        const lexeme = unit(word) ?? abbreviation(word) ?? (c ? currencyLexeme(c, word) : null);
        if (lexeme) out.word(lexeme.output);
        else if (chars(word).every((ch) => UPPERCASE.test(ch))) emitLetters(word);
        else out.word(word);
      }
      cursor += length;
      continue;
    }
    const grapheme = rest.slice(0, graphemeEnd(rest, 0));
    const scalars = chars(grapheme);
    const name = scalars.length === 1 ? symbolName(scalars[0]) : null;
    if (name) out.word(name);
    else for (const s of scalars) codePoint(s, out);
    cursor += grapheme.length;
  }
}

/** fallback/mod.rs Request::render. */
function fallbackText(prepared: Prepared, source: string): string {
  const out = new Output();
  switch (prepared.kind) {
    case 'number':
      if (prepared.preference.kind === 'number') out.word(renderNumeric(prepared.preference.value).text);
      else { out.word(numberWords(prepared.preference.number).text); out.append('.'); }
      break;
    case 'dateSurface':
      out.word(`${cardinal(prepared.day).text} ${prepared.month} ${cardinal(prepared.year).text}`);
      break;
    case 'timeSurface':
      out.word(`${cardinal(prepared.hour).text} ${cardinal(prepared.minute).text}`);
      break;
    case 'date':
      out.word(render({ kind: 'date', date: prepared.date, locative: prepared.locative }));
      break;
    case 'time':
      out.word(render({ kind: 'time', clock: prepared.clock, locative: prepared.locative }));
      break;
    case 'literal':
      literal(source, prepared.spell, out);
      break;
  }
  if (!out.text.trim()) throw new Error('internal: empty fallback');
  return out.text;
}

// ── pipeline.rs ─────────────────────────────────────────────────────────────

/** `Normalizer().normalize(text, ambiguity_policy="fallback").normalized_text`. Throws where the library
 *  raises: empty or control-character input, input past 32 KiB, too many candidates. */
export function normalize(input: string): string {
  if (utf8Length(input) > MAX_INPUT_BYTES) throw new Error('limit: input');
  if (chars(input).every(isWhitespace) || chars(input).some((c) => (/^\p{Cc}$/u.test(c) && !'\n\r\t'.includes(c))
    || /^[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]$/u.test(c))) throw new Error('invalid input');
  const source = new SourceMap(input);
  const candidates = collect(source);
  supplement(source, candidates);
  let out = '';
  let cursor = 0;
  for (const candidate of candidates) {
    const range = source.original(candidate.range);
    if (range.start < cursor || range.start >= range.end || range.end > input.length) throw new Error('internal: overlapping candidates');
    out += input.slice(cursor, range.start);
    const reading = candidate.reading;
    if ('resolved' in reading) out += render(reading.resolved);
    else {
      let text = fallbackText(reading.fallback, source.text.slice(candidate.range.start, candidate.range.end));
      // pad with a space where the reading would otherwise run into a neighbouring letter or digit
      const before = input.slice(source.originalBefore(range.start), range.start);
      const after = input.slice(range.end, graphemeEnd(input, range.end));
      if (anyChar(before, isAlphanumeric)) text = ' ' + text;
      if (anyChar(after, isAlphanumeric)) text += ' ';
      out += text;
    }
    cursor = range.end;
  }
  return out + input.slice(cursor);
}
