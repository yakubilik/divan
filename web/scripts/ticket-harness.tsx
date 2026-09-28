/** The opened ticket, on its own, with nothing behind it.
 *
 *  Built and driven by `scripts/test-ticket-ui.mjs`: what that check is about
 *  is what happens when somebody types in the box, and that is the one thing a
 *  static render cannot show.
 *
 *  `onNote` stands in for the daemon and for the wall behind it. It writes
 *  down what it was asked, answers the way the queue does, and then — a beat
 *  later, the way the eight-second poll does — hands the note back as part of
 *  the ticket. That beat is the whole point: it is where a message shown
 *  before the queue confirmed it could turn into two.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TicketChat } from '../src/components/TicketChat';
import { ticket } from './ticket-fixture.js';

declare global {
  interface Window {
    sent: string[];
    refuse: boolean;
    /** a note arriving from somewhere else, while this one is being read */
    arrive: (text: string) => void;
  }
}

window.sent = [];
window.refuse = false;

const status = new URLSearchParams(location.search).get('status') || 'blocked';

/** How long the queue takes to say the note is on the ticket. Longer than the
 *  real poll on purpose: the check has to be able to look at the conversation
 *  in between, and a round trip to a browser is not instant. */
const POLL = 1500;

function Harness() {
  const [t, setT] = useState(() => ticket({ status }) as any);
  const arrive = (text: string, from = 'user') => setT((prev: any) => ({
    ...prev,
    notes: [...prev.notes, { ts: Date.now() / 1000, from, text }],
    note_count: prev.note_count + 1,
  }));
  window.arrive = (text: string) => arrive(text, 'supervisor');

  return (
    <TicketChat
      t={t}
      tone={{ label: 'needs an answer', color: '#D8A657', rgb: '216,166,87' }}
      onClose={() => {}}
      onNote={async (text: string) => {
        window.sent.push(text);
        if (window.refuse) throw new Error('the queue refused that note');
        setTimeout(() => arrive(text), POLL);
        return 'note added; ticket re-queued for the worker';
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
