/** The Dashboard place: every product on every machine, what is running on them,
 *  and — as conversations rather than as a list — whatever needs a person.
 *
 *  Web12 W1 and Web13 W3 are this page in the two themes, and the theme is the
 *  whole of what differs between them. Top down, both frames: the head with a
 *  mono aside saying how much of what is below is true, four counters, then the
 *  products two abreast on the left and the agent roster on the right, with the
 *  command bar across the bottom and the questions open over the corner.
 *
 *  Scoped to one product by the bar, it is that product's page instead, and the
 *  head is the one Web12 W2 draws: the monogram, the name, what it is and where
 *  it is checked out, the tabs, and the states its board is in at the far end.
 *  The Board tab is `screens/Board.tsx`, drawn here rather than in a place of
 *  its own so that the questions in the corner stay on screen beside it — the
 *  whole point of W2 is the board and the asking agent's chat at once.
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
import { useEffect, useState } from 'react';
import { uptime } from '../lib/format';
import {
  agentLine, agentRows, calm, calmWords, cardMarks, chip, clock,
  count, counters, figure, freshness, latest, line, marks, staleWords, staleness, summaryOf,
} from '../lib/overview';
import { RADIUS, SHADOW, SIZE, T } from '../lib/theme';
import { branchOf } from '../lib/project';
import { idOf } from '../lib/sessions';
import type { DivanView, MergedCard, MergedProject } from '../lib/divan';
import {
  Card, CommandBar, Counter, EmptyState, Monogram, Note, RosterRow, SectionHeader,
  StateMark, Tabs, Tag,
} from '../ui/divan';
import { mono } from '../ui/kit';
import { Sessions } from '../components/Sessions';
import { MicButton, useMic } from '../components/Mic';
import { appendSpeech } from '../lib/dictate';
import { useFleet } from '../lib/fleet';
import { Board } from './Board';
import { Branch } from './Branch';
import { Branches } from './Branches';
import { Project } from './Project';
import { Ticket } from './Ticket';

/** The tabs over a product (Web12 W2, Web14 W6): what is happening on it, the
 *  faces it has beside its code, its board, and — the frame's own fourth,
 *  `Chats 6` — the chats that are work on it. The Chat place in the bar above
 *  is every chat on a computer; this is the ones about one product, read and
 *  answered without leaving the product.
 *
 *  Branches is a tab rather than the top of the Overview because the two answer
 *  different questions: how a product is organised is something a person looks
 *  up, and what is going on is what they opened the product for. */
export const PROJECT_TABS = [
  { key: 'overview', label: 'Overview' }, { key: 'branches', label: 'Branches' },
  { key: 'board', label: 'Board' }, { key: 'chat', label: 'Chat' },
] as const;

export type ProjectTab = typeof PROJECT_TABS[number]['key'];

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
}

export function Overview({
  view, project, onProject, onAsk, askNote, tab, onTab, branch, onBranch, card, onCard, chats,
}: OverviewProps) {
  const old = staleness(view);
  const agents = agentRows(view);
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
  const board = !!project && !deep && here === 'board';
  const chatting = !!project && !deep && here === 'chat';
  const [drafting, setDrafting] = useState(false);
  // A half-written card belongs to the board it was opened on: leaving the
  // product, or the board for a card's own page, puts it down. A *tab* is put
  // down where the tab is pressed rather than here — the word that opens a
  // draft moves the tab itself, and an effect watching the tab would close the
  // card in the same commit that opened it.
  useEffect(() => { setDrafting(false); }, [project?.key, deep]);
  const aside = project
    ? (project.machines.join(' · ') || 'no machine')
    : old
      ? `partly as of ${clock(old.asOf)}`
      : `${count(view.projects.length, 'project')} · ${count(agents.length, 'agent')}`;
  const said = project ? marks(project) : [];

  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20,
      // The chat has a composer of its own, so the command bar is not drawn
      // over it and the page does not keep room for one.
      padding: `24px 32px ${chatting ? 20 : BAR_ROW + 12}px`, background: T.bg,
      // The board fills the page and its columns scroll, and so does the chat;
      // everything else is a page that scrolls under a bar fixed over it.
      overflowY: board || chatting ? 'hidden' : 'auto',
    }}>
      {!deep && (
      <SectionHeader
        kind="page"
        lead={project
          ? <Monogram name={project.name} index={view.projects.indexOf(project)} size={44} />
          : undefined}
        title={project ? project.name : 'Overview'}
        // The frame's own line under a product's name, with the machines it is
        // checked out on after it: `SaaS · client portals for studios · studio
        // · mini`.
        note={project ? [summaryOf(project), aside].join(' · ') : undefined}
        right={project ? (said.length ? <Marks project={project} /> : null) : aside}
        tone={!project && old ? 'amber' : undefined}
      >
        {!!project && (
          <Tabs
            tabs={PROJECT_TABS.map((t) => (t.key === 'branches'
              // The frame's `Chats 6`: the number belongs to the tab that has
              // one, and a product whose faces have not arrived yet has none.
              ? { ...t, count: project.branches.length || null }
              : t.key === 'chat' ? { ...t, count: chats?.count || null } : { ...t }))}
            value={here}
            onChange={(key) => { setDrafting(false); onTab?.(key as ProjectTab); }}
            style={{ marginLeft: 14 }} />
        )}
        {/* Web14 W6 puts it at the far end of this line, and W9 is what it
            opens: the card is written at the top of Ice Box, so the press lands
            on the board with the draft open. */}
        {!!project && (
          <button type="button" style={NEW_TICKET}
            onClick={() => { onTab?.('board'); setDrafting(true); }}>+ New ticket</button>
        )}
      </SectionHeader>
      )}
      {/* The fleet's own sentence, over the page that is about the fleet. A
          product's page says which of *its* machines has gone quiet, which is
          the same fact said more precisely — twice would be the page arguing
          with itself. */}
      {!!old && !project && (
        <div style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink2 }}>
          {staleWords(old, uptime)}
        </div>
      )}
      {!project && <Everything view={view} onProject={onProject} />}
      {!!project && !!open && (
        <Ticket
          card={open} project={project} index={view.projects.indexOf(project)} now={view.now}
          onProject={() => { onCard?.(null); onBranch?.(null); }}
          onBranch={(kind) => { onCard?.(null); onBranch?.(kind); }}
        />
      )}
      {!!project && !open && !!face && (
        <Branch
          project={project} branch={face} index={view.projects.indexOf(project)} now={view.now}
          onProject={() => onBranch?.(null)}
          onCard={(c: MergedCard) => onCard?.(idOf(c))}
        />
      )}
      {chatting && (
        <div style={{
          flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden',
          border: `1px solid ${T.line}`, borderRadius: RADIUS.card,
        }}>{chats?.pane}</div>
      )}
      {!!project && !deep && !chatting && (board
        ? (
          <Board
            view={view} project={project}
            drafting={drafting} onDraft={setDrafting}
            onCard={(t) => onCard?.(idOf(t.card))}
          />
        )
        : here === 'branches'
          ? (
            <Branches
              project={project} now={view.now}
              onBranch={(kind) => onBranch?.(kind)}
            />
          )
          : <Project view={view} project={project} onCard={(c) => onCard?.(idOf(c))} />)}
      {/* The bar and the windows are over the page rather than in it: the page
          scrolls, and a question that scrolled away with it would be a
          notification again. */}
      {!!onAsk && !chatting && <Bar onAsk={onAsk} note={askNote ?? null} />}
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

/** Everything, which is the page the frames draw: the counters, the products and
 *  the roster. */
function Everything({ view, onProject }: { view: DivanView; onProject: (key: string) => void }) {
  const quiet = calm(view);
  const words = calmWords(view);
  const rows = agentRows(view);
  if (!view.hosts.length || !view.projects.length) return <Nothing view={view} />;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        {counters(view).map((c) => (
          <Counter key={c.label} value={c.value} label={c.label} tone={c.tone} ring={c.ring} />
        ))}
      </div>
      {/* A morning where nothing needs anybody is a state this page is designed
          for, and not the busy one with its numbers at zero. The rule is
          `calm()` and not a copy of it: two spellings of one rule is how a
          screen comes to say "all clear" over a quiet machine's own amber
          sentence. */}
      {quiet && (
        <Note tone="run" dot title={words.title} foot={words.foot ? [words.foot] : undefined} />
      )}
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 24, alignItems: 'start',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <SectionHeader title="Projects" note="sorted by urgency" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {view.projects.map((p, i) => (
              <ProjectCard key={p.key} project={p} index={i} now={view.now}
                onClick={() => onProject(p.key)} />
            ))}
          </div>
        </div>
        {!!rows.length && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <SectionHeader title="Agents" count={rows.length} />
            <Card inset={false} style={{ padding: '2px 12px' }}>
              {rows.map((r, i) => (
                <RosterRow
                  key={`${r.agent.host}:${r.agent.card_id}`} first={i === 0}
                  mark={r.mark} tone={r.tone} who={r.who}
                  lead={<Monogram name={view.projects[r.index]?.name ?? r.agent.project}
                    index={r.index < 0 ? null : r.index} size={18} />}
                  text={agentLine(r, view.now, uptime)}
                />
              ))}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

/** One product's card (Web12 W1): its monogram and name, where its work is, the
 *  worst true thing about it in the corner, what git says, and the board's own
 *  marks with the worst card's line beside them. */
function ProjectCard({ project: p, index, now, onClick }: {
  project: MergedProject; index: number; now: number; onClick: () => void;
}) {
  const corner = chip(p, now, uptime);
  const fresh = freshness(p);
  const git = figure(p, now, uptime);
  const board = cardMarks(p);
  const said = latest(p.cards);
  return (
    <Card onClick={onClick} title={`Everything on ${p.name}`} style={{ gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Monogram name={p.name} index={index} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>{p.name}</div>
          <div style={{
            ...mono, fontSize: 11.5, color: T.ink3, marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{line(p, now)}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          <Tag mark={corner.mark} label={corner.text} tone={corner.tone} />
          {!!fresh && <span style={{ ...mono, fontSize: 10.5, color: T.ink3 }}>{fresh}</span>}
        </div>
      </div>
      {!!git && (
        <div>
          <div style={{ ...mono, fontSize: 24, lineHeight: 1, fontWeight: 500, letterSpacing: '-.02em' }}>
            {git.value}
          </div>
          <div style={{ ...mono, fontSize: 11, color: T.ink3, marginTop: 6, whiteSpace: 'nowrap' }}>
            {git.label} · {git.moved}
          </div>
        </div>
      )}
      {(!!board.length || !!said) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
          borderTop: `1px solid ${T.line}`, paddingTop: 10,
        }}>
          <span style={{ display: 'flex', gap: 8, flex: 'none' }}>
            {board.map((m) => <StateMark key={m.mark} state={m.mark} label={m.n} size={11.5} />)}
          </span>
          {!!said && (
            <span style={{
              marginLeft: 'auto', fontSize: 12.5, color: T.ink2, minWidth: 0,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{said}</span>
          )}
        </div>
      )}
    </Card>
  );
}

/** The word at the far end of a product's head, which the frame sets as plain
 *  type rather than as a button. */
const NEW_TICKET: React.CSSProperties = {
  marginLeft: 'auto', flex: 'none', background: 'transparent', border: 'none', padding: 0,
  font: 'inherit', fontSize: 13, fontWeight: 500, color: T.ink, cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/** `? 1 asking · ■ 1 stuck · ● 2 running`, and nothing at all where none of the
 *  three is true — a calm product says so by being quiet. */
function Marks({ project, style }: { project: MergedProject; style?: React.CSSProperties }) {
  const list = marks(project);
  if (!list.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 12, flex: 'none', ...style }}>
      {list.map((m) => <StateMark key={m.state} state={m.state} label={m.label} />)}
    </span>
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
