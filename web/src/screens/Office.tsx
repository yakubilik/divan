import { useEffect } from 'react';
import { officeUrl } from '../lib/actions';
import { directoryKey, useFleet } from '../lib/fleet';
import { EmptyState } from '../ui/divan';

/** The office: every chat on the home computer as a pixel character at a
 *  desk, a room for each product. The page is the daemon's own
 *  (daemon/divan/office_page: pixtuoid's web build fed what office.py makes
 *  of the chats), so this is only a frame over it, on the computer that
 *  served the panel. A click on a character comes back as a message naming its chat,
 *  which `onOpen` opens. */
export function OfficeFrame({ onOpen }: { onOpen: (hostKey: string, chatId: string) => void }) {
  // The computer that served this page, which is the one whose chats these are;
  // a peer's office would be another computer's.
  const key = useFleet((s) => directoryKey(s));
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
      <iframe title="Office" src={src} style={{ flex: 1, border: 0, display: 'block' }} />
    </div>
  );
}
