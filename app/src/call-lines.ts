/** What the phone itself says on a call, in the language the call is held in.
 *
 *  Not the interface's strings: the app's buttons are English, but these are
 *  heard, and the call is held in the phone's own language (`locale()` in
 *  voice.ts). English read by the Turkish voice is neither language.
 *
 *  Pickup is the greeting and nothing else: no count of what is running or
 *  waiting. The model answers that when it is asked. */
export type CallLines = {
  /** What the transcript shows. */
  greeting: string;
  /** What the voice is given. The same words, punctuated for the ear: the
   *  comma is the beat between "alo" and "vaysa" and the exclamation mark
   *  keeps it playful. Both voices read the repeated vowels as one long vowel
   *  rather than spelling them out (EMA's normaliser passes them through as a
   *  plain word; see test-call-pickup.cjs). */
  greetingSpoken: string;
};

const TR: CallLines = {
  greeting: 'Alooooo vaysaaaa',
  greetingSpoken: 'Alooooo, vaysaaaa!',
};

const EN: CallLines = {
  greeting: 'Hello.',
  greetingSpoken: 'Hello.',
};

/** The lines for a call held in `lang` (a tag such as 'tr-TR'); English for anything else. */
export function callLines(lang: string): CallLines {
  return /^tr\b/i.test(lang || '') ? TR : EN;
}
