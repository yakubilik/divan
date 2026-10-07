// EMA Lightning's text frontend (ema_lightning/frontend.py), ported: any written Turkish in, text in the
// model's own alphabet out, and that text as the ids text.onnx takes. Nothing here throws on text.
//
// The phone's port is checked against the Python frontend's own output in
// scripts/fixtures/tts-frontend.json and tts/vectors.json (`npm test`).

import { normalize } from './normalizer';

/** The model's alphabet; a letter's id is its index (tts/vectors.json `vocab`). */
export const VOCAB = [
  '<pad>', '<unk>', ' ', '!', '"', '%', '&', "'", '(', ')', ',', '-', '.', '/', ':', ';', '?',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w',
  'x', 'y', 'z', 'ç', 'ö', 'ü', 'ğ', 'ı', 'ş',
];
const STOI = new Map(VOCAB.map((ch, i) => [ch, i]));
export const UNK = 1;

const BLOCK_BYTES = 8 * 1024;
const TURKISH = new Set('çğıöşüÇĞİÖŞÜ');
const TYPOGRAPHY: Record<string, string> = {
  '’': "'", '‘': "'", 'ʼ': "'", '´': "'", '`': "'", '“': '"', '”': '"', '„': '"', '«': '"', '»': '"',
  '–': '-', '—': '-', '−': '-', '…': '...',
};
const UNSAFE = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
// Python's str.split() / str.strip() whitespace
const PY_SPACE = /[\t\n\x0b\x0c\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

/** Text the model can read: numbers and notation read aloud, lowercased the Turkish way, and cut to
 *  its alphabet. Empty when nothing readable is left. */
export function frontend(text: string): string {
  const clean = text.replace(LONE_SURROGATE, '').replace(UNSAFE, ' ');
  if (!clean.split(PY_SPACE).some(Boolean)) return '';
  return alphabet(blocks(clean).map(spoken).join(' '));
}

function spoken(block: string): string {
  try {
    return normalize(block);
  } catch {
    return block; // invalid input or a resource limit: keep the words rather than lose the sentence
  }
}

const utf8Length = (s: string) => {
  let n = 0;
  for (const c of s) { const p = c.codePointAt(0)!; n += p < 0x80 ? 1 : p < 0x800 ? 2 : p < 0x10000 ? 3 : 4; }
  return n;
};

/** Split at whitespace into pieces the normalizer accepts in one call. */
export function blocks(text: string): string[] {
  const out: string[] = [];
  let block: string[] = [], size = 0;
  for (const word of text.split(PY_SPACE).filter(Boolean)) {
    const n = utf8Length(word) + 1;
    if (block.length && size + n > BLOCK_BYTES) { out.push(block.join(' ')); block = []; size = 0; }
    block.push(word);
    size += n;
  }
  if (block.length) out.push(block.join(' '));
  return out;
}

export function alphabet(text: string): string {
  const lowered = Array.from(text, (ch) => TYPOGRAPHY[ch] ?? ch).join('').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  let out = '';
  for (let ch of lowered) {
    if (!TURKISH.has(ch)) ch = ch.normalize('NFKD').replace(/\p{M}/gu, '');
    out += ch && Array.from(ch).every((c) => STOI.has(c)) ? ch : ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Each letter's id in the model's alphabet (unknown letters are 1, as `stoi.get(ch, 1)`). */
export function ids(spokenText: string): number[] {
  return Array.from(spokenText, (ch) => STOI.get(ch) ?? UNK);
}
