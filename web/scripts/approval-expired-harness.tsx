/** Three approvals as the chat shows them: one that timed out, one a daemon
 *  restart dropped, and one whose Allow arrived after it had expired. Built and
 *  photographed by `scripts/shot-approval-expired.mjs`. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { Timeline } from '../src/components/Timeline';
import { setThemeChoice } from '../src/lib/theme';

const q = new URLSearchParams(location.search);
const scheme = q.get('theme') === 'light' ? 'light' : 'dark';
setThemeChoice(scheme);
document.documentElement.dataset.theme = scheme;
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = scheme;
root.style.padding = '24px';
root.style.maxWidth = '760px';

const card = (id: string, command: string, reason: string, decision: any, why: string | null) => ({
  kind: 'approval' as const, id, ts: Date.now() / 1000 - 300, requestId: id, tool: 'Bash',
  input: { command }, preview: command, danger: true, reason, decision, why,
});
const outside = 'can destroy the machine or your data: rm -r outside the chat\'s folder: /Users/x/projects/';
const items = [
  card('a', 'rm -rf ~/projects/old', outside + 'old', 'expired', 'timeout'),
  card('b', 'git push --force origin main', 'can destroy the machine or your data: git push --force', 'expired', 'restart'),
  card('c', 'rm -rf ~/projects/old-2', outside + 'old-2', null, null),
];
const gone = Object.assign(new Error('gone'), { code: 'approval_expired' });
createRoot(root).render(createElement(Timeline, {
  hostKey: 'shot', items, onRespond: async () => { throw gone; },
} as any));
