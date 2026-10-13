/** Work in flight (`/work`): every ticket the queue is on right now, on every
 *  paired computer and across every project, on one page.
 *
 *  Laid out the way the Dashboard and a product's page are — a head, then a
 *  `dv-sec` per project with its tickets as `dv-live` rows under it — because
 *  it is the project page's "In progress now" said once for all of them. Which
 *  rows, in what order and in which words is `lib/work.ts`; what is left here
 *  is reading the queues and the arrangement.
 *
 *  It is live the way the wall is: every computer's `ustabasi.list` is read
 *  again every few seconds, and whatever the newest answer says is drawn. A
 *  row opens the ticket's own page — its card where a board has one, the
 *  wall's ticket where none does — through `onOpen`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFleet } from '../lib/fleet';
import {
  NOTHING, flights, groupFlights, headLine, type QueueSnap,
} from '../lib/work';

/** How often every queue is read again. The wall's own pace: the supervisor
 *  ticks every few minutes, a worker's stage moves about as often. An object so
 *  that a test can shorten it before the page is drawn. */
export const workPoll = { ms: 8000 };

export function Work({ onOpen }: {
  /** A row pressed: that ticket, on the computer it is on. */
  onOpen?: (host: string, id: number) => void;
}) {
  const hosts = useFleet((s) => s.hosts);
  const order = useFleet((s) => s.order);
  const call = useFleet((s) => s.call);
  const online = useMemo(() => order.filter((k) => hosts[k]?.status === 'online'), [order, hosts]);
  const onlineKey = online.join('|');

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

  const rows = useMemo(
    () => online.flatMap((k) => flights(k, snaps[k], now)),
    [online, snaps, now]);
  const groups = useMemo(() => groupFlights(rows), [rows]);
  const answered = online.filter((k) => snaps[k] !== undefined || errors[k]);
  const reading = online.length > 0 && answered.length === 0;
  const silent = online.length > 0 && answered.length === online.length && online.every((k) => errors[k]);

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      <div className="dv-page" data-work="">
        <section style={{ marginTop: 28 }}>
          <h1 className="dv-greet">Work in flight</h1>
          <p className="dv-summary" data-work-head="">
            {!online.length ? 'No computer is connected, so no queue can be read.'
              : reading ? 'Reading every queue…'
              : silent ? 'No queue answered.'
              : rows.length ? headLine(rows) : NOTHING}
          </p>
        </section>

        {groups.map((g) => (
          <section key={g.project} style={{ marginTop: 28 }} aria-labelledby={`work-${g.project}`} data-work-project={g.project}>
            <div className="dv-sec">
              <h3 id={`work-${g.project}`}>{g.project}</h3>
              <span className="dv-meta">{g.rows.length}</span>
            </div>
            <div className="dv-glass" style={{ borderRadius: 'var(--radius-md)', padding: '4px 14px' }}>
              {g.rows.map((f) => (
                <button key={f.key} type="button" className="dv-live press"
                  style={{ flexWrap: 'wrap', padding: '12px 4px' }}
                  onClick={() => onOpen?.(f.host, f.ticket.id)}
                  data-work-row={f.key} data-phase={f.phase} title={f.ticket.title}>
                  <span className={`dv-status dv-status--${f.tone}`} style={{ minWidth: 84 }}><i />{f.word}</span>
                  <span className="t">{`#${f.ticket.id} ${f.ticket.title}`}</span>
                  <span className="dv-meta" data-work-meta="">{f.meta}</span>
                  <span className="dv-meta" data-work-line=""
                    style={{ flexBasis: '100%', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.line}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
