/** The board, which is Plane (plane.so) on another computer — drawn here, in
 *  the page, as the Dashboard's own face.
 *
 *  Plane does not come into the page directly: it refuses to be framed, and its
 *  sign-in cookie would not travel into a frame from another host. So the
 *  computer that has it serves it through its own gateway (the daemon's
 *  `plane_gateway.py`, on its port + 1): same site as this page, framable by
 *  this page and nobody else, and on the tunnel only with a pass this page
 *  fetches first (`planePass`). The phone shows the same page in a web view
 *  (`app/src/components/plane.tsx`).
 */
import { useEffect, useState } from 'react';
import { planePass } from '../lib/actions';
import { useFleet } from '../lib/fleet';
import { useDivanStore } from '../lib/divan';
import { Button, EmptyState } from '../ui/divan';
import { P } from '../ui/kit';

/** The first computer whose products have a board, and one of its links. */
function usePlaneOf(): { key: string | null; link: string } {
  const order = useFleet((s) => s.order);
  // One string, so the store's own comparison is enough to keep it still.
  const found = useDivanStore((s) => {
    for (const key of order) {
      const p = (s.snaps[key]?.snapshot?.projects ?? []).find((x) => !!x.plane);
      if (p) return `${key}\n${p.plane}`;
    }
    return '';
  });
  if (!found) return { key: null, link: '' };
  const [key, link] = found.split('\n');
  return { key, link };
}

/** The workspace's own page, from any product's link: `<base>/<ws>/projects/`. */
function workspaceOf(url: string): string {
  const m = url.match(/^(https?:\/\/[^/]+\/[^/]+\/)/);
  return m ? `${m[1]}projects/` : url;
}

type Gate = { base: string; upstream: string } | { error: string } | null;

/** Plane in a frame. `url` is a page of Plane at its own address (what the
 *  snapshot carries); without one, the workspace's project list. */
export function PlaneFrame({ url, hostKey, fill }: { url?: string; hostKey?: string | null; fill?: boolean }) {
  const found = usePlaneOf();
  const key = hostKey ?? found.key;
  const any = found.link;
  const [gate, setGate] = useState<Gate>(null);
  const [opened] = useState(() => Date.now().toString(36));
  useEffect(() => {
    if (!key) return;
    let alive = true;
    setGate(null);
    planePass(key).then((g) => { if (alive) setGate(g); },
      (e) => { if (alive) setGate({ error: String(e?.message ?? e) }); });
    return () => { alive = false; };
  }, [key]);

  const page = url || (any ? workspaceOf(any) : '');
  // Nothing heard from any computer yet is not "no board".
  const heard = useDivanStore((s) => Object.values(s.snaps).some((x) => !!x?.snapshot));
  if (!page && !heard) return <div style={{ flex: 1 }} data-plane="loading" />;
  if (!page) {
    return (
      <EmptyState title="No board yet"
        body="This computer has no Plane. Add a [plane] url and workspace to its config.toml." />
    );
  }
  if (key && !gate) return <div style={{ flex: 1 }} data-plane="loading" />;
  // No computer to serve it through, or one that cannot here: Plane in a tab.
  if (!key || !gate || 'error' in gate || !gate.base) {
    return (
      <EmptyState title="The board is in Plane"
        body={gate && 'error' in gate ? gate.error : 'It cannot be shown from this address. It opens in a tab of its own.'}
        actions={<Button label="Open in Plane" icon={P.external}
          onClick={() => { window.open(page, '_blank', 'noopener'); }} />}
        foot={page} />
    );
  }
  const served = gate.upstream && page.startsWith(gate.upstream) ? gate.base + page.slice(gate.upstream.length) : page;
  // A fresh address each time the board is opened: Plane's pages say nothing
  // about caching, so a browser may keep one for days and never ask again —
  // and a page kept from before a Plane patch (ops/plane) is the old Plane.
  const src = `${served}${served.includes('?') ? '&' : '?'}divan=${opened}`;
  return (
    <iframe
      data-plane="" title="Board" src={src}
      allow="clipboard-read; clipboard-write; fullscreen"
      style={{
        border: 0, width: '100%', display: 'block', background: 'var(--surface, transparent)',
        ...(fill ? { flex: 1, minHeight: 0, height: '100%' } : { height: 'calc(100vh - 170px)', borderRadius: 12 }),
      }} />
  );
}

/** A product's board tab. */
export function PlaneBoard({ url }: { url: string }) {
  return <PlaneFrame url={url} />;
}
