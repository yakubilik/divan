/** Settings: how the panel looks and reads, and the way into what one computer
 *  keeps.
 *
 *  Web15 W18 is groups of rows on one card — a mono heading, then a row with
 *  what the setting is on the left and the answer on the right. That is this
 *  page. The first group is the panel's own and is answered here; the second is
 *  a computer's, and each row opens the page that holds it, which is one level
 *  down.
 *
 *  TODO(daemon): the frame's other two groups are left off rather than faked.
 *  *Reaching you* — push only when something needs you, quiet hours, haptics —
 *  is a phone's; this panel has no push registration and nothing to be quiet
 *  about. *Voice and language* is the same: the daemon transcribes what is sent
 *  to it, and neither a voice for its answers nor a language for this browser
 *  exists to be chosen. The two rows of Density and the running dot's pulse are
 *  off for a smaller reason: nothing on any screen reads either, so they would
 *  be settings that do nothing.
 */
import { setThemeChoice, useTheme, T, type ThemeChoice } from '../lib/theme';
import { useFleet } from '../lib/fleet';
import type { View } from '../lib/shell';
import { Button, Card, Choice, EmptyState, Row, SectionHeader } from '../ui/divan';
import { glyph } from '../ui/kit';
import { usePrefs } from '../lib/prefs';
import { toldDefaults } from '../lib/tell';
import { accountOptions } from '../lib/compose';
import type { Provider } from '../lib/protocol';

const THEMES: { key: ThemeChoice; label: string }[] = [
  { key: 'system', label: 'Auto' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

const CHATS: { key: 'one' | 'all'; label: string }[] = [
  { key: 'one', label: 'One computer' },
  { key: 'all', label: 'Every one' },
];

/** The rows of the second group: what a computer keeps, and the page that holds
 *  it. All four are sections of the screen one level down, which is where they
 *  have always been. */
const COMPUTER: { key: string; icon: string; title: string; note: string }[] = [
  { key: 'chats', icon: 'plus', title: 'What a new chat opens with',
    note: 'the tool, the model, how hard it thinks, what it may do without asking, and where' },
  { key: 'tools', icon: 'bolt', title: 'Tools',
    note: 'which CLIs are installed on that computer, and which versions' },
  { key: 'security', icon: 'shield', title: 'What an agent may open',
    note: 'the folders outside which nothing that runs there can read or write' },
  { key: 'about', icon: 'layout', title: 'About that computer',
    note: 'the daemon it is running, how long it has been up and how often it has restarted' },
];

export function Settings({ onView }: { onView: (view: View) => void }) {
  const { choice, scheme } = useTheme();
  const order = useFleet((s) => s.order);
  const hosts = useFleet((s) => s.hosts);
  const allHosts = useFleet((s) => s.allHosts);
  const setAllHosts = useFleet((s) => s.setAllHosts);
  const focus = useFleet((s) => s.focus);
  const machine = (focus && hosts[focus]?.info?.name) || hosts[order[0]]?.cfg.name || '';

  return (
    <>
      <SectionHeader kind="page" title="Settings" />

      <Card inset={false} style={{ padding: '4px 0 0' }}>
        <SectionHeader kind="mark" title="appearance" style={{ padding: '8px 20px 6px' }} />
        <Row
          title="Theme"
          note={choice === 'system'
            ? `Follows this computer, which is ${scheme} right now`
            : `Set by hand · this browser opens ${choice} until you change it back`}
          style={{ padding: '14px 20px' }}
          right={<Choice
            label="Theme" value={choice} options={THEMES}
            onChange={(v) => setThemeChoice(v)}
          />}
        />
        <Row
          title="The chat list"
          note="every conversation on every paired computer, or only the one you are on"
          style={{ padding: '14px 20px' }}
          right={<Choice
            label="The chat list" value={allHosts ? 'all' : 'one'} options={CHATS}
            onChange={(v) => setAllHosts(v === 'all')}
          />}
        />
      </Card>

      {!!focus && !!hosts[focus] && <NewChats host={focus} machine={machine} />}

      {order.length ? (
        <Card inset={false} style={{ padding: '4px 0 0' }}>
          <SectionHeader
            kind="mark" title={machine ? `this computer · ${machine}` : 'this computer'}
            style={{ padding: '8px 20px 6px' }}
          />
          {COMPUTER.map((r) => (
            <Row
              key={r.key} icon={glyph(r.icon)} title={r.title} note={r.note}
              style={{ padding: '14px 20px' }}
              right={<Button small face="outline" label="Change"
                onClick={() => onView('preferences')} />}
            />
          ))}
        </Card>
      ) : (
        <EmptyState
          title="Nothing is paired yet."
          body="The theme above is this browser's and works with no computer at all. Everything
                else on this page belongs to a computer, so it arrives with the first one."
          actions={<Button label="Machines" onClick={() => onView('machines')} />}
        />
      )}

      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: T.ink3, maxWidth: 560 }}>
        The theme is this browser's and is remembered here. Everything under the second
        heading lives on the computer it belongs to; the panel only reads and changes it.
      </div>
    </>
  );
}

/** What the next new chat opens with on the computer in focus: the sign-in it
 *  spends and the model it runs. These are the Composer's chips before anybody
 *  touches them (HANDOVER §5) — a chip changed in the Composer is for that one
 *  chat, and this is where the lasting answer is set. */
function NewChats({ host, machine }: { host: string; machine: string }) {
  const slot = useFleet((s) => s.hosts[host]);
  const prefs = usePrefs((s) => s.defaults);
  const setProviderDefaults = usePrefs((s) => s.setProviderDefaults);
  // The tool the Composer opens a chat on: Claude where this computer has it,
  // its usual tool where it does not (`tell`).
  const open = toldDefaults(slot, prefs, host, 'claude') ?? toldDefaults(slot, prefs, host);
  const provider: Provider = open?.provider ?? 'claude';
  const accounts = accountOptions(slot?.accounts ?? [], provider);
  const models = slot?.catalog?.[provider]?.models ?? [];
  const field = { height: 36, borderRadius: 10, border: `1px solid ${T.line}`, background: T.line2,
                  color: T.ink, font: '500 13px/18px var(--font-sans)', padding: '0 10px', minWidth: 200 };
  return (
    <Card inset={false} style={{ padding: '4px 0 0' }} data-new-chats>
      <SectionHeader kind="mark" title={machine ? `new chats · ${machine}` : 'new chats'}
        style={{ padding: '8px 20px 6px' }} />
      <Row
        title={<label htmlFor="default-account">Default account</label>}
        note="the sign-in a new chat spends, unless the Composer's chip is changed for that chat"
        style={{ padding: '14px 20px' }}
        right={accounts.length ? (
          <select id="default-account" style={field} value={open?.account_id ?? ''}
            onChange={(e) => setProviderDefaults(host, provider, { account_id: e.target.value })}>
            {accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        ) : <span className="dv-meta">no sign-in reported yet</span>}
      />
      <Row
        title={<label htmlFor="default-model">Default model</label>}
        note="the model a new chat runs, unless the Composer's chip is changed for that chat"
        style={{ padding: '14px 20px' }}
        right={models.length ? (
          <select id="default-model" style={field} value={open?.model ?? ''}
            onChange={(e) => setProviderDefaults(host, provider, { model: e.target.value })}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
          </select>
        ) : <span className="dv-meta">none offered yet</span>}
      />
    </Card>
  );
}
