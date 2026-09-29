import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C, MEDIA, R } from '../lib/theme';
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

interface Display { id: string; label: string; w: number; h: number; primary: boolean }
interface Caps {
  view: boolean; control: boolean; enabled: boolean;
  os?: string; reason?: string | null; displays?: Display[];
}

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
  const [live, setLive] = useState(false);
  const [fs, setFs] = useState(false);
  // Which screen of that computer. Empty is "whichever it calls primary",
  // which is every single-monitor machine and the first answer on the rest.
  const [display, setDisplay] = useState('');
  // Read by the frame loop and by every click, both of which run from handlers
  // older than the render that changed it.
  const displayRef = useRef('');
  displayRef.current = display;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const picRef = useRef<HTMLDivElement | null>(null);
  const frontRef = useRef(0);
  // Read inside timers and load handlers, where a stale `live` would keep
  // asking for frames after the picture was turned off.
  const liveRef = useRef(false);
  const tick = useRef(0);
  const alive = useRef(true);
  const lastAt = useRef(0);
  const lastMove = useRef(0);
  const held = useRef<string | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const base = slot ? `http://${slot.cfg.host}:${slot.cfg.port}` : null;
  const controllable = !!caps?.control && !!caps?.enabled;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; liveRef.current = false; };
  }, []);

  // ── frames ────────────────────────────────────────────────────────────
  const nextFrame = useCallback(() => {
    if (!alive.current || !liveRef.current || !base || !slot) return;
    tick.current += 1;
    // What the element is actually drawn at, in device pixels, and more again
    // when zoomed in. Anything less and a 3440-wide desktop arrives as mush.
    const wide = Math.round((box.w || 1280) * (window.devicePixelRatio || 1) * Math.min(zoom, 2));
    const w = Math.max(640, Math.min(3840, wide));
    const uri = `${base}/screen.jpg?token=${encodeURIComponent(slot.cfg.token)}&w=${w}&q=72`
      + `&display=${encodeURIComponent(displayRef.current)}&t=${tick.current}`;
    const backSlot = frontRef.current === 0 ? 1 : 0;
    setSlots((s) => (backSlot === 1 ? [s[0], uri] : [uri, s[1]]));
  }, [base, slot, box.w, zoom]);

  // Each frame asks for the next once it has arrived, so a slow link runs at
  // fewer frames a second rather than falling further behind with every one.
  const onFrame = useCallback(() => {
    if (!alive.current || !liveRef.current) return;
    frontRef.current = frontRef.current === 0 ? 1 : 0;
    setFront(frontRef.current);
    setError(null);
    lastAt.current = Date.now();
    window.setTimeout(() => nextFrame(), 60);
  }, [nextFrame]);

  /* Opening this view asks the computer what it can do and stops there.
   * The picture is a JPEG several times a second for as long as it runs, and a
   * panel left on this tab overnight would spend the night taking screenshots
   * of an empty desk — so it starts when someone asks for it and stops when
   * they are done, rather than following whichever tab happens to be open. */
  const start = useCallback(() => {
    if (liveRef.current) return;
    liveRef.current = true;
    setLive(true);
    setError(null);
    lastAt.current = Date.now();
    nextFrame();
  }, [nextFrame]);

  const stop = useCallback(() => {
    liveRef.current = false;
    setLive(false);
    setSlots([null, null]);
    frontRef.current = 0;
    setFront(0);
  }, []);

  useEffect(() => {
    if (!key) return;
    let gone = false;
    stop();
    setCaps(null); setError(null); setDisplay('');
    call<Caps>(key, 'screen.info', {})
      .then((r) => { if (!gone) setCaps(r); })
      .catch((e: any) => !gone && setError(e?.message ?? 'This computer did not answer about its screen'));
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A request that neither arrives nor errors ends the stream in silence.
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => {
      if (liveRef.current && lastAt.current && Date.now() - lastAt.current > 4000) {
        lastAt.current = Date.now();
        nextFrame();
      }
    }, 2000);
    return () => window.clearInterval(t);
  }, [live, nextFrame]);

  /* Full screen is the whole view, header included: the thing you reach for
   * first once the picture fills the wall is the button that gives the mouse
   * back. */
  useEffect(() => {
    const onFs = () => setFs(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const pickDisplay = useCallback((id: string) => {
    displayRef.current = id;
    setDisplay(id);
    setSlots([null, null]);
    frontRef.current = 0;
    setFront(0);
    setZoom(1);
    // The loop is driven by frames arriving, so throwing the two in flight away
    // breaks the chain: it has to be started again by hand rather than left to
    // the watchdog, which would show a black rectangle for four seconds first.
    if (liveRef.current) { lastAt.current = Date.now(); nextFrame(); }
  }, [nextFrame]);

  const toggleFs = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  }, []);

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
    call(key, 'screen.input', { actions, display: displayRef.current }).catch(
      (e: any) => setError(e?.message ?? 'That did not go through'));
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
    if (!controllable || !live) return;
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
  }, [controllable, live, send]);

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
    <div ref={rootRef} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
                                height: '100%', minHeight: 0, background: C.bg }}>
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
        {(caps?.displays?.length ?? 0) > 1 && (
          <select
            value={display || caps!.displays!.find((d) => d.primary)?.id || caps!.displays![0].id}
            onChange={(e) => pickDisplay(e.target.value)}
            title="Which screen of that computer"
            style={{ background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: R.btn,
                     padding: '5px 8px', fontSize: 13, outline: 'none' }}
          >
            {caps!.displays!.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        )}
        {zoom > 1.01 && <Chip onClick={() => setZoom(1)} title="Back to actual size">{zoom.toFixed(1)}×</Chip>}
        <div style={{ flex: 1 }} />
        {caps?.view && (
          <Btn kind={live ? 'ghost' : 'primary'} onClick={live ? stop : start}>
            {live ? 'Disconnect' : 'Connect'}
          </Btn>
        )}
        {caps && caps.control && (
          <Btn kind={caps.enabled ? 'danger' : 'primary'} onClick={enable} disabled={busy}>
            {busy ? <Spinner size={12} /> : caps.enabled ? 'Stop controlling' : 'Take control'}
          </Btn>
        )}
        <Btn kind="ghost" onClick={toggleFs} title={fs ? 'Leave full screen' : 'Full screen'}>
          <Icon path={fs ? P.shrink : P.expand} size={15} />
        </Btn>
        <span style={{ fontSize: 12, color: controllable && live ? C.warn : C.mute }}>
          {blocked ? (caps?.reason ?? 'no screen here')
            : !live ? 'not connected'
            : controllable ? 'control is on'
            : caps?.control === false ? (caps.reason ?? 'view only')
            : caps ? 'watching' : 'asking…'}
        </span>
      </div>

      <div ref={boxRef} style={{ flex: 1, minHeight: 0, background: MEDIA.stage, display: 'flex',
                                 alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
        {live && fit.w > 0 && (
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
                  if (!liveRef.current) return;
                  setError('The screen could not be read. Is the computer locked?');
                  window.setTimeout(() => nextFrame(), 1500);
                }}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                         opacity: i === front ? 1 : 0, userSelect: 'none' }}
              />
            ))}
          </div>
        )}
        {live && !slots[front] && !error && (
          <div style={{ position: 'absolute' }}><Spinner size={18} /></div>
        )}
        {!live && (
          <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column',
                        alignItems: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
            <Icon path={P.monitor} size={26} />
            <div style={{ fontSize: 13, color: C.mute, maxWidth: 340, lineHeight: 1.5 }}>
              {blocked ? (caps?.reason ?? 'There is no screen to show on this computer.')
                : caps ? 'Nothing is being watched. The picture starts when you ask for it, and stops when you leave.'
                : 'Asking this computer about its screen…'}
            </div>
            {caps?.view && <Btn kind="primary" onClick={start}>Connect</Btn>}
          </div>
        )}
      </div>

      {!!error && (
        <div style={{ padding: '8px 14px', fontSize: 12, color: C.danger, borderTop: `1px solid ${C.hair}` }}>{error}</div>
      )}
      {controllable && live && (
        <div style={{ padding: '7px 14px', fontSize: 12, color: C.mute, borderTop: `1px solid ${C.hair}` }}>
          Click, drag and type as if you were sitting at it. Right-click works; ⌃/⌘ shortcuts are passed
          through; hold ⌃ and scroll to zoom this view rather than the computer.
        </div>
      )}
    </div>
  );
}
