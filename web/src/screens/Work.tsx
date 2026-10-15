/** Work (`/work`): every ticket the queue is on, on every paired computer and
 *  across every project, as one board of status columns — and what finished
 *  in the days the date picker says.
 *
 *  Above the board, three ways to narrow it, each kept in the address so a
 *  reload, Back and a link keep them: the days (`?range=30d`, or
 *  `?from=…&to=…`; the last seven when neither is there), a search box
 *  (`?q=`) and one project (`?project=`). Which cards, in what order and in
 *  which words is `lib/work.ts`; what is left here is reading the queues and
 *  drawing them.
 *
 *  It is live the way the wall is: every computer's `ustabasi.list` is read
 *  again every few seconds, and whatever the newest answer says is drawn. A
 *  card opens the ticket's own page through `onOpen`.
 *
 *  A card can be dragged to another column — with a mouse, or a finger held
 *  on it for a moment — or moved from its own Move to… menu, and either asks
 *  the queue to do what that move means: Cancelled is `ustabasi cancel`,
 *  Queued is `ustabasi restart`, a new place in Queued is `ustabasi
 *  priority`, and In progress is first in line (`ustabasi priority N 0`) —
 *  started by the supervisor's next pass, or told on the card what holds it. Nothing is moved here: the card goes back where it was, says
 *  what the queue answered, and lands wherever the next snapshot puts it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFleet } from '../lib/fleet';
import { cancelTicket, prioritiseTicket, restartTicket } from '../lib/actions';
import {
  COLUMNS, PRESETS, boardColumns, cardMeta, columnOf, finished, flights, headLine, matches, moveOf,
  nothing, projectCounts, reorder, spanOf, within,
  type ColumnKey, type Flight, type QueueSnap,
} from '../lib/work';

/** How often every queue is read again. The wall's own pace: the supervisor
 *  ticks every few minutes, a worker's stage moves about as often. An object so
 *  that a test can shorten it before the page is drawn. */
export const workPoll = { ms: 8000 };

/** How long a finger rests on a card before it is picked up rather than
 *  scrolled past. An object for the same reason as `workPoll`. */
export const workHold = { ms: 300 };

/** What the board is narrowed to: which days (null: the last seven), what is
 *  typed in the search box and which project (null: all). Held by the panel,
 *  beside the rest of where it is, because it is in the address. */
export interface WorkLayout { range: string | null; search: string; project: string | null }

/** What the queue said to the last thing asked of a card. */
interface Said { tone: 'busy' | 'ok' | 'error' | 'refused' | 'starting'; text: string }

/** What a card asked to start says, read off the newest snapshot rather than
 *  promised: started once it is running, why not while something holds it,
 *  and starting until the supervisor's next pass takes it. */
function startWord(f: Flight): string {
  if (f.phase === 'running') return 'Started.';
  if (f.ended) return `It ${f.ended} before it started.`;
  if (f.startBlock) return `First in line, but it can't start yet: ${f.startBlock}.`;
  return 'Starting…';
}

/** A card being dragged: what was picked up, where, and whether it has left
 *  its place yet (a press that never moved is a click). */
interface Lift {
  f: Flight; pointer: number; touch: boolean;
  x0: number; y0: number; on: boolean; timer: ReturnType<typeof setTimeout> | null;
}

export function Work({ onOpen, layout, onLayout }: {
  /** A card pressed: that ticket, on the computer it is on. */
  onOpen?: (host: string, id: number) => void;
  layout?: WorkLayout;
  onLayout?: (to: WorkLayout) => void;
}) {
  const hosts = useFleet((s) => s.hosts);
  const order = useFleet((s) => s.order);
  const call = useFleet((s) => s.call);
  const online = useMemo(() => order.filter((k) => hosts[k]?.status === 'online'), [order, hosts]);
  const onlineKey = online.join('|');
  // A page drawn without a panel round it (the picture's harness) keeps its
  // own choice.
  const [own, setOwn] = useState<WorkLayout>({ range: null, search: '', project: null });
  const shown = layout ?? own;
  const setLayout = onLayout ?? setOwn;

  const [snaps, setSnaps] = useState<Record<string, QueueSnap | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now() / 1000);
  const busy = useRef(new Set<string>());

  const load = useCallback(() => {
    for (const key of onlineKey ? onlineKey.split('|') : []) {
      if (busy.current.has(key)) continue;
      busy.current.add(key);
      call(key, 'ustabasi.list', {})
        .then((snap) => {
          setSnaps((had) => ({ ...had, [key]: snap as QueueSnap }));
          setErrors((had) => { const { [key]: _gone, ...rest } = had; return rest; });
        })
        // An older daemon has no such handler, and a computer with no queue
        // has nothing in flight: either way it adds no cards.
        .catch((e: any) => setErrors((had) => ({ ...had, [key]: e?.message || 'did not answer' })))
        .finally(() => { busy.current.delete(key); setNow(Date.now() / 1000); });
    }
  }, [onlineKey, call]);

  useEffect(() => {
    load();
    const t = setInterval(load, workPoll.ms);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);

  const span = spanOf(shown.range, now);
  const all = useMemo(
    () => online.flatMap((k) => [...flights(k, snaps[k], now), ...finished(k, snaps[k], now)]),
    [online, snaps, now]);
  // The days and the search narrow the board; the project picker is counted
  // over what those two leave, and narrows it last.
  const found = useMemo(
    () => all.filter((f) => within(f, span) && matches(f, shown.search)),
    [all, span.from, span.end, shown.search]);
  const rows = useMemo(
    () => (shown.project ? found.filter((f) => f.project === shown.project) : found),
    [found, shown.project]);
  const counts = useMemo(() => projectCounts(all, found), [all, found]);
  const groups = useMemo(() => boardColumns(rows), [rows]);
  const answered = online.filter((k) => snaps[k] !== undefined || errors[k]);
  const reading = online.length > 0 && answered.length === 0;
  const silent = online.length > 0 && answered.length === online.length && online.every((k) => errors[k]);
  const narrowed = !!shown.search.trim() || !!shown.project;

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      {/* Seven columns do not fit the width a list is read at: the board takes
          the window. */}
      <div className="dv-page" data-work="" data-grouping="board" style={{ maxWidth: 'none' }}>
        <section style={{ marginTop: 28 }}>
          <h1 className="dv-greet">Work</h1>
          <p className="dv-summary" data-work-head="">
            {!online.length ? 'No computer is connected, so no queue can be read.'
              : reading ? 'Reading every queue…'
              : silent ? 'No queue answered.'
              : rows.length ? headLine(rows, shown.range)
              : narrowed ? 'Nothing here matches.' : nothing(shown.range)}
          </p>
          <div className="dv-work-bar" data-work-bar="">
            <Dates range={shown.range} first={span.first} last={span.last}
              onRange={(range) => setLayout({ ...shown, range })} />
            <input type="search" className="dv-work-search" data-work-search=""
              aria-label="Search tickets" placeholder="Search #id, title, project, last event…"
              value={shown.search} onChange={(e) => setLayout({ ...shown, search: e.target.value })} />
            <Projects chosen={shown.project} counts={counts} total={found.length}
              onPick={(project) => setLayout({ ...shown, project })} />
          </div>
        </section>

        <Board groups={groups} now={now} onOpen={onOpen} reload={load} />
      </div>
    </div>
  );
}

// ── the three pickers ───────────────────────────────────────────────────────

function Dates({ range, first, last, onRange }: {
  range: string | null; first: string; last: string; onRange: (r: string | null) => void;
}) {
  const preset = PRESETS.some((p) => p.key === range);
  const span = (a: string, b: string) => {
    if (!a || !b) return;
    onRange(a <= b ? `${a}..${b}` : `${b}..${a}`);
  };
  return (
    <div className="dv-work-dates" data-work-dates="" role="group" aria-label="Days">
      <div className="dv-seg" role="group" aria-label="Preset">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="dv-hit" aria-pressed={preset && p.key === range}
            data-work-preset={p.key ?? '7d'} onClick={() => onRange(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      <input type="date" aria-label="From" data-work-from="" value={first} max={last}
        onChange={(e) => span(e.target.value, last)} />
      <span className="dv-meta" aria-hidden="true">–</span>
      <input type="date" aria-label="To" data-work-to="" value={last} min={first}
        onChange={(e) => span(first, e.target.value)} />
    </div>
  );
}

function Projects({ chosen, counts, total, onPick }: {
  chosen: string | null; counts: { name: string; count: number }[]; total: number;
  onPick: (p: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    box.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const pick = (p: string | null) => { setOpen(false); onPick(p); };
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button type="button" className="dv-chip dv-hit" data-work-project-picker=""
        aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {chosen ?? 'All projects'} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="dv-menu" role="listbox" aria-label="Project" data-work-projects=""
          style={{ left: 'auto', right: 0 }}>
          <button type="button" role="option" aria-selected={!chosen} aria-checked={!chosen}
            data-work-project-option="" onClick={() => pick(null)}>
            <span>All projects</span><span className="dv-meta">{total}</span>
          </button>
          {counts.map((c) => (
            <button key={c.name} type="button" role="option" aria-selected={chosen === c.name}
              aria-checked={chosen === c.name} data-work-project-option={c.name} onClick={() => pick(c.name)}>
              <span>{c.name}</span><span className="dv-meta">{c.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── the board ───────────────────────────────────────────────────────────────

const TITLE = Object.fromEntries(COLUMNS.map((c) => [c.key, c.title])) as Record<ColumnKey, string>;

function Board({ groups, now, onOpen, reload }: {
  groups: { key: string; title: string; rows: Flight[] }[];
  now: number;
  onOpen?: (host: string, id: number) => void;
  reload: () => void;
}) {
  const board = useRef<HTMLDivElement>(null);
  const [said, setSaid] = useState<Record<string, Said>>({});
  const [asking, setAsking] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [lifted, setLifted] = useState<{ key: string; dx: number; dy: number; over: ColumnKey | null } | null>(null);
  const lift = useRef<Lift | null>(null);
  /** A drag just ended on this card: the click that follows it is not a press. */
  const dropped = useRef<string | null>(null);
  const queued = groups.find((g) => g.key === 'queued')?.rows ?? [];

  const say = (key: string, s: Said) => setSaid((had) => ({ ...had, [key]: s }));
  /** A card picked up again forgets what was said about the last move. */
  const unsay = (key: string) => setSaid((had) => {
    if (!(key in had)) return had;
    const { [key]: _gone, ...rest } = had;
    return rest;
  });

  /** Ask the queue, say what it answered on the card, and read the queue again
   *  so the board shows where the ticket went. */
  const ask = useCallback(async (f: Flight, busyWord: string, go: () => Promise<string>, after: Said['tone'] = 'ok') => {
    say(f.key, { tone: 'busy', text: busyWord });
    try {
      const text = await go();
      say(f.key, { tone: after, text });
    } catch (e: any) {
      say(f.key, { tone: 'error', text: e?.message || 'The queue did not answer.' });
    } finally {
      reload();
    }
  }, [reload]);

  const cancel = (f: Flight) => ask(f, 'Cancelling…', async () =>
    ((await cancelTicket(f.host, f.ticket.id))?.message || '').trim() || `#${f.ticket.id} cancelled`);
  const restart = (f: Flight) => ask(f, 'Putting it back in the queue…', async () =>
    ((await restartTicket(f.host, f.ticket.id))?.message || '').trim() || `#${f.ticket.id} back in the queue`);
  /** First in line, which is what starting a ticket is: the queue decides
   *  when a slot takes it, and its next pass is within a minute. */
  const start = (f: Flight) => ask(f, 'Starting…', async () =>
    ((await prioritiseTicket(f.host, f.ticket.id, 0))?.message || '').trim(), 'starting');
  const place = (f: Flight, index: number) => {
    const calls = reorder(queued, f, index);
    if (!calls.length) return;
    void ask(f, 'Reordering…', async () => {
      let mine = '';
      for (const c of calls) {
        const r = await prioritiseTicket(f.host, c.id, c.priority);
        if (c.id === f.ticket.id) mine = (r?.message || '').trim();
      }
      return mine || `#${f.ticket.id} priority ${calls[0].priority}`;
    });
  };

  /** A card put down on a column — by a drag or from its menu. `index` is
   *  where in Queued, for a card that was already there. */
  const move = (f: Flight, to: ColumnKey, index = 0) => {
    setMenu(null);
    const m = moveOf(f, to);
    if (m.kind === 'stay') return;
    if (m.kind === 'refuse') { say(f.key, { tone: 'refused', text: m.reason }); return; }
    if (m.kind === 'priority') { place(f, index); return; }
    if (m.kind === 'cancel') {
      if (m.confirm) { setAsking(f.key); return; }
      void cancel(f);
      return;
    }
    if (m.kind === 'start') { void start(f); return; }
    void restart(f);
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  /** The column under a point, by where the columns are drawn. */
  const columnAt = (x: number, y: number): HTMLElement | null => {
    for (const el of board.current?.querySelectorAll<HTMLElement>('[data-work-column]') ?? []) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
    }
    return null;
  };
  /** …and where in it: how many of its other cards are above the point. */
  const indexAt = (col: HTMLElement, y: number, key: string) => [...col.querySelectorAll<HTMLElement>('[data-work-row]')]
    .filter((el) => el.getAttribute('data-work-row') !== key)
    .filter((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 < y; }).length;

  function end(e: PointerEvent | null) {
    const l = lift.current;
    if (!l) return;
    if (l.timer) clearTimeout(l.timer);
    lift.current = null;
    setLifted(null);
    window.removeEventListener('pointermove', stable.move);
    window.removeEventListener('pointerup', stable.up);
    window.removeEventListener('pointercancel', stable.cancel);
    if (!e || !l.on) return;
    dropped.current = l.f.key;
    setTimeout(() => { if (dropped.current === l.f.key) dropped.current = null; }, 0);
    const col = columnAt(e.clientX, e.clientY);
    // Put down nowhere: it goes back where it was, and nothing is asked.
    if (!col) return;
    const to = col.getAttribute('data-work-column') as ColumnKey;
    move(l.f, to, to === 'queued' ? indexAt(col, e.clientY, l.f.key) : 0);
  }

  function drag(e: PointerEvent) {
    const l = lift.current;
    if (!l || e.pointerId !== l.pointer) return;
    const dx = e.clientX - l.x0;
    const dy = e.clientY - l.y0;
    if (!l.on) {
      const far = Math.hypot(dx, dy);
      // A finger that moves before it has rested is scrolling the page.
      if (l.touch) { if (far > 8) end(null); return; }
      if (far < 5) return;
      l.on = true;
      unsay(l.f.key);
    }
    const col = columnAt(e.clientX, e.clientY);
    setLifted({ key: l.f.key, dx, dy, over: (col?.getAttribute('data-work-column') as ColumnKey) ?? null });
  }

  // The window's listeners are added when a card is pressed and taken off when
  // it is put down, so they are the same three functions for the life of the
  // board, each calling this render's own.
  const live = useRef({ end, drag });
  live.current = { end, drag };
  const stable = useMemo(() => ({
    move: (e: PointerEvent) => live.current.drag(e),
    up: (e: PointerEvent) => { if (lift.current && e.pointerId === lift.current.pointer) live.current.end(e); },
    cancel: (e: PointerEvent) => { if (lift.current && e.pointerId === lift.current.pointer) live.current.end(null); },
  }), []);

  const down = (f: Flight, e: React.PointerEvent) => {
    if (e.button !== 0 || lift.current) return;
    // The card's own controls are pressed, not dragged.
    if ((e.target as HTMLElement).closest('[data-work-move], [data-work-menu], [data-work-confirm]')) return;
    const touch = e.pointerType === 'touch';
    const l: Lift = { f, pointer: e.pointerId, touch, x0: e.clientX, y0: e.clientY, on: false, timer: null };
    if (touch) {
      l.timer = setTimeout(() => {
        if (lift.current !== l) return;
        l.on = true;
        unsay(f.key);
        setLifted({ key: f.key, dx: 0, dy: 0, over: columnOf(f) });
      }, workHold.ms);
    }
    lift.current = l;
    window.addEventListener('pointermove', stable.move);
    window.addEventListener('pointerup', stable.up);
    window.addEventListener('pointercancel', stable.cancel);
  };

  // A finger that has picked a card up moves the card, not the page.
  useEffect(() => {
    const hold = (e: TouchEvent) => { if (lift.current?.on) e.preventDefault(); };
    window.addEventListener('touchmove', hold, { passive: false });
    return () => { window.removeEventListener('touchmove', hold); live.current.end(null); };
  }, []);

  const options = (f: Flight): { label: string; to: ColumnKey; index?: number }[] => {
    const out: { label: string; to: ColumnKey; index?: number }[] = [];
    const col = columnOf(f);
    if (col === 'queued') {
      const i = queued.findIndex((x) => x.key === f.key);
      if (reorder(queued, f, 0).length) out.push({ label: 'Top of Queued', to: 'queued', index: 0 });
      if (i > 1 && reorder(queued, f, i - 1).length) out.push({ label: 'Up one', to: 'queued', index: i - 1 });
      if (i >= 0 && i < queued.length - 1 && reorder(queued, f, i + 1).length) {
        out.push({ label: 'Down one', to: 'queued', index: i + 1 });
      }
    }
    for (const c of COLUMNS) {
      const m = moveOf(f, c.key);
      if (m.kind === 'restart') out.push({ label: `${c.title} — run it again`, to: c.key });
      if (m.kind === 'start') out.push({ label: `${c.title} — start it`, to: c.key });
      if (m.kind === 'cancel') out.push({ label: `${c.title} — stop it`, to: c.key });
    }
    return out;
  };

  return (
    <div className="dv-board" data-work-board="" ref={board}>
      <div className="dv-board-cols" style={{ gridTemplateColumns: 'repeat(7, minmax(180px, 1fr))', minWidth: 7 * 180 + 6 * 16 }}>
        {groups.map((g) => (
          <section key={g.key} className="dv-col" aria-label={g.title} data-work-column={g.key}
            data-dropping={lifted?.over === g.key ? 'true' : undefined}>
            <div className="dv-sec" style={{ margin: 0, padding: '0 4px' }}>
              <h3>{g.title}</h3>
              <span className="dv-meta" style={{ marginLeft: 0 }} data-work-count="">{g.rows.length}</span>
            </div>
            {g.rows.map((f) => {
              const s = said[f.key];
              const up = lifted?.key === f.key ? lifted : null;
              const opts = menu === f.key ? options(f) : [];
              return (
                <div key={f.key} className="dv-glass dv-card"
                  onPointerDown={(e) => down(f, e)}
                  onContextMenu={(e) => { if (lift.current) e.preventDefault(); }}
                  data-work-row={f.key} data-phase={f.phase} data-ended={f.ended ?? undefined}
                  data-merged={f.merged ? '' : undefined} data-lifted={up ? 'true' : undefined}
                  style={{
                    position: 'relative', touchAction: 'manipulation', userSelect: 'none', WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                    ...(up ? { transform: `translate(${up.dx}px, ${up.dy}px)`, zIndex: 30, cursor: 'grabbing' } : {}),
                  } as React.CSSProperties}>
                  <button type="button" className="press" data-work-open="" title={f.ticket.title}
                    style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}
                    onClick={() => {
                      if (dropped.current === f.key) { dropped.current = null; return; }
                      onOpen?.(f.host, f.ticket.id);
                    }}>
                    <span className="dv-card-title">{`#${f.ticket.id} ${f.ticket.title}`}</span>
                    <span className="dv-card-foot">
                      <span className={`dv-status dv-status--${f.tone}`}><i />{f.word}</span>
                    </span>
                    <span className="dv-meta" data-work-meta="" style={{ lineHeight: '17px' }}>{cardMeta(f, now)}</span>
                  </button>
                  <div style={{ position: 'relative', display: 'flex' }}>
                    <button type="button" className="dv-chip dv-hit" data-work-move=""
                      aria-haspopup="menu" aria-expanded={menu === f.key}
                      aria-label={`Move #${f.ticket.id} to…`}
                      onClick={() => setMenu((m) => (m === f.key ? null : f.key))}>
                      Move to…
                    </button>
                    {menu === f.key && (
                      <Menu id={f.ticket.id} options={opts} onClose={closeMenu}
                        onPick={(o) => move(f, o.to, o.index)} />
                    )}
                  </div>
                  {asking === f.key && (
                    <div className="dv-confirm" role="group" aria-label={`Cancel #${f.ticket.id}`} data-work-confirm=""
                      style={{ marginTop: 0, padding: 0 }}>
                      <p>#{f.ticket.id} is running. Cancel it? The worker is stopped where it is.</p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" className="dv-btn dv-hit" onClick={() => setAsking(null)}>Keep it running</button>
                        <button type="button" className="dv-btn dv-btn--ghost dv-btn--danger dv-hit"
                          onClick={() => { setAsking(null); void cancel(f); }}>
                          Cancel it
                        </button>
                      </div>
                    </div>
                  )}
                  {s && (
                    <p className="dv-meta" role="status" data-work-said={s.tone}
                      style={{ margin: 0, lineHeight: '17px', color: s.tone === 'error' || s.tone === 'refused' ? 'var(--red)' : undefined }}>
                      {s.tone === 'starting' ? startWord(f) : s.text}
                    </p>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
      {lifted?.over && (
        <p className="dv-meta" aria-live="polite" style={{ position: 'absolute', left: -9999 }}>
          {`Over ${TITLE[lifted.over]}`}
        </p>
      )}
    </div>
  );
}

/** A card's Move to… menu: the same moves a drag makes, for a keyboard and for
 *  anybody who would rather not drag. */
function Menu({ id, options, onPick, onClose }: {
  id: number;
  options: { label: string; to: ColumnKey; index?: number }[];
  onPick: (o: { to: ColumnKey; index?: number }) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const away = (e: Event) => { if (!box.current?.parentElement?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  const keys = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };
  return (
    <div ref={box} className="dv-menu" role="menu" aria-label={`Move #${id} to`} data-work-menu="" onKeyDown={keys}>
      {options.length ? options.map((o) => (
        <button key={`${o.to}-${o.label}`} type="button" role="menuitem" data-work-to={o.to}
          onClick={() => onPick(o)}>
          <span>{o.label}</span>
        </button>
      )) : (
        <p className="dv-meta" style={{ margin: 0, padding: '8px 10px' }}>The queue moves this one itself.</p>
      )}
    </div>
  );
}
