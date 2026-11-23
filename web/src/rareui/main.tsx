/* Every Rare UI component, running, on one page of the panel: `/rareui.html`.
 *
 * Rare UI (https://rareui.com) by Swami Malode, MIT + Commons Clause +
 * Attribution. The components under `components/ui/` and the demos under
 * `demos/` are the repository's own files, used as they are; `LICENSE` beside
 * them is its licence. This page only lays them out. */
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
import { components, CATEGORY_LABELS, CATEGORY_ORDER, type ComponentItem } from '@/lib/components';
import { PreviewControlsProvider } from '@/components/preview/PreviewControls';

const DEMOS = import.meta.glob('./demos/*.tsx') as Record<string, () => Promise<{ default: React.ComponentType }>>;

type Entry = { slug: string; item: ComponentItem; Demo: React.LazyExoticComponent<React.ComponentType> };

function entries(): Entry[] {
  const out: Entry[] = [];
  for (const item of components) {
    const slug = item.href.split('/').pop()!;
    const load = DEMOS[`./demos/${slug}.tsx`];
    if (load) out.push({ slug, item, Demo: lazy(load) });
  }
  return out;
}

/** A demo runs only while it is near the screen: thirty-odd animations, one of
 *  them WebGL, all at once would make a phone crawl. */
function Stage({ entry }: { entry: Entry }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const { Demo, item, slug } = entry;
  return (
    <section id={slug} className="min-w-0 scroll-mt-20">
      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-[15px] font-semibold text-neutral-100">{item.name}</h2>
        <span className="text-[11px] uppercase tracking-wider text-neutral-500">{CATEGORY_LABELS[item.category]}</span>
      </div>
      <div ref={ref} className="relative flex min-h-[460px] items-center justify-center overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950">
        {near ? (
          <Suspense fallback={<div className="text-sm text-neutral-600">…</div>}>
            <Fit><Demo /></Fit>
          </Suspense>
        ) : null}
      </div>
      {item.description && <p className="mt-3 px-1 text-[13px] leading-relaxed text-neutral-400">{item.description}</p>}
    </section>
  );
}

/** The demos are laid out for a desktop stage about 640 wide. On a phone the
 *  stage is narrower, so the demo is drawn at that width and zoomed down to
 *  fit, rather than cut off at the edges. */
const STAGE = 520;
function Fit({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setZoom(Math.min(1, e.contentRect.width / STAGE)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="w-full">
      <div className="flex items-center justify-center p-4" style={{ width: zoom < 1 ? STAGE : '100%', zoom }}>{children}</div>
    </div>
  );
}

function Gallery() {
  const list = useMemo(entries, []);
  const order = (e: Entry) => CATEGORY_ORDER.indexOf(e.item.category);
  const sorted = [...list].sort((a, b) => order(a) - order(b));
  return (
    <PreviewControlsProvider>
      <div className="min-h-screen overflow-x-hidden bg-black text-neutral-100">
        <header className="sticky top-0 z-50 border-b border-neutral-900 bg-black/80 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
            <img src="/rareui/logos/Rareui.svg" alt="" className="h-6 w-6" />
            <div className="flex-1">
              <div className="text-[15px] font-semibold">Rare UI in Divan</div>
              <div className="text-[12px] text-neutral-500">{sorted.length} components, straight from the repository</div>
            </div>
            <a href="https://rareui.com" target="_blank" rel="noreferrer" className="text-[12px] text-orange-500">rareui.com</a>
          </div>
          <nav className="no-scrollbar mx-auto flex max-w-5xl gap-2 overflow-x-auto px-5 pb-3">
            {sorted.map((e) => (
              <a key={e.slug} href={`#${e.slug}`} className="shrink-0 rounded-full border border-neutral-800 px-3 py-1 text-[12px] text-neutral-300 hover:bg-neutral-900">{e.item.name}</a>
            ))}
          </nav>
        </header>
        <main className="mx-auto grid max-w-5xl grid-cols-1 gap-12 px-4 py-8 md:grid-cols-2">
          {sorted.map((e) => <Stage key={e.slug} entry={e} />)}
        </main>
        <footer className="mx-auto max-w-5xl px-5 pb-12 text-[12px] text-neutral-500">
          Components by Swami Malode · <a className="text-orange-500" href="https://rareui.com">Rare UI</a> · MIT + Commons Clause + Attribution
        </footer>
      </div>
    </PreviewControlsProvider>
  );
}

document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')!).render(<Gallery />);
