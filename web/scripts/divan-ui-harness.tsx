/** Every screen the panel has, and every part it is about to be built out of,
 *  in one page and in one theme — the theme `?theme=` asks for.
 *
 *  Built and driven by `scripts/test-divan-ui.mjs`. What that check is about is
 *  the one thing neither a static render nor a reading of the source can see:
 *  whether the two themes actually paint. The palette reaches the screen as CSS
 *  custom properties, and a variable nobody declared does not fail — it falls
 *  back to `inherit` and the text goes the colour of whatever is behind it. So
 *  the check walks the page and reads the colours a browser resolved.
 *
 *  The screens are drawn with nothing behind them: no daemon, no pairing, no
 *  sockets. That is what a screen looks like the moment it opens, which is the
 *  state every one of them has to survive anyway.
 */
import { createRoot } from 'react-dom/client';
import { themeCss, type Scheme } from '../src/lib/theme';
import { Gallery } from './divan-gallery';
import { Onboarding } from '../src/screens/Onboarding';
import { Ustabasi } from '../src/screens/Ustabasi';
import { Sidebar } from '../src/components/Sidebar';
import { Machine } from '../src/screens/Machine';
import { Overview } from '../src/screens/Overview';
import { Shell } from '../src/components/Shell';
import { merge, project as productIn } from '../src/lib/divan';
import { chips } from '../src/lib/shell';
import { boards } from './overview-fixture.js';
import { ChatView } from '../src/components/ChatView';
import { Modal } from '../src/components/Modal';
import { ApprovalModal } from '../src/components/ApprovalModal';
import { NewChat } from '../src/components/NewChat';
import { ChatMenu } from '../src/components/ChatMenu';
import { ChatDetails } from '../src/components/ChatDetails';
import { Lightbox } from '../src/components/Lightbox';
import { Palette } from '../src/components/Palette';
import { FieldSheet } from '../src/components/FieldSheet';
import { TicketChat } from '../src/components/TicketChat';
import { toneFace } from '../src/lib/theme';
import { useFleet } from '../src/lib/fleet';
import { useLogs } from '../src/lib/timeline';
import { useTold } from '../src/lib/tell';
import { Wall } from '../src/screens/Ustabasi';
import { groupByProject } from '../src/lib/ustabasi';
import { chat, groups, host, items, pending, shots } from './panel-fixture.js';
import { NOW as TICKET_NOW, ticket, wall as tickets } from './ticket-fixture.js';

const q = new URLSearchParams(location.search);
const scheme = (q.get('theme') === 'light' ? 'light' : 'dark') as Scheme;

// A computer on the other end, made up. Every screen here is drawn from a
// daemon and there is none, so without this they all draw the one state that
// cannot be wrong — their empty one. Seeded before the first render, so the
// screens come up with rows, accounts, quota bars and the two marks the panel
// dims. Nothing reaches the network: there is no socket for this host, and the
// calls a screen makes on mount are all caught.
useFleet.setState({
  hosts: { studio: host() as any }, order: ['studio'], focus: 'studio', ready: true,
});

// The wall is a list this browser keeps, and a tile's transcript comes from the
// log store: without both, terminal mode draws "the wall is empty" and the
// phase colours — the tile's outline, the wash behind its head — are drawn
// nowhere at all.
const oneLog = (patch: object = {}) => ({
  items: items(), seq: 8, busy: false, pending: [], loading: false,
  error: null, truncated: false, ...patch,
});
useLogs.setState({
  logs: {
    'studio/c1': oneLog(), 'studio/c2': oneLog({ busy: true }), 'studio/c3': oneLog(),
  } as any,
});
try {
  localStorage.setItem('rac.terminal.wall',
    JSON.stringify(['studio/c1', 'studio/c2', 'studio/c3']));
} catch { /* private mode */ }

// A chat started from the command bar, so that the Dashboard's corner is drawn
// with both kinds of window in it: the question the board is asking, and the
// chat somebody typed a sentence into the bar to start. `c1` is the fixture's
// own chat, which is why the log above is already behind it.
useTold.setState({
  chats: [{ host: 'studio', chatId: 'c1', title: 'ship the beta tonight',
            at: Math.floor(Date.now() / 1000) }],
  minimised: [],
});

const noop = () => {};

// One paired computer that has never answered the board: the state every screen
// in this place opens in, and the one the Dashboard has to have something to say
// about rather than a blank page.
const emptyView = merge([{ key: 'studio', name: 'studio', state: {
  snapshot: null, at: null, reachable: false, error: null, old: false,
} }], Date.now() / 1000);

// …and one that has, so that the project bar has products in it. This is the
// page to hold up against Web12 W1 and Web13 W3: the bar, its chips, the clock
// and the switch, over the place they belong to — and under them the counters,
// the products, the roster and the questions that open themselves. The board is
// `overview-fixture.js`'s, which is the one with a question that has a choice in
// it and a card that is nobody's but yours; `divan-fixture.js`'s would draw the
// windows with nothing to answer.
const NOW = Math.floor(Date.now() / 1000);
const board = merge(boards(NOW).busy.map((host) => ({
  key: host.key, name: host.name, state: {
    snapshot: host.snap, at: NOW - (host.age ?? 0), reachable: true, error: null, old: false,
  },
})), NOW);

/** The pages of the Machine place, drawn inside it. Four of them are a column
 *  of blocks and nothing else — the place around them is what carries their
 *  scroll, their padding and their width — so rendering one on its own lays
 *  its sections out side by side and measures a screen nobody will ever see.
 *  This is the composition the panel actually draws. */
const inDrawer = (view: string) => (
  <Machine
    view={view as any} onView={noop} fleet={board} onOpenChat={noop} onNewChat={noop}
    onNewChatIn={noop} onStartChat={noop} onPeek={noop}
  />
);

const SCREENS: [string, React.ReactNode][] = [
  ['Fleet', inDrawer('fleet')],
  ['Projects', inDrawer('projects')],
  ['Agents', inDrawer('agents')],
  ['Terminal', inDrawer('terminal')],
  ['Screen', inDrawer('screen')],
  ['Update', inDrawer('update')],
  ['Preferences', inDrawer('preferences')],
  ['Onboarding', <Onboarding onPaired={noop} />],
  ['Ustabasi', <Ustabasi />],
  ['Sidebar', <Sidebar
    selected={null} selectedHost={null} onSelect={noop}
    onNewChat={noop} searchRef={{ current: null }} collapsed={false} onCollapse={noop} />],
  // The shell and the two places this ticket draws, over the same made-up
  // computer. `Overview` is handed a merged view rather than a store, so it is
  // the one screen here that can be shown with no machine answering as well.
  ['Shell', <Shell view="overview" onView={noop} now={board.now}
    chips={chips(board, null)} onProject={noop}>
    <Overview view={board} project={null} onProject={noop} onAsk={noop} />
  </Shell>],
  // The chat place: the bar, the list and the chat, which is the composition
  // the panel is in most of the time and the one place the shell has to leave
  // exactly as it was.
  ['ShellChat', <Shell view="chats" onView={noop} now={board.now} onProject={noop}>
    <Sidebar selected="c1" selectedHost="studio" onSelect={noop} onNewChat={noop}
      searchRef={{ current: null }} collapsed={false} onCollapse={noop} />
    <ChatView
      chat={chat() as any} hostKey="studio"
      log={{ items: items(), busy: false, pending: [] } as any} sending={false}
      groups={[]} groupName={null} accountLabel="yakup@…" accountUsage={0.64} liveTokens={null}
      onSend={async () => {}} onUpload={(async () => ({})) as any} onInterrupt={noop}
      onRespond={noop} onEdit={noop} onUpdate={noop} onDelete={noop} onPopOut={noop} />
  </Shell>],
  ['Overview', <Overview view={emptyView} project={null} onProject={noop} />],
  // One product's board, which is the page to hold up against Web12 W2 and
  // Web13 W4: the shell, the product's head with the tabs over it, and the four
  // columns under them. `height` because the gallery is one long page and the
  // board is the one screen that fills the window it is in.
  ['ShellBoard', <div style={{ height: 620, display: 'flex' }}>
    <Shell view="overview" onView={noop} now={board.now}
      chips={chips(board, 'quire')} onProject={noop}>
      <Overview view={board} project={productIn(board, 'quire')} onProject={noop}
        onAsk={noop} tab="board" onTab={noop} />
    </Shell>
  </div>],
  // …and the calm morning, which is a designed state rather than the busy page
  // with its numbers at zero.
  ['OverviewCalm', <Overview view={merge(boards(NOW).calm.map((host) => ({
    key: host.key, name: host.name, state: {
      snapshot: host.snap, at: NOW, reachable: true, error: null, old: false,
    },
  })), NOW)} project={null} onProject={noop} onAsk={noop} />],
  ['Machine', <Machine
    view="machines" onView={noop} fleet={emptyView} onOpenChat={noop} onNewChat={noop}
    onNewChatIn={noop} onStartChat={noop} onPeek={noop} />],
  ['ChatView', <ChatView
    chat={null} hostKey={null} log={{ items: [], busy: false } as any} sending={false}
    groups={[]} groupName={null} accountLabel={null} accountUsage={null} liveTokens={null}
    onSend={async () => {}} onUpload={(async () => ({})) as any} onInterrupt={noop}
    onRespond={noop} onEdit={noop} onUpdate={noop} onDelete={noop} onPopOut={noop} />],
  // The chat with a chat open in it, which is the only way the composer is
  // drawn — and the composer at rest is where a white glyph on a neutral disc
  // hid through a whole round of this ticket.
  ['ChatOpen', <ChatView
    chat={chat() as any} hostKey="studio"
    log={{ items: items(), busy: false, pending: [] } as any} sending={false}
    groups={[]} groupName={null} accountLabel="yakup@…" accountUsage={0.64} liveTokens={null}
    onSend={async () => {}} onUpload={(async () => ({})) as any} onInterrupt={noop}
    onRespond={noop} onEdit={noop} onUpdate={noop} onDelete={noop} onPopOut={noop} />],
];

/** The panels a screen opens over itself. Each is `position: fixed`, so each
 *  gets a container that is a containing block for it (a transform is enough),
 *  or they would all be stacked on the same corner of the window. */
const OVERLAYS: [string, React.ReactNode][] = [
  ['Modal', <Modal onClose={noop}>Anything at all.</Modal>],
  // What ⌘K opens, over the same made-up computer: the chats, the folders and
  // the panel's own commands, which is every kind of row it can draw.
  ['Palette', <Palette
    commands={[{ id: 'theme', label: 'Light theme', hint: 'following this computer', run: noop },
               { id: 'stop-all', label: 'Stop every session', hint: '2 running', danger: true, run: noop }]}
    onOpenChat={noop} onNewChatIn={noop} onClose={noop} />],
  ['ApprovalModal', <ApprovalModal
    pending={pending() as any} chat={chat() as any} queued={2}
    onRespond={noop} onOpenChat={noop} onClose={noop} />],
  ['NewChat', <NewChat hostKey="studio" initialAgent={null} onDone={noop} onClose={noop} />],
  ['ChatMenu', <ChatMenu
    chat={chat() as any} groups={groups() as any} onUpdate={noop} onDelete={noop} onClose={noop} />],
  ['ChatDetails', <ChatDetails
    chat={chat() as any} items={items() as any} busy liveTokens={1240}
    accountLabel="yakup@…" accountUsage={0.64}
    onEdit={noop} onInterrupt={noop} onPopOut={noop} onClose={noop} />],
  ['Lightbox', <Lightbox shots={shots() as any} start={0} onClose={noop} />],
  ['FieldSheet', <FieldSheet
    field="model" chat={chat() as any} catalog={null} projects={[]} accounts={[]}
    limits={{}} busy={false} onPick={noop} onClose={noop} />],
  ['TicketChat', <TicketChat
    t={ticket() as any} tone={toneFace('needs an answer', 'amber')}
    onClose={noop} onNote={async () => 'ok'} />],
  // The ticket queue's wall, which carries the other copy of the phase table.
  ['TicketWall', <Wall groups={groupByProject(tickets() as any)} now={TICKET_NOW} onOpen={noop} />],
];

function Page() {
  return (
    <>
      <style>{themeCss()}</style>
      <Gallery scheme={scheme} />
      {SCREENS.map(([name, node]) => (
        <div key={name} data-screen={name} style={{ height: 760, display: 'flex', overflow: 'hidden' }}>
          {node}
        </div>
      ))}
      {OVERLAYS.map(([name, node]) => (
        <div key={name} data-screen={name} style={{
          height: 760, position: 'relative', overflow: 'hidden',
          // A containing block for the panel's `position: fixed`, so that each
          // one is drawn in its own frame instead of eight on top of each other.
          transform: 'translateZ(0)',
        }}>
          {node}
        </div>
      ))}
    </>
  );
}

document.documentElement.dataset.theme = scheme;
createRoot(document.getElementById('root')!).render(<Page />);
