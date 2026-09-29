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
    </>
  );
}

document.documentElement.dataset.theme = scheme;
createRoot(document.getElementById('root')!).render(<Page />);
