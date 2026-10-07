// EMA Lightning's chunker (ema_lightning/chunker.py), ported: spoken text in, pieces short enough for one
// pass of the model out. Text that fits in about ten seconds stays one piece; longer text is cut at the
// last good spot inside each ten-second window — a sentence end, then a clause mark, then a space, and
// only when there is none of those, exactly at the limit.
//
// Indices are UTF-16 units, Python's are code points: the same for frontend output, which is all BMP.

const LETTERS_PER_SECOND = 18.0;
const MAX_SECONDS = 10.0;
const MAX_LETTERS = 250;
const SENTENCE_PAUSE = 0.25;
const CLAUSE_PAUSE = 0.12;
const CUTS: [RegExp, number][] = [
  [/[.!?]+["')]*(?= )/g, SENTENCE_PAUSE],
  [/[,;:](?= )/g, CLAUSE_PAUSE],
  [/\S(?= )/g, CLAUSE_PAUSE],
];
const LETTER = /[\p{L}\p{Nl}\p{No}]/u;

/** A piece of text and the seconds of silence after it. */
export type Piece = { text: string; pause: number };

/** Pieces, each ending in terminal punctuation; the last has no pause after it. */
export function chunk(text: string, speed = 1.0): Piece[] {
  const limit = Math.trunc(Math.min(MAX_LETTERS, LETTERS_PER_SECOND * MAX_SECONDS * speed));
  const pieces: Piece[] = [];
  let rest = text.trim();
  while (rest) {
    let cut = rest.length, pause = 0.0;
    if (rest.length > limit) {
      cut = limit;
      // finditer(rest, 0, limit + 1): the window ends there, lookahead included
      const window = rest.slice(0, limit + 1);
      for (const [pattern, gap] of CUTS) {
        const ends = Array.from(window.matchAll(pattern), (m) => m.index! + m[0].length);
        if (ends.length) { cut = ends[ends.length - 1]; pause = gap; break; }
      }
    }
    const piece = rest.slice(0, cut).trim();
    rest = rest.slice(cut).trim();
    if (LETTER.test(piece)) pieces.push({ text: finish(piece), pause });
  }
  if (pieces.length) pieces[pieces.length - 1].pause = 0.0;
  return pieces;
}

/** End every piece the way the model was trained: on a sentence end. */
export function finish(piece: string): string {
  if (['.', '!', '?'].includes(piece.replace(/["')]+$/, '').slice(-1))) return piece;
  return piece.replace(/[,;:\- ]+$/, '') + '.';
}
