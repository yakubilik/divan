/** What the phone itself says on a call, in the language the call is held in.
 *
 *  English is here; Turkish is the computer's language pack `app/call`
 *  (lang.ts). Without the pack a call held in Turkish is answered in English.
 *
 *  Not the interface's strings: the app's buttons are English, but these are
 *  heard, and the call is held in the phone's own language (`locale()` in
 *  voice.ts). English read by the Turkish voice is neither language.
 *
 *  Pickup is the greeting and nothing else: no count of what is running or
 *  waiting. The model answers that when it is asked. */
import { pack } from './lang';

export type CallLines = {
  /** What the transcript shows. */
  greeting: string;
  /** What the voice is given. The same words, punctuated for the ear: the
   *  comma is the beat between the two words and the exclamation mark keeps
   *  it playful. Both voices read the repeated vowels as one long vowel
   *  rather than spelling them out (EMA's normaliser passes them through as a
   *  plain word; see test-call-pickup.cjs). */
  greetingSpoken: string;
};

/** The pack `app/call`: the Turkish lines and the yes and no words. */
interface CallPack {
  greeting?: string;
  greeting_spoken?: string;
  chat?: {
    looking?: string; approval?: Partial<Record<Kind, string>>; structured?: string;
    dangerous?: string; yes_or_no?: string; allowed?: string; denied?: string;
  };
  no?: string[];
  yes?: string[];
}
const trPack = () => pack<CallPack>('tr', 'app/call');
const isTr = (lang: string) => /^tr\b/i.test(lang || '');

const EN: CallLines = {
  greeting: 'Hello.',
  greetingSpoken: 'Hello.',
};

/** The lines for a call held in `lang` (a tag such as 'tr-TR'); English for anything else. */
export function callLines(lang: string): CallLines {
  const tr = isTr(lang) ? trPack() : undefined;
  if (!tr?.greeting) return EN;
  return { greeting: tr.greeting, greetingSpoken: tr.greeting_spoken || tr.greeting };
}

// ── a call made from inside a chat ──────────────────────────────────────────
// There the call talks to that chat's own session, so the phone has a few
// lines of its own to say around the agent's reply: one while it works, and
// the approval it is waiting on, put as a question that a yes or a no answers.

export type ChatCallLines = {
  /** Said once per turn, at the first tool call, instead of silence. */
  looking: string;
  /** An approval, as a question. The tool's input is never read out: it is a
   *  command or a path, and neither is something a voice should spell. */
  approval: (tool: string) => string;
  /** A destructive request is not approved by voice; it waits in the app. */
  dangerous: string;
  structured: string;
  /** The answer to an approval question was neither a yes nor a no. */
  yesOrNo: string;
  allowed: string;
  denied: string;
};

type Kind = 'command' | 'edit' | 'read' | 'web' | 'other';

function kindOf(tool: string): Kind {
  if (tool === 'Bash' || tool === 'BashOutput' || tool === 'KillShell') return 'command';
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return 'edit';
  if (/^(Read|Glob|Grep|LS)$/.test(tool)) return 'read';
  if (/^Web(Fetch|Search)$/.test(tool)) return 'web';
  return 'other';
}

const CHAT_EN: ChatCallLines = {
  looking: 'Looking into it.',
  approval: (tool) => ({
    command: 'It wants to run a command. Shall I allow it?',
    edit: 'It wants to change a file. Shall I allow it?',
    read: 'It wants to read a file. Shall I allow it?',
    web: 'It wants to look something up online. Shall I allow it?',
    other: 'It wants to use a tool. Shall I allow it?',
  })[kindOf(tool)],
  structured: 'It needs a form or question answered. Please use the chat screen.',
  dangerous: 'It is asking to do something destructive. That one has to be approved in the app.',
  yesOrNo: 'Yes or no?',
  allowed: 'Okay.',
  denied: 'Okay, denied.',
};

export function chatCallLines(lang: string): ChatCallLines {
  const tr = isTr(lang) ? trPack()?.chat : undefined;
  if (!tr) return CHAT_EN;
  return {
    looking: tr.looking || CHAT_EN.looking,
    approval: (tool) => tr.approval?.[kindOf(tool)] || CHAT_EN.approval(tool),
    structured: tr.structured || CHAT_EN.structured,
    dangerous: tr.dangerous || CHAT_EN.dangerous,
    yesOrNo: tr.yes_or_no || CHAT_EN.yesOrNo,
    allowed: tr.allowed || CHAT_EN.allowed,
    denied: tr.denied || CHAT_EN.denied,
  };
}

// Both languages are listened for whichever the call is held in: people answer
// "okay" in the middle of Turkish (whose words are the pack's). A no is looked
// for first, because most of them contain a yes ("don't do it").
const NO = ['no', 'nope', 'nah', 'dont', 'do not', 'deny', 'cancel', 'stop', 'never'];
const YES = ['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'allow', 'approve', 'go ahead', 'do it'];
/** The Turkish capital dotted I, which lower-cases to two code points otherwise. */
const DOTTED_CAPITAL_I = /\u0130/g;

/** A spoken answer to an approval question: true for yes, false for no, null
 *  when it was neither and the question has to be asked again. */
export function yesNo(heard: string): boolean | null {
  const words = (heard || '').replace(DOTTED_CAPITAL_I, 'i').toLowerCase().replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return null;
  const s = ` ${words.join(' ')} `;
  const tr = trPack();
  const no = [...NO, ...(tr?.no ?? [])];
  const yes = [...YES, ...(tr?.yes ?? [])];
  if (no.some((w) => s.includes(` ${w} `))) return false;
  if (yes.some((w) => s.includes(` ${w} `))) return true;
  return null;
}
