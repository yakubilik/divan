/** The bell on the top line: what the queue sent, kept.
 *
 *  A count of what has come in since the list was last opened, and the list
 *  itself on a press — newest first, each one the ticket's title, what
 *  happened to it and the first lines of what was said, the new ones marked
 *  until the list is opened again. A press on one opens
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
  // What had been seen before this opening: the rows newer than it are the
  // ones marked, for as long as the list stays open. Opening marks them seen,
  // so the next opening shows them plain.
  const [was, setWas] = useState<Record<string, number>>(seen);
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
      setWas(seen);
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
          position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 40, width: 440,
          maxHeight: '70vh', overflowY: 'auto', borderRadius: 14, background: T.s1,
          boxShadow: SHADOW.drawer, padding: 6,
        }}>
          {!items.length && (
            <div style={{ padding: 16, fontSize: 13, color: T.ink3 }}>Nothing from the queue yet.</div>
          )}
          {items.map((n, i) => {
            const fresh = n.id > (was[n.host] ?? 0);
            const tone = KIND_TONE[n.kind] ?? T.ink2;
            // The queue's own sentence: what came of it. Shown under the title
            // rather than in its place, and not twice when there is no title.
            const said = n.title && n.headline && n.headline !== n.title ? n.headline : null;
            return (
              <button key={`${n.host}:${n.id}`} type="button" data-notice="" data-unread={fresh ? '' : undefined}
                onClick={() => { setOpen(false); onOpen(n); }}
                style={{
                  position: 'relative', display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: fresh ? T.amberBg : 'transparent', border: 'none', borderRadius: 0,
                  borderTop: i ? `1px solid ${T.line}` : '1px solid transparent',
                  padding: '12px 14px 12px 22px', color: T.ink, font: 'inherit',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = T.s2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = fresh ? T.amberBg : 'transparent'; }}
              >
                {fresh && (
                  <>
                    <i data-unread-dot="" aria-hidden="true" style={{
                      position: 'absolute', left: 8, top: 19, width: 7, height: 7,
                      borderRadius: '50%', background: T.amber,
                    }} />
                    <span className="dv-hidden">New: </span>
                  </>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span data-part="kind" style={{
                    fontSize: 11, fontWeight: 600, lineHeight: '16px', padding: '0 7px', borderRadius: 999,
                    color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)`, whiteSpace: 'nowrap',
                  }}>{n.ticket ? `#${n.ticket} · ` : ''}{KIND_WORD[n.kind] ?? n.kind}</span>
                  <span data-part="meta" style={{
                    ...mono, fontSize: 11, color: T.ink3, marginLeft: 'auto', whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {n.project ? `${n.project} · ` : ''}{uptime(Math.max(0, now - n.ts))} ago
                  </span>
                </div>
                <div data-part="title" style={{
                  fontSize: 15, fontWeight: 600, color: T.ink, marginTop: 6, lineHeight: 1.3,
                }}>
                  {n.title || n.headline}
                </div>
                {!!said && (
                  <div data-part="headline" style={{
                    fontSize: 13, fontWeight: 500, color: T.ink2, marginTop: 4, lineHeight: 1.4,
                  }}>{said}</div>
                )}
                {!!n.body && (
                  <div data-part="body" style={{
                    fontSize: 12.5, fontWeight: 400, color: T.ink3, marginTop: 4, lineHeight: 1.55,
                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>{n.body}</div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
