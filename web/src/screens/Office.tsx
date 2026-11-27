import { useEffect } from 'react';
import { officeUrl } from '../lib/actions';
import { pickedKey, useFleet } from '../lib/fleet';
import { EmptyState } from '../ui/divan';

/** The office: every chat on one computer as a pixel character at a desk, a
 *  room for each product. The page is that computer's own
 *  (daemon/divan/office_page: pixtuoid's web build fed what office.py makes
 *  of the chats), so this is only a frame over it, and the computer is the one
 *  picked in the panel. A click on a character comes back as a message naming
 *  its chat, which `onOpen` opens. */
export function OfficeFrame({ onOpen }: { onOpen: (hostKey: string, chatId: string) => void }) {
  // The computer picked in the panel: its page, its chats. Another one picked
  // is another office, never the serving computer's shown under its name.
  const key = useFleet((s) => pickedKey(s));
  const src = key ? officeUrl(key) : '';
  useEffect(() => {
    if (!key || !src) return;
    const origin = new URL(src, location.href).origin;
    const heard = (e: MessageEvent) => {
      if (e.origin !== origin) return;
      const d = e.data;
      if (d && d.type === 'office-open' && typeof d.chat === 'string') onOpen(key, d.chat);
    };
    window.addEventListener('message', heard);
    return () => window.removeEventListener('message', heard);
  }, [key, src, onOpen]);
  if (!src) {
    return <EmptyState title="No office here" body="This panel is not connected to a computer yet." />;
  }
  return (
    <div data-office-screen="" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
      <iframe key={key} title="Office" src={src} style={{ flex: 1, border: 0, display: 'block' }} />
    </div>
  );
}
