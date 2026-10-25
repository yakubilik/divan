/** Panes: several chats open at once, side by side, tiled like a terminal's
 *  split panes.
 *
 *  Each pane is the floating chat window the Dashboard opens (`ChatPanel`) —
 *  the same head, the same live timeline, the same composer — drawn as big as
 *  its tile. A chat comes in by being dragged off the chat list on the left
 *  (or pressed there); where it is let go says where it goes: on a pane's
 *  edge it splits that pane, on the screen's own edge it takes a strip of the
 *  whole screen, on an empty screen it is the screen. A pane is picked up by
 *  its head and put down the same way, and the others close up behind it.
 *
 *  What the layout *is* lives in `lib/panes.ts`. What is here is the drawing
 *  and the pointer, and one rule that the smoothness depends on: a divider
 *  being dragged never re-renders React. The tiles are positioned in
 *  percentages, flat and keyed by pane, and while a divider moves the new
 *  percentages are written straight onto those tiles' styles; the store hears
 *  about it once, when the mouse comes up. The chats inside the tiles are
 *  memoised on which chat they are, so even that one render leaves them be —
 *  and a pane that moves across the tree is the same element, never a remount.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChatPanel } from '../components/ChatPanel';
import { hasChatDrag, readChatDrag } from '../lib/dnd';
import { useFleet } from '../lib/fleet';
import {
  boxes, drag, dropAt, leaves, usePanes, type Box, type Divider, type Drop, type PaneNode, type Size,
} from '../lib/panes';
import type { Place, Told } from '../lib/tell';
import { RADIUS, SIZE, T } from '../lib/theme';
import { mono } from '../ui/kit';

/** The gap between two panes, which is also where the divider is grabbed. */
const GAP = 8;
/** How long the panes take to make room for one another. */
const EASE = '180ms cubic-bezier(.2,.7,.3,1)';

/** How many times each pane's chat has been drawn — read by the checks, which
 *  hold a divider drag to drawing none. */
export const paneRenders = new Map<string, number>();

const pct = (v: number) => `${(v * 100).toFixed(4)}%`;

function place(el: HTMLElement, b: Box) {
  el.style.left = pct(b.x);
  el.style.top = pct(b.y);
  el.style.width = pct(b.w);
  el.style.height = pct(b.h);
}

const lineBox = (d: Divider): React.CSSProperties => (d.dir === 'row'
  ? { left: `calc(${pct(d.at.x)} - ${GAP / 2 + 2}px)`, top: pct(d.at.y), width: GAP + 4, height: pct(d.at.h), cursor: 'col-resize' }
  : { left: pct(d.at.x), top: `calc(${pct(d.at.y)} - ${GAP / 2 + 2}px)`, width: pct(d.at.w), height: GAP + 4, cursor: 'row-resize' });

const CSS = `
.dv-panes .dv-pane { transition: left ${EASE}, top ${EASE}, width ${EASE}, height ${EASE}, opacity ${EASE};
  animation: dv-pane-in ${EASE}; }
.dv-panes[data-resizing] .dv-pane { transition: none; }
.dv-panes .dv-pane-line::after { content: ''; position: absolute; inset: 0; margin: auto; border-radius: 2px;
  background: transparent; transition: background 120ms; }
.dv-panes .dv-pane-line[data-dir="row"]::after { width: 2px; }
.dv-panes .dv-pane-line[data-dir="col"]::after { height: 2px; }
.dv-panes .dv-pane-line:hover::after, .dv-panes[data-resizing] .dv-pane-line[data-active]::after { background: ${T.ink3}; }
@keyframes dv-pane-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
`;

/** Nobody drags the pane's window by its own corner here; the place it is
 *  handed is only there because the window needs one. */
const NOWHERE: Place = { right: 0, bottom: 0, width: SIZE.panel, height: SIZE.panelTall };
const stay = () => {};

/** One pane's chat. Memoised on which chat it is and whether it fills the
 *  screen: a divider dragged, a pane added beside it, the layout saved — none
 *  of those is anything this has to draw again. */
const PaneChat = memo(function PaneChat({ id, host, chat, maxed, grab }: {
  id: string; host: string; chat: string; maxed: boolean;
  grab: (id: string, e: React.MouseEvent) => void;
}) {
  paneRenders.set(id, (paneRenders.get(id) ?? 0) + 1);
  const title = useFleet((s) => s.hosts[host]?.chats.find((c) => c.id === chat)?.title ?? '');
  const told: Told = useMemo(() => ({ host, chatId: chat, title: title || 'Chat', at: 0 }), [host, chat, title]);
  return (
    <ChatPanel
      told={told} place={NOWHERE} onPlace={stay} fill
      big={maxed} onBig={(on) => usePanes.getState().maximise(on ? id : null)}
      onGrab={(e) => grab(id, e)}
      onClose={() => usePanes.getState().close(id)}
    />
  );
});

export function Panes() {
  const root = usePanes((s) => s.root);
  const max = usePanes((s) => s.max);
  const area = useRef<HTMLDivElement | null>(null);
  const tiles = useRef(new Map<string, HTMLDivElement>());
  const lines = useRef(new Map<string, HTMLDivElement>());
  /** What a drop here would do, lit up while something is held over it. */
  const [hint, setHint] = useState<Box | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  const list = leaves(root);
  const b = useMemo(() => boxes(root), [root]);

  /** The area in pixels, as it is drawn now. */
  const size = (): Size => {
    const r = area.current?.getBoundingClientRect();
    const was = usePanes.getState().area;
    return { w: r?.width || was.w, h: r?.height || was.h };
  };

  // The area's size is kept on the store, for the choices made from outside
  // the screen (a chat pressed in the list goes beside the biggest pane).
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => { const r = el.getBoundingClientRect(); if (r.width && r.height) usePanes.getState().setArea({ w: r.width, h: r.height }); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Esc puts a pane that fills the screen back where it was.
  useEffect(() => {
    if (!max) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') usePanes.getState().maximise(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [max]);

  const lit = (next: Box | null) => setHint((was) => (
    was && next && was.x === next.x && was.y === next.y && was.w === next.w && was.h === next.h ? was : next));

  /** A divider held: the two sides follow the pointer, written straight onto
   *  the tiles, and the layout is committed when it is let go. */
  const holdLine = (d: Divider, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = usePanes.getState().root;
    if (!start) return;
    const px = size();
    const from = d.dir === 'row' ? e.clientX : e.clientY;
    const el = area.current;
    let next: PaneNode = start;
    el?.setAttribute('data-resizing', '');
    lines.current.get(d.key)?.setAttribute('data-active', '');
    const body = document.body;
    const was = { select: body.style.userSelect, cursor: body.style.cursor };
    body.style.userSelect = 'none';
    body.style.cursor = d.dir === 'row' ? 'col-resize' : 'row-resize';
    const follow = (ev: MouseEvent) => {
      next = drag(start, d, (d.dir === 'row' ? ev.clientX : ev.clientY) - from, px);
      const nb = boxes(next);
      for (const [id, tile] of tiles.current) { const r = nb.panes[id]; if (r) place(tile, r); }
      for (const nd of nb.dividers) {
        const line = lines.current.get(nd.key);
        if (line) Object.assign(line.style, lineBox(nd));
      }
    };
    const drop = () => {
      window.removeEventListener('mousemove', follow);
      window.removeEventListener('mouseup', drop);
      body.style.userSelect = was.select;
      body.style.cursor = was.cursor;
      lines.current.get(d.key)?.removeAttribute('data-active');
      if (next !== start) usePanes.getState().resize(next);
      el?.removeAttribute('data-resizing');
    };
    window.addEventListener('mousemove', follow);
    window.addEventListener('mouseup', drop);
  };

  /** A pane picked up by its head: where it would go is lit up as it is
   *  carried, and the layout moves when it is put down. */
  const grabRef = useRef<(id: string, e: React.MouseEvent) => void>(() => {});
  grabRef.current = (id, e) => {
    if (e.button !== 0 || usePanes.getState().max) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    let carried = false;
    let target: Drop | null = null;
    const body = document.body;
    const was = body.style.userSelect;
    body.style.userSelect = 'none';
    const follow = (ev: MouseEvent) => {
      if (!carried && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      if (!carried) { carried = true; setMoving(id); }
      const r = area.current?.getBoundingClientRect();
      const hit = dropAt(usePanes.getState().root, { x: ev.clientX - (r?.left ?? 0), y: ev.clientY - (r?.top ?? 0) }, size(), id);
      target = hit?.drop ?? null;
      lit(hit?.hint ?? null);
    };
    const drop = () => {
      window.removeEventListener('mousemove', follow);
      window.removeEventListener('mouseup', drop);
      body.style.userSelect = was;
      setMoving(null);
      setHint(null);
      if (carried && target) usePanes.getState().move(id, target);
    };
    window.addEventListener('mousemove', follow);
    window.addEventListener('mouseup', drop);
  };
  // One function for the life of the screen, so the memoised chats keep it.
  const grab = useMemo(() => (id: string, e: React.MouseEvent) => grabRef.current(id, e), []);

  /** A chat from the list, held over the screen. */
  const over = (e: React.DragEvent) => {
    if (!hasChatDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = area.current?.getBoundingClientRect();
    lit(dropAt(usePanes.getState().root, { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }, size())?.hint ?? null);
  };
  const land = (e: React.DragEvent) => {
    const chat = readChatDrag(e.dataTransfer);
    setHint(null);
    if (!chat) return;
    e.preventDefault();
    const r = area.current?.getBoundingClientRect();
    const hit = dropAt(usePanes.getState().root, { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }, size());
    usePanes.getState().open(chat.hostKey, chat.chatId, hit?.drop ?? null);
  };

  return (
    <div
      ref={area} className="dv-panes" data-panes=""
      onDragOver={over} onDrop={land}
      onDragLeave={(e) => {
        const to = e.relatedTarget as Node | null;
        if (!to || !e.currentTarget.contains(to)) setHint(null);
      }}
      style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, margin: `0 ${GAP}px ${GAP}px 0`, overflow: 'hidden' }}
    >
      <style>{CSS}</style>
      {list.map((l) => {
        const maxed = max === l.id;
        const hidden = !!max && !maxed;
        const r = maxed ? { x: 0, y: 0, w: 1, h: 1 } : b.panes[l.id];
        return (
          <div
            key={l.id} className="dv-pane" data-pane={l.id} data-pane-chat={l.chat}
            data-pane-max={maxed ? '' : undefined}
            ref={(el) => { if (el) tiles.current.set(l.id, el); else tiles.current.delete(l.id); }}
            aria-hidden={hidden || undefined}
            style={{
              position: 'absolute', left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h),
              padding: GAP / 2, boxSizing: 'border-box', zIndex: maxed ? 2 : 1,
              visibility: hidden ? 'hidden' : undefined,
              opacity: moving === l.id ? 0.45 : 1,
            }}
          >
            <PaneChat id={l.id} host={l.host} chat={l.chat} maxed={maxed} grab={grab} />
          </div>
        );
      })}
      {!max && b.dividers.map((d) => (
        <div
          key={d.key} className="dv-pane-line" data-pane-divider={d.key} data-dir={d.dir}
          role="separator" aria-orientation={d.dir === 'row' ? 'vertical' : 'horizontal'}
          aria-label="Drag to resize the panes on either side"
          ref={(el) => { if (el) lines.current.set(d.key, el); else lines.current.delete(d.key); }}
          onMouseDown={(e) => holdLine(d, e)}
          style={{ position: 'absolute', zIndex: 3, ...lineBox(d) }}
        />
      ))}
      {!!hint && (
        <div data-pane-hint="" style={{
          position: 'absolute', zIndex: 4, pointerEvents: 'none',
          left: pct(hint.x), top: pct(hint.y), width: pct(hint.w), height: pct(hint.h),
          padding: GAP / 2, boxSizing: 'border-box', transition: `all ${EASE}`,
        }}>
          <div style={{
            width: '100%', height: '100%', borderRadius: RADIUS.card, boxSizing: 'border-box',
            background: `color-mix(in srgb, ${T.ink} 9%, transparent)`,
            border: `2px dashed ${T.ink3}`,
          }} />
        </div>
      )}
      {!list.length && (
        <div data-panes-empty="" style={{
          position: 'absolute', inset: GAP / 2, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center',
          borderRadius: RADIUS.card, border: `1px dashed ${T.line2}`, color: T.ink3, pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.ink2 }}>No panes open</div>
          <div style={{ ...mono, fontSize: 11.5, maxWidth: 380, lineHeight: 1.6 }}>
            drag a chat here from the list — or press one — to open it as a pane. drop it on a
            pane’s edge to split that pane; drag a pane by its head to move it.
          </div>
        </div>
      )}
    </div>
  );
}
