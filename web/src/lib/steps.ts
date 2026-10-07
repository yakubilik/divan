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
type Say = Record<Lang, [now: string, done: string]>;

const WORK = {
  think: { tr: ['Düşünüyorum', 'düşündüm'], en: ['Thinking', 'thought it through'] },
  read: { tr: ['Dosyaları okuyorum', 'dosyaları okudum'], en: ['Reading files', 'read files'] },
  search: { tr: ['Kodda arıyorum', 'kodda aradım'], en: ['Searching the code', 'searched the code'] },
  edit: { tr: ['Dosyaları düzenliyorum', 'dosyaları düzenledim'], en: ['Editing files', 'edited files'] },
  git: { tr: ['Değişikliklere bakıyorum', 'değişikliklere baktım'], en: ['Looking at the changes', 'looked at the changes'] },
  commit: { tr: ['Değişiklikleri kaydediyorum', 'değişiklikleri kaydettim'], en: ['Committing the changes', 'committed the changes'] },
  push: { tr: ['Değişiklikleri gönderiyorum', 'değişiklikleri gönderdim'], en: ['Pushing the changes', 'pushed the changes'] },
  github: { tr: ['GitHub’a bakıyorum', 'GitHub’a baktım'], en: ['Checking GitHub', 'checked GitHub'] },
  test: { tr: ['Testleri çalıştırıyorum', 'testleri çalıştırdım'], en: ['Running the tests', 'ran the tests'] },
  build: { tr: ['Projeyi derliyorum', 'projeyi derledim'], en: ['Building the project', 'built the project'] },
  install: { tr: ['Paketleri kuruyorum', 'paketleri kurdum'], en: ['Installing packages', 'installed packages'] },
  deploy: { tr: ['Yayına alıyorum', 'yayına aldım'], en: ['Deploying', 'deployed'] },
  cloud: { tr: ['Sunucu tarafına bakıyorum', 'sunucu tarafına baktım'], en: ['Checking the cloud side', 'checked the cloud side'] },
  data: { tr: ['Veritabanına bakıyorum', 'veritabanına baktım'], en: ['Looking in the database', 'looked in the database'] },
  request: { tr: ['Bir servise istek atıyorum', 'servise istek attım'], en: ['Calling a service', 'called a service'] },
  script: { tr: ['Bir script çalıştırıyorum', 'script çalıştırdım'], en: ['Running a script', 'ran a script'] },
  files: { tr: ['Dosyalara bakıyorum', 'dosyalara baktım'], en: ['Looking through files', 'looked through files'] },
  ticket: { tr: ['Ticket kuyruğuyla ilgileniyorum', 'ticket kuyruğuyla ilgilendim'], en: ['Working the ticket queue', 'worked the ticket queue'] },
  run: { tr: ['Terminalde komut çalıştırıyorum', 'terminalde komut çalıştırdım'], en: ['Running commands', 'ran commands'] },
  browser: { tr: ['Tarayıcıda sayfayı kontrol ediyorum', 'tarayıcıda sayfayı kontrol ettim'], en: ['Checking the page in the browser', 'checked the page in the browser'] },
  shot: { tr: ['Ekran görüntüsü alıyorum', 'ekran görüntüsü aldım'], en: ['Taking a screenshot', 'took screenshots'] },
  websearch: { tr: ['İnternette arıyorum', 'internette aradım'], en: ['Searching the web', 'searched the web'] },
  webread: { tr: ['Bir web sayfasını okuyorum', 'web sayfalarını okudum'], en: ['Reading a web page', 'read web pages'] },
  agent: { tr: ['Yardımcı ajana iş veriyorum', 'yardımcı ajan çalıştırdım'], en: ['Handing work to a helper agent', 'used a helper agent'] },
  wait: { tr: ['Arka plandaki işi bekliyorum', 'arka plandaki işi bekledim'], en: ['Waiting on background work', 'waited on background work'] },
  message: { tr: ['Başka bir chate mesaj bırakıyorum', 'başka bir chate mesaj bıraktım'], en: ['Messaging another chat', 'messaged another chat'] },
  skill: { tr: ['Nasıl yapılacağına bakıyorum', 'nasıl yapılacağına baktım'], en: ['Reading how to do it', 'read how to do it'] },
  plan: { tr: ['Planı güncelliyorum', 'planı güncelledim'], en: ['Updating the plan', 'updated the plan'] },
  memory: { tr: ['Not alıyorum', 'not aldım'], en: ['Taking a note', 'took a note'] },
  mail: { tr: ['Maillere bakıyorum', 'maillere baktım'], en: ['Going through mail', 'went through mail'] },
  calendar: { tr: ['Takvime bakıyorum', 'takvime baktım'], en: ['Checking the calendar', 'checked the calendar'] },
  docs: { tr: ['Dokümanla ilgileniyorum', 'dokümanla ilgilendim'], en: ['Working on a document', 'worked on a document'] },
  design: { tr: ['Tasarımla ilgileniyorum', 'tasarımla ilgilendim'], en: ['Working on the design', 'worked on the design'] },
  media: { tr: ['Görsel üretiyorum', 'görsel ürettim'], en: ['Generating media', 'generated media'] },
  tool: { tr: ['Bir araç kullanıyorum', 'araç kullandım'], en: ['Using a tool', 'used a tool'] },
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
    return { text: `${WORK[workOf(at)][lang][0]}…`, count, failed };
  }
  const seen = new Map<Work, number>();
  for (const s of tools) seen.set(workOf(s), (seen.get(workOf(s)) ?? 0) + 1);
  if (!seen.size) return { text: cap(WORK.think[lang][1], lang), count, failed };
  const most = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, NAMED).map(([w]) => w);
  const named = [...seen.keys()].filter((w) => most.includes(w)).map((w) => WORK[w][lang][1]);
  return { text: cap(named.join(', '), lang), count, failed };
}

function cap(s: string, lang: Lang): string {
  // Turkish has its own capital for `i` ("internette aradım").
  return s ? s[0].toLocaleUpperCase(lang === 'tr' ? 'tr' : 'en') + s.slice(1) : s;
}

/** "14 adım" / "14 steps". */
export function counted(n: number, lang: Lang): string {
  return lang === 'tr' ? `${n} adım` : `${n} step${n === 1 ? '' : 's'}`;
}

const TURKISH = /[çğıöşüÇĞİÖŞÜ]|\b(bir|ve|bunu|yok|tamam|evet|merhaba|selam|naber|kanka)\b/i;

/** The language the person in this conversation writes in. */
export function langOf(items: Item[], fallback: string = typeof navigator !== 'undefined' ? navigator.language : 'en'): Lang {
  let said = false;
  for (const it of items) {
    if (it.kind !== 'user' || !it.text.trim()) continue;
    said = true;
    if (TURKISH.test(it.text)) return 'tr';
  }
  if (said) return 'en';
  return fallback.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

/** What is being done this moment, for the strip above the box. */
export function doingNow(items: Item[], lang: Lang): string {
  const last = items[items.length - 1];
  if (last?.kind === 'tool' || last?.kind === 'thinking') return tell([last], true, lang).text;
  if (last?.kind === 'assistant' && !last.done) return lang === 'tr' ? 'Yazıyorum…' : 'Writing…';
  return `${WORK.think[lang][0]}…`;
}
