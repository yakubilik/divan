// The values the normalizer recognises and how each is read aloud, ported from normalizer-tr 0.4.0:
// model.rs, domain/numeric.rs, domain/identifiers.rs, domain/electronic.rs and verbalize.rs.

import {
  type Inflection, type Lexeme, type Num, Spoken, abbreviation, allDigits, amount, caseInflection, cardinal,
  currency, currencyLexeme, currencyMinor, digits, integerInflection, lookupKey, minor, MONTHS, number,
  parseNumber, rate, spokenCase, unit,
} from './words';

export type Category = 'ambiguous' | 'invalid' | 'protected' | 'unsupported' | 'unknownAbbreviation';

// ── model.rs ────────────────────────────────────────────────────────────────

export type DateValue = { day: number; month: number; year: number; dotted: boolean };
export type Clock = { hour: number; minute: number };

export function parseDate(text: string): DateValue | null {
  const dotted = text.includes('.');
  const parts = text.split(dotted ? '.' : '-');
  if (parts.length !== 3) return null;
  const [day, month, year] = dotted ? parts : [parts[2], parts[1], parts[0]];
  if (year.length !== 4 || day.length < 1 || day.length > 2 || month.length < 1 || month.length > 2
    || (!dotted && (day.length !== 2 || month.length !== 2))
    || ![day, month, year].every((s) => /^[0-9]*$/.test(s))) return null;
  const d = Number(day), m = Number(month), y = Number(year);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = m === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : m >= 1 && m <= 12 ? 31 : 0;
  if (!days || y === 0 || d === 0 || d > days) return null;
  return { day: d, month: m, year: y, dotted };
}

/** First `:` or `.`, as Rust's `split_once([':', '.'])`. */
export function splitClock(text: string): [string, string] | null {
  const at = text.search(/[:.]/);
  return at < 0 ? null : [text.slice(0, at), text.slice(at + 1)];
}

export function parseClock(text: string): Clock | null {
  const split = splitClock(text);
  if (!split) return null;
  const [hour, minute] = split;
  if (hour.length < 1 || hour.length > 2 || minute.length !== 2 || ![hour, minute].every((s) => /^[0-9]*$/.test(s))) return null;
  const h = Number(hour), m = Number(minute);
  if (h > 23 || m > 59) return null;
  return { hour: h, minute: m };
}

export type Value =
  | { kind: 'numeric'; value: Numeric }
  | { kind: 'percent'; number: Num; case: Inflection | null }
  | { kind: 'date'; date: DateValue; locative: boolean }
  | { kind: 'time'; clock: Clock; locative: boolean }
  | { kind: 'quantity'; value: Quantity }
  | { kind: 'lexical'; entry: Lexeme; case: Inflection | null }
  | { kind: 'range'; value: NumericRange }
  | { kind: 'telephone'; value: Telephone }
  | { kind: 'iban'; canonical: string }
  | { kind: 'roman'; value: Numeric }
  | { kind: 'electronic'; spoken: string }
  | { kind: 'symbol'; text: string };

// ── domain/numeric.rs ───────────────────────────────────────────────────────

const APOSTROPHE = /['’]/;

function suffixParts(text: string): [string, string[]] | null {
  const [base, ...suffixes] = text.split(APOSTROPHE);
  if (suffixes.length > 2 || suffixes.some((s) => !s)) return null;
  return [base, suffixes];
}

export function splitSuffix(text: string): [string, string | null] | null {
  const parts = text.split(APOSTROPHE);
  if (parts.length > 2 || parts[1] === '') return null;
  return [parts[0], parts.length === 2 ? parts[1] : null];
}

export const baseOf = (text: string) => text.split(APOSTROPHE)[0];

export type Numeric = { number: Num; ordinal: boolean; case: Inflection | null };

/** What fallback reads instead, when a number was recognised but not resolved. */
export type NumericPreference = { kind: 'number'; value: Numeric } | { kind: 'sentence'; number: Num };
export type NumericFailure = { category: Category; preference: NumericPreference | null };

const fail = (category: Category): NumericFailure => ({ category, preference: null });

export function automatic(text: string): Numeric | NumericFailure {
  if ([...text].some((c) => /\p{N}/u.test(c) && !/[0-9]/.test(c))) return fail('unsupported');
  const parsed = parseNumeric(text, false);
  if (parsed) return parsed;
  const split = splitSuffix(text);
  if (!split) return fail('invalid');
  const [base, suffix] = split;
  if (base.endsWith('.') && suffix === null) {
    const n = parseNumber(base.slice(0, -1));
    return n && !n.fraction && !n.grouped
      ? { category: 'ambiguous', preference: { kind: 'sentence', number: n } }
      : fail('invalid');
  }
  const n = parseNumber(base);
  if (!n) return fail('invalid');
  if (n.grouped) {
    // undefined: the suffix does not fit, so there is nothing to prefer
    let family: Inflection | null | undefined = null;
    if (suffix !== null) family = !n.fraction ? integerInflection(number(n), suffix) ?? undefined : undefined;
    return {
      category: 'ambiguous',
      preference: family === undefined ? null
        : { kind: 'number', value: { number: n, ordinal: family === 'ordinal', case: family === 'ordinal' ? null : family } },
    };
  }
  let kase: Inflection | null = null;
  if (suffix !== null) {
    if (n.fraction) return fail('unsupported');
    kase = integerInflection(number(n), suffix);
    if (!kase) return fail('invalid');
  }
  return { number: n, ordinal: false, case: kase };
}

export const isFailure = (v: Numeric | NumericFailure): v is NumericFailure => 'category' in v;

export function parseNumeric(text: string, ordinalHint: boolean): Numeric | null {
  const parts = suffixParts(text);
  if (!parts) return null;
  const [base, suffixes] = parts;
  const period = base.endsWith('.');
  if (ordinalHint && !period && !suffixes.length) return null;
  const n = parseNumber(period ? base.slice(0, -1) : base);
  if (!n || n.fraction || n.grouped) return null;
  const spoken = number(n);
  if (period) {
    if (!suffixes.length && !ordinalHint) return null;
    if (suffixes.length > 1) return null;
    spoken.inflect('ordinal');
    if (!suffixes.length) return { number: n, ordinal: true, case: null };
    const kase = spokenCase(spoken, suffixes[0]);
    return kase ? { number: n, ordinal: true, case: kase } : null;
  }
  if (suffixes.length) {
    const first = integerInflection(spoken, suffixes[0]);
    if (!first) {
      if (suffixes.length !== 1) return null;
      const ordinalSuffix = spoken.sourceSuffix('ordinal');
      if (!suffixes[0].startsWith(ordinalSuffix)) return null;
      spoken.inflect('ordinal');
      const kase = spokenCase(spoken, suffixes[0].slice(ordinalSuffix.length));
      return kase ? { number: n, ordinal: true, case: kase } : null;
    }
    if (first === 'ordinal') {
      spoken.inflect('ordinal');
      if (suffixes.length < 2) return { number: n, ordinal: true, case: null };
      const kase = spokenCase(spoken, suffixes[1]);
      return kase ? { number: n, ordinal: true, case: kase } : null;
    }
    if (ordinalHint || suffixes.length !== 1) return null;
    return { number: n, ordinal: false, case: first };
  }
  return { number: n, ordinal: ordinalHint, case: null };
}

export function parseRoman(text: string): Numeric | null {
  const parts = suffixParts(text);
  if (!parts) return null;
  const [base, suffixes] = parts;
  const ordinal = base.endsWith('.');
  const value = romanValue(ordinal ? base.slice(0, -1) : base);
  if (value === null) return null;
  let numeric = String(value) + (ordinal ? '.' : '');
  for (const s of suffixes) numeric += "'" + s;
  const parsed = parseNumeric(numeric, ordinal);
  if (!parsed || (suffixes.length && !parsed.ordinal)) return null;
  return parsed;
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const CANONICAL: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

function romanValue(text: string): number | null {
  if (!text || text.length > 15) return null;
  let total = 0, previous = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    const n = ROMAN[text[i]];
    if (!n) return null;
    total += n < previous ? -n : n;
    previous = n;
  }
  if (total < 1 || total > 3999) return null;
  let rest = total, canonical = '';
  for (const [n, s] of CANONICAL) while (rest >= n) { canonical += s; rest -= n; }
  return canonical === text ? total : null;
}

export function renderNumeric(v: Numeric): Spoken {
  const spoken = number(v.number);
  if (v.ordinal) spoken.inflect('ordinal');
  if (v.case) spoken.inflect(v.case);
  return spoken;
}

export type Quantity = {
  money: { sign: Num['sign']; major: string; minor: number; currency: NonNullable<ReturnType<typeof currency>> } | null;
  number: Num | null;
  lexeme: Lexeme;
  prefix: Lexeme | null;
  case: Inflection | null;
};

export function parseQuantity(text: string, label: string): Quantity | null {
  const parts = suffixParts(label);
  if (!parts) return null;
  const [base, suffixes] = parts;
  if (suffixes.length > 1) return null;
  let q: Omit<Quantity, 'case'>;
  const c = currency(base);
  const r = rate(base);
  if (c) {
    const n = parseNumber(text);
    const m = n && minor(n);
    if (!n || m === null) return null;
    q = { money: { sign: n.sign, major: n.integer, minor: m, currency: c }, number: null, lexeme: currencyLexeme(c, base), prefix: null };
  } else if (r) {
    if (suffixes.length) return null;
    const n = parseNumber(text);
    if (!n) return null;
    q = { money: null, number: n, lexeme: r[1], prefix: r[0] };
  } else {
    const n = parseNumber(text);
    const u = unit(base);
    if (!n || !u) return null;
    q = { money: null, number: n, lexeme: u, prefix: null };
  }
  let kase: Inflection | null = null;
  if (suffixes.length) {
    kase = caseInflection(q.lexeme.source, suffixes[0]);
    if (!kase) return null;
  }
  return { ...q, case: kase };
}

export function renderQuantity(q: Quantity): Spoken {
  const spoken = q.money
    ? amount(q.money.sign, q.money.major, q.money.minor, q.lexeme.output, q.lexeme.target, currencyMinor(q.money.currency).target)
    : Spoken.lexical(`${number(q.number!).text} ${q.lexeme.output}`, q.lexeme.target);
  if (q.prefix) {
    const denominator = Spoken.lexical(q.prefix.output, q.prefix.target);
    denominator.inflect('locative');
    spoken.prefix(`${denominator.text} `);
  }
  if (q.case) spoken.inflect(q.case);
  return spoken;
}

export const label = (text: string) => {
  const base = baseOf(text);
  return currency(base) !== null || unit(base) !== null || rate(base) !== null;
};

const UNSUPPORTED_LABELS = new Set(['JPY', 'CHF', 'CAD', 'AUD', 'RUB', '¥', 'Hz', 'kHz', 'MHz', 'GHz', '°C', '°F', 'mph', 'GB', 'MB', 'V', 'A', 'W']);
export const unsupportedLabel = (text: string) => UNSUPPORTED_LABELS.has(text);

export type Lexical = { entry: Lexeme; case: Inflection | null };

export function lexicalReading(text: string): Lexical | Category | null {
  const base = baseOf(text);
  const c = currency(base);
  const entry = abbreviation(base) ?? (c ? currencyLexeme(c, base) : null);
  if (!entry) return null;
  const parts = suffixParts(text);
  if (!parts || parts[1].length > 1) return 'unsupported';
  if (!parts[1].length) return { entry, case: null };
  const kase = caseInflection(entry.source, parts[1][0]);
  return kase ? { entry, case: kase } : 'invalid';
}

export function percent(text: string): { number: Num; case: Inflection | null } | Category | null {
  const parts = suffixParts(text);
  if (!parts || !parts[0].startsWith('%')) return null;
  const n = parseNumber(parts[0].slice(1));
  if (!n) return 'invalid';
  if (parts[1].length > 1) return 'unsupported';
  const spoken = number(n);
  const s = parts[1][0];
  if (s === undefined) return { number: n, case: null };
  if (s === spoken.sourceSuffix('derivation')) return { number: n, case: 'derivation' };
  const kase = spokenCase(spoken, s);
  return kase ? { number: n, case: kase } : 'invalid';
}

const RANGE_NOUNS = ['kişi', 'adet', 'gün', 'yaş'];
export const rangeNoun = (text: string) => RANGE_NOUNS.includes(lookupKey(text));

export type NumericRange = { start: Num; end: Num; unit: Lexeme | null; noun: string | null };

export function parseRange(text: string, context: string | null): NumericRange | null {
  let found: [Num, Num] | null = null;
  for (let offset = 1; offset < text.length; offset++) {
    const ch = text[offset];
    if (ch !== '-' && ch !== '–') continue;
    const start = parseNumber(text.slice(0, offset));
    const end = parseNumber(text.slice(offset + 1));
    if (start && end) {
      if (found) return null;
      found = [start, end];
    }
  }
  if (!found) return null;
  let u: Lexeme | null = null, noun: string | null = null;
  if (context !== null) {
    if (rangeNoun(context)) noun = context;
    else if (!(u = unit(context))) return null;
  }
  return { start: found[0], end: found[1], unit: u, noun };
}

export function renderRange(r: NumericRange): string {
  let out = `${number(r.start).text} ila ${number(r.end).text}`;
  if (r.unit) out += ' ' + r.unit.output;
  if (r.noun) out += ' ' + r.noun;
  return out;
}

// ── domain/identifiers.rs ───────────────────────────────────────────────────

export type Telephone = { national: string; international: boolean; nationalZero: boolean };

export function parseTelephone(text: string, explicit: boolean): Telephone | null {
  if (!/^[0-9+ \-()]*$/.test(text)) return null;
  if ((text.match(/\+/g) ?? []).length > (text.startsWith('+') ? 1 : 0)) return null;
  let depth = 0;
  for (const ch of text) {
    if (ch === '(' && depth === 0) depth = 1;
    else if (ch === ')' && depth === 1) depth = 0;
    else if (ch === '(' || ch === ')') return null;
  }
  if (depth !== 0 || /[- (]$/.test(text) || text.includes('--') || text.includes('  ')) return null;
  const international = text.startsWith('+90');
  const cleaned = text.replace(/[^0-9]/g, '');
  let national: string, nationalZero: boolean;
  if (international) {
    if (cleaned.length !== 12) return null;
    national = cleaned.slice(2); nationalZero = false;
  } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
    national = cleaned.slice(1); nationalZero = true;
  } else if (cleaned.length === 10 && explicit) {
    national = cleaned; nationalZero = false;
  } else return null;
  const groups = text.split(/[ \-()]/).filter(Boolean);
  if (groups.length > 1) {
    const sizes = groups.map((s) => s.replace(/^\++/, '').length).join(',');
    const allowed = international ? sizes === '2,3,3,2,2'
      : nationalZero ? sizes === '4,3,2,2' || sizes === '1,3,3,2,2'
      : explicit && sizes === '3,3,2,2';
    if (!allowed) return null;
  }
  return { national, international, nationalZero };
}

export function renderTelephone(t: Telephone): string {
  const chunks: string[] = [];
  if (t.international) chunks.push('artı doksan');
  if (t.nationalZero) chunks.push('sıfır');
  for (const [a, b] of [[0, 3], [3, 6], [6, 8], [8, 10]]) {
    const group = t.national.slice(a, b);
    chunks.push(group.startsWith('0') ? digits(group) : cardinal(group).text);
  }
  return chunks.join(' ');
}

export function parseIban(text: string): string | null {
  const groups = text.split(' ');
  if (groups.some((g) => !g)) return null;
  if (groups.length > 1 && (groups.length !== 7 || groups.slice(0, 6).some((g) => g.length !== 4) || groups[6].length !== 2)) return null;
  const canonical = groups.join('');
  if (canonical.length !== 26 || !canonical.startsWith('TR') || !allDigits(canonical.slice(2))) return null;
  const check = Number(canonical.slice(2, 4));
  if (check < 2 || check > 98) return null;
  let remainder = 0;
  for (const ch of canonical.slice(4) + '2927' + canonical.slice(2, 4)) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1 ? canonical : null;
}

export function renderIban(canonical: string): string {
  let out = 'te re ' + digits(canonical.slice(2, 4));
  for (let i = 4; i < canonical.length; i += 4) out += ', ' + digits(canonical.slice(i, i + 4));
  return out;
}

// ── domain/electronic.rs ────────────────────────────────────────────────────

const TLD: Record<string, string> = { com: 'kom', net: 'net', org: 'org', tr: 'te re', gov: 'gov', edu: 'edu', app: 'app' };
const tld = (text: string): string | null => TLD[text.replace(/[A-Z]/g, (c) => c.toLowerCase())] ?? null;
const isAscii = (text: string) => /^[\x00-\x7f]*$/.test(text);

function host(text: string): boolean {
  if (text.length > 253 || !text || !isAscii(text)) return false;
  const labels = text.split('.');
  return labels.length >= 2
    && labels.every((l) => l && l.length <= 63 && !l.startsWith('-') && !l.endsWith('-')
      && l.slice(0, 4).toLowerCase() !== 'xn--' && /^[A-Za-z0-9-]+$/.test(l))
    && tld(labels[labels.length - 1]) !== null;
}

const CHARACTER_WORDS: Record<string, string> = {
  '.': 'nokta', '@': 'et', '/': 'eğik çizgi', ':': 'iki nokta', '?': 'soru işareti', '=': 'eşittir', '&': 've',
  '#': 'kare', '%': 'yüzde', '-': 'tire', '_': 'alt çizgi', '+': 'artı', '(': 'aç parantez', ')': 'kapat parantez',
  '!': 'ünlem', '$': 'dolar işareti', "'": 'kesme', '*': 'yıldız', ',': 'virgül', ';': 'noktalı virgül', '~': 'tilde',
};

function characters(text: string, domain: boolean): string {
  const words: string[] = [];
  for (const m of text.matchAll(/[A-Za-z]+|[0-9]+|[^A-Za-z0-9]/g)) {
    const chunk = m[0];
    if (/^[A-Za-z]/.test(chunk)) words.push(domain ? tld(chunk) ?? chunk : chunk);
    else if (/^[0-9]/.test(chunk)) words.push(digits(chunk));
    else if (CHARACTER_WORDS[chunk]) words.push(CHARACTER_WORDS[chunk]);
  }
  return words.join(' ');
}

function domainWords(domain: string): string {
  const parts = domain.split('.');
  return parts.map((part, i) => (i === parts.length - 1 ? tld(part) ?? part
    : i === 0 && part === 'www' ? 'çift ve çift ve çift ve' : characters(part, false))).join(' nokta ');
}

export function parseElectronic(text: string, bare: boolean): string | null {
  if (!isAscii(text) || /[\x00-\x1f\x7f]/.test(text)) return null;
  if (text.includes('@') && !text.includes('://') && !text.startsWith('www.')) {
    if ((text.match(/@/g) ?? []).length !== 1) return null;
    const [local, domain] = text.split('@');
    if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')
      || !/^[A-Za-z0-9._+-]+$/.test(local) || !host(domain)) return null;
    return `${characters(local, false)} et ${domainWords(domain)}`;
  }
  let prefix: string, body: string;
  if (text.slice(0, 8).toLowerCase() === 'https://') { prefix = 'ha te te pe es iki nokta eğik çizgi eğik çizgi '; body = text.slice(8); }
  else if (text.slice(0, 7).toLowerCase() === 'http://') { prefix = 'ha te te pe iki nokta eğik çizgi eğik çizgi '; body = text.slice(7); }
  else if (text.startsWith('www.') || bare) { prefix = ''; body = text; }
  else return null;
  if (!body) return null;
  let split = body.search(/[/?#]/);
  if (split < 0) split = body.length;
  const authority = body.slice(0, split);
  const rest = body.slice(split);
  const colon = authority.indexOf(':');
  const domain = colon < 0 ? authority : authority.slice(0, colon);
  if (colon >= 0) {
    const port = authority.slice(colon + 1);
    if (!port || port.length > 5 || !allDigits(port)) return null;
    const n = Number(port);
    if (n < 1 || n > 65535) return null;
  }
  if (!host(domain) || authority.includes('@')) return null;
  let depth = 0;
  for (let i = 0; i < rest.length;) {
    const b = rest[i];
    if (b === '%') {
      if (i + 2 >= rest.length || !/^[0-9A-Fa-f]{2}$/.test(rest.slice(i + 1, i + 3))) return null;
      i += 3;
      continue;
    }
    if (!/[A-Za-z0-9]/.test(b) && !"-._~!$&'()*+,;=:@/?#".includes(b)) return null;
    if (b === '(') depth++;
    if (b === ')') depth--;
    if (depth < 0) return null;
    i++;
  }
  if (depth !== 0 || (rest.match(/#/g) ?? []).length > 1) return null;
  let spoken = prefix + domainWords(domain);
  if (colon >= 0) spoken += ' iki nokta ' + digits(authority.slice(colon + 1));
  if (rest) spoken += ' ' + characters(rest, false);
  return spoken;
}

export const looksElectronic = (text: string) => text.includes('@') || text.includes('://') || text.startsWith('www.');

export function hashtag(text: string): string | null {
  if (!text.startsWith('#')) return null;
  const body = text.slice(1);
  const chars = [...body];
  if (!body || !chars.every((c) => /[\p{Alphabetic}\p{N}_]/u.test(c)) || chars.some((c) => /\p{N}/u.test(c) && !/[0-9]/.test(c))) return null;
  let out = 'hashtag ';
  let chunk = '';
  for (const ch of chars) {
    if (/[0-9]/.test(ch)) {
      if (chunk) { out += chunk + ' '; chunk = ''; }
      out += digits(ch) + ' ';
    } else chunk += ch;
  }
  out += chunk;
  return out.trimEnd();
}

// ── verbalize.rs ────────────────────────────────────────────────────────────

export function dateSpoken(d: DateValue): Spoken {
  const year = cardinal(d.year);
  year.prefix(`${cardinal(d.day).text} ${MONTHS[d.month - 1]} `);
  return year;
}

export function timeSpoken(t: Clock): Spoken {
  const hour = cardinal(t.hour);
  if (t.minute === 0) return hour;
  const minute = cardinal(t.minute);
  minute.prefix(`${hour.text} `);
  return minute;
}

export function render(value: Value): string {
  switch (value.kind) {
    case 'numeric': return renderNumeric(value.value).text;
    case 'date': case 'time': {
      const spoken = value.kind === 'date' ? dateSpoken(value.date) : timeSpoken(value.clock);
      if (value.locative) spoken.inflect('locative');
      return spoken.text;
    }
    case 'percent': {
      const spoken = number(value.number);
      if (value.case) spoken.inflect(value.case);
      spoken.prefix('yüzde ');
      return spoken.text;
    }
    case 'quantity': return renderQuantity(value.value).text;
    case 'lexical': {
      const spoken = Spoken.lexical(value.entry.output, value.entry.target);
      if (value.case) spoken.inflect(value.case);
      return spoken.text;
    }
    case 'range': return renderRange(value.value);
    case 'telephone': return renderTelephone(value.value);
    case 'iban': return renderIban(value.canonical);
    case 'roman': return renderNumeric(value.value).text;
    case 'electronic': return value.spoken;
    case 'symbol': return value.text;
  }
}
