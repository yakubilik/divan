/** Where a sign-in stands, decided away from the sheet that draws it.
 *
 *  A sign-in is a conversation in two voices that do not wait for each other:
 *  the requests this panel sends (`account.login`, `account.login.submit`) and
 *  the events the computer sends back down the same socket (`…prompt`,
 *  `…done`). They arrive in whatever order the computer finished them in — a
 *  key is settled *inside* the request, so its `done` comes before the answer
 *  to the request that asked. The sheet used to take that late answer as "now
 *  wait for a page" and sat on a spinner over an account that was already
 *  signed in.
 *
 *  So every step goes through here, and the two rules are in one place: a
 *  sign-in that has ended stays ended, and one whose code has been handed over
 *  is not asked for the code again by a prompt that repeats.
 *
 *  No React and no store, so `scripts/test-signin.mjs` can walk it in any
 *  order without a browser.
 */
import type { LoginPrompt } from './protocol';

/** `method` choosing how · `waiting` on the computer or on the person, with
 *  nothing to type · `code` the page's code is wanted · `finishing` the code or
 *  the key is with the computer · `done` it said yes or no. */
export type Stage = 'method' | 'waiting' | 'code' | 'finishing' | 'done';

export interface SignIn {
  stage: Stage;
  /** The page to open, and a one-time code where the tool gives one. */
  prompt: LoginPrompt | null;
  ok: boolean;
  /** Who the computer says is signed in now: an address, a plan. */
  detail: string;
  /** Why it did not work, in words a person can act on. */
  problem: string | null;
}

export type Step =
  /** Start was pressed. A key has no page to wait for: it is being checked
   *  from the moment it is sent. */
  | { type: 'start'; key: boolean }
  /** `account.login` answered. */
  | { type: 'started'; needsCode: boolean }
  /** …or was refused before anything began. */
  | { type: 'refused'; why: string }
  | { type: 'prompt'; prompt: LoginPrompt }
  /** The code was sent. */
  | { type: 'submit' }
  /** …and the computer would not take it; the sign-in itself is still open. */
  | { type: 'unsent'; why: string }
  | { type: 'done'; ok: boolean; detail?: string | null; why?: string | null }
  /** Try again, from the top. */
  | { type: 'again' };

export const START: SignIn = { stage: 'method', prompt: null, ok: false, detail: '', problem: null };

export function step(s: SignIn, e: Step): SignIn {
  switch (e.type) {
    case 'start':
      return { ...START, stage: e.key ? 'finishing' : 'waiting' };
    case 'started':
      // Only a sheet still waiting moves on: by now the sign-in may have
      // ended, or its prompt may already have asked for the code.
      return s.stage === 'waiting' && e.needsCode ? { ...s, stage: 'code' } : s;
    case 'refused':
      return s.stage === 'done' ? s : { ...START, problem: e.why };
    case 'prompt':
      if (s.stage === 'done' || s.stage === 'method') return s;
      // A prompt is sent again when the tool prints more (the link, then the
      // one-time code). After the code has gone in, that is not a question.
      if (s.stage === 'finishing') return { ...s, prompt: e.prompt };
      return { ...s, prompt: e.prompt, stage: e.prompt.needs_code ? 'code' : 'waiting' };
    case 'submit':
      return s.stage === 'code' ? { ...s, stage: 'finishing', problem: null } : s;
    case 'unsent':
      return s.stage === 'finishing' ? { ...s, stage: 'code', problem: e.why } : s;
    case 'done':
      return {
        ...s, stage: 'done', ok: e.ok, detail: e.detail ?? '',
        problem: e.ok ? null : (e.why || 'The sign-in did not complete.'),
      };
    case 'again':
      return START;
  }
}

/** While this is true the sheet is holding a live sign-in on that computer,
 *  and a stray click beside it must not throw that away: the page's code is
 *  good for one sign-in, and a sheet that closed under it has spent it. */
export function inFlight(s: SignIn): boolean {
  return s.stage === 'waiting' || s.stage === 'code' || s.stage === 'finishing';
}

/** The page e-mails six digits on the way and shows a long code at the end.
 *  The six digits are the ones people paste here, and a wrong code ends the
 *  tool's session for good — so it is said before it is sent. */
export function looksLikeEmailCode(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length < 20 && /^[0-9\s-]+$/.test(t);
}
