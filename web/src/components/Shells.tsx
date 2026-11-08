/** Machine › Terminal's first view: real shells on the computer being looked
 *  at, a tab each, drawn by xterm.js. The computers are the fleet's own chips,
 *  as on the remote screen, so which one this is is the fleet's `focus`; the
 *  shells and their bytes are term.ts's. */
import { useEffect, useRef } from 'react';
import { MEDIA, RADIUS, T } from '../lib/theme';
import { useFleet } from '../lib/fleet';
import { scrollback, subscribe, useShells, viewFactory, type Shell, type TermView } from '../lib/term';
import { Icon, P } from '../ui/kit';
import { Button, EmptyState, SectionHeader } from '../ui/divan';

const STAGE = MEDIA.term;

export function Shells({ header }: { header: React.ReactNode }) {
  const { hosts, order, focus } = useFleet();
  const { shells, active, open, close, select } = useShells();
  const key = focus && hosts[focus] ? focus : order[0] ?? null;
  const slot = key ? hosts[key] : undefined;
  const online = slot?.status === 'online';
  const mine = shells.filter((s) => s.hostKey === key);
  const front = key ? active[key] : undefined;

  // Opening the tab is opening a shell: a computer with none open here gets
  // one as soon as it is looked at and answering. Once per computer per visit,
  // so closing the last tab leaves the page empty rather than reopening it.
  const opened = useRef(new Set<string>());
  useEffect(() => {
    if (!key || !online || opened.current.has(key)) return;
    opened.current.add(key);
    if (!useShells.getState().shells.some((s) => s.hostKey === key)) void open(key);
  }, [key, online, open]);

  const name = (k: string) => hosts[k]?.info?.name?.replace('.local', '') || hosts[k]?.cfg.name || k;

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: T.bg }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '16px 24px 10px', flexWrap: 'wrap' }}>
        {header}
        <SectionHeader kind="page" title="Terminal" note={key ? name(key) : undefined} style={{ flexShrink: 0 }} />
        {/* The computer is chosen by the picker beside the Machine tabs, which
            is this same focus; a second row of the same names here was two
            pickers for one choice (7 Nov 2026). */}
      </div>

      {!key ? (
        <EmptyState
          title="No computer is paired yet."
          body="A shell opens on one of your computers. Pair one under Machines."
        />
      ) : (
        <>
          <div role="tablist" aria-label={`Shells on ${name(key)}`} style={{
            flexShrink: 0, display: 'flex', alignItems: 'flex-end', gap: 2, padding: '0 24px', overflowX: 'auto',
          }}>
            {mine.map((s) => (
              <ShellTab
                key={s.id} shell={s} on={s.id === front}
                onSelect={() => select(key, s.id)} onClose={() => close(s.id)}
              />
            ))}
            <button
              type="button" aria-label="Open another shell" title="Open another shell"
              disabled={!online} onClick={() => { void open(key); }}
              className="dv-hit"
              style={{
                width: 30, height: 30, marginBottom: 2, border: 'none', borderRadius: RADIUS.mark,
                background: 'transparent', cursor: online ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            ><Icon path={P.plus} size={16} color={online ? T.ink2 : T.ink3} /></button>
          </div>
          <div style={{
            flex: 1, minHeight: 0, margin: '0 24px 24px', position: 'relative',
            background: STAGE, borderRadius: `0 ${RADIUS.card}px ${RADIUS.card}px ${RADIUS.card}px`, overflow: 'hidden',
          }}>
            {/* Every shell stays drawn while the page is open, the ones not in
                front hidden, so switching tabs or computers loses nothing. */}
            {shells.map((s) => (
              <ShellPane key={s.id} shell={s} visible={s.hostKey === key && s.id === front} />
            ))}
            {!mine.length && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: MEDIA.inkDim, fontSize: 13.5 }}>
                  <span>{online ? `No shell open on ${name(key)}.` : `${name(key)} is not answering.`}</span>
                  {online && <Button small icon={P.plus} label="Open a shell" onClick={() => { void open(key); }} />}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ShellTab({ shell, on, onSelect, onClose }: {
  shell: Shell; on: boolean; onSelect: () => void; onClose: () => void;
}) {
  const note = shell.state === 'opening' ? 'opening…'
    : shell.state === 'failed' ? 'failed'
      : shell.state === 'ended' ? 'ended' : null;
  return (
    <span style={{
      display: 'flex', alignItems: 'center', gap: 2, height: 32, padding: '0 4px 0 12px',
      borderRadius: `${RADIUS.mark}px ${RADIUS.mark}px 0 0`,
      background: on ? STAGE : T.s1, color: on ? MEDIA.ink : T.ink2, fontSize: 13,
    }}>
      <button
        type="button" role="tab" aria-selected={on} onClick={onSelect} data-shell={shell.id}
        style={{ border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', padding: 0 }}
      >
        {shell.title}
        {note && <span style={{ marginLeft: 6, color: on ? MEDIA.inkDim : T.ink3 }}>{note}</span>}
      </button>
      <button
        type="button" aria-label={`Close ${shell.title}`} title="Close this shell" onClick={onClose}
        style={{
          width: 22, height: 22, border: 'none', borderRadius: RADIUS.mark, background: 'transparent',
          color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      ><Icon path={P.x} size={13} color="currentColor" /></button>
    </span>
  );
}

/** One shell's xterm, alive as long as the tab is. */
function ShellPane({ shell, visible }: { shell: Shell; visible: boolean }) {
  const el = useRef<HTMLDivElement | null>(null);
  const view = useRef<TermView | null>(null);
  const shown = useRef(visible);
  shown.current = visible;

  useEffect(() => {
    let dead = false;
    let unsub = () => {};
    let frame = 0;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (shown.current) view.current?.fit(); });
    };
    const box = el.current!;
    const watch = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refit) : null;
    viewFactory()(box).then((v) => {
      if (dead) { v.dispose(); return; }
      view.current = v;
      const { write, resize } = useShells.getState();
      v.write(scrollback(shell.id));
      unsub = subscribe(shell.id, (d) => v.write(d));
      v.onData((d) => write(shell.id, d));
      v.onResize(({ cols, rows }) => resize(shell.id, cols, rows));
      if (shown.current) { v.fit(); v.focus(); }
      watch?.observe(box);
    }).catch(() => {});
    window.addEventListener('resize', refit);
    return () => {
      dead = true;
      unsub();
      cancelAnimationFrame(frame);
      watch?.disconnect();
      window.removeEventListener('resize', refit);
      view.current?.dispose();
      view.current = null;
    };
  }, [shell.id]);

  // Brought to the front: it may have been hidden through a resize.
  useEffect(() => {
    if (!visible || !view.current) return;
    view.current.fit();
    view.current.focus();
  }, [visible]);

  return (
    <div
      ref={el} data-shell-pane={shell.id} aria-hidden={!visible}
      style={{ position: 'absolute', inset: 10, display: visible ? 'block' : 'none' }}
    />
  );
}
