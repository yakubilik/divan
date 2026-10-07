/** The bell on the top line: what the queue sent, kept.
 *
 *  A count of what has come in since the list was last opened, and the list
 *  itself on a press — newest first, each one the ticket's title, what
 *  happened to it and the first lines of what was said. A press on one opens
 *  the ticket. Opening the list is also where the browser is asked whether
 *  the panel may raise notifications of its own: a permission asked for on
 *  page load is a permission refused. */
import { useEffect, useRef, useState } from 'react';
import { KIND_WORD, unread, useInbox, type Notice } from '../lib/inbox';
import { T, SHADOW } from '../lib/theme';
import { P, mono } from '../ui/kit';
import { uptime } from '../lib/format';

const KIND_TONE: Record<string, string> = { done: T.run, blocked: T.amber, failed: T.red };

export function InboxBell({ onOpen }: { onOpen: (n: Notice) => void }) {
  const items = useInbox((s) => s.items);
  const seen = useInbox((s) => s.seen);
  const markSeen = useInbox((s) => s.markSeen);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const count = unread(items, seen);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      markSeen();
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    }
  };
  const now = Date.now() / 1000;

  return (
    <div ref={box} style={{ position: 'relative', flex: 'none' }}>
      {/* Drawn like the line's place buttons: an icon, the word (folded away
          on a narrow window), and the count with an amber dot when it has one. */}
      <button type="button" className="dv-btn dv-btn--ghost dv-hit" data-inbox=""
        aria-expanded={open} aria-label={count ? `Inbox, ${count} new` : 'Inbox'}
        title={count ? `${count} new from the queue` : 'What the queue sent'}
        onClick={toggle}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={P.bell} /></svg>
        <span className="sys-word">Inbox</span>
        {!!count && <><b>{count}</b><i className="dv-dot dv-dot--ask" aria-hidden="true" /></>}
      </button>
      {open && (
        <div role="dialog" aria-label="Inbox" style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 40, width: 420,
          maxHeight: '70vh', overflowY: 'auto', borderRadius: 14, background: T.s1,
          boxShadow: SHADOW.drawer, padding: 6,
        }}>
          {!items.length && (
            <div style={{ padding: 16, fontSize: 13, color: T.ink3 }}>Nothing from the queue yet.</div>
          )}
          {items.map((n) => (
            <button key={`${n.host}:${n.id}`} type="button"
              onClick={() => { setOpen(false); onOpen(n); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                background: 'transparent', border: 'none', borderRadius: 10, padding: '10px 12px',
                color: T.ink, font: 'inherit',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = T.s2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: KIND_TONE[n.kind] ?? T.ink2 }}>
                  {n.ticket ? `#${n.ticket} · ` : ''}{KIND_WORD[n.kind] ?? n.kind}
                </span>
                {!!n.project && <span style={{ ...mono, fontSize: 11, color: T.ink3 }}>{n.project}</span>}
                <span style={{ ...mono, fontSize: 11, color: T.ink3, marginLeft: 'auto' }}>
                  {uptime(Math.max(0, now - n.ts))} ago
                </span>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 500, marginTop: 3, lineHeight: 1.35 }}>
                {n.title || n.headline}
              </div>
              {!!n.body && (
                <div style={{
                  fontSize: 12.5, color: T.ink2, marginTop: 3, lineHeight: 1.4,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>{n.body}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
