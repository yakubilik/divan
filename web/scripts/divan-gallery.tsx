/** Every part of the desktop design system, in both themes, each beside the
 *  name of the frame it was measured off.
 *
 *  Two things read this file. `scripts/test-divan.mjs` renders it and reads the
 *  colours back off the markup — which is how "a part paints nothing that is
 *  not a token" is answered by what came out rather than by what was written —
 *  and it writes the same render to `.test-build/divan/gallery.html`, which
 *  opens in a browser with no daemon and no pairing. That page is the thing to
 *  hold up against `design/divan/frames/12-web12-*.html` and the three that
 *  follow it.
 *
 *  The specimens are the states the frames actually draw. A part with two faces
 *  appears twice; a part that needs a parent to make sense gets one.
 */
import React from 'react';
import { T, themeCss, type Scheme } from '../src/lib/theme';
import { P, mono } from '../src/ui/kit';
import {
  BarChip, BarDivider, BarStamp, Button, Card, Cell, Choice, ColumnTab, CommandBar, Composer,
  Counter, DockMore, DockTab, EmptyState, ExecutorBadge, FieldRow, Figures, Monogram, NameCell,
  NavItem, Note, Panel, PanelHead, Pill, Quoted, Row, RosterRow, SectionHeader, SidePanel, Slider,
  StampRow, StateMark, StatusDot, Table, Tabs, Tag, TopBar, Write,
} from '../src/ui/divan';

export interface Specimen {
  name: string;
  /** The frame and option it was measured off. */
  frame: string;
  /** How wide the specimen wants to be drawn in the gallery. */
  width?: number;
  node: React.ReactNode;
}

const COLUMNS = [
  { key: 'icebox', label: 'Ice Box', count: 11, sub: 'someday' },
  { key: 'queued', label: 'Queued', count: 4, sub: 'next up' },
  { key: 'progress', label: 'In Progress', count: 5, sub: 'agents working' },
  { key: 'done', label: 'Done', count: 48, sub: 'this month 12' },
];

export const SPECIMENS: Specimen[] = [
  {
    name: 'Card', frame: 'Web14 W6', width: 380,
    node: (
      <Card>
        <SectionHeader title="Engineering" right="live" tone="run" />
        <div style={{ fontSize: 13.5, lineHeight: 1.4, color: T.ink2 }}>
          4 Coders on 4 tickets. One stuck on Safari login.
        </div>
      </Card>
    ),
  },
  {
    name: 'CardAsking', frame: 'Web12 W1', width: 380,
    node: (
      <Card ring="amber" radius={14} tight>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <ExecutorBadge executor="coder" />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Coder</span>
          <span style={{ ...mono, fontSize: 11, fontWeight: 500, color: T.amber }}>asks you</span>
        </div>
        <div style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: '-.005em' }}>
          Webhook retry policy
        </div>
      </Card>
    ),
  },
  {
    name: 'CardLifted', frame: 'Web12 W2 · a card in the air', width: 380,
    node: <Card lifted ring="run" bar={0.38}><div style={{ fontSize: 14 }}>Bulk invite clients from a CSV</div></Card>,
  },
  {
    name: 'CardRaised', frame: 'Web14 W9', width: 380,
    node: (
      <Card ring="amber" raised radius={14}>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>Export client list as CSV</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button label="Add · ↵" wide />
          <Button label="Esc" face="outline" wide />
        </div>
      </Card>
    ),
  },
  {
    name: 'Row', frame: 'Web15 W12', width: 560,
    node: (
      <Card inset={false}>
        <Row first icon={P.monitor} title="studio" mark note="Mac Studio M2 Ultra · home · macOS 15.1"
          meta="12s ago" right={<Button label="Terminal" face="outline" small />} />
        <Row icon={P.monitor} title="mini" mark note="Mac mini M2 · office · macOS 15.1"
          meta="2h 14m" tone="amber" wash right={<Button label="Wake" face="outline" small />} />
        <Row icon={P.cpu} title="cloud" mark note="four agents, no screen" meta="idle" chevron />
      </Card>
    ),
  },
  {
    name: 'Pill', frame: 'Web12 W1 · the project chips', width: 380,
    node: (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Pill label="All" dot="asking" face="ink" />
        <Pill label="Quire" dot="stuck" />
        <Pill label="The Long Walk" dot="quiet" />
      </div>
    ),
  },
  {
    name: 'PillAnswers', frame: 'Web12 W1 · the answers under a question', width: 380,
    node: (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Pill label="Follow Stripe" face="amber" />
        <Pill label="Keep 3" face="outline" />
      </div>
    ),
  },
  {
    name: 'Button', frame: 'Web14 W9', width: 380,
    node: (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button label="New ticket" icon={P.plus} />
        <Button label="Later" face="outline" />
        <Button label="Allow" face="amber" />
        <Button label="Screen" face="outline" small />
        <Button label="Up to date" disabled />
      </div>
    ),
  },
  {
    name: 'Tabs', frame: 'Web14 W6', width: 380,
    node: (
      <Tabs value="board" onChange={() => {}} tabs={[
        { key: 'overview', label: 'Overview' },
        { key: 'board', label: 'Board' },
        { key: 'chats', label: 'Chats', count: 6 },
      ]} />
    ),
  },
  {
    name: 'ColumnTab', frame: 'Web12 W2', width: 560,
    node: (
      <div style={{ display: 'flex', gap: 12 }}>
        {COLUMNS.map((c, i) => (
          <ColumnTab key={c.key} label={c.label} count={c.count} sub={c.sub}
            live={i === 2} onClick={() => {}} style={{ flex: 1 }} />
        ))}
      </div>
    ),
  },
  {
    name: 'ColumnTabDrop', frame: 'Web12 W2 · a card in the air', width: 560,
    node: (
      <div style={{ display: 'flex', gap: 12 }}>
        {COLUMNS.slice(0, 3).map((c, i) => (
          <ColumnTab key={c.key} label={c.label} count={c.count} sub={c.sub}
            dragging dropping={i === 1} style={{ flex: 1 }} />
        ))}
      </div>
    ),
  },
  {
    name: 'StatusDot', frame: 'Web15 W12', width: 240,
    node: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StatusDot state="running" />
        <StatusDot state="asking" hollow />
        <StatusDot state="stuck" />
        <StatusDot state="quiet" />
      </div>
    ),
  },
  {
    name: 'StateMark', frame: 'Web12 W2 · the summary line', width: 380,
    node: (
      <SectionHeader kind="mark" title="? 1 asking" tone="amber">
        <StateMark state="stuck" label="1 stuck" />
        <StateMark state="running" label="2 running" />
        <StateMark state="yours" label="1 yours" />
      </SectionHeader>
    ),
  },
  {
    name: 'ExecutorBadge', frame: 'Web14 W10', width: 380,
    node: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ExecutorBadge executor="coder" />
        <ExecutorBadge executor="seo" />
        <ExecutorBadge executor="analyst" />
        <ExecutorBadge executor="research" />
        <ExecutorBadge executor="divan" />
        <ExecutorBadge executor="you" />
        <ExecutorBadge executor="unassigned" />
      </div>
    ),
  },
  {
    name: 'Monogram', frame: 'Web12 W1', width: 380,
    node: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {['Quire', 'Kanji Daily', 'Hush', 'The Long Walk'].map((n, i) => (
          <Monogram key={n} name={n} index={i} />
        ))}
      </div>
    ),
  },
  {
    name: 'Counter', frame: 'Web12 W1', width: 560,
    node: (
      <div style={{ display: 'flex', gap: 8 }}>
        <Counter value={2} label="Needs you" tone="amber" />
        <Counter value={2} label="Stuck" tone="red" />
        <Counter value={2} label="Unheard from" tone="amber" ring />
        <Counter value={4} label="Running" />
      </div>
    ),
  },
  {
    name: 'CounterZero', frame: 'Web13 W3 · a calm morning', width: 560,
    node: (
      <div style={{ display: 'flex', gap: 8 }}>
        <Counter value={0} label="Needs you" tone="amber" />
        <Counter value={0} label="Stuck" tone="red" />
        <Counter value={3} label="Running" />
        <Counter value={9} label="Done today" />
      </div>
    ),
  },
  {
    name: 'SectionHeader', frame: 'Web12 W1 · Web15 W12', width: 560,
    node: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionHeader kind="page" title="Overview" right="4 projects · 7 agents" />
        <SectionHeader kind="page" title="Machines" note="3 paired" />
        <SectionHeader title="Projects" note="sorted by urgency" />
        <SectionHeader title="Agents" count={7} />
      </div>
    ),
  },
  {
    name: 'EmptyState', frame: 'Mobile7 S6 · the desktop frames draw none', width: 560,
    node: (
      <EmptyState
        title="A new board."
        body="Nothing is on it yet. Write the first ticket, or let Divan read the repository and propose a few."
        actions={<><Button label="New ticket" icon={P.plus} /><Button label="Ask Divan" face="outline" /></>}
        foot="nothing starts until you move one"
      />
    ),
  },
  {
    name: 'SidePanel', frame: 'Web15 W12', width: 280,
    node: (
      <SidePanel
        title="Machine" note="One machine is unreachable." value="machines" onChange={() => {}}
        items={[
          { key: 'machines', label: 'Machines', icon: P.monitor, dot: 'asking', hollow: true },
          { key: 'executors', label: 'Executors', icon: P.agent },
          { key: 'terminals', label: 'Terminals', icon: P.terminal },
          { key: 'accounts', label: 'Accounts & sign-ins', icon: P.shield, count: 1 },
          { key: 'settings', label: 'Settings', icon: P.gear },
        ]}
      />
    ),
  },
  {
    name: 'TopBar', frame: 'Web12 W1 · Web14 W6', width: 800,
    node: (
      <TopBar>
        <NavItem label="Dashboard" icon={P.grid} on />
        <NavItem label="Chat" icon={P.chat} />
        <NavItem label="Machine" icon={P.server} />
        <BarDivider />
        <Pill label="All" dot="asking" face="ink" />
        <Pill label="Quire" dot="stuck" />
        <Pill label="Kanji Daily" dot="running" />
        <span style={{ marginLeft: 'auto' }} />
        <BarStamp>Mon 28 Sep · 23:14</BarStamp>
        <BarChip icon={P.sun} label="Light" />
      </TopBar>
    ),
  },
  {
    name: 'BarChip', frame: 'Web15 W12', width: 380,
    node: (
      <div style={{ display: 'flex', gap: 8 }}>
        <BarChip label="mini unreachable · 2h 14m" tone="amber" icon={P.warn} />
        <BarChip label="3 machines" />
      </div>
    ),
  },
  {
    name: 'Note', frame: 'Mobile1 V3 · the desktop frames draw none', width: 380,
    node: (
      <Note tone="run" dot title="All clear. Nothing needs you." foot={['9 finished today']} />
    ),
  },
  {
    name: 'Tag', frame: 'Web12 W1 · a project card’s corner', width: 380,
    node: (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Tag mark="■" label="1 stuck" tone="red" />
        <Tag mark="?" label="2 asks" tone="amber" />
        <Tag mark="●" label="2 running" tone="run" />
        <Tag label="quiet" />
      </div>
    ),
  },
  {
    name: 'RosterRow', frame: 'Web12 W1 · the agent roster', width: 380,
    node: (
      <Card inset={false} style={{ padding: '2px 12px' }}>
        <RosterRow first mark="●" tone="run" who="Coder" text="Webhook retry policy · 5m"
          lead={<Monogram name="Quire" index={0} size={18} />} />
        <RosterRow mark="◌" tone="amber" who="Branch" text="Ranking report · last seen 21:02"
          lead={<Monogram name="Kanji Daily" index={1} size={18} />} />
        <RosterRow mark="⏸" tone="red" who="Research" text="Reading App Review’s reply"
          lead={<Monogram name="Hush" index={2} size={18} />} />
      </Card>
    ),
  },
  {
    name: 'Panel', frame: 'Web12 W1 · the asking agent’s window', width: 350,
    node: (
      <Panel
        head={(
          <PanelHead
            lead={<ExecutorBadge executor="coder" />}
            title="Coder" badge="asks you" note="Quire · Webhook retry policy · 23:02"
            onMinimise={() => {}} onClose={() => {}}
          />
        )}
        foot={<Composer placeholder="Reply to Coder…" value="" onChange={() => {}} />}
      >
        <div style={{ fontSize: 13.5, lineHeight: 1.45, maxWidth: '94%' }}>
          Picking up the webhook retry ticket. One thing I can’t decide on my own:
        </div>
        <Quoted>{'today  3 attempts · 1, 5, 30 min → drop\nstripe up to 3 days · exponential'}</Quoted>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Pill label="Follow Stripe" face="amber" />
          <Pill label="Keep 3" face="outline" />
        </div>
      </Panel>
    ),
  },
  {
    name: 'DockTab', frame: 'Web12 W1 · the corner', width: 380,
    node: (
      <div style={{ display: 'flex', gap: 8 }}>
        <DockTab open label="Webhook retries" lead={<ExecutorBadge executor="coder" size={20} />} />
        <DockTab label="Gradle 8.7 build" lead={<ExecutorBadge executor="seo" size={20} />} />
        <DockMore n={1} />
      </div>
    ),
  },
  {
    name: 'CommandBar', frame: 'Web12 W1 · every desktop frame', width: 420,
    node: <CommandBar placeholder="Tell Divan anything…" />,
  },
  {
    name: 'Figures', frame: 'Web14 W6 · a branch card', width: 380,
    node: (
      <Card>
        <SectionHeader title="Engineering" right="live" tone="run" />
        <Figures figures={[
          { value: 4, label: 'open' },
          { value: 2, label: 'in progress' },
          { value: 48, label: 'done' },
        ]} />
      </Card>
    ),
  },
  {
    name: 'FiguresShort', frame: 'Web14 W6 · two of the three slots', width: 380,
    node: <Figures figures={[{ value: 3, label: 'open' }, { value: '212/214', label: 'tests', tone: 'red' }]} />,
  },
  {
    name: 'StampRow', frame: 'Web14 W6 · conversations filed here', width: 380,
    node: (
      <Card>
        <StampRow at="Tonight" text="Newsletter cut to 250 words, scheduled Thu 09:00" />
        <StampRow at="26 Sep" text="Created QUI-142 Bulk invite from your idea" />
      </Card>
    ),
  },
  {
    name: 'StampRowCode', frame: 'Web14 W8 · the live log', width: 380,
    node: (
      <Card>
        <StampRow code at="23:12" text="pnpm test → 11 passed" tone="run" />
        <StampRow code at="23:13" text="e2e timeout at 501 rows" tone="red" />
        <StampRow code at="23:13" text={'you: “batch the commit, 100 at a time”'} tone="amber" />
      </Card>
    ),
  },
  {
    name: 'FieldRow', frame: 'Web14 W8 · the details panel', width: 380,
    node: (
      <Card inset={false} style={{ padding: '4px 16px' }}>
        <FieldRow first label="Executor" value="Coder" lead={<ExecutorBadge executor="coder" size={22} />}
          note="studio" />
        <FieldRow label="Created by" value="Divan" note="from your chat" />
        <FieldRow label="Branch" value="Engineering" />
      </Card>
    ),
  },
  {
    name: 'Write', frame: 'Web14 W9 · the card being written', width: 380,
    node: (
      <Card ring="amber" raised radius={14}>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>
          <Write value="Export client list as CSV" onChange={() => {}} label="Title" />
        </div>
        <div style={{ fontSize: 13.5, lineHeight: '20px' }}>
          <Write lines={3} value="Studios keep asking to download their client list."
            onChange={() => {}} label="What to do" style={{ height: 60 }} />
        </div>
      </Card>
    ),
  },
  {
    name: 'Table', frame: 'Web15 W12 · the machines', width: 700,
    node: (
      <Table
        columns={[
          { width: '34px' }, { label: 'machine', width: 'minmax(0, 1.4fr)' },
          { label: 'state', width: '120px' }, { label: 'last contact', width: '110px' },
          { width: '110px' },
        ]}
        rows={[
          { key: 'studio', cells: [
            <StatusDot state="running" />,
            <NameCell mark title="studio" note="Mac Studio · macOS 15.1" />,
            <Cell text="reachable" tone="run" />, <Cell text="12s ago" />,
            <Button small face="outline" label="Terminal" />,
          ] },
          { key: 'mini', tone: 'amber', wash: true, cells: [
            <StatusDot state="asking" hollow />,
            <NameCell mark title="mini" note="Mac mini · macOS 15.0" />,
            <Cell text="unreachable" tone="amber" />, <Cell text="2h 14m ago" tone="amber" />,
            <Button small face="outline" label="Try again" />,
          ] },
        ]}
      />
    ),
  },
  {
    name: 'Slider', frame: 'Web15 W11 · a quota threshold', width: 380,
    node: (
      <Card>
        <Slider label="Warn on the system line at" value={0.2}
          format={(v) => `${Math.round(v * 100)}%`} onChange={() => {}} />
      </Card>
    ),
  },
  {
    name: 'Choice', frame: 'Web15 W18 · a setting answered', width: 380,
    node: (
      <Card inset={false} style={{ padding: '4px 0' }}>
        <Row first title="Theme" note="Follows this computer, which is dark right now"
          style={{ padding: '14px 20px' }}
          right={<Choice
            label="Theme" value="system" onChange={() => {}}
            options={[{ key: 'system', label: 'Auto' }, { key: 'light', label: 'Light' },
                      { key: 'dark', label: 'Dark' }]}
          />} />
      </Card>
    ),
  },
];

/** All of it, in one theme. `data-theme` is the whole of the switch: every
 *  colour in here is a custom property that attribute selects. */
export function Gallery({ scheme }: { scheme: Scheme }) {
  return (
    <div data-theme={scheme} style={{ background: T.bg, color: T.ink, padding: 32, minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 24 }}>
        <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-.02em' }}>Divan · {scheme}</span>
        <span style={{ ...mono, fontSize: 12, color: T.ink3 }}>
          {SPECIMENS.length} specimens · design/divan/frames
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32 }}>
        {SPECIMENS.map((s) => (
          <div key={s.name} style={{ width: s.width ?? 380, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ ...mono, fontSize: 11.5, fontWeight: 600 }}>{s.name}</span>
              <span style={{ ...mono, fontSize: 11, color: T.ink3 }} data-frame={s.frame}>{s.frame}</span>
            </div>
            <div style={{ display: 'flex', minHeight: 0 }}>{s.node}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The page the test writes out: both themes, one under the other, so that the
 *  pair can be looked at without switching anything. */
export function GalleryPage() {
  return (
    <>
      <style>{themeCss()}</style>
      <Gallery scheme="dark" />
      <Gallery scheme="light" />
    </>
  );
}
