/** What the phone itself says on a call, in the language the call is held in.
 *
 *  Not the interface's strings: the app's buttons are English, but these are
 *  heard, and the call is held in the phone's own language (`locale()` in
 *  voice.ts). English read by the Turkish voice is neither language. Plain
 *  words in both — no butler, in any language. */
export type CallLines = {
  greeting: string;
  quiet: string;
  working: (n: number) => string;
  blocked: (n: number) => string;
};

const TR: CallLines = {
  greeting: 'Alo.',
  quiet: 'Her şey sakin.',
  working: (n) => `${n} iş çalışıyor.`,
  blocked: (n) => `${n} iş seni bekliyor.`,
};

const EN: CallLines = {
  greeting: 'Hello.',
  quiet: 'All quiet here.',
  working: (n) => `${n} running.`,
  blocked: (n) => `${n} waiting on you.`,
};

/** The lines for a call held in `lang` (a tag such as 'tr-TR'); English for anything else. */
export function callLines(lang: string): CallLines {
  return /^tr\b/i.test(lang || '') ? TR : EN;
}

/** The headline after the greeting: what is blocked first — the only thing
 *  waiting on the person holding the phone — then what is running. */
export function headline(lang: string, h: { working: number; blocked: number }): string {
  const l = callLines(lang);
  const bits: string[] = [];
  if (h.blocked > 0) bits.push(l.blocked(h.blocked));
  if (h.working > 0) bits.push(l.working(h.working));
  if (!bits.length) bits.push(l.quiet);
  return bits.join(' ');
}
