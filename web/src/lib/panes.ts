/** The Panes screen's layout: several chats open at once, tiled like a
 *  terminal's split panes.
 *
 *  The layout is a tree. A leaf is one chat's pane; a split lays its children
 *  side by side (`row`) or one above the other (`col`), each with a share of
 *  the split's extent (`sizes`, adding up to 1). Every operation here is pure —
 *  it takes a tree and hands back a new one — so `scripts/test-panes.mjs` can
 *  hold it to its word without a browser, and the screen (`screens/Panes.tsx`)
 *  is only the drawing and the pointer.
 *
 *  Nothing here has a pane limit. What it has is a minimum size per pane in
 *  pixels (`MIN_W`, `MIN_H`): a divider stops before either side of it would
 *  go under, and every change ends in `settle`, which tops up a pane that has
 *  fallen under its minimum from the siblings that have room to spare.
 *
 *  The layout lives in this browser (`rac.panes`), like the sidebar's own
 *  preferences: a reload, or the `/panes` address opened cold, draws it again.
 */
import { create } from 'zustand';

export type Edge = 'left' | 'right' | 'top' | 'bottom';
export type Dir = 'row' | 'col';

export interface PaneLeaf { kind: 'pane'; id: string; host: string; chat: string }
export interface PaneSplit { kind: 'split'; dir: Dir; kids: PaneNode[]; sizes: number[] }
export type PaneNode = PaneLeaf | PaneSplit;

/** Where something is put down: beside one pane, on one of its edges — or,
 *  with no `target`, along an edge of the whole screen. */
export interface Drop { target: string | null; edge: Edge }

/** A rectangle in fractions of the Panes area (0..1). */
export interface Box { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }

/** The smallest a pane is let go, in CSS pixels: room for the window's head,
 *  a couple of lines of conversation and its composer. */
export const MIN_W = 240;
export const MIN_H = 200;
/** How close to the screen's own edge a drop has to be to be about the whole
 *  screen rather than about the pane under it. */
export const OUTER = 28;

export const paneId = (host: string, chat: string): string => `${host}:${chat}`;
export const leaf = (host: string, chat: string): PaneLeaf => ({ kind: 'pane', id: paneId(host, chat), host, chat });

const dirOf = (e: Edge): Dir => (e === 'left' || e === 'right' ? 'row' : 'col');
const first = (e: Edge): boolean => e === 'left' || e === 'top';

/** Every pane, in reading order. */
export function leaves(node: PaneNode | null): PaneLeaf[] {
  if (!node) return [];
  return node.kind === 'pane' ? [node] : node.kids.flatMap(leaves);
}

export function has(node: PaneNode | null, id: string): boolean {
  return leaves(node).some((l) => l.id === id);
}

// ── geometry ────────────────────────────────────────────────────────────────

/** A line between two children of a split: `path` is the split, `i` the
 *  child before it. `at` is the line itself — zero wide in a row, zero tall in
 *  a column. */
export interface Divider { key: string; path: number[]; i: number; dir: Dir; at: Box }

export interface Boxes {
  panes: Record<string, Box>;
  splits: Record<string, Box>;
  dividers: Divider[];
}

export function boxes(root: PaneNode | null): Boxes {
  const out: Boxes = { panes: {}, splits: {}, dividers: [] };
  const walk = (node: PaneNode, box: Box, path: number[]) => {
    if (node.kind === 'pane') { out.panes[node.id] = box; return; }
    out.splits[path.join('.')] = box;
    let off = 0;
    node.kids.forEach((kid, k) => {
      const s = node.sizes[k];
      const at: Box = node.dir === 'row'
        ? { x: box.x + off * box.w, y: box.y, w: s * box.w, h: box.h }
        : { x: box.x, y: box.y + off * box.h, w: box.w, h: s * box.h };
      walk(kid, at, [...path, k]);
      off += s;
      if (k < node.kids.length - 1) {
        out.dividers.push({
          key: `${path.join('.')}:${k}`, path, i: k, dir: node.dir,
          at: node.dir === 'row'
            ? { x: box.x + off * box.w, y: box.y, w: 0, h: box.h }
            : { x: box.x, y: box.y + off * box.h, w: box.w, h: 0 },
        });
      }
    });
  };
  if (root) walk(root, { x: 0, y: 0, w: 1, h: 1 }, []);
  return out;
}

/** The least a subtree can be squeezed to along `dir`, in pixels. */
export function minExtent(node: PaneNode, dir: Dir): number {
  const one = dir === 'row' ? MIN_W : MIN_H;
  if (node.kind === 'pane') return one;
  const each = node.kids.map((k) => minExtent(k, dir));
  return node.dir === dir ? each.reduce((a, b) => a + b, 0) : Math.max(...each);
}

// ── tree surgery ────────────────────────────────────────────────────────────

const norm = (sizes: number[]): number[] => {
  const sum = sizes.reduce((a, b) => a + b, 0);
  return sum > 0 ? sizes.map((s) => s / sum) : sizes.map(() => 1 / sizes.length);
};

/** A split with one child is that child, and a child split the same way as
 *  its parent is folded into it: the tree stays the shape it looks like. */
function tidy(node: PaneNode): PaneNode {
  if (node.kind === 'pane') return node;
  const kids: PaneNode[] = [];
  const sizes: number[] = [];
  node.kids.forEach((raw, k) => {
    const kid = tidy(raw);
    if (kid.kind === 'split' && kid.dir === node.dir) {
      kid.kids.forEach((g, j) => { kids.push(g); sizes.push(kid.sizes[j] * node.sizes[k]); });
    } else { kids.push(kid); sizes.push(node.sizes[k]); }
  });
  if (kids.length === 1) return kids[0];
  return { kind: 'split', dir: node.dir, kids, sizes: norm(sizes) };
}

/** The node at `path`, replaced by what `fn` makes of it. */
function at(node: PaneNode, path: number[], fn: (n: PaneNode) => PaneNode): PaneNode {
  if (!path.length) return fn(node);
  if (node.kind !== 'split') return node;
  const [k, ...rest] = path;
  return { ...node, kids: node.kids.map((kid, j) => (j === k ? at(kid, rest, fn) : kid)) };
}

function pathOf(node: PaneNode, id: string, path: number[] = []): number[] | null {
  if (node.kind === 'pane') return node.id === id ? path : null;
  for (let k = 0; k < node.kids.length; k++) {
    const p = pathOf(node.kids[k], id, [...path, k]);
    if (p) return p;
  }
  return null;
}

function nodeAt(node: PaneNode, path: number[]): PaneNode | null {
  let n: PaneNode = node;
  for (const k of path) { if (n.kind !== 'split' || !n.kids[k]) return null; n = n.kids[k]; }
  return n;
}

/** Where a pane goes when nobody said: beside the biggest pane on screen,
 *  along its longer side — which is how two panes become a pair, four a 2×2
 *  grid, and how a full screen makes room without anybody arranging it. */
export function autoDrop(root: PaneNode | null, area: Size): Drop {
  const b = boxes(root).panes;
  let best: string | null = null;
  let most = -1;
  for (const l of leaves(root)) {
    const r = b[l.id];
    const px = r.w * area.w * r.h * area.h;
    if (px > most + 1e-6) { most = px; best = l.id; }
  }
  if (!best) return { target: null, edge: 'right' };
  const r = b[best];
  return { target: best, edge: r.w * area.w >= r.h * area.h ? 'right' : 'bottom' };
}

/** A pane put into the layout: beside a pane, splitting it in two along that
 *  edge; along an edge of the whole screen, with every other pane giving up
 *  its share; or, with no drop, wherever `autoDrop` says. */
export function insert(root: PaneNode | null, add: PaneLeaf, drop: Drop | null, area: Size): PaneNode {
  if (has(root, add.id)) return root!;
  if (!root) return add;
  const d = drop ?? autoDrop(root, area);
  const dir = dirOf(d.edge);
  let next: PaneNode;
  if (!d.target || !has(root, d.target)) {
    if (root.kind === 'split' && root.dir === dir) {
      const n = root.kids.length;
      const sizes = root.sizes.map((s) => (s * n) / (n + 1));
      next = first(d.edge)
        ? { ...root, kids: [add, ...root.kids], sizes: [1 / (n + 1), ...sizes] }
        : { ...root, kids: [...root.kids, add], sizes: [...sizes, 1 / (n + 1)] };
    } else {
      next = { kind: 'split', dir, kids: first(d.edge) ? [add, root] : [root, add], sizes: [0.5, 0.5] };
    }
  } else {
    const path = pathOf(root, d.target)!;
    const parentPath = path.slice(0, -1);
    const parent = path.length ? nodeAt(root, parentPath) : null;
    if (parent && parent.kind === 'split' && parent.dir === dir) {
      const k = path[path.length - 1];
      next = at(root, parentPath, (p) => {
        const s = p as PaneSplit;
        const kids = [...s.kids];
        const sizes = [...s.sizes];
        const half = sizes[k] / 2;
        sizes[k] = half;
        const where = first(d.edge) ? k : k + 1;
        kids.splice(where, 0, add);
        sizes.splice(where, 0, half);
        return { ...s, kids, sizes };
      });
    } else {
      next = at(root, path, (target) => ({
        kind: 'split', dir, kids: first(d.edge) ? [add, target] : [target, add], sizes: [0.5, 0.5],
      }));
    }
  }
  return settle(tidy(next), area);
}

/** A pane taken out. Its share goes to the neighbour before it — or, for the
 *  first child, the one after it — so the rest of the screen does not move. */
export function remove(root: PaneNode | null, id: string, area?: Size): PaneNode | null {
  if (!root) return null;
  if (root.kind === 'pane') return root.id === id ? null : root;
  const path = pathOf(root, id);
  if (!path) return root;
  const parentPath = path.slice(0, -1);
  const k = path[path.length - 1];
  const next = at(root, parentPath, (p) => {
    const s = p as PaneSplit;
    const kids = s.kids.filter((_, j) => j !== k);
    const sizes = s.sizes.filter((_, j) => j !== k);
    sizes[k > 0 ? k - 1 : 0] += s.sizes[k];
    return { ...s, kids, sizes };
  });
  const out = tidy(next);
  return area ? settle(out, area) : out;
}

/** A pane picked up and put down somewhere else: the same pane — the same
 *  chat, nothing reloaded — and everything else closes up behind it. */
export function move(root: PaneNode | null, id: string, drop: Drop, area: Size): PaneNode | null {
  if (!root || drop.target === id || !has(root, id)) return root;
  const pane = leaves(root).find((l) => l.id === id)!;
  const rest = remove(root, id);
  if (!rest) return root;
  return insert(rest, pane, drop, area);
}

/** A divider pulled `delta` pixels along its split: only the two children on
 *  either side of it change, and neither goes under its minimum. */
export function drag(root: PaneNode, div: { path: number[]; i: number }, delta: number, area: Size): PaneNode {
  const split = nodeAt(root, div.path);
  if (!split || split.kind !== 'split') return root;
  const box = boxes(root).splits[div.path.join('.')];
  if (!box) return root;
  const extent = split.dir === 'row' ? box.w * area.w : box.h * area.h;
  if (extent <= 0) return root;
  const a = split.sizes[div.i];
  const b = split.sizes[div.i + 1];
  const lo = minExtent(split.kids[div.i], split.dir) / extent;
  const hi = a + b - minExtent(split.kids[div.i + 1], split.dir) / extent;
  if (lo > hi) return root;
  const want = Math.min(hi, Math.max(lo, a + delta / extent));
  if (Math.abs(want - a) < 1e-9) return root;
  const next = at(root, div.path, (p) => {
    const s = p as PaneSplit;
    const sizes = [...s.sizes];
    sizes[div.i] = want;
    sizes[div.i + 1] = a + b - want;
    return { ...s, sizes };
  });
  return settle(next, area);
}

/** Every split given a second look at the size it is actually drawn at: a
 *  child under its minimum is topped up from the siblings over theirs. Where
 *  there is not room for every minimum the shares follow the minimums, so a
 *  crowded screen is crowded evenly rather than one pane being crushed. */
export function settle(root: PaneNode, area: Size): PaneNode {
  const walk = (node: PaneNode, w: number, h: number): PaneNode => {
    if (node.kind === 'pane') return node;
    const extent = node.dir === 'row' ? w : h;
    const mins = node.kids.map((k) => minExtent(k, node.dir) / Math.max(extent, 1));
    const need = mins.reduce((a, b) => a + b, 0);
    let sizes = [...node.sizes];
    if (need >= 1) sizes = norm(mins);
    else {
      const short = sizes.reduce((t, s, k) => t + Math.max(0, mins[k] - s), 0);
      if (short > 1e-9) {
        const spare = sizes.reduce((t, s, k) => t + Math.max(0, s - mins[k]), 0);
        sizes = sizes.map((s, k) => (s < mins[k] ? mins[k] : s - ((s - mins[k]) / spare) * short));
      }
    }
    const kids = node.kids.map((kid, k) => (node.dir === 'row'
      ? walk(kid, w * sizes[k], h) : walk(kid, w, h * sizes[k])));
    return { ...node, kids, sizes };
  };
  return walk(root, area.w, area.h);
}

// ── where a drop lands ──────────────────────────────────────────────────────

/** What a pointer over the Panes area would drop onto, and the rectangle the
 *  screen lights up to say so. Near the area's own edge it is the whole
 *  screen's edge; over a pane it is that pane's nearest edge; over nothing at
 *  all it is the whole area. `point` is in pixels from the area's top left. */
export function dropAt(root: PaneNode | null, point: { x: number; y: number }, area: Size,
                       moving?: string | null): { drop: Drop; hint: Box } | null {
  if (!root) return { drop: { target: null, edge: 'right' }, hint: { x: 0, y: 0, w: 1, h: 1 } };
  const fx = point.x / area.w;
  const fy = point.y / area.h;
  const outer: [Edge, number][] = [
    ['left', point.x], ['right', area.w - point.x], ['top', point.y], ['bottom', area.h - point.y],
  ];
  const [oe, od] = outer.reduce((m, e) => (e[1] < m[1] ? e : m));
  if (od <= OUTER && leaves(root).length > (moving ? 1 : 0)) {
    return { drop: { target: null, edge: oe }, hint: half({ x: 0, y: 0, w: 1, h: 1 }, oe, 1 / 3) };
  }
  const b = boxes(root).panes;
  const hit = Object.entries(b).find(([, r]) => fx >= r.x && fx <= r.x + r.w && fy >= r.y && fy <= r.y + r.h);
  if (!hit) return null;
  const [id, r] = hit;
  if (id === moving) return null;
  const px = { l: (fx - r.x) * area.w, r: (r.x + r.w - fx) * area.w, t: (fy - r.y) * area.h, b: (r.y + r.h - fy) * area.h };
  // Measured against the pane's own proportions, so a wide pane is not all
  // "top" and "bottom" because its sides are far away.
  const rel: [Edge, number][] = [
    ['left', px.l / (r.w * area.w)], ['right', px.r / (r.w * area.w)],
    ['top', px.t / (r.h * area.h)], ['bottom', px.b / (r.h * area.h)],
  ];
  const [edge] = rel.reduce((m, e) => (e[1] < m[1] ? e : m));
  return { drop: { target: id, edge }, hint: half(r, edge, 1 / 2) };
}

function half(r: Box, edge: Edge, part: number): Box {
  if (edge === 'left') return { ...r, w: r.w * part };
  if (edge === 'right') return { ...r, x: r.x + r.w * (1 - part), w: r.w * part };
  if (edge === 'top') return { ...r, h: r.h * part };
  return { ...r, y: r.y + r.h * (1 - part), h: r.h * part };
}

// ── kept in this browser ────────────────────────────────────────────────────

export interface Layout {
  root: PaneNode | null;
  /** The pane filling the whole area, if one is. The tree under it is left
   *  exactly as it was, which is what makes restore put it all back. */
  max: string | null;
}

export const PANES_KEY = 'rac.panes';
export const EMPTY_LAYOUT: Layout = { root: null, max: null };

/** A saved layout read back, as far as it is one: anything malformed is no
 *  layout rather than a screen that throws. */
export function readLayout(raw: unknown): Layout {
  // The same chat twice is one pane, the first one.
  const seen = new Set<string>();
  const node = (v: any, depth = 0): PaneNode | null => {
    if (!v || typeof v !== 'object' || depth > 32) return null;
    if (v.kind === 'pane') {
      if (typeof v.host !== 'string' || typeof v.chat !== 'string' || !v.host || !v.chat) return null;
      const l = leaf(v.host, v.chat);
      if (seen.has(l.id)) return null;
      seen.add(l.id);
      return l;
    }
    if (v.kind === 'split' && (v.dir === 'row' || v.dir === 'col') && Array.isArray(v.kids)) {
      const kids: PaneNode[] = [];
      const sizes: number[] = [];
      v.kids.forEach((k: unknown, i: number) => {
        const n = node(k, depth + 1);
        const s = Number(Array.isArray(v.sizes) ? v.sizes[i] : NaN);
        if (n) { kids.push(n); sizes.push(Number.isFinite(s) && s > 0 ? s : 1); }
      });
      if (!kids.length) return null;
      return tidy({ kind: 'split', dir: v.dir, kids, sizes: norm(sizes) });
    }
    return null;
  };
  const v: any = raw;
  const root = v && typeof v === 'object' ? node(v.root) : null;
  const max = typeof v?.max === 'string' && has(root, v.max) ? v.max : null;
  return { root, max };
}

function loadLayout(): Layout {
  try { return readLayout(JSON.parse(localStorage.getItem(PANES_KEY) || 'null')); } catch { return EMPTY_LAYOUT; }
}

function saveLayout(l: Layout): void {
  try { localStorage.setItem(PANES_KEY, JSON.stringify(l)); } catch { /* private mode: until reload */ }
}

interface PanesState extends Layout {
  /** The size the Panes area was last drawn at, for the choices that depend
   *  on it (`autoDrop`, `settle`) when they are made from outside the screen. */
  area: Size;
  setArea: (area: Size) => void;
  /** A chat opened as a pane — or, already open, moved to `drop`. */
  open: (host: string, chat: string, drop?: Drop | null) => void;
  move: (id: string, drop: Drop) => void;
  close: (id: string) => void;
  /** A finished divider drag. */
  resize: (root: PaneNode) => void;
  maximise: (id: string | null) => void;
  /** Read the saved layout again (a cold open, a test's reload). */
  reload: () => void;
}

export const usePanes = create<PanesState>((set, get) => {
  const commit = (next: Partial<Layout>) => {
    set(next);
    const { root, max } = get();
    saveLayout({ root, max });
  };
  return {
    ...loadLayout(),
    area: { w: 1100, h: 800 },
    setArea: (area) => {
      const was = get().area;
      if (Math.abs(was.w - area.w) < 1 && Math.abs(was.h - area.h) < 1) return;
      set({ area });
    },
    open: (host, chat, drop = null) => {
      const { root, area } = get();
      const id = paneId(host, chat);
      if (has(root, id)) {
        if (drop) commit({ root: move(root, id, drop, area), max: null });
        return;
      }
      commit({ root: insert(root, leaf(host, chat), drop, area), max: null });
    },
    move: (id, drop) => {
      const { root, area } = get();
      commit({ root: move(root, id, drop, area), max: null });
    },
    close: (id) => {
      const { root, area, max } = get();
      commit({ root: remove(root, id, area), max: max === id ? null : max });
    },
    resize: (root) => commit({ root }),
    maximise: (id) => commit({ max: id && has(get().root, id) ? id : null }),
    reload: () => set(loadLayout()),
  };
});
