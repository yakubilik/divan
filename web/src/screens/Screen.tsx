import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C, R } from '../lib/theme';
import { Btn, Chip, Empty, Icon, P, Spinner } from '../ui/kit';
import { useFleet } from '../lib/fleet';

/* The computer's own screen, in the panel.
 *
 * The same two daemon calls the phone makes — a JPEG over HTTP and
 * `screen.input` with coordinates between 0 and 1 — and the browser turns out
 * to be the easier client of the two. There are real mouse and keyboard events
 * here, so nothing has to be guessed from a finger, and `getBoundingClientRect`
 * already accounts for the zoom transform: a click is where the browser says it
 * is, whatever CSS did to the picture on the way. */

interface Caps { view: boolean; control: boolean; enabled: boolean; os?: string; reason?: string | null }

/** The keys worth naming, in the daemon's own vocabulary. Anything else
 *  printable is sent as text, which is what a keyboard produces anyway. */
const KEYS: Record<string, string> = {
  Enter: 'enter', Tab: 'tab', Escape: 'escape', Backspace: 'backspace', Delete: 'delete',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
  F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6',
  F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11', F12: 'f12',
};

const MAX_ZOOM = 5;
/** A pointer that reported every pixel would send a hundred messages a second
 *  to move an arrow the computer redraws seven times a second. */
const MOVE_MS = 45;

export function Screen() {
  const { hosts, order, focus, setFocus, call } = useFleet();
  const key = focus && hosts[focus] ? focus : order[0] ?? null;
  const slot = key ? hosts[key] : undefined;

  const [caps, setCaps] = useState<Caps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState<[string | null, string | null]>([null, null]);
  const [front, setFront] = useState(0);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const picRef = useRef<HTMLDivElement | null>(null);
  const frontRef = useRef(0);
  const tick = useRef(0);
  const alive = useRef(true);
  const lastAt = useRef(0);
  const lastMove = useRef(0);
  const held = useRef<string | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const base = slot ? `http://${slot.cfg.host}:${slot.cfg.port}` : null;
  const controllable = !!caps?.control && !!caps?.enabled;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // ── frames ────────────────────────────────────────────────────────────
  const nextFrame = useCallback(() => {
    if (!alive.current || !base || !slot) return;
    tick.current += 1;
    // What the element is actually drawn at, in device pixels, and more again
    // when zoomed in. Anything less and a 3440-wide desktop arrives as mush.
    const wide = Math.round((box.w || 1280) * (window.devicePixelRatio || 1) * Math.min(zoom, 2));
    const w = Math.max(640, Math.min(3840, wide));
    const uri = `${base}/screen.jpg?token=${encodeURIComponent(slot.cfg.token)}&w=${w}&q=72&t=${tick.current}`;
    const backSlot = frontRef.current === 0 ? 1 : 0;
    setSlots((s) => (backSlot === 1 ? [s[0], uri] : [uri, s[1]]));
  }, [base, slot, box.w, zoom]);

  // Each frame asks for the next once it has arrived, so a slow link runs at
  // fewer frames a second rather than falling further behind with every one.
  const onFrame = useCallback(() => {
    if (!alive.current) return;
    frontRef.current = frontRef.current === 0 ? 1 : 0;
    setFront(frontRef.current);
    setError(null);
    lastAt.current = Date.now();
    window.setTimeout(() => nextFrame(), 60);
  }, [nextFrame]);

  useEffect(() => {
    if (!key) return;
    let gone = false;
    setCaps(null); setSlots([null, null]); setError(null);
    call<Caps>(key, 'screen.info', {})
      .then((r) => { if (!gone) { setCaps(r); if (r.view) { lastAt.current = Date.now(); nextFrame(); } } })
      .catch((e: any) => !gone && setError(e?.message ?? 'This computer did not answer about its screen'));
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A request that neither arrives nor errors ends the stream in silence.
  useEffect(() => {
    if (!caps?.view) return;
    const t = window.setInterval(() => {
      if (lastAt.current && Date.now() - lastAt.current > 4000) { lastAt.current = Date.now(); nextFrame(); }
    }, 2000);
    return () => window.clearInterval(t);
  }, [caps?.view, nextFrame]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ── input ─────────────────────────────────────────────────────────────
  const send = useCallback((...actions: any[]) => {
    if (!key) return;
    call(key, 'screen.input', { actions }).catch((e: any) => setError(e?.message ?? 'That did not go through'));
  }, [key, call]);

  /** Where a browser event landed on the picture, 0..1. The rect already has
   *  the zoom transform in it, so nothing has to be undone by hand. */
  const norm = useCallback((e: { clientX: number; clientY: number }) => {
    const r = picRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }, []);

  const mods = (e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) => {
    const m: string[] = [];
    if (e.ctrlKey) m.push('ctrl');
    if (e.altKey) m.push('alt');
    if (e.shiftKey) m.push('shift');
    if (e.metaKey) m.push('cmd');
    return m;
  };

  const enable = async () => {
    if (!key) return;
    setBusy(true);
    try {
      const r = await call<{ enabled: boolean }>(key, 'screen.enable', { enabled: !caps?.enabled });
      setCaps((c) => (c ? { ...c, enabled: r.enabled } : c));
    } catch (e: any) {
      setError(e?.message ?? 'Could not change that');
    } finally { setBusy(false); }
  };

  // The keyboard is listened for on the window rather than the element, because
  // the keys worth sending — tab, escape, the arrows — are exactly the ones a
  // focused element never sees.
  useEffect(() => {
    if (!controllable) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const named = KEYS[e.key];
      if (named) { e.preventDefault(); send({ kind: 'key', key: named, mods: mods(e) }); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) {
        // A shortcut: send the letter with its modifiers rather than the
        // character the browser would have produced.
        if (e.key.length === 1) { e.preventDefault(); send({ kind: 'key', key: e.key.toLowerCase(), mods: mods(e) }); }
        return;
      }
      if (e.key.length === 1) { e.preventDefault(); send({ kind: 'text', text: e.key }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controllable, send]);

  const onMove = (e: React.MouseEvent) => {
    if (!controllable) return;
    const now = Date.now();
    if (now - lastMove.current < MOVE_MS) return;
    lastMove.current = now;
    const p = norm(e);
    if (p) send({ kind: 'move', x: p.x, y: p.y });
  };

  const onDown = (e: React.MouseEvent) => {
    if (!controllable || e.button === 2) return;
    const p = norm(e);
    if (!p) return;
    held.current = e.button === 1 ? 'middle' : 'left';
    send({ kind: 'down', button: held.current, x: p.x, y: p.y });
  };

  const onUp = (e: React.MouseEvent) => {
    if (!controllable || !held.current) return;
    const p = norm(e);
    send({ kind: 'up', button: held.current, ...(p ?? {}) });
    held.current = null;
  };

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!controllable) return;
    const p = norm(e);
    if (p) send({ kind: 'click', button: 'right', x: p.x, y: p.y });
  };

  const onDouble = (e: React.MouseEvent) => {
    if (!controllable) return;
    const p = norm(e);
    if (p) send({ kind: 'double', button: 'left', x: p.x, y: p.y });
  };

  const onWheel = (e: React.WheelEvent) => {
    // Pinch on a trackpad arrives as ctrl+wheel, which is the browser's own
    // signal for "zoom this" — so that is what it does, and every other wheel
    // goes to the computer.
    if (e.ctrlKey) {
      setZoom((z) => Math.max(1, Math.min(MAX_ZOOM, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
      return;
    }
    if (!controllable) return;
    const p = norm(e);
    // Wheel notches, 120 to the notch, the way a wheel actually reports.
    const dy = -Math.sign(e.deltaY) * 120 * Math.min(3, Math.ceil(Math.abs(e.deltaY) / 40));
    const dx = Math.sign(e.deltaX) * 120 * Math.min(3, Math.ceil(Math.abs(e.deltaX) / 40));
    if (dy || dx) send({ kind: 'scroll', dy, dx, ...(p ?? {}) });
  };

  // ── layout ────────────────────────────────────────────────────────────
  // `contain`, worked out here rather than left to CSS: a click in the
  // letterbox is not a click on the screen, and the element has to end where
  // the picture does or the arithmetic above is off by the size of the bar.
  const fit = useMemo(() => {
    if (!box.w || !box.h || !aspect) return { w: 0, h: 0 };
    return box.w / box.h > aspect
      ? { w: Math.round(box.h * aspect), h: box.h }
      : { w: box.w, h: Math.round(box.w / aspect) };
  }, [box, aspect]);

  if (!slot) return <Empty title="No computer" hint="Pair one first." />;

  const blocked = caps && !caps.view;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${C.hair}` }}>
        <Icon path={P.terminal} size={15} />
        <select
          value={key ?? ''}
          onChange={(e) => setFocus(e.target.value)}
          style={{ background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: R.btn,
                   padding: '5px 8px', fontSize: 13, outline: 'none' }}
        >
          {order.filter((k) => hosts[k]).map((k) => (
            <option key={k} value={k}>{hosts[k].info?.name?.replace('.local', '') || hosts[k].cfg.name}</option>
          ))}
        </select>
        {zoom > 1.01 && <Chip onClick={() => setZoom(1)} title="Back to actual size">{zoom.toFixed(1)}×</Chip>}
        <div style={{ flex: 1 }} />
        {caps && caps.control && (
          <Btn kind={caps.enabled ? 'danger' : 'primary'} onClick={enable} disabled={busy}>
            {busy ? <Spinner size={12} /> : caps.enabled ? 'Stop controlling' : 'Take control'}
          </Btn>
        )}
        <span style={{ fontSize: 12, color: controllable ? C.warn : C.mute }}>
          {blocked ? (caps?.reason ?? 'no screen here')
            : controllable ? 'control is on'
            : caps?.control === false ? (caps.reason ?? 'view only')
            : caps ? 'watching' : 'asking…'}
        </span>
      </div>

      <div ref={boxRef} style={{ flex: 1, minHeight: 0, background: '#000', display: 'flex',
                                 alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
        {fit.w > 0 && (
          <div
            ref={picRef}
            onMouseMove={onMove}
            onMouseDown={onDown}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            onContextMenu={onContext}
            onDoubleClick={onDouble}
            onWheel={onWheel}
            style={{ width: fit.w, height: fit.h, position: 'relative', transform: `scale(${zoom})`,
                     cursor: controllable ? 'crosshair' : 'default' }}
          >
            {[0, 1].map((i) => slots[i] && (
              <img
                key={i}
                src={slots[i]!}
                alt=""
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth && img.naturalHeight) setAspect(img.naturalWidth / img.naturalHeight);
                  if (i !== front) onFrame();
                }}
                onError={() => {
                  setError('The screen could not be read. Is the computer locked?');
                  window.setTimeout(() => nextFrame(), 1500);
                }}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                         opacity: i === front ? 1 : 0, userSelect: 'none' }}
              />
            ))}
          </div>
        )}
        {!slots[front] && !error && (
          <div style={{ position: 'absolute' }}><Spinner size={18} /></div>
        )}
      </div>

      {!!error && (
        <div style={{ padding: '8px 14px', fontSize: 12, color: C.danger, borderTop: `1px solid ${C.hair}` }}>{error}</div>
      )}
      {controllable && (
        <div style={{ padding: '7px 14px', fontSize: 12, color: C.mute, borderTop: `1px solid ${C.hair}` }}>
          Click, drag and type as if you were sitting at it. Right-click works; ⌃/⌘ shortcuts are passed
          through; hold ⌃ and scroll to zoom this view rather than the computer.
        </div>
      )}
    </div>
  );
}
