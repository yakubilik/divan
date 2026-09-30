/** A ticket as the steps it has to go through, and where it has got to.
 *
 *  A ticket used to open as a conversation: the goal at the top, the reports
 *  under it, the question at the end. Everything in it was true and most of it
 *  was the brief — the words handed to an agent — which is the one thing
 *  nobody reading a board wants to read. What they want is the same thing a
 *  build page gives you: the steps, in order, ticking off.
 *
 *  So this is that, out of what the queue already writes down. Every run of
 *  every stage is an event, and the daemon folds those into `steps`
 *  (`ustabasi.py`): which stage, which round, when it began, when it ended and
 *  how. What is here is the arrangement — the rounds in order, each with the
 *  stages it went through and the ones still ahead of it — and no drawing at
 *  all, so a check can hold it without a browser.
 *
 *  The order is the queue's own: a worker writes it, a check runs the
 *  mechanical part, a verifier reads it against the card. Triage is not in
 *  that list because it is not a step of the work — it is the queue deciding
 *  what to do about a worker that stopped — so it is drawn where it happened
 *  and never as something still to come.
 */
import type { Status, Ticket } from './ustabasi';

/** The three stages every round walks, in the order it walks them. */
export const STAGES = ['worker', 'check', 'verifier'] as const;

export type Stage = string;

/** What a step is doing. `stopped` is the one that needs a person: a stage
 *  that ended badly, or the stage a red ticket is sitting on. */
export type StepState = 'done' | 'running' | 'stopped' | 'waiting';

export interface Step {
  stage: Stage;
  state: StepState;
  /** The queue's own word for how it ended: `ok`, `rejected`, `blocked`… */
  outcome: string | null;
  at: number | null;
  endedAt: number | null;
  /** How many attempts this stage took in this round. A worker that crashed
   *  and was picked up again is one step that took two goes, not two steps —
   *  a list that grew a row every time a process died would be a list of
   *  processes rather than of work. */
  tries: number;
  /** Which model and sign-in the last attempt ran on, where the queue said. */
  model: string | null;
  account: string | null;
}

export interface Round {
  round: number;
  steps: Step[];
  /** Nothing has finished this round yet and something is running in it. */
  live: boolean;
}

interface RawStep {
  stage?: string;
  round?: number;
  at?: number;
  ended_at?: number | null;
  outcome?: string | null;
  model?: string | null;
  account?: string | null;
}

const RED: Status[] = ['blocked', 'failed'];

/** Every round a ticket has been through, oldest first, each with its steps.
 *
 *  A stage that has not happened yet is in the list as `waiting` — that is the
 *  whole point of the view, the tick that is not ticked yet — but only in the
 *  round that is actually being worked: a finished ticket does not grow three
 *  empty rows, and a round that was abandoned because the verifier turned it
 *  down does not pretend it was going to do more.
 */
export function flow(t: Ticket): Round[] {
  const raw = ((t as any).steps ?? []) as RawStep[];
  const rounds = new Map<number, Step[]>();

  for (const s of raw) {
    const n = Number(s.round ?? t.round) || 1;
    const list = rounds.get(n) ?? [];
    const stage = String(s.stage ?? '').trim() || 'worker';
    const last = list[list.length - 1];
    // The same stage picked up again in the same round is the same step.
    if (last && last.stage === stage) {
      last.tries += 1;
      last.at = last.at ?? (s.at ?? null);
      last.endedAt = s.ended_at ?? null;
      last.outcome = s.outcome ?? null;
      last.model = s.model ?? last.model;
      last.account = s.account ?? last.account;
      last.state = stepState(s, t);
    } else {
      list.push({
        stage,
        state: stepState(s, t),
        outcome: s.outcome ?? null,
        at: s.at ?? null,
        endedAt: s.ended_at ?? null,
        tries: 1,
        model: s.model ?? null,
        account: s.account ?? null,
      });
    }
    rounds.set(n, list);
  }

  const numbers = [...rounds.keys()].sort((a, b) => a - b);
  if (!numbers.length) {
    // Nothing has run at all: the whole round is ahead of it.
    return [{ round: t.round || 1, live: false, steps: STAGES.map(ahead) }];
  }

  return numbers.map((n) => {
    const steps = rounds.get(n)!;
    const current = n === (t.round || 1);
    // What is still to come in the round being worked, in the queue's order,
    // and nothing at all in a round that is behind us.
    if (current && !['done', 'cancelled'].includes(t.status)) {
      const seen = new Set(steps.map((s) => s.stage));
      const from = STAGES.findIndex((s) => s === steps[steps.length - 1]?.stage);
      for (const stage of STAGES.slice(Math.max(0, from) + (from >= 0 ? 1 : 0))) {
        if (!seen.has(stage)) steps.push(ahead(stage));
      }
    }
    return { round: n, steps, live: steps.some((s) => s.state === 'running') };
  });
}

const ahead = (stage: string): Step => ({
  stage, state: 'waiting', outcome: null, at: null, endedAt: null,
  tries: 1, model: null, account: null,
});

function stepState(s: RawStep, t: Ticket): StepState {
  if (s.ended_at == null) {
    // The queue writes no ending for a run that is still going — and none for
    // one that was killed either, so a ticket that is not running any more is
    // read off the ticket rather than off the step.
    if (t.status === 'running') return 'running';
    return RED.includes(t.status) ? 'stopped' : 'done';
  }
  const out = (s.outcome ?? '').trim();
  if (!out || out === 'ok') return 'done';
  return out === 'rejected' ? 'done' : 'stopped';
}

/** The step a person is waiting on, which is the one a window scrolls to and
 *  draws the live run under. Null on a ticket that is not running. */
export function current(rounds: Round[]): { round: number; step: Step } | null {
  for (let i = rounds.length - 1; i >= 0; i--) {
    const found = rounds[i].steps.find((s) => s.state === 'running' || s.state === 'stopped');
    if (found) return { round: rounds[i].round, step: found };
  }
  return null;
}

/** What a step says about itself in one line: the outcome where there is one,
 *  how many goes it took where it took more than one. Empty where the honest
 *  answer is nothing — a step that has not started says nothing rather than
 *  "waiting", which the tick already says. */
export function stepNote(s: Step): string {
  const bits: string[] = [];
  if (s.outcome && s.outcome !== 'ok') bits.push(s.outcome);
  if (s.tries > 1) bits.push(`${s.tries} goes`);
  return bits.join(' · ');
}

/** The mark in front of a step. A character rather than a colour alone: the
 *  panel's rule everywhere else, and the reason the board is readable in a
 *  screenshot. */
export const STEP_MARK: Record<StepState, string> = {
  done: '✓', running: '●', stopped: '✗', waiting: '○',
};
