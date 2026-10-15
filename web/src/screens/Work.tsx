/** Work (`/work`): every ticket the queue is on right now, on every paired
 *  computer and across every project, on one page — and under it what
 *  finished in the last week.
 *
 *  Three ways to lay it out, chosen in the head and kept in the address
 *  (`?view=board`, `?group=date`, nothing for the default): a board of status
 *  columns, a list by project — the project page's "In progress now" said once
 *  for all of them, as `dv-sec` sections of `dv-live` rows — or the same list
 *  by day. Which rows, in what order and in which words is `lib/work.ts`; what
 *  is left here is reading the queues and the arrangement.
 *
 *  It is live the way the wall is: every computer's `ustabasi.list` is read
 *  again every few seconds, and whatever the newest answer says is drawn. A
 *  row opens the ticket's own page — its card where a board has one, the
 *  wall's ticket where none does — through `onOpen`. The board is read-only:
 *  the queue moves tickets, not this page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFleet } from '../lib/fleet';
import {
  GROUPINGS, cardMeta, finished, flights, groupBy, hasOlder, headLine, nothing, since,
  type Flight, type Grouping, type QueueSnap,
} from '../lib/work';

/** How often every queue is read again. The wall's own pace: the supervisor
 *  ticks every few minutes, a worker's stage moves about as often. An object so
 *  that a test can shorten it before the page is drawn. */
export const workPoll = { ms: 8000 };

/** How the page is laid out (null: by project) and how many weeks of finished
 *  tickets it adds beyond the last seven days. Held by the panel, beside the
 *  rest of where it is, because it is in the address. */
export interface WorkLayout { group: 'board' | 'date' | null; older: number }

export function Work({ onOpen, layout, onLayout }: {
  /** A row pressed: that ticket, on the computer it is on. */
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
  const [own, setOwn] = useState<WorkLayout>({ group: null, older: 0 });
  const shown = layout ?? own;
  const setLayout = onLayout ?? setOwn;
  const grouping: Grouping = shown.group ?? 'project';

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
        // has nothing in flight: either way it adds no rows.
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

  const from = since(now, shown.older);
  const rows = useMemo(
    () => online.flatMap((k) => [...flights(k, snaps[k], now), ...finished(k, snaps[k], now, from)]),
    [online, snaps, now, from]);
  const groups = useMemo(() => groupBy(grouping, rows, now), [grouping, rows, now]);
  const more = online.some((k) => hasOlder(snaps[k], from));
  const answered = online.filter((k) => snaps[k] !== undefined || errors[k]);
  const reading = online.length > 0 && answered.length === 0;
  const silent = online.length > 0 && answered.length === online.length && online.every((k) => errors[k]);
  const pick = (g: Grouping) => {
    if (g !== grouping) setLayout({ ...shown, group: g === 'project' ? null : g });
  };

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      {/* Seven columns do not fit the width a list is read at: the board takes
          the window. */}
      <div className="dv-page" data-work="" data-grouping={grouping}
        style={grouping === 'board' ? { maxWidth: 'none' } : undefined}>
        <section style={{ marginTop: 28 }}>
          <h1 className="dv-greet">Work</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <p className="dv-summary" data-work-head="" style={{ flex: 1, minWidth: 0 }}>
              {!online.length ? 'No computer is connected, so no queue can be read.'
                : reading ? 'Reading every queue…'
                : silent ? 'No queue answered.'
                : rows.length ? headLine(rows, shown.older) : nothing(shown.older)}
            </p>
            <div className="dv-seg" role="group" aria-label="Lay out by" data-work-grouping="">
              {GROUPINGS.map((g) => (
                <button key={g.key} type="button" className="dv-hit" aria-pressed={g.key === grouping}
                  onClick={() => pick(g.key)}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {grouping === 'board' ? (
          <div className="dv-board" data-work-board="">
            <div className="dv-board-cols" style={{ gridTemplateColumns: 'repeat(7, minmax(180px, 1fr))', minWidth: 7 * 180 + 6 * 16 }}>
              {groups.map((g) => (
                <section key={g.key} className="dv-col" aria-label={g.title} data-work-column={g.key}>
                  <div className="dv-sec" style={{ margin: 0, padding: '0 4px' }}>
                    <h3>{g.title}</h3>
                    <span className="dv-meta" style={{ marginLeft: 0 }} data-work-count="">{g.rows.length}</span>
                  </div>
                  {g.rows.map((f) => (
                    <button key={f.key} type="button" className="dv-glass dv-card press"
                      style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', border: 0, width: '100%' }}
                      onClick={() => onOpen?.(f.host, f.ticket.id)}
                      data-work-row={f.key} data-phase={f.phase} data-ended={f.ended ?? undefined}
                      data-merged={f.merged ? '' : undefined} title={f.ticket.title}>
                      <span className="dv-card-title">{`#${f.ticket.id} ${f.ticket.title}`}</span>
                      <span className="dv-card-foot">
                        <span className={`dv-status dv-status--${f.tone}`}><i />{f.word}</span>
                      </span>
                      <span className="dv-meta" data-work-meta="" style={{ lineHeight: '17px' }}>{cardMeta(f, now)}</span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </div>
        ) : groups.map((g) => (
          <section key={g.key} style={{ marginTop: 28 }} aria-labelledby={`work-${g.key}`}
            data-work-project={grouping === 'project' ? g.key : undefined}
            data-work-day={grouping === 'date' ? g.title : undefined}>
            <div className="dv-sec">
              <h3 id={`work-${g.key}`}>{g.title}</h3>
              <span className="dv-meta">{g.rows.length}</span>
            </div>
            <div className="dv-glass" style={{ borderRadius: 'var(--radius-md)', padding: '4px 14px' }}>
              {g.rows.map((f) => <Row key={f.key} f={f} onOpen={onOpen} />)}
            </div>
          </section>
        ))}

        {more && (
          <button type="button" className="dv-btn dv-btn--ghost dv-hit" data-work-older=""
            style={{ alignSelf: 'flex-start', marginTop: 20 }}
            onClick={() => setLayout({ ...shown, older: shown.older + 1 })}>
            Show older
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ f, onOpen }: { f: Flight; onOpen?: (host: string, id: number) => void }) {
  return (
    <button type="button" className="dv-live press"
      style={{ flexWrap: 'wrap', padding: '12px 4px' }}
      onClick={() => onOpen?.(f.host, f.ticket.id)}
      data-work-row={f.key} data-phase={f.phase} data-ended={f.ended ?? undefined}
      data-merged={f.merged ? '' : undefined} title={f.ticket.title}>
      <span className={`dv-status dv-status--${f.tone}`} style={{ minWidth: 84 }}><i />{f.word}</span>
      <span className="t">{`#${f.ticket.id} ${f.ticket.title}`}</span>
      <span className="dv-meta" data-work-meta="">{f.meta}</span>
      <span className="dv-meta" data-work-line=""
        style={{ flexBasis: '100%', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {f.line}
      </span>
    </button>
  );
}
