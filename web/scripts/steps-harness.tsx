/** A turn's work as the chat shows it: a finished run of steps (thinking, a
 *  read, commands, edits, one that failed), the answer, and a run still going.
 *  `?open=1` presses every run open. Built and photographed by
 *  `scripts/shot-steps.mjs`. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { Timeline } from '../src/components/Timeline';
import { apply, type Item } from '../src/lib/timeline';
import { setThemeChoice, themeCss } from '../src/lib/theme';
import { KEYFRAMES } from '../src/ui/kit';

const q = new URLSearchParams(location.search);
const scheme = q.get('theme') === 'light' ? 'light' : 'dark';
setThemeChoice(scheme);
document.documentElement.dataset.theme = scheme;
const sheet = document.createElement('style');
sheet.textContent = themeCss() + KEYFRAMES;
document.head.appendChild(sheet);
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = scheme;
root.style.padding = '24px';
root.style.maxWidth = '760px';

const t0 = Date.now() / 1000 - 95;
let seq = 0;
const ev = (event: string, data: any, dt: number) => ({ event, seq: ++seq, ts: t0 + dt, data });
const tool = (id: string, name: string, input: any, output: string, dt: number, bad = false) => [
  ev('tool.use', { id, tool: name, input }, dt),
  ev('tool.result', { id, output, is_error: bad }, dt + 1),
];
const events = [
  ev('message.user', { text: 'Loader neden dönmüyor, bir bak', attachments: [] }, 0),
  ev('thinking.delta', { text: 'The spinner is drawn by kit.tsx; the keyframes may be missing from the harness sheet.' }, 2),
  ...tool('1', 'Read', { file_path: '/Users/x/projects/divan/web/src/ui/kit.tsx' }, 'export function Spinner…', 4),
  ...tool('2', 'Grep', { pattern: 'rac-spin', path: 'web/src' }, 'src/ui/kit.tsx:191\nsrc/ui/kit.tsx:213', 7),
  ...tool('3', 'Bash', { command: 'npm run typecheck', description: 'Type-check the panel' }, 'tsc --noEmit\nerror TS2304: Cannot find name "Loader".', 10, true),
  ...tool('4', 'Edit', { file_path: '/Users/x/projects/divan/web/src/ui/kit.tsx', old_string: 'const a = 1;\nconst b = 2;', new_string: 'const a = 1;\nconst b = 3;\nconst c = 4;' }, 'ok', 14),
  ...tool('5', 'Write', { file_path: '/Users/x/projects/divan/web/src/ui/loader.tsx', content: 'export const x = 1;\n' }, 'ok', 18),
  ...tool('6', 'Bash', { command: 'npm test -- steps', description: 'Run the steps tests' }, '12 passed', 22),
  ev('message.assistant', { text: 'Keyframe dosyaya hiç eklenmemiş; ekledim, loader dönüyor.', segment: 0, attachments: [] }, 26),
  ev('turn.done', { cost_usd: 0.04, duration_ms: 26000, num_turns: 7, usage: null, stop_reason: 'end_turn' }, 27),
  ev('message.user', { text: 'Tamam, şimdi build al', attachments: [] }, 40),
  ev('thinking.delta', { text: 'Build writes into daemon/divan/webui.' }, 41),
  ev('tool.use', { id: '7', tool: 'Bash', input: { command: 'npm run build', description: 'Build the panel' } }, 43),
];
const upTo = q.get('upto') ? Number(q.get('upto')) : events.length;
const items = events.slice(0, upTo).reduce<Item[]>((acc, e) => apply(acc, e as any), []);

createRoot(root).render(createElement(Timeline, {
  hostKey: 'shot', items, busy: true, onRespond: () => {},
} as any));
if (q.get('open')) {
  setTimeout(() => document.querySelectorAll<HTMLElement>('[data-steps] > button[aria-expanded="false"]').forEach((b) => b.click()), 200);
}
