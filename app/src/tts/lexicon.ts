// The Turkish voice's lexicon: every word, suffix and fixed reading the normalizer speaks. The repository
// holds none of it; it is the language pack `tr/app/tts.json`, handed in with `setLexicon` by whoever has
// the pack (src/ema.ts on the phone, the tests in node). Without one the frontend refuses to run and the
// phone reads Turkish with the system voice.

export type Inflection = 'ordinal' | 'accusative' | 'dative' | 'locative' | 'ablative' | 'genitive' | 'derivation';
/** Vowel harmony class of a word's last vowel: front or back, rounded or unrounded. */
export type Harmony = 'backFlat' | 'frontFlat' | 'backRound' | 'frontRound';
/** How a word ends, as far as a suffix cares: a vowel, a voiced or voiceless consonant, a final stop that
 *  softens before a vowel (to the pack's `softened` letter), or a possessive ending that takes a buffer n. */
export type WordEnd = 'vowel' | 'voiced' | 'voiceless' | 'softens' | 'softensP' | 'possessive';

export type Word = { text: string; harmony: Harmony; end: WordEnd };
export type Lexeme = { output: string; source: Word; target: Word };
export type CurrencyEntry = { output: string; sources: Map<string, Word>; target: Word; minor: Lexeme };

/** The pack, checked and turned into what the code looks things up in. */
export type Lexicon = {
  warmup: string;
  /** Suffix templates per inflection: [after a vowel, after a consonant]. `{H}` is the high vowel of the
   *  word's harmony, `{A}` the low one, `{D}` the stop (voiced or voiceless by the word's end). */
  suffixes: Record<Inflection, [string, string]>;
  /** The cases that take a different template after a possessive ending. */
  possessive: Map<Inflection, string>;
  stops: { voiced: string; voiceless: string };
  softened: { softens: string; softensP: string };
  digits: Word[];
  tens: Word[];
  hundred: Word;
  scales: Word[];
  plus: string;
  minus: string;
  decimal: string;
  months: string[];
  units: [string, Lexeme][];
  rates: Map<string, [string, string]>;
  abbreviations: Map<string, Lexeme>;
  keepPeriod: string[];
  currencyOf: Map<string, string>;
  currencies: Map<string, CurrencyEntry>;
  letters: Map<string, string>;
  symbols: Map<string, string>;
  rangeNouns: string[];
  rangeJoin: string;
  tlds: Map<string, string>;
  http: string;
  https: string;
  hashtag: string;
  percent: string;
  cues: { date: string[]; time: string[]; telephone: string[]; web: string[] };
  century: string;
  worldWar: [string, string];
  codePoint: string;
};

const INFLECTIONS: Inflection[] = ['ordinal', 'accusative', 'dative', 'locative', 'ablative', 'genitive', 'derivation'];
const HARMONIES = new Set<string>(['backFlat', 'frontFlat', 'backRound', 'frontRound']);
const ENDS = new Set<string>(['vowel', 'voiced', 'voiceless', 'softens', 'softensP', 'possessive']);

function bad(what: string): never {
  throw new Error(`tts lexicon: ${what}`);
}

const str = (v: unknown, what: string): string => (typeof v === 'string' && v ? v : bad(what));
const strs = (v: unknown, what: string, n?: number): string[] => {
  if (!Array.isArray(v) || (n !== undefined && v.length !== n)) bad(what);
  return v.map((x, i) => str(x, `${what}[${i}]`));
};
const obj = (v: unknown, what: string): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : bad(what));
const strMap = (v: unknown, what: string) => new Map(Object.entries(obj(v, what)).map(([k, x]) => [k, str(x, `${what}.${k}`)]));

/** A word is `[text, harmony, end]`. */
function word(v: unknown, what: string): Word {
  if (!Array.isArray(v) || v.length !== 3) bad(what);
  const [text, harmony, end] = v;
  if (!HARMONIES.has(harmony) || !ENDS.has(end)) bad(what);
  return { text: str(text, what), harmony, end };
}
const words = (v: unknown, what: string, n: number): Word[] => {
  if (!Array.isArray(v) || v.length !== n) bad(what);
  return v.map((x, i) => word(x, `${what}[${i}]`));
};

/** A lexeme is a word (`[output, harmony, end]`, read and inflected as itself) or
 *  `{output, source, target}`: its suffix as written follows `source`, as spoken `target`. */
function lexeme(v: unknown, what: string): Lexeme {
  if (Array.isArray(v)) {
    const w = word(v, what);
    return { output: w.text, source: w, target: { ...w } };
  }
  const o = obj(v, what);
  return { output: str(o.output, `${what}.output`), source: word(o.source, `${what}.source`), target: word(o.target, `${what}.target`) };
}

function compile(raw: unknown): Lexicon {
  const p = obj(raw, 'not an object');
  const suffixes = {} as Record<Inflection, [string, string]>;
  const s = obj(p.suffixes, 'suffixes');
  for (const i of INFLECTIONS) {
    const pair = strs(s[i], `suffixes.${i}`, 2);
    suffixes[i] = [pair[0], pair[1]];
  }
  const possessive = new Map<Inflection, string>();
  for (const [k, v] of Object.entries(obj(p.possessive, 'possessive'))) {
    if (!INFLECTIONS.includes(k as Inflection)) bad(`possessive.${k}`);
    possessive.set(k as Inflection, str(v, `possessive.${k}`));
  }
  const stops = obj(p.stops, 'stops');
  const softened = obj(p.softened, 'softened');
  const cues = obj(p.cues, 'cues');
  const units = (Array.isArray(p.units) ? p.units : bad('units')).map((u, i): [string, Lexeme] => {
    if (!Array.isArray(u) || u.length !== 2) bad(`units[${i}]`);
    return [str(u[0], `units[${i}]`), lexeme(u[1], `units[${i}]`)];
  });
  const unitSymbols = new Set(units.map(([k]) => k));
  const rates = new Map<string, [string, string]>();
  for (const [k, v] of Object.entries(obj(p.rates, 'rates'))) {
    const [per, of] = strs(v, `rates.${k}`, 2);
    if (!unitSymbols.has(per) || !unitSymbols.has(of)) bad(`rates.${k}`);
    rates.set(k, [per, of]);
  }
  const abbreviations = new Map(Object.entries(obj(p.abbreviations, 'abbreviations')).map(([k, v]) => [k, lexeme(v, `abbreviations.${k}`)]));
  const currencyOf = new Map<string, string>();
  const currencies = new Map<string, CurrencyEntry>();
  for (const [code, v] of Object.entries(obj(p.currencies, 'currencies'))) {
    const c = obj(v, `currencies.${code}`);
    const sources = new Map(Object.entries(obj(c.sources, `currencies.${code}.sources`)).map(([k, w]) => [k, word(w, `currencies.${code}.sources.${k}`)]));
    for (const label of strs(c.labels, `currencies.${code}.labels`)) {
      if (!sources.has(label)) bad(`currencies.${code}.sources.${label}`);
      currencyOf.set(label, code);
    }
    currencies.set(code, {
      output: str(c.output, `currencies.${code}.output`), sources,
      target: word(c.target, `currencies.${code}.target`), minor: lexeme(c.minor, `currencies.${code}.minor`),
    });
  }
  const worldWar = strs(p.worldWar, 'worldWar', 2);
  return {
    warmup: str(p.warmup, 'warmup'),
    suffixes,
    possessive,
    stops: { voiced: str(stops.voiced, 'stops.voiced'), voiceless: str(stops.voiceless, 'stops.voiceless') },
    softened: { softens: str(softened.softens, 'softened.softens'), softensP: str(softened.softensP, 'softened.softensP') },
    digits: words(p.digits, 'digits', 10),
    tens: words(p.tens, 'tens', 9),
    hundred: word(p.hundred, 'hundred'),
    scales: words(p.scales, 'scales', 5),
    plus: str(p.plus, 'plus'),
    minus: str(p.minus, 'minus'),
    decimal: str(p.decimal, 'decimal'),
    months: strs(p.months, 'months', 12),
    units,
    rates,
    abbreviations,
    keepPeriod: strs(p.keepPeriod, 'keepPeriod'),
    currencyOf,
    currencies,
    letters: strMap(p.letters, 'letters'),
    symbols: strMap(p.symbols, 'symbols'),
    rangeNouns: strs(p.rangeNouns, 'rangeNouns'),
    rangeJoin: str(p.rangeJoin, 'rangeJoin'),
    tlds: strMap(p.tlds, 'tlds'),
    http: str(p.http, 'http'),
    https: str(p.https, 'https'),
    hashtag: str(p.hashtag, 'hashtag'),
    percent: str(p.percent, 'percent'),
    cues: {
      date: strs(cues.date, 'cues.date'), time: strs(cues.time, 'cues.time'),
      telephone: strs(cues.telephone, 'cues.telephone'), web: strs(cues.web, 'cues.web'),
    },
    century: str(p.century, 'century'),
    worldWar: [worldWar[0], worldWar[1]],
    codePoint: str(p.codePoint, 'codePoint'),
  };
}

let current: Lexicon | null = null;
let installed: unknown = null;

/** Install the pack's data (or remove it with null). A pack that is not a whole lexicon installs
 *  nothing, and the one before it stays; returns whether a lexicon is in place for this data. */
export function setLexicon(data: unknown): boolean {
  if (data == null) { current = null; installed = null; return false; }
  if (data === installed && current) return true;
  try {
    current = compile(data);
    installed = data;
    return true;
  } catch (e) {
    console.warn(String((e as Error)?.message ?? e));
    return false;
  }
}

export function hasLexicon(): boolean {
  return current !== null;
}

/** The installed lexicon; throws when there is none, so nothing is read with half the words missing. */
export function lex(): Lexicon {
  if (!current) throw new Error('no Turkish lexicon (language pack tr/app/tts)');
  return current;
}
