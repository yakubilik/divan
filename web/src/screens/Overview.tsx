/** The Dashboard place: every product on every machine, what is running on them,
 *  and — as conversations rather than as a list — whatever needs a person.
 *
 *  Web12 W1 and Web13 W3 are this page in the two themes, and the theme is the
 *  whole of what differs between them. Top down, both frames: the head with a
 *  mono aside saying how much of what is below is true, four counters, then the
 *  products two abreast on the left and the agent roster on the right, with the
 *  command bar across the bottom and the questions open over the corner.
 *
 *  Scoped to one product it is that product's page instead: its chats down
 *  the left on every page of it, and in the middle the product's own page
 *  (`screens/Project.tsx`) until one of those chats is opened, which is then
 *  read there. Its board and a card are pages of their own in the same middle,
 *  reached from what is on the page and not from a row of tabs.
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
import { useMemo } from 'react';
import { idOf } from '../lib/sessions';
import type { DivanView, MergedCard, MergedProject } from '../lib/divan';
import { EmptyState } from '../ui/divan';
import { Sessions } from '../components/Sessions';
import { useFleet } from '../lib/fleet';
import { today } from '../lib/today';
import { Board } from './Board';
import { Project, ProjectHead } from './Project';
import { Ticket } from './Ticket';
import { Waiting } from './Waiting';
import { Dashboard } from './Dashboard';

/** Where inside a product the page is: its own page, one of its chats open on
 *  it, or its board. Each is a path of its own (`lib/nav.ts`). */
export type ProjectTab = 'overview' | 'board' | 'chat' | 'waiting';

export interface OverviewProps {
  view: DivanView;
  /** The product the bar is scoped to, or null for all of them. */
  project: MergedProject | null;
  onProject: (key: string | null) => void;
  /** Which tab of a scoped product is open. Held above this screen, beside the
   *  product it belongs to, so that scoping to another product lands on its
   *  Overview rather than on whichever tab the last one was left on. */
  tab?: ProjectTab;
  onTab?: (tab: ProjectTab) => void;
  /** Which card is open (Web14 W8), by `host:id`. Held above this screen
   *  beside the product, for the same reason the tab is: it is a place inside
   *  one product, and choosing another product leaves it. */
  card?: string | null;
  onCard?: (id: string | null) => void;
  /** The product's chats: the list that stands down the left of every page of
   *  it, the one that is open (or null), and what closing it does. Handed in whole, because the chat is the Chat place's own surface
   *  and its handlers live above both. */
  chats?: {
    list: React.ReactNode;
    open: React.ReactNode | null;
    onClose: () => void;
  } | null;
  /** The Composer the unscoped page is built round (HANDOVER §4.1). */
  composer?: React.ReactNode;
  /** A waiting card's Open: its own page, inside its product. */
  onOpenCard?: (card: MergedCard) => void;
  /** The Composer at the foot of a product's page, locked to that product. */
  projectComposer?: React.ReactNode;
  /** A running chat's badge on the Dashboard: open that chat. */
  onOpenChat?: (host: string, chatId: string) => void;
}

export function Overview({
  view, project, onProject, tab, onTab, card, onCard, chats,
  composer, onOpenCard, projectComposer, onOpenChat,
}: OverviewProps) {
  const here: ProjectTab = tab ?? 'overview';
  // What this product's chats did today, off every computer that has it.
  const hosts = useFleet((s) => s.hosts);
  const day = useMemo(() => {
    if (!project) return [];
    const mine = Object.keys(project.ids).flatMap((k) => (hosts[k]?.chats ?? [])
      .filter((c) => !!project.ids[k] && c.project_id === project.ids[k]));
    return today(mine, view.now);
  }, [project, hosts, view.now]);
  // The page inside a product that has a head of its own. A key that is
  // no longer in the view — a card that has been finished, a machine that has
  // been unpaired — leaves the product's own page rather than a blank one.
  // By the card's own id as well as by `host:id`, because those are the two
  // things that can be in hand: a press on the board hands over the merged key,
  // and an address hands over the id alone (`/p/quire/c/0d2279020af7` — the
  // card is named by what it is, not by which computer this browser reaches it
  // through). Matching only the first is why a reload of a card's page landed
  // on the board instead of the card.
  const open = project && card
    ? view.cards.find((c) => idOf(c) === card || c.id === card) ?? null
    : null;
  if (!project) {
    const openCard = (c: MergedCard) => (onOpenCard ? onOpenCard(c) : onProject(c.projectKey));
    if (here === 'waiting') return <Waiting view={view} onCard={openCard} />;
    return (
      <Dashboard view={view} onProject={onProject} composer={composer}
        onCard={openCard} onChat={onOpenChat} onWaiting={() => onTab?.('waiting')}
        empty={<Nothing view={view} />} />
    );
  }

  /** Every page of a product, with its chats down the left of it. */
  const framed = (body: React.ReactNode) => (
    <div className="dv-chatpane" data-project-page="" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
      {chats?.list}
      {body}
    </div>
  );

  if (open) {
    return framed(
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <div className="dv-page">
          <Ticket
            card={open} project={project} index={view.projects.indexOf(project)} now={view.now}
            onProject={() => { onCard?.(null); onTab?.('overview'); }}
          />
          {!!projectComposer && <div style={{ marginTop: 40 }}>{projectComposer}</div>}
        </div>
        <Sessions view={view} />
      </div>,
    );
  }

  const to = (key: string) => onTab?.(key as ProjectTab);

  // One of the product's chats, read where the product's page was: the list
  // stays where it is, and closing the chat is the page again.
  if (here === 'chat' && chats?.open) {
    return framed(
      <div data-project-chat="" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 20px' }}>
          <span className="dv-meta">{project.name}</span>
          <button type="button" className="dv-btn dv-btn--ghost dv-hit" style={{ marginLeft: 'auto' }}
            onClick={chats.onClose}>Close chat</button>
        </div>
        {chats.open}
      </div>,
    );
  }

  const board = here === 'board';
  return framed(
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      <div className="dv-page dv-page--wide">
        <ProjectHead project={project} now={view.now} compact={here === 'board'} />
        {(here === 'overview' || here === 'chat') && (
          <Project view={view} project={project}
            today={day}
            onCard={(c) => onCard?.(idOf(c))}
            onBoard={() => to('board')}
            composer={projectComposer} />
        )}
        {board && (
          <>
            <Board view={view} project={project} onCard={(t) => onCard?.(idOf(t.card))} />
            {!!projectComposer && <div style={{ marginTop: 32 }}>{projectComposer}</div>}
          </>
        )}
      </div>
      <Sessions view={view} />
    </div>,
  );
}

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
