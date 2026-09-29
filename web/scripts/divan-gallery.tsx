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
  BarChip, BarDivider, BarStamp, Button, Card, ColumnTab, Counter, EmptyState, ExecutorBadge,
  Monogram, NavItem, Pill, Row, SectionHeader, SidePanel, StateMark, StatusDot, Tabs, TopBar,
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
