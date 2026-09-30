/** Watching a worker, from the panel.
 *
 *  A ticket that has been running for three hours read exactly like one that
 *  had been running for three minutes: the wall said `running`, the
 *  conversation said what the queue had written down, and what the agent was
 *  actually doing — every sentence, every tool call — was in a file on the
 *  computer and nowhere on screen. The phone got this first
 *  (`app/src/queue.ts`, `useRun`); this is the same reading on this end.
 *
 *  Asking is all that is here. What a page of records *means* is
 *  `lib/transcript.ts`, which is the phone's own module, and what it looks like
 *  is the screen's business (`components/RunLog.tsx`).
 *
 *  Three things it has to get right, and each of them was a bug on the phone
 *  first: a poll that overlaps itself reads the same page twice, a page that is
 *  not continuous with the last one has to replace what is on screen rather
 *  than be appended to it, and a run that has ended and been read to the end is
 *  not worth asking about again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { readRun } from './actions';
import { useFleet } from './fleet';
import { attach, silence, trim, turns, type RunSilence, type Turn } from './transcript';

/** How often a run is asked for while its window is open. The daemon answers a
 *  poll that finds nothing new in two hundred bytes, and a worker that is
 *  thinking writes nothing for ten seconds at a time. */
export const RUN_POLL_MS = 2500;

export interface RunRead {
  turns: Turn[];
  /** The pictures this run left — the finished state of whatever screen it
   *  changed. Kept beside the turns rather than in them: a screenshot is not
   *  something the model said, it is something the work produced. */
  shots: { path: string; name: string; at: number; size: number }[];
  /** the file is still being written to */
  live: boolean;
  /** nothing has been read yet */
  loading: boolean;
  /** why there is nothing to show, in the words of the thing that is missing */
  silence: RunSilence;
  /** the reader had fallen more than a page behind and was moved to the end */
  jumped: boolean;
}

const EMPTY: RunRead = {
  turns: [], shots: [], live: false, loading: false, silence: null, jumped: false,
};

export function useRun(hostKey: string | null, ticketId: number | null): RunRead {
  const status = useFleet((s) => (hostKey ? s.hosts[hostKey]?.status : null));
  const online = status === 'online';

  const [list, setList] = useState<Turn[]>([]);
  const [shots, setShots] = useState<RunRead['shots']>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [quiet, setQuiet] = useState<RunSilence>(null);
  const [jumped, setJumped] = useState(false);
  /** In a ref rather than in state: it changes on every poll and nothing draws
   *  it, so a render for it would be a render every two seconds for nothing. */
  const cursor = useRef<string | null>(null);
  /** Where the turn numbering got to, which is not how many turns are on
   *  screen: a record can spend a number without drawing anything, and `trim`
   *  drops turns off the front of a long read. */
  const numbered = useRef(0);
  const over = useRef(false);
  const busy = useRef(false);
  const opened = useRef(false);

  // A different ticket is a different run. Everything on screen belongs to the
  // one that was open, so it goes with it.
  useEffect(() => {
    cursor.current = null;
    numbered.current = 0;
    over.current = false;
    opened.current = false;
    setList([]);
    setShots([]);
    setJumped(false);
    setLoading(true);
  }, [hostKey, ticketId]);

  const poll = useCallback(async () => {
    if (!online || !hostKey || ticketId == null) return;
    if (busy.current || over.current || !Number.isFinite(ticketId)) return;
    busy.current = true;
    try {
      const page = await readRun(hostKey, ticketId, cursor.current);
      cursor.current = page.cursor;
      setLive(!!page.live);
      setShots(page.shots ?? []);
      setQuiet(page.available ? silence(page.reason) : 'noQueue');
      // A page that is not continuous with the last one — a first open, or a
      // reader moved up to the end because it had fallen a page behind —
      // replaces what is on screen rather than being appended to it.
      const fresh = !!page.reset;
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
      if (!opened.current) {
        setQuiet(/unknown type|no such type/i.test(String(e?.message ?? '')) ? 'oldHost' : 'offline');
      }
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [online, hostKey, ticketId]);

  useEffect(() => {
    if (ticketId == null) return;
    void poll();
    const timer = setInterval(() => { void poll(); }, RUN_POLL_MS);
    return () => clearInterval(timer);
  }, [poll, ticketId]);

  if (ticketId == null) return EMPTY;
  return { turns: list, shots, live, loading, silence: quiet, jumped };
}
