/** Havuz (`/havuz`): the tool pool, category by category.
 *
 *  Every tool Yakup has collected — mostly from Reels and posts he shared —
 *  with a picture, what it is for, where it fits, what it costs and whether it
 *  is actually on this machine. The chips at the top narrow the page to one
 *  group; that choice is in the address (`?g=video`), so a reload or a link
 *  lands on the same group. A press on a picture opens it large.
 *
 *  The data is `lib/havuz.ts`'s; the page only reads.
 */
import { useEffect, useMemo, useState } from 'react';
import { ago } from '../lib/format';
import { grouped, knownGroup, thumbUrl, usePool, type PoolTool } from '../lib/havuz';

const STATUS_WORD: Record<string, { word: string; cls: string }> = {
  verified: { word: 'verified', cls: 'dv-hv-st--verified' },
  installed: { word: 'installed', cls: 'dv-hv-st--installed' },
  catalogued: { word: 'catalogued', cls: 'dv-hv-st--catalogued' },
};

export function Havuz({ group, onGroup }: { group: string | null; onGroup: (g: string | null) => void }) {
  const load = usePool();
  const [big, setBig] = useState<{ src: string; alt: string } | null>(null);
  useEffect(() => {
    if (!big) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(null); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [big]);

  const tools = load.state === 'ok' ? load.pool.tools : [];
  const groups = useMemo(() => grouped(tools), [tools]);
  const g = knownGroup(tools, group);
  const shown = g ? groups.filter((x) => x.key === g) : groups;
  const count = shown.reduce((n, x) => n + x.tools.length, 0);
  const ready = tools.filter((t) => t.status !== 'catalogued').length;

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      <div className="dv-page dv-page--wide" data-havuz="">
        <section style={{ marginTop: 28 }}>
          <h1 className="dv-greet">Havuz</h1>
          <p className="dv-summary" data-havuz-summary="">
            {load.state === 'ok'
              ? <><span><b>{tools.length}</b> tools</span><span><b>{groups.length}</b> categories</span><span><b>{ready}</b> on this machine</span></>
              : load.state === 'loading' ? <span>Reading the pool…</span> : <span>No pool found.</span>}
          </p>
          {load.state === 'ok' && (
            <p className="dv-meta" style={{ margin: '8px 0 0' }}>
              Snapshot {ago(load.pool.generated_at)}{load.pool.catalog_updated ? ` · catalog updated ${load.pool.catalog_updated}` : ''}
            </p>
          )}
        </section>

        {load.state === 'missing' && (
          <section className="dv-glass dv-hv-empty" style={{ marginTop: 32 }}>
            <p>None of the paired computers has a pool snapshot at <code>~/projects/.havuz/havuz.json</code>.</p>
            <p className="dv-meta">Make one on the computer that has the shared-tool-pool skill: <code>python3 scripts/havuz-snapshot.py</code></p>
          </section>
        )}

        {load.state === 'ok' && (
          <>
            <nav className="dv-hv-chips" aria-label="Categories" data-havuz-groups="">
              <a href="/havuz" className="dv-hv-chip" aria-current={g == null ? 'page' : undefined}
                onClick={(e) => { e.preventDefault(); onGroup(null); }}>
                All <span className="n">{tools.length}</span>
              </a>
              {groups.map((x) => (
                <a key={x.key} href={`/havuz?g=${encodeURIComponent(x.key)}`} className="dv-hv-chip"
                  data-havuz-group={x.key} aria-current={g === x.key ? 'page' : undefined}
                  onClick={(e) => { e.preventDefault(); onGroup(g === x.key ? null : x.key); }}>
                  {x.word} <span className="n">{x.tools.length}</span>
                </a>
              ))}
            </nav>

            <p className="dv-hidden" aria-live="polite" data-havuz-count={count}>{count} tools shown</p>

            {shown.map((x) => (
              <section key={x.key} style={{ marginTop: 36 }} aria-labelledby={`hv-${x.key}`} data-havuz-section={x.key}>
                <div className="dv-sec">
                  <h3 id={`hv-${x.key}`}>{x.word}</h3>
                  <span className="dv-meta">{x.tools.length}</span>
                </div>
                <div className="dv-hv-grid">
                  {x.tools.map((t) => (
                    <Tool key={t.id} tool={t} host={load.host} onBig={setBig} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
      {!!big && (
        <div className="dv-hv-lb" role="dialog" aria-label={big.alt} onClick={() => setBig(null)}>
          <img src={big.src} alt={big.alt} />
        </div>
      )}
    </div>
  );
}

function Tool({ tool: t, host, onBig }: {
  tool: PoolTool; host: string; onBig: (b: { src: string; alt: string }) => void;
}) {
  const [more, setMore] = useState(false);
  const [broken, setBroken] = useState(false);
  const src = broken ? '' : thumbUrl(host, t);
  const st = STATUS_WORD[t.status] ?? STATUS_WORD.catalogued;
  const link = t.canonical || t.shared?.[0]?.link;
  return (
    <article className="dv-glass dv-hv-card" data-havuz-tool={t.id} data-status={t.status}>
      <button type="button" className="dv-hv-pic" disabled={!src}
        aria-label={src ? `Open the picture of ${t.name}` : undefined}
        onClick={() => src && onBig({ src, alt: t.name })}>
        {src
          ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
          : <span className="dv-hv-ph" data-group={t.group} aria-hidden="true"><b>{t.name}</b><i>{t.group}</i></span>}
      </button>
      <div className="dv-hv-body">
        <div className="dv-hv-head">
          <h4>{t.name}</h4>
          <span className={`dv-status ${st.cls}`} title={t.status_label}><i />{st.word}</span>
        </div>
        {!!t.purpose && <p className="dv-hv-purpose">{t.purpose}</p>}
        {!!t.project_fit && <p className="dv-hv-fit"><span>Fits</span>{t.project_fit}</p>}
        <dl className="dv-hv-meta">
          {!!t.priority && <><dt>Priority</dt><dd data-priority={t.priority}>{t.priority}</dd></>}
          {!!t.cost_license && <><dt>Cost</dt><dd>{t.cost_license}</dd></>}
          {!!t.platform && more && <><dt>Platform</dt><dd>{t.platform}</dd></>}
        </dl>
        {more && (
          <div className="dv-hv-more">
            {!!t.use && <p><span>Use</span>{t.use}</p>}
            {!!t.setup && <p><span>Setup</span>{t.setup}</p>}
            {!!t.cautions && <p><span>Careful</span>{t.cautions}</p>}
            {!!t.status_label && <p><span>Here</span>{t.status_label}</p>}
            {!!t.shared?.length && (
              <p><span>Shared</span>
                {t.shared.map((s, i) => (
                  <a key={i} href={s.link} target="_blank" rel="noopener noreferrer">{s.on ?? 'link'}{i < t.shared!.length - 1 ? ', ' : ''}</a>
                ))}
              </p>
            )}
          </div>
        )}
        <div className="dv-hv-foot">
          <button type="button" className="dv-btn dv-btn--ghost dv-hit" aria-expanded={more}
            onClick={() => setMore(!more)}>{more ? 'Less' : 'More'}</button>
          {!!link && (
            <a className="dv-btn dv-btn--ghost dv-hit" href={link} target="_blank" rel="noopener noreferrer"
              data-havuz-link="">Source ↗</a>
          )}
        </div>
      </div>
    </article>
  );
}
