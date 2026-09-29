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
import { Dashboard } from '../src/screens/Dashboard';
import { Projects } from '../src/screens/Projects';
import { Agents } from '../src/screens/Agents';
import { Terminal } from '../src/screens/Terminal';
import { Screen } from '../src/screens/Screen';
import { Admin } from '../src/screens/Admin';
import { Settings } from '../src/screens/Settings';
import { Onboarding } from '../src/screens/Onboarding';
import { Ustabasi } from '../src/screens/Ustabasi';
import { Sidebar } from '../src/components/Sidebar';
import { ChatView } from '../src/components/ChatView';
import { Modal } from '../src/components/Modal';
import { ApprovalModal } from '../src/components/ApprovalModal';
import { NewChat } from '../src/components/NewChat';
import { ChatMenu } from '../src/components/ChatMenu';
import { ChatDetails } from '../src/components/ChatDetails';
import { Lightbox } from '../src/components/Lightbox';
import { FieldSheet } from '../src/components/FieldSheet';
import { TicketChat } from '../src/components/TicketChat';
import { toneFace } from '../src/lib/theme';
import { chat, groups, items, pending, shots } from './panel-fixture.js';
import { ticket } from './ticket-fixture.js';

const q = new URLSearchParams(location.search);
const scheme = (q.get('theme') === 'light' ? 'light' : 'dark') as Scheme;

const noop = () => {};

const SCREENS: [string, React.ReactNode][] = [
  ['Dashboard', <Dashboard onOpenChat={noop} onNewChat={noop} />],
  ['Projects', <Projects onNewChatIn={noop} onOpenChat={noop} />],
  ['Agents', <Agents onStartChat={noop} />],
  ['Terminal', <Terminal onPeek={noop} onNewChat={noop} />],
  ['Screen', <Screen />],
  ['Admin', <Admin />],
  ['Settings', <Settings />],
  ['Onboarding', <Onboarding onPaired={noop} />],
  ['Ustabasi', <Ustabasi />],
  ['Sidebar', <Sidebar
    view="chats" onView={noop} selected={null} selectedHost={null} onSelect={noop}
    onNewChat={noop} searchRef={{ current: null }} collapsed={false} onCollapse={noop} />],
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
