/** A conversation whose agent filed #177, with nothing behind it.
 *
 *  Built and driven by `scripts/test-filed-ui.mjs`: a real browser, so the
 *  keyboard reaches the entry and its Go details the way it does for a person.
 *  Go details records the ticket it was pressed for in `window.opened`. */
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { Timeline } from '../src/components/Timeline';
import { apply, type Item } from '../src/lib/timeline';
import { themeCss } from '../src/lib/theme';

const QUEUED_177 = '#177 queued: Show pending agent questions as a floating chat on the dashboard  (worker opus, verifier opus)';
const now = Date.now() / 1000;
const events = [
  { event: 'message.user', data: { text: 'Can you file the floating questions idea?', attachments: [] } },
  { event: 'tool.use', data: { id: 'u1', tool: 'Bash', input: { command: 'ustabasi add questions.json' } } },
  { event: 'tool.result', data: { id: 'u1', output: QUEUED_177 } },
  { event: 'message.assistant', data: { segment: 1, text: 'Filed it. The design notes are [here](https://example.com/notes).' } },
];
const items = events.reduce<Item[]>((acc, e, i) => apply(acc, { ...e, seq: i + 1, ts: now + i } as any), []);

declare global { interface Window { opened: number[] } }
window.opened = [];

const scheme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = scheme;
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = scheme;
const sheet = document.createElement('style');
sheet.textContent = themeCss();
document.head.appendChild(sheet);

createRoot(root).render(
  <div data-chat style={{ maxWidth: 760, margin: '0 auto', padding: 16, minHeight: '100%', boxSizing: 'border-box' }}>
    <Timeline items={items} hostKey="test" onRespond={() => {}}
      tickets={{ open: (id) => { window.opened.push(id); }, describe: () => null }} />
  </div>,
);
