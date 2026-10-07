/** The Dashboard place: every product on every machine, what is running on them,
 *  and — as conversations rather than as a list — whatever needs a person.
 *
 *  Web12 W1 and Web13 W3 are this page in the two themes, and the theme is the
 *  whole of what differs between them. Top down, both frames: the head with a
 *  mono aside saying how much of what is below is true, four counters, then the
 *  products two abreast on the left and the agent roster on the right, with the
 *  command bar across the bottom and the questions open over the corner.
 *
 *  Scoped to one product it is that product's page instead (HANDOVER §4.2,
 *  §4.3, §4.5): the head from `screens/Project.tsx` over the Overview, the
 *  Board or the Chats, or the New ticket form — each at its own path. A card's
 *  page and a branch's page keep their own heads until their own step.
 *
 *  Three things are true of everything on it:
 *
 *  **Nothing here is invented.** Every counter is counted, every project card
 *  carries the two figures that exist for a product today — what its board says
 *  and what git says about its repositories — and the third figure the frames put
 *  at the top of a card, what the product earns, has no source connected and so
 *  is not drawn at all. The frames draw a fourteen-bar sparkline beside that
 *  figure; nothing carries a day-by-day history, so the panel draws the two
 *  numbers it has and no chart of numbers it does not. A gap is honest; a
 *  placeholder is not.
 *
 *  **A machine that has gone quiet is said out loud.** Its cards still count
 *  towards what a person has to do, because a ticket that stopped to ask does not
 *  answer itself while a laptop is shut. What its *agents* are doing cannot be
 *  known, so that is a counter of its own, the head says how old the page is, and
 *  the products that live there say when they were last seen.
 *
 *  **The judgements are not in here.** Which the fourth counter is, what a
 *  product's corner says, which questions open as windows — all of it is
 *  `lib/overview.ts` and `lib/sessions.ts`, held to the phone's own answers by
 *  `scripts/test-overview.mjs`, because a panel and a phone that disagreed about
 *  how many things need you would be two products. What is left here is the
 *  arrangement.
 *
 *  Three states it has to survive, and all three are drawn rather than guarded
 *  against: no machine has answered yet, a machine answered and has since gone
 *  quiet, and a machine that cannot be reached at all.
 */
import { useState } from 'react';
import { RADIUS, SHADOW, SIZE, T } from '../lib/theme';
import { branchOf } from '../lib/project';
import { idOf } from '../lib/sessions';
import type { DivanView, MergedCard, MergedProject } from '../lib/divan';
import { CommandBar, EmptyState } from '../ui/divan';
import { mono } from '../ui/kit';
import { Sessions } from '../components/Sessions';
import { MicButton, useMic } from '../components/Mic';
import { appendSpeech } from '../lib/dictate';
import { useFleet } from '../lib/fleet';
import { Board } from './Board';
import { Branch } from './Branch';
import { Branches } from './Branches';
import { Project, ProjectHead } from './Project';
import { NewTicket } from './NewTicket';
import { Ticket } from './Ticket';
import { Dashboard } from './Dashboard';

/** Where inside a product the page is: the three views of the segment, the
 *  branches with their repositories (reached from the Branches section), and a
 *  new ticket being written. Each is a path of its own (`lib/nav.ts`). */
export type ProjectTab = 'overview' | 'board' | 'chat' | 'branches' | 'new';

export interface OverviewProps {
  view: DivanView;
  /** The product the bar is scoped to, or null for all of them. */
  project: MergedProject | null;
  onProject: (key: string | null) => void;
  /** What the command bar across the bottom does with a sentence: start a chat
   *  on the computer in focus and say it there (`lib/tell.ts`). The page does
   *  not move — the chat opens as a window on this one — so the bar is a
   *  composer and not a way out of the Dashboard. */
  onAsk?: (text: string) => Promise<unknown> | unknown;
  /** What the bar will do that is not the obvious thing — the folder a chat
   *  would open in on a page about one product. Said over the bar, because a
   *  chat that opens somewhere you did not expect is worse than one you had to
   *  point at a folder. */
  askNote?: string | null;
  /** Which tab of a scoped product is open. Held above this screen, beside the
   *  product it belongs to, so that scoping to another product lands on its
   *  Overview rather than on whichever tab the last one was left on. */
  tab?: ProjectTab;
  onTab?: (tab: ProjectTab) => void;
  /** Which face of the product is open (Web14 W7), by kind, and which card
   *  (Web14 W8), by `host:id`. Both are held above this screen beside the
   *  product, for the same reason the tab is: they are places inside one
   *  product, and choosing another product leaves them. */
  branch?: string | null;
  onBranch?: (kind: string | null) => void;
  card?: string | null;
  onCard?: (id: string | null) => void;
  /** The product's chats: how many are part of today, and the list and the
   *  chat themselves. Handed in whole, because the chat is the Chat place's own
   *  surface and its handlers live above both. */
  chats?: { count: number; pane: React.ReactNode } | null;
  /** The Composer the unscoped page is built round (HANDOVER §4.1). */
  composer?: React.ReactNode;
  /** A waiting card's Open: its own page, inside its product. */
  onOpenCard?: (card: MergedCard) => void;
  /** The Composer at the foot of a product's page, locked to that product. */
  projectComposer?: React.ReactNode;
}

export function Overview({
  view, project, onProject, onAsk, askNote, tab, onTab, branch, onBranch, card, onCard, chats,
  composer, onOpenCard, projectComposer,
}: OverviewProps) {
  const here: ProjectTab = tab ?? 'overview';
  // The two pages inside a product that have a head of their own. A key that is
  // no longer in the view — a card that has been finished, a machine that has
  // been unpaired — leaves the product's own page rather than a blank one.
  // By the card's own id as well as by `host:id`, because those are the two
  // things that can be in hand: a press on the board hands over the merged key,
  // and an address hands over the id alone (`/p/babysee/c/0d2279020af7` — the
  // card is named by what it is, not by which computer this browser reaches it
  // through). Matching only the first is why a reload of a card's page landed
  // on the board instead of the card.
  const open = project && card
    ? view.cards.find((c) => idOf(c) === card || c.id === card) ?? null
    : null;
  const face = project && !open ? branchOf(project, branch ?? null) : null;
  const deep = !!open || !!face;
  if (!project) {
    return (
      <Dashboard view={view} onProject={onProject} composer={composer}
        onCard={(c) => (onOpenCard ? onOpenCard(c) : onProject(c.projectKey))}
        empty={<Nothing view={view} />} />
    );
  }

  if (deep) {
    // A card's page and a branch's page keep their own heads and the bar under
    // them until their own step of the redesign.
    return (
      <div style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20,
        padding: `24px 32px ${BAR_ROW + 12}px`, background: T.bg, overflowY: 'auto',
      }}>
        {!!open && (
          <Ticket
            card={open} project={project} index={view.projects.indexOf(project)} now={view.now}
            onProject={() => { onCard?.(null); onBranch?.(null); }}
            onBranch={(kind) => { onCard?.(null); onBranch?.(kind); }}
          />
        )}
        {!open && !!face && (
          <Branch
            project={project} branch={face} index={view.projects.indexOf(project)} now={view.now}
            onProject={() => onBranch?.(null)}
            onCard={(c: MergedCard) => onCard?.(idOf(c))}
          />
        )}
        {!!onAsk && <Bar onAsk={onAsk} note={askNote ?? null} />}
        <Sessions view={view} />
      </div>
    );
  }

  const to = (key: string) => onTab?.(key as ProjectTab);
  const writeNew = () => onTab?.('new');
  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      <div className={`dv-page${here === 'board' ? ' dv-page--wide' : ''}`}>
        {here !== 'new' && (
          <ProjectHead project={project} now={view.now} tab={here} onTab={to} onNew={writeNew}
            compact={here !== 'overview'} />
        )}
        {here === 'overview' && (
          <Project view={view} project={project}
            onCard={(c) => onCard?.(idOf(c))}
            onBoard={() => to('board')}
            onBranch={(kind) => onBranch?.(kind)}
            onBranches={() => to('branches')}
            composer={projectComposer} />
        )}
        {here === 'board' && (
          <>
            <Board view={view} project={project} onNew={writeNew}
              onCard={(t) => onCard?.(idOf(t.card))} />
            {!!projectComposer && <div style={{ marginTop: 32 }}>{projectComposer}</div>}
          </>
        )}
        {here === 'branches' && (
          <div style={{ marginTop: 32 }}>
            <Branches project={project} now={view.now} onBranch={(kind) => onBranch?.(kind)} />
          </div>
        )}
        {here === 'chat' && (
          <div style={{
            marginTop: 24, height: 'calc(100vh - 220px)', minHeight: 420, display: 'flex', overflow: 'hidden',
            border: '1px solid var(--glass-edge)', borderRadius: 'var(--radius-md)',
          }}>{chats?.pane}</div>
        )}
        {here === 'new' && (
          <NewTicket view={view} project={project} onClose={() => to('board')} onCreated={() => to('board')} />
        )}
      </div>
      <Sessions view={view} />
    </div>
  );
}

/** The command bar, with what it is for in it.
 *
 *  A sentence typed here is said to a new chat on the computer in focus, and
 *  the page it was typed on is the page it is read on: the chat opens as a
 *  window in the corner beside the questions (`components/Sessions.tsx`). So
 *  the bar keeps only what a composer has to keep — the words, whether they are
 *  in flight, and what the computer said if they did not land. The words are
 *  kept on a failure rather than cleared: a sentence a screen swallowed is a
 *  sentence somebody has to type again.
 *
 *  ⌘K still opens the palette. It is written on the bar because that is where
 *  the frame writes it, and because a bar you can reach from the keyboard is
 *  the point of the key. */
function Bar({ onAsk, note }: {
  onAsk: (text: string) => Promise<unknown> | unknown;
  note: string | null;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The computer in focus listens, the one the chat is going to open on.
  const focus = useFleet((s) => s.focus);
  const mic = useMic({ hostKey: focus, onCommit: (chunk) => setText((prev) => appendSpeech(prev, chunk)) });

  const say = async () => {
    // Send with the microphone open means "that was it": stop first, then send.
    if (mic.state !== 'idle') { mic.stop(); return; }
    const words = text.trim();
    if (!words || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAsk(words);
      setText('');
    } catch (e: any) {
      setError(e?.message ?? 'That did not reach the computer');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    {/* The bar floats, and nothing is drawn for the row it floats in. A strip
        of the page's colour with a hairline over it kept cards from passing
        under the bar, and cut the page in two to do it. The page is open on
        both sides of the bar instead, and ends a row early (`padding` above):
        scrolled to its end, nothing is left behind the bar. */}
    <div style={{
      position: 'fixed', left: '50%', bottom: 22, transform: 'translateX(-50%)', zIndex: 10,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    }}>
      {(busy || !!error || !!note || !!mic.error || mic.state === 'installing') && (
        <div style={{
          ...mono, maxWidth: 420, fontSize: 11, color: error ? T.red : T.ink3,
          background: T.s2, padding: '6px 10px', borderRadius: RADIUS.well, boxShadow: SHADOW.pop,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{error ?? mic.error ?? (busy ? 'starting a chat…'
          : mic.state === 'installing' ? 'fetching the speech model, once' : note)}</div>
      )}
      <CommandBar
        placeholder={mic.state === 'listening' ? 'Listening…' : 'Tell Divan anything…'}
        value={mic.interim ? appendSpeech(text, mic.interim) : text} onChange={setText}
        onSend={() => { void say(); }}
        after={<MicButton mic={mic} size={SIZE.send} />}
      />
    </div>
    </>
  );
}

/** How tall the row the command bar sits in is: the 22 pt it floats off the
 *  bottom edge, the bar, and the one-line note that stands over it (which
 *  product a sentence will be said about). It is also what the page leaves
 *  empty at its foot, so the two are one number. */
const BAR_ROW = 118;

/** Nothing to draw, in whichever of its four ways. A page with no products on
 *  it is not the same thing as a page whose machines have not answered. */
function Nothing({ view }: { view: DivanView }) {
  const answered = view.hosts.some((h) => !h.missing);
  const older = view.hosts.filter((h) => h.old);
  if (!view.hosts.length) {
    return (
      <EmptyState
        title="No computer paired yet"
        body="Pair one and its products appear here — every machine at once, not one at a time."
        foot="Machine › Settings › Computers"
      />
    );
  }
  if (!answered) {
    // A machine that has not answered *yet* is not a machine that would not:
    // nothing has failed until something says why, and the first poll of a
    // panel that has just opened is still out.
    const asking = view.hosts.every((h) => !h.error);
    if (asking) {
      return (
        <EmptyState
          title="Asking every computer…"
          body="The board is read from each of them at once. This is the moment before the
                first one answers."
          foot={view.hosts.map((h) => h.machine).join(' · ')}
        />
      );
    }
    return (
      <EmptyState
        title="No machine has answered"
        body={older.length
          ? 'The daemon on the other end is older than this panel and has never heard of the board.'
          : 'Nothing has come back from the computers this browser is paired with.'}
        foot={view.hosts.map((h) => `${h.machine} — ${h.error || 'no answer'}`).join(' · ')}
      />
    );
  }
  return (
    <EmptyState
      title="No products yet"
      body="A product is what you ship — a site, an app, a piece of client work — and it owns
            however many repositories it takes. Tell Divan about one in the chat and it appears
            here, on every machine it is checked out on."
      foot="Nothing appears here on its own."
    />
  );
}
