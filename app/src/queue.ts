import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useStore } from './store';
import { POLL_MS, wall, type Wall } from './tickets';
import type { Ticket, UstabasiSnapshot } from './protocol';

/** The ustabasi queue, kept fresh for as long as a screen is looking at it.
 *
 *  The queue is somebody else's program and sends this app nothing: no event, no
 *  push, no socket of its own. The only way to know a ticket went red is to ask,
 *  so the two screens that draw it ask on a timer — the same eight seconds the
 *  desktop panel uses — and again whenever the phone comes back to the
 *  foreground, which is the moment the answer is most likely to be stale and the
 *  one where a timer that has been asleep in the background cannot help. */
export function useQueue(): {
  snapshot: UstabasiSnapshot | null; tickets: Ticket[]; state: Wall; error: string | null; reload: () => void;
} {
  const conn = useStore((s) => s.conn);
  const snapshot = useStore((s) => s.ustabasi);
  const error = useStore((s) => s.ustabasiError);
  const old = useStore((s) => s.ustabasiOld);
  const loadUstabasi = useStore((s) => s.loadUstabasi);
  const online = conn === 'online';

  const reload = useCallback(() => { if (online) void loadUstabasi(); }, [online, loadUstabasi]);

  useFocusEffect(reload);
  useEffect(() => {
    reload();
    const timer = setInterval(reload, POLL_MS);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') reload(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [reload]);

  return { snapshot, tickets: snapshot?.tickets ?? [], error,
           state: wall({ online, snapshot, error, oldHost: old }) , reload };
}

/** A clock for the "twelve minutes in this state" lines, in seconds. Nothing
 *  else on these screens moves on its own, so it ticks slowly: the numbers it
 *  feeds are minutes and hours. */
export function useNow(everyMs = 5000): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
