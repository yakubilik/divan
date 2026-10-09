/** A conversation with ticket notices in it and nothing behind it.
 *
 *  Built and driven by `scripts/test-notice-ui.mjs`: a real browser, so the
 *  keyboard reaches the row the way it does for a person. */
import { createRoot } from 'react-dom/client';
import { Timeline } from '../src/components/Timeline';
import { apply, type Item } from '../src/lib/timeline';
import { themeCss } from '../src/lib/theme';
import { BLOCKED_139, CONTROL, DONE_157, FAILED } from './notice-fixture.js';

const now = Date.now() / 1000;
const items = [CONTROL, DONE_157, BLOCKED_139, FAILED].reduce<Item[]>(
  (acc, text, i) => apply(acc, { event: 'message.user', seq: i + 1, ts: now + i, data: { text, attachments: [] } } as any), []);

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'dark';
const sheet = document.createElement('style');
sheet.textContent = themeCss();
document.head.appendChild(sheet);

createRoot(document.getElementById('root')!).render(
  <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, minHeight: '100%', boxSizing: 'border-box' }}>
    <Timeline items={items} hostKey="test" onRespond={() => {}} />
  </div>,
);
