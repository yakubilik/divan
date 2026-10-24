/** The order the computers' headings stand in on the All computers list.
 *
 *  Pairing order (`useFleet().order`) is what a list starts in; dragging one
 *  computer's heading above or below another's is remembered in this browser,
 *  and only here — the phone and other browsers keep their own. Kept apart
 *  from `chat-list.ts`, which is shared byte for byte with the app.
 *
 *  The machine card above the list (`HostCard`) stays in pairing order on
 *  purpose: it is where a computer is picked, and it should not move under a
 *  finger because a heading further down was dragged. */

export const FLEET_ORDER_KEY = 'rac.fleetOrder';

/** The computers in the order this browser saved, as far as they are still
 *  paired: one saved and since removed is skipped, and one paired since is
 *  put at the end, in pairing order. */
export function fleetOrder(order: string[], saved: string[]): string[] {
  const paired = new Set(order);
  const kept = saved.filter((k, i) => paired.has(k) && saved.indexOf(k) === i);
  return [...kept, ...order.filter((k) => !kept.includes(k))];
}

/** `key` moved to just above `to`, or just below it with `after`. Anything it
 *  does not know leaves the order as it was. */
export function moveHost(order: string[], key: string, to: string, after: boolean): string[] {
  if (key === to || !order.includes(key) || !order.includes(to)) return order;
  const rest = order.filter((k) => k !== key);
  rest.splice(rest.indexOf(to) + (after ? 1 : 0), 0, key);
  return rest;
}

export function savedFleetOrder(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FLEET_ORDER_KEY) || '[]');
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
  } catch { return []; }
}

export function saveFleetOrder(order: string[]): void {
  try { localStorage.setItem(FLEET_ORDER_KEY, JSON.stringify(order)); } catch { /* private mode: until reload */ }
}
