/** What the agent did between two things it said, as one plain sentence.
 *
 *  A turn is mostly tool calls: forty of them between a question and its
 *  answer is ordinary. Drawn one card each, they are the conversation — the
 *  two sentences that matter are a screen apart and nobody reads the cards
 *  anyway. So a run of them is one line saying what kind of work it was, in
 *  the words a colleague would use ("I ran the tests"), and the cards are
 *  behind it for whoever wants the command.
 *
 *  The sentence is in the language the person writes in. It is the agent
 *  speaking, and it answers them in that language everywhere else.
 */
import type { Item } from './timeline';
import { pack, packRegex } from './lang';

export type Step = Extract<Item, { kind: 'tool' | 'thinking' }>;

export type Block =
  | { kind: 'item'; item: Exclude<Item, Step> }
  | { kind: 'steps'; id: string; steps: Step[] };

export type Lang = 'tr' | 'en';

/** The conversation as blocks: every run of tool calls and thinking is one. */
export function blocks(items: Item[]): Block[] {
  const out: Block[] = [];
  for (const item of items) {
    if (item.kind !== 'tool' && item.kind !== 'thinking') {
      out.push({ kind: 'item', item });
      continue;
    }
    const last = out[out.length - 1];
    if (last?.kind === 'steps') last.steps.push(item);
    else out.push({ kind: 'steps', id: `g${item.id}`, steps: [item] });
  }
  return out;
}

/** A kind of work: what it is called while it is going on, and once it is done. */
type Say = [now: string, done: string];

/** The step strip's words in another language: the pack `web/steps`. */
interface StepsPack { work?: Record<string, Say>; steps?: string; writing?: string; detect?: string }
const stepsPack = (lang: Lang) => (lang === 'en' ? undefined : pack<StepsPack>(lang, 'web/steps'));

/** What a kind of work is called in `lang`, English when the pack lacks it. */
function say(work: Work, lang: Lang): Say {
  const got = stepsPack(lang)?.work?.[work];
  return Array.isArray(got) && got.length === 2 ? got : WORK[work];
}

const WORK = {
  think: ['Thinking', 'thought it through'],
  read: ['Reading files', 'read files'],
  search: ['Searching the code', 'searched the code'],
  edit: ['Editing files', 'edited files'],
  git: ['Looking at the changes', 'looked at the changes'],
  commit: ['Committing the changes', 'committed the changes'],
  push: ['Pushing the changes', 'pushed the changes'],
  github: ['Checking GitHub', 'checked GitHub'],
  test: ['Running the tests', 'ran the tests'],
  build: ['Building the project', 'built the project'],
  install: ['Installing packages', 'installed packages'],
  deploy: ['Deploying', 'deployed'],
  cloud: ['Checking the cloud side', 'checked the cloud side'],
  data: ['Looking in the database', 'looked in the database'],
  request: ['Calling a service', 'called a service'],
  script: ['Running a script', 'ran a script'],
  files: ['Looking through files', 'looked through files'],
  ticket: ['Working the ticket queue', 'worked the ticket queue'],
  run: ['Running commands', 'ran commands'],
  browser: ['Checking the page in the browser', 'checked the page in the browser'],
  shot: ['Taking a screenshot', 'took screenshots'],
  websearch: ['Searching the web', 'searched the web'],
  webread: ['Reading a web page', 'read web pages'],
  agent: ['Handing work to a helper agent', 'used a helper agent'],
  wait: ['Waiting on background work', 'waited on background work'],
  message: ['Messaging another chat', 'messaged another chat'],
  skill: ['Reading how to do it', 'read how to do it'],
  plan: ['Updating the plan', 'updated the plan'],
  memory: ['Taking a note', 'took a note'],
  mail: ['Going through mail', 'went through mail'],
  calendar: ['Checking the calendar', 'checked the calendar'],
  docs: ['Working on a document', 'worked on a document'],
  design: ['Working on the design', 'worked on the design'],
  media: ['Generating media', 'generated media'],
  tool: ['Using a tool', 'used a tool'],
} satisfies Record<string, Say>;

export type Work = keyof typeof WORK;

/** A shell command, by what it is for. The first rule that matches wins, so
 *  the specific ones (a push, a test run) stand before the general ones. */
const SHELL: [RegExp, Work][] = [
  [/\bustabasi\b/, 'ticket'],
  [/\bgit\s+(-\S+\s+)*push\b/, 'push'],
  [/\bgit\s+(-\S+\s+)*(commit|merge|rebase|cherry-pick)\b/, 'commit'],
  [/\b(vercel|firebase\s+deploy|eas\s+(build|submit|update)|terraform\s+apply|cdk\s+deploy|wrangler\s+(deploy|publish)|launchctl\s+(kickstart|bootstrap|load))\b/, 'deploy'],
  [/\b(pytest|vitest|jest|maestro|playwright\s+test|go\s+test|cargo\s+test)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bscripts\/test[-_]|\btest_\w+\.py\b/, 'test'],
  [/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(build|typecheck)\b|\b(tsc|vite\s+build|xcodebuild|gradlew?|cargo\s+build|make)\b|\bexpo\s+(prebuild|export)\b/, 'build'],
  [/\b(npm|pnpm|yarn|bun)\s+(install|i|add|ci)\b|\b(pip3?|uv)\s+(pip\s+)?(install|sync|add)\b|\bbrew\s+install\b|\bpod\s+install\b/, 'install'],
  [/\bgh\s/, 'github'],
  [/\bgit\s/, 'git'],
  [/\b(aws|gcloud|az|kubectl|docker|ssh|terraform)\s/, 'cloud'],
  [/\b(sqlite3|psql|mysql|redis-cli)\b/, 'data'],
  [/\b(curl|wget|http)\s/, 'request'],
  [/\b(python3?|node|npx|uv\s+run|ruby|deno|bun)\b/, 'script'],
  [/\b(ls|cat|head|tail|sed|awk|grep|rg|find|wc|stat|tree|du|file|jq|diff)\b/, 'files'],
];

/** An MCP server, by what it reaches. Matched against the tool's whole name. */
const SERVERS: [RegExp, Work][] = [
  [/screenshot/, 'shot'],
  [/chrome|playwright|browser|puppeteer|firecrawl/, 'browser'],
  [/gmail|mail/, 'mail'],
  [/calendar/, 'calendar'],
  [/docs|drive|notion/, 'docs'],
  [/firebase|firestore|postgres|supabase/, 'data'],
  [/livepeer|image|video/, 'media'],
  [/github/, 'github'],
];

const BUILT_IN: Record<string, Work> = {
  Read: 'read', NotebookRead: 'read',
  Grep: 'search', Glob: 'search', ToolSearch: 'search',
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  WebSearch: 'websearch', WebFetch: 'webread',
  Agent: 'agent', Task: 'agent', Workflow: 'agent',
  Monitor: 'wait', TaskStop: 'wait', TaskOutput: 'wait', ScheduleWakeup: 'wait',
  SendMessage: 'message', ListAgents: 'message',
  Skill: 'skill', TodoWrite: 'plan', ExitPlanMode: 'plan',
  DesignSync: 'design',
};

/** Which kind of work one step is. */
export function workOf(step: Step): Work {
  if (step.kind === 'thinking') return 'think';
  const name = step.tool;
  if (name === 'Bash' || name === 'shell') {
    const cmd = String(step.input?.command ?? '');
    for (const [re, work] of SHELL) if (re.test(cmd)) return work;
    return 'run';
  }
  if (BUILT_IN[name]) return BUILT_IN[name];
  if (/\/memory\//.test(String(step.input?.file_path ?? ''))) return 'memory';
  const lower = name.toLowerCase();
  for (const [re, work] of SERVERS) if (re.test(lower)) return work;
  return 'tool';
}

/** At most this many kinds of work are named; a sentence listing six is the
 *  list of cards again. */
const NAMED = 3;

export interface Told {
  /** The sentence. */
  text: string;
  /** How many tool calls it stands for; thinking is not counted as one. */
  count: number;
  failed: number;
}

/** A run of steps as one sentence.
 *
 *  While it is going on (`live`) it says what is being done right now. Once
 *  it is over it says what kinds of work the run was: the ones done most,
 *  in the order they first happened.
 */
export function tell(steps: Step[], live: boolean, lang: Lang): Told {
  const tools = steps.filter((s) => s.kind === 'tool');
  const count = tools.length;
  const failed = tools.filter((s) => s.kind === 'tool' && s.isError).length;
  if (live) {
    const running = [...steps].reverse().find((s) => s.kind === 'tool' && s.running);
    const at = running ?? steps[steps.length - 1];
    return { text: `${say(workOf(at), lang)[0]}…`, count, failed };
  }
  const seen = new Map<Work, number>();
  for (const s of tools) seen.set(workOf(s), (seen.get(workOf(s)) ?? 0) + 1);
  if (!seen.size) return { text: cap(say('think', lang)[1], lang), count, failed };
  const most = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, NAMED).map(([w]) => w);
  const named = [...seen.keys()].filter((w) => most.includes(w)).map((w) => say(w, lang)[1]);
  return { text: cap(named.join(', '), lang), count, failed };
}

function cap(s: string, lang: Lang): string {
  // Turkish has its own capital for a dotted small i, so the locale decides.
  return s ? s[0].toLocaleUpperCase(lang === 'tr' ? 'tr' : 'en') + s.slice(1) : s;
}

/** "14 steps", in the conversation's language. */
export function counted(n: number, lang: Lang): string {
  const word = stepsPack(lang)?.steps;
  return word ? word.split('{n}').join(String(n)) : `${n} step${n === 1 ? '' : 's'}`;
}

/** The language the person in this conversation writes in. */
export function langOf(items: Item[], fallback: string = typeof navigator !== 'undefined' ? navigator.language : 'en'): Lang {
  // Turkish is told by its letters and commonest words, which the pack holds;
  // a browser without the pack has no Turkish words to show either.
  const detect = packRegex(stepsPack('tr')?.detect);
  if (!detect) return 'en';
  let said = false;
  for (const it of items) {
    if (it.kind !== 'user' || !it.text.trim()) continue;
    said = true;
    if (detect.test(it.text)) return 'tr';
  }
  if (said) return 'en';
  return fallback.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

/** What is being done this moment, for the strip above the box. */
export function doingNow(items: Item[], lang: Lang): string {
  const last = items[items.length - 1];
  if (last?.kind === 'tool' || last?.kind === 'thinking') return tell([last], true, lang).text;
  if (last?.kind === 'assistant' && !last.done) return stepsPack(lang)?.writing || 'Writing…';
  return `${say('think', lang)[0]}…`;
}
