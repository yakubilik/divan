/** The opened ticket, on its own, with nothing behind it.
 *
 *  Built and driven by `scripts/test-ticket-ui.mjs`: what that check is about
 *  is what happens when somebody types in the box, and that is the one thing
 *  a static render cannot show. `onNote` answers the way the daemon does and
 *  writes down what it was asked, so the check can see both halves — the call
 *  that went out, and the message that landed.
 */
import { createRoot } from 'react-dom/client';
import { TicketChat } from '../src/components/TicketChat';
import { ticket } from './ticket-fixture.js';

declare global {
  interface Window { sent: string[]; refuse: boolean }
}

window.sent = [];
window.refuse = false;

const status = new URLSearchParams(location.search).get('status') || 'blocked';

createRoot(document.getElementById('root')!).render(
  <TicketChat
    t={ticket({ status }) as any}
    tone={{ label: 'needs an answer', color: '#D8A657', rgb: '216,166,87' }}
    onClose={() => {}}
    onNote={async (text: string) => {
      window.sent.push(text);
      if (window.refuse) throw new Error('the queue refused that note');
      return 'note added; ticket re-queued for the worker';
    }}
  />,
);
