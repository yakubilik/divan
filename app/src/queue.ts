import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useStore } from './store';
import { BADGE_POLL_MS, oldHost, POLL_MS, redCount, RUN_POLL_MS, wall, type Wall } from './tickets';
import { attach, silence, trim, turns, type RunSilence, type Turn } from './transcript';
import { DIVAN_POLL_MS, entries, merge, type DivanView } from './divan';
import type { DivanCardDetail, Ticket, UstabasiSnapshot } from './protocol';

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

  // Tied to focus rather than to being mounted: the wall stays mounted under an
  // opened ticket, and two screens polling the same queue is two requests every
  // eight seconds for one answer.
  useFocusEffect(useCallback(() => {
    reload();
    const timer = setInterval(reload, POLL_MS);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') reload(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [reload]));

  return { snapshot, tickets: snapshot?.tickets ?? [], error,
           state: wall({ online, snapshot, error, oldHost: old }) , reload };
}

/** The same queue, asked slowly, for the one line about it that is on a screen
 *  nobody opened the wall from: how many of its tickets stopped to ask.
 *
 *  Nothing else keeps that number honest. The queue is asked once on connect
 *  and then only by the wall, which is not open — so a ticket that went red an
 *  hour ago would sit behind an unbadged row until something reconnected. Asked
 *  again on the way back to the foreground, and slowly while the Dashboard is
 *  up: one local read a minute, against a ticket nobody would otherwise find
 *  out about for hours.
 *
 *  …and not at all on a computer that has already said it does not know the
 *  request: that answer cannot change without a restart, and a minute is a long
 *  time to keep asking a question already answered. */
export function useQueueBadge(): { available: boolean; red: number } {
  const conn = useStore((s) => s.conn);
  const snapshot = useStore((s) => s.ustabasi);
  const old = useStore((s) => s.ustabasiOld);
  const loadUstabasi = useStore((s) => s.loadUstabasi);

  useFocusEffect(useCallback(() => {
    if (conn !== 'online' || old) return;
    void loadUstabasi();
    const timer = setInterval(() => void loadUstabasi(), BADGE_POLL_MS);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void loadUstabasi(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [conn, old, loadUstabasi]));

  return {
    available: !!snapshot?.available,
    red: snapshot?.available ? redCount(snapshot.tickets) : 0,
  };
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

/** What the agent on a ticket is printing, kept up to date while the page is
 *  open.
 *
 *  The log is a file the run appends to, so this is a cursor and a timer: the
 *  first ask gets the end of it, every ask after that gets what has been
 *  written since, and the turns are appended to what is already on screen.
 *  Nothing of it is kept in the store — a run is a river, and what is worth
 *  holding is the part being read.
 *
 *  It stops asking when the run is over and there is nothing more to read.
 *  A finished run is a finished file: polling it is asking the same question
 *  of the same bytes every three seconds for as long as the page is open. */
export function useRun(ticketId: number): {
  turns: Turn[]; live: boolean; loading: boolean; silence: RunSilence; jumped: boolean;
} {
  const conn = useStore((s) => s.conn);
  const readRun = useStore((s) => s.readRun);
  const online = conn === 'online';

  const [list, setList] = useState<Turn[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [quiet, setQuiet] = useState<RunSilence>(null);
  const [jumped, setJumped] = useState(false);
  /** In a ref rather than in state: it changes on every poll and nothing draws
   *  it, so a render for it would be a render a second for nothing. */
  const cursor = useRef<string | null>(null);
  /** Where the turn numbering got to, which is not how many turns are on
   *  screen: a record can spend a number without drawing anything, and `trim`
   *  drops turns off the front of a long read. Counting what is drawn gave two
   *  turns the same key on the second page. */
  const numbered = useRef(0);
  const over = useRef(false);
  const busy = useRef(false);
  /** Whether anything has been read for this ticket yet. A page that starts
   *  again is an ordinary first open the first time and a jump every time
   *  after — the reader had fallen more than a page behind. */
  const opened = useRef(false);

  // A different ticket is a different run. Everything on screen belongs to the
  // one that was open, so it goes with it.
  useEffect(() => {
    cursor.current = null;
    numbered.current = 0;
    over.current = false;
    opened.current = false;
    setList([]);
    setJumped(false);
    setLoading(true);
  }, [ticketId]);

  const poll = useCallback(async () => {
    if (!online || busy.current || over.current || !Number.isFinite(ticketId)) return;
    busy.current = true;
    try {
      const page = await readRun(ticketId, cursor.current);
      cursor.current = page.cursor;
      setLive(!!page.live);
      setQuiet(page.available ? silence(page.reason) : 'noQueue');
      // A page that is not continuous with the last one — a first open, or a
      // reader moved up to the end because it had fallen a page behind —
      // replaces what is on screen rather than being appended to it.
      const fresh = !!page.reset;
      // Read outside the updater rather than inside it: numbering the page is
      // the one part of this that has to happen exactly once, and a state
      // updater is not promised that.
      if (fresh) numbered.current = 0;
      const { turns: more, answers, next } = turns(page.events || [], numbered.current);
      numbered.current = next;
      setList((had) => trim(attach([...(fresh ? [] : had), ...more], answers)));
      if (fresh && opened.current) setJumped(true);
      opened.current = true;
      // Nothing is going to be appended to a run that has ended, and the file
      // has been read to its end.
      if (!page.live && page.caught_up) over.current = true;
    } catch (e: any) {
      // A poll that failed against a run already on screen changes nothing: the
      // turns are still the turns, and replacing them with "the queue did not
      // answer" because one request in twenty dropped is the screen panicking.
      // A failure with nothing read yet is the only one worth a sentence.
      if (!opened.current) setQuiet(oldHost(e) ? 'oldHost' : 'offline');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [online, readRun, ticketId]);

  useFocusEffect(useCallback(() => {
    void poll();
    const timer = setInterval(() => { void poll(); }, RUN_POLL_MS);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void poll(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [poll]));

  return { turns: list, live, loading, silence: quiet, jumped };
}

/** One card, opened, kept up to date while the page is open: its brief, its
 *  ticket, and what the worker on it is printing as it prints it.
 *
 *  `useRun` above does the same job for a ticket on the computer this phone
 *  holds a socket to. A Divan card is not that: it is on whichever machine it is
 *  on, so everything here is asked of that machine by name (`store.readCard`),
 *  and the answer carries the card's two faces as well as the page of the run.
 *
 *  The cursor and the appending are `useRun`'s, because it is the same file
 *  being read — a page at a time, appended to what is on screen, the reader
 *  moved to the end where it has fallen more than a page behind.
 *
 *  Two things are its own. It slows down when nothing is running: three seconds
 *  is for a worker being watched, and a card nobody is working on is a minute's
 *  worth of gentle, like the dashboard. And it stamps every turn with the moment
 *  this phone first saw it — the run's log has no clock in it, so that stamp is
 *  the only honest time the live face can put beside a line, and the page that
 *  was already in the file when the screen opened gets none.
 *
 *  Nothing of it reaches the store: a brief belongs to the page reading it. */
export function useCard(card: string, host: string | null | undefined): {
  detail: DivanCardDetail | null; turns: Turn[]; stamps: Record<string, number>;
  live: boolean; loading: boolean; silence: RunSilence; jumped: boolean; error: string | null;
} {
  // The connection is a dependency rather than a gate: which socket carries the
  // request is the store's business (`onHost`), and this screen is about a card
  // on a named machine, not about the one the phone happens to hold. What `conn`
  // is for is the poll being made again the moment a connection comes back.
  const conn = useStore((s) => s.conn);
  const readCard = useStore((s) => s.readCard);

  const [detail, setDetail] = useState<DivanCardDetail | null>(null);
  const [list, setList] = useState<Turn[]>([]);
  const [stamps, setStamps] = useState<Record<string, number>>({});
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [quiet, setQuiet] = useState<RunSilence>(null);
  const [jumped, setJumped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<string | null>(null);
  const numbered = useRef(0);
  const busy = useRef(false);
  const opened = useRef(false);

  // A different card is a different run and a different brief.
  useEffect(() => {
    cursor.current = null;
    numbered.current = 0;
    opened.current = false;
    setDetail(null);
    setList([]);
    setStamps({});
    setJumped(false);
    setLoading(true);
  }, [card, host]);

  const poll = useCallback(async () => {
    if (busy.current || !card || !host) return;
    busy.current = true;
    try {
      const got = await readCard({ card, host, cursor: cursor.current });
      setDetail(got);
      setError(null);
      const page = got.run;
      setLive(!!page?.live);
      // No ticket on the card is not a silent queue: there is nothing running on
      // it and nothing to read, which is what `never_run` says.
      setQuiet(page ? (page.available ? silence(page.reason) : 'noQueue') : 'neverRun');
      if (page) {
        cursor.current = page.cursor;
        const fresh = !!page.reset;
        if (fresh) numbered.current = 0;
        const { turns: more, answers, next } = turns(page.events || [], numbered.current);
        numbered.current = next;
        // The first page is the tail of a file nobody was watching being
        // written; everything after it arrived while somebody was.
        if (opened.current && more.length) {
          const now = Date.now() / 1000;
          setStamps((had) => ({ ...had, ...Object.fromEntries(more.map((t) => [t.id, now])) }));
        }
        setList((had) => trim(attach([...(fresh ? [] : had), ...more], answers)));
        if (fresh && opened.current) setJumped(true);
      }
      opened.current = true;
    } catch (e: any) {
      // A poll that failed against a card already on screen changes nothing but
      // the line that says the machine is not answering: the brief is still the
      // brief and the run is still what was read of it.
      setError(e?.message ?? '');
      if (!opened.current) setQuiet(oldHost(e) ? 'oldHost' : 'offline');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [conn, readCard, card, host]);

  // A worker being watched is worth three seconds; a card nobody is working on
  // is worth a minute, which is what the boards themselves cost.
  const every = live ? RUN_POLL_MS : DIVAN_POLL_MS;
  useFocusEffect(useCallback(() => {
    void poll();
    const timer = setInterval(() => { void poll(); }, every);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void poll(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [poll, every]));

  return { detail, turns: list, stamps, live, loading, silence: quiet, jumped, error };
}

/** The Divan view of every paired computer, kept fresh while a screen is looking
 *  at it.
 *
 *  `useDivanView`, not `useDivan`: the design system already has one of those
 *  (`components/divan.tsx`) and it hands out tokens. A screen that reached for
 *  the wrong one would be asking for a palette and getting a fleet.
 *
 *  Same shape as `useQueue` above and for the same reason — nothing on the other
 *  end pushes, so the only way to know is to ask — with two differences that
 *  come out of there being several computers rather than one.
 *
 *  It is slower. A dashboard is a minute's worth of gentle: the board moves when
 *  a worker crosses a stage, which is minutes apart, and every tick is one
 *  request per machine rather than one in total. A laptop that is asleep is
 *  woken by each of them.
 *
 *  And it does not care which computer is active. The socket the phone holds
 *  decides where a terminal opens and whose screen is mirrored; a board is every
 *  machine at once, so this reads the paired list and the snapshots and nothing
 *  else. Switching computers leaves what is on screen exactly as it was.
 *
 *  `now` comes from the same slow clock the ticket screens age their lines with,
 *  which is what makes "unreachable · 2h 14m" go on being true while nobody
 *  asks anything. */
export function useDivanView(): DivanView & { reload: () => void } {
  const hosts = useStore((s) => s.hosts);
  const divan = useStore((s) => s.divan);
  const loadDivan = useStore((s) => s.loadDivan);
  const now = useNow();

  const reload = useCallback(() => { void loadDivan(); }, [loadDivan]);

  // Tied to focus rather than to being mounted: a dashboard stays mounted under
  // the project page opened from it, and two screens polling four machines is
  // eight requests for one answer.
  useFocusEffect(useCallback(() => {
    reload();
    const timer = setInterval(reload, DIVAN_POLL_MS);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') reload(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [reload]));

  // The clock the merge aged the machines against comes back on the view itself
  // (`DivanView.now`): a screen that asked for its own would be a second timer
  // ticking at a second's offset, and two answers to "how long has mini been
  // quiet" on one page.
  const view = useMemo(() => merge(entries(hosts, divan), now), [hosts, divan, now]);
  return { ...view, reload };
}
