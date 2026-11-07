import type { ApprovalResponse } from './lib/approval-input';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RADIUS, SHADOW, T, setThemeChoice, themeCss, useTheme } from './lib/theme';
import { KEYFRAMES, P, mono } from './ui/kit';
import { Button } from './ui/divan';
import { ListToggle, SIDEBAR_W, Sidebar } from './components/Sidebar';
import { Shell } from './components/Shell';
import { ChatView } from './components/ChatView';
import { ChatComposer } from './components/ChatComposer';
import { Asking, useAskingRoom } from './components/Asking';
import { NewChat } from './components/NewChat';
import { DraftHead } from './components/DraftHead';
import { Palette, type Command } from './components/Palette';
import { FieldSheet, accountName, type Field } from './components/FieldSheet';
import { ApprovalModal, isGone, type Pending } from './components/ApprovalModal';
import { Machine } from './screens/Machine';
import { Panes } from './screens/Panes';
import { usePanes } from './lib/panes';
import { Overview, type ProjectTab } from './screens/Overview';
import type { WorkLayout } from './screens/Work';
import { Composer } from './components/Composer';
import { Onboarding } from './screens/Onboarding';
import { useFleet, onAnyEvent, pokeAll, putChat } from './lib/fleet';
import { project as projectIn, useDivanView } from './lib/divan';
import { idOf } from './lib/sessions';
import {
  MACHINE_ASIDE, MACHINE_ROWS, PLACE_LABEL, PLACE_VIEW, chatNeedsYou, placeOf,
  updateWaiting, type View,
} from './lib/shell';
import {
  ABOUT_ONE, HOME, canonical, pathOf, placeOfState, readPlace, sameButMachine, sameButSearch, samePlace, searchOf,
  type Place,
} from './lib/nav';
import { useLogs, logKey, emptyLog } from './lib/timeline';
import { InboxBell } from './components/Inbox';
import { Report } from './components/Report';
import { Modal, ModalHead } from './components/Modal';
import { POLL_MS, announce, useInbox, type Notice } from './lib/inbox';
import { createGroup, deleteChat, interrupt, markSeen, respond, send, updateChat, upload } from './lib/actions';
import { unseen } from './lib/light';
import { idOfTold, tell, useTold, whereFor, type Scoped, type ToldPicks } from './lib/tell';
import type { Agent, Chat } from './lib/protocol';

interface Selection { hostKey: string; chatId: string }

export function App() {
  const fleet = useFleet();
  // Read for one reason: the palette has to offer the theme that is not on
  // screen. Nothing else in the panel re-renders on a theme change — the
  // colours are custom properties and the switch is one attribute on <html>.
  const theme = useTheme();
  const logs = useLogs();
  // Every product on every machine, merged here and read by both the bar and
  // the page under it. `now` comes back on the view, so the bar's clock and a
  // machine's age are the same moment.
  const divan = useDivanView();
  // The questions' floating windows are drawn on the Chat place too, and what
  // they cover of it is kept clear: the composer's send button above all.
  const askingRoom = useAskingRoom();
  // The panel opens on the Dashboard: it is the screen that is looked at instead
  // of a question being asked. The chat is a place you go to on purpose.
  /** Where the panel opens: whatever the address says. A link to a board, a
   *  card or a chat is a link to that, and a reload puts you back where you
   *  were rather than on the Dashboard. */
  const opened = useRef<Place>(
    typeof location === 'undefined' ? HOME : readPlace(location.pathname, location.search));
  const [view, setView] = useState<View>(opened.current.view);
  // Which product is being read lives in the address, the way the phone keeps it
  // in the route — so it survives a reload and a scoped page can be sent to
  // somebody.
  const [project, setProject] = useState<string | null>(opened.current.project);
  // Which tab of a scoped product is open. Beside the product rather than
  // inside the page, so that choosing another product lands on its Overview:
  // "the board" is a thing about one product, not a mode the panel is in.
  const [tab, setTab] = useState<ProjectTab>(opened.current.tab as ProjectTab);
  // Which card of that product is open. Beside the product for the same reason
  // the tab is: it is a place inside one product, and choosing another product
  // leaves it.
  const [card, setCard] = useState<string | null>(opened.current.card);
  const [sel, setSel] = useState<Selection | null>(null);
  /** The Chat place with no chat selected on purpose: New chat was pressed
   *  there, so its middle is the empty composer rather than the newest chat. */
  const [fresh, setFresh] = useState(opened.current.view === 'chats' && opened.current.sub === 'new');
  /** Which part of a Machine page is open: the Terminal's wall, a section of
   *  one computer's settings. In the address with the page (`Place.sub`). */
  const [sub, setSub] = useState<string | null>(opened.current.view === 'chats' ? null : opened.current.sub);
  const [newChat, setNewChat] = useState<{
    cwd?: string; groupId?: string; agent?: { agent: Agent; accountId: string | null };
    /** Started from a product's own page: on the computer that product is on,
     *  and read where it was started rather than in the Chat place. */
    host?: string | null; stay?: boolean;
  } | null>(null);
  const [palette, setPalette] = useState(false);
  const [field, setField] = useState<Field | null>(null);
  const [sending, setSending] = useState(false);
  const [liveTokens, setLiveTokens] = useState<number | null>(null);
  const [liveContext, setLiveContext] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  // Closed by hand: the chat still shows it, the dialog does not raise it again.
  const dismissed = useRef(new Set<string>());
  // Terminal mode opens a chat over the wall rather than leaving it: the point
  // of the wall is that you can answer one thing and still be looking at the
  // other eleven. It is the same selection the chat screen uses, so everything
  // hung off `sel` — the live token count, the approval queue, the field sheet
  // — works inside the overlay without a second copy of any of it.
  const [peek, setPeek] = useState(false);
  /** A ticket a card link in a chat asked for, with no card on any board: it is
   *  read on the queue's wall under Machine › Terminal. */
  const [ticket, setTicket] = useState<number | null>(opened.current.ticket);
  /** …and the chat that ticket was asked for from, so the way back is to it. */
  const [ticketFrom, setTicketFrom] = useState<Place | null>(null);
  /** What the Work board is narrowed to: which days, what is typed in its
   *  search box and which project. In the address with the page
   *  (`Place.range`, `Place.search`, `Place.workProject`). */
  /** The Havuz page's category (`/havuz?g=video`), held here for the reason
   *  the Work board's layout is: it is in the address. */
  const [poolGroup, setPoolGroup] = useState<string | null>(opened.current.group);
  const [workLayout, setWorkLayout] = useState<WorkLayout>({
    range: opened.current.range, search: opened.current.search ?? '', project: opened.current.workProject,
  });
  const searchRef = useRef<HTMLInputElement>(null);
  /** The Dashboard's Composer, which ⌘N and every "new chat" now lead to. */
  const composerRef = useRef<HTMLTextAreaElement>(null);
  /** …and the one at the foot of a product's page, where its New chat leads. */
  const projectComposerRef = useRef<HTMLTextAreaElement>(null);
  /** …and the Chat place's own empty composer, where New chat leads there. */
  const firstWordRef = useRef<HTMLTextAreaElement>(null);
  // What the empty chat's head was changed to; the next send opens with it.
  const [draftPicks, setDraftPicks] = useState<ToldPicks>({});

  // Whether the sidebar is a list or a rail. Remembered because it is a way of
  // working — terminal mode wants the width, the chat screen wants the list —
  // and re-picking it every morning is not a preference, it is a chore.
  const [rail, setRail] = useState(() => {
    try { return localStorage.getItem('rac.sidebar') === 'rail'; } catch { return false; }
  });
  // Functional, so the keyboard shortcut below can live in an effect that is
  // mounted once and still read the current state.
  const setRailTo = useCallback((next: boolean | 'toggle') => {
    setRail((cur) => {
      const on = next === 'toggle' ? !cur : next;
      try { localStorage.setItem('rac.sidebar', on ? 'rail' : 'open'); } catch { /* private mode */ }
      return on;
    });
  }, []);

  useEffect(() => { fleet.boot(); }, []);

  /** A card, from the id an address carries to the `host:id` this panel holds
   *  it by: the machine is whichever one has that card. A card the boards have
   *  not been read for yet cannot be found, and null is the honest answer —
   *  the effect below runs again when they arrive. */
  const cardKey = useCallback((id: string | null) => {
    if (!id) return null;
    const found = divan.cards.find((c) => c.id === id);
    return found ? `${found.host}:${found.id}` : null;
  }, [divan.cards]);

  /** …and the same for a chat: which computer holds it. */
  const hostOfChat = useCallback((id: string | null) => {
    if (!id) return null;
    return useFleet.getState().order
      .find((k) => useFleet.getState().hosts[k]?.chats.some((c) => c.id === id)) ?? null;
  }, []);

  /** Set when a place opens its newest chat on its own: that chat is the place
   *  arrived at, not a step from it, so it takes the entry over rather than
   *  pushing one Back would land on and bounce off. */
  const landing = useRef(false);

  // An address with a chat in it — "open in a new window", a link somebody
  // sent, or a reload of a chat that was open — is honoured once the computer
  // that owns it is connected. `select` rather than `open`: which page to be on
  // is the address's business too, and it already said.
  // Once: closing that chat is not a reason to open it again.
  const chatHonoured = useRef(false);
  useEffect(() => {
    if (chatHonoured.current || !fleet.ready) return;
    const chatId = opened.current.chat;
    if (!chatId || sel) { chatHonoured.current = true; return; }
    const wanted = opened.current.host;
    const key = wanted && fleet.hosts[wanted] ? wanted : hostOfChat(chatId);
    if (!key) return;
    chatHonoured.current = true;
    // The chat is the page that was opened, not a step from it.
    landing.current = true;
    select(key, chatId);
  }, [fleet.ready, fleet.hosts, sel, hostOfChat]);

  // …and the same for a card: a link to one is a link to a card on whichever
  // machine has it, and which machine that is cannot be known until that
  // computer has answered with its board.
  // Once: leaving that card is not a reason to open it again.
  const cardHonoured = useRef(false);
  useEffect(() => {
    if (cardHonoured.current || !opened.current.card) return;
    if (card && card !== opened.current.card) { cardHonoured.current = true; return; }
    const key = cardKey(opened.current.card);
    if (key) { cardHonoured.current = true; setCard(key); }
  }, [card, divan.cards, cardKey]);

  /** A computer's name, as a page about it says it in its address. */
  const nameOf = (key: string | null) => {
    const s = key ? fleet.hosts[key] : null;
    return s ? (s.info?.name || s.cfg.name || key) : null;
  };
  /** …and back: the computer an address names, if one paired here has it. */
  const keyOfName = useCallback((name: string | null) => {
    if (!name) return null;
    const { order, hosts } = useFleet.getState();
    return order.find((k) => (hosts[k]?.info?.name || hosts[k]?.cfg.name || k) === name) ?? null;
  }, []);
  /** The computer the opened address named, until the fleet can say which
   *  one that is: until then it is still the address's, not whichever one
   *  happens to be in focus. */
  const [wantMachine, setWantMachine] = useState<string | null>(opened.current.machine);
  useEffect(() => {
    if (!wantMachine || !fleet.ready) return;
    const key = keyOfName(wantMachine);
    if (key && useFleet.getState().focus !== key) fleet.setFocus(key);
    setWantMachine(null);
  }, [wantMachine, fleet.ready, fleet.order, keyOfName]);
  /** Which computer the page is about, where that is worth saying. */
  const machine = ABOUT_ONE.includes(view) && fleet.order.length > 1
    ? (wantMachine ?? nameOf(fleet.focus)) : null;

  /** Where the panel is, as one value: what goes in the address, and what the
   *  back button puts back. In the one shape its address reads back as
   *  (`canonical`), so a reload of it is the same value. */
  const where: Place = useMemo(() => canonical({
    view, project,
    // A product's page with no chat open on it is the product's page, whatever
    // was open a moment ago: one place, so one entry.
    tab: tab === 'chat' && !sel ? 'overview' : tab,
    // A card is named in the address by its own id. `host:id` is how this
    // browser reaches it and is nobody else's business — the machine is looked
    // up on the way back in, the way anybody opening the link would.
    card: card ? (card.split(':').pop() ?? null) : null,
    // A chat is part of where the panel is only where one is being read: the
    // Chat place, or a product's page with one open on it.
    chat: (view === 'chats' || (view === 'overview' && tab === 'chat')) ? sel?.chatId ?? null : null,
    // …and the computer is only in the address where a link carried one: a
    // popped-out window is told which machine, because it may be opened before
    // that machine has answered.
    host: opened.current.host && opened.current.chat === sel?.chatId ? opened.current.host : null,
    sub: view === 'chats' ? (fresh && !sel ? 'new' : null) : sub,
    ticket, machine, range: workLayout.range, search: workLayout.search || null,
    workProject: workLayout.project, group: poolGroup,
  }), [view, project, tab, card, sel?.chatId, fresh, sub, ticket, machine, workLayout, poolGroup]);
  const whereRef = useRef(where);
  whereRef.current = where;

  /** The entry the browser is on. Compared rather than trusted: a render for a
   *  board poll must not push a second copy of the page you are already on. */
  const shown = useRef<Place>(opened.current);
  /** Set while a `popstate` is being applied, so that putting the state back
   *  does not push the entry we have just gone back from. */
  const going = useRef(false);
  /** The page a card was opened from, while that card is open. */
  const [cameFrom, setCameFrom] = useState<Place | null>(null);
  /** The opened address has been written back in this build's shape. */
  const settled = useRef(false);
  /** Set by a change that takes the entry it is on over rather than adding
   *  one: a chat deleted from under you is not a page Back should return to. */
  const replacing = useRef(false);

  useEffect(() => {
    if (typeof history === 'undefined') return;
    if (going.current) { going.current = false; shown.current = where; return; }
    const url = pathOf(where) + searchOf(where);
    // The address the panel was opened on is written over once, in the shape
    // this build writes it — that entry is this page, not a step away from it —
    // and every move after it is a step Back can undo.
    if (!settled.current) {
      settled.current = true;
      shown.current = where;
      // …carrying its place, as every entry after it does.
      history.replaceState(where, '', url);
      return;
    }
    if (samePlace(shown.current, where)) return;
    // A card opened by a press in the panel remembers the page it was opened
    // from, so its Back is the browser's own Back and lands there. A card the
    // panel was opened on has no such page, and its Back is its product's board.
    if (where.card && where.card !== shown.current.card) setCameFrom(shown.current);
    // Another computer picked on a page about one is that page still.
    // …and a letter typed into the Work board's search is not a step.
    const over = replacing.current || sameButMachine(shown.current, where) || sameButSearch(shown.current, where)
      || (landing.current && !!where.chat && !shown.current.chat);
    if (over) history.replaceState(where, '', url);
    else history.pushState(where, '', url);
    landing.current = false;
    replacing.current = false;
    shown.current = where;
  }, [where]);

  /** The product the Dashboard is scoped to, as much of it as a new chat needs:
   *  which computers have it and which folders it owns. Null on the unscoped
   *  page, which is a chat about nothing in particular. */
  const scope: Scoped | null = useMemo(() => {
    const p = projectIn(divan, project);
    return p ? { name: p.name, repos: p.repos, hosts: p.hosts } : null;
  }, [divan, project]);

  /** Which of the three the panel is in, worked out from the screen rather than
   *  held beside it: a place and the page it is on cannot then disagree. */
  const place = placeOf(view);
  /** The same, for handlers mounted once (the keyboard) that must still know
   *  which place a press came from. */
  const placeRef = useRef(place);
  placeRef.current = place;

  /** The two lights the old sidebar carried on its rows, now on the place each
   *  belongs to: a chat that cannot go on until somebody allows something, and
   *  a computer running something older than what it has in hand. */
  const dots = useMemo(() => {
    const out: { chat?: 'asking'; machine?: 'asking' } = {};
    for (const key of fleet.order) {
      const slot = fleet.hosts[key];
      if (!slot) continue;
      if (chatNeedsYou(slot.chats)) out.chat = 'asking';
      if (updateWaiting(slot.info?.update)) out.machine = 'asking';
    }
    return out;
  }, [fleet.hosts, fleet.order]);

  /** Where the left end of the line leads: up one level, and on the Dashboard
   *  nowhere — it is the word. */
  const scopedName = projectIn(divan, project)?.name ?? project;
  const from = card ? cameFrom : null;
  const back = view === 'terminal' && ticket != null && ticketFrom
    ? { label: placeName(ticketFrom, divan), onBack: () => history.back() }
    : view !== 'overview'
    ? { label: 'Dashboard', onBack: () => go(HOME) }
    : project && card
      ? (from
        ? { label: placeName(from, divan), onBack: () => history.back() }
        : { label: `${scopedName ?? 'Project'} · Board`, onBack: () => { setCard(null); setTab('board'); } })
        : project && (tab === 'board' || (tab === 'chat' && sel))
          ? { label: scopedName ?? 'Project', onBack: () => setTab('overview') }
          : project
          ? { label: 'Dashboard', onBack: () => chooseProject(null) }
          : tab === 'waiting' || tab === 'work' || tab === 'havuz'
            ? { label: 'Dashboard', onBack: () => setTab('overview') }
            : null;

  const slot = sel ? fleet.hosts[sel.hostKey] : (fleet.focus ? fleet.hosts[fleet.focus] : null);
  const chat: Chat | null = useMemo(() => {
    if (!sel) return null;
    return fleet.hosts[sel.hostKey]?.chats.find((c) => c.id === sel.chatId) ?? null;
  }, [sel, fleet.hosts]);

  const log = sel ? (logs.logs[logKey(sel.hostKey, sel.chatId)] ?? emptyLog()) : emptyLog();

  const select = useCallback((hostKey: string, chatId: string) => {
    setSel({ hostKey, chatId });
    setFresh(false);
    if (useFleet.getState().focus !== hostKey) fleet.setFocus(hostKey);
    logs.open(hostKey, chatId);
  }, []);

  // …and the other direction: the browser hands an entry back, and the panel
  // is drawn where that entry says. Never a push, or Back would be a loop.
  const cardKeyRef = useRef(cardKey);
  cardKeyRef.current = cardKey;

  /** The panel, drawn where a place says — every field of it, so that what is
   *  on screen and what the address says cannot drift apart. A move made with
   *  this pushes one entry (the effect above); Back is this with the entry the
   *  browser handed back. */
  const go = useCallback((to: Place) => {
    setView(to.view);
    setProject(to.project);
    setTab(to.tab as ProjectTab);
    setCard(cardKeyRef.current(to.card) ?? (to.card || null));
    setSub(to.view === 'chats' ? null : to.sub);
    setTicket(to.ticket);
    setWorkLayout((had) => (had.range === to.range && had.search === (to.search ?? '') && had.project === to.workProject
      ? had : { range: to.range, search: to.search ?? '', project: to.workProject }));
    setPoolGroup(to.group);
    setPeek(false);
    const key = keyOfName(to.machine);
    if (key && useFleet.getState().focus !== key) useFleet.getState().setFocus(key);
    const host = to.host ?? hostOfChat(to.chat);
    if (host && to.chat) select(host, to.chat);
    // The Chat place with `new` in its entry is the empty composer New chat
    // left there, not a place to land on the newest chat again.
    else if (to.view === 'chats' || to.chat) { setSel(null); setFresh(to.sub === 'new'); }
  }, [select, keyOfName, hostOfChat]);

  /** A page of the Machine place or a place of the line, as a press on its
   *  button means it: that page, at its own first part. The Chat place keeps
   *  the chat it had open. */
  const goView = useCallback((v: View, part: string | null = null) => {
    if (v === 'chats') { setView('chats'); setPeek(false); return; }
    go({ ...HOME, view: v, sub: part });
  }, [go]);

  // …and the other direction: the browser hands an entry back, and the panel
  // is drawn where that entry says. Never a push, or Back would be a loop.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const to: Place = canonical((e.state && typeof e.state === 'object' && 'view' in e.state)
        ? placeOfState(e.state as Partial<Place>)
        : readPlace(location.pathname, location.search));
      // An entry that draws what is already drawn changes nothing, and there
      // would be no write for the flag to be spent on.
      if (samePlace(to, whereRef.current)) { shown.current = to; return; }
      going.current = true;
      shown.current = to;
      setTicketFrom(null);
      go(to);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [go]);

  const scopedTo = projectIn(divan, project);

  // The Chat place opens writable, on the newest conversation, without anybody
  // choosing one. An address that names a chat is honoured instead (above).
  useEffect(() => {
    if (view !== 'chats' || sel || fresh || !fleet.ready) return;
    if (opened.current.chat && opened.current.view === 'chats') return;
    const newest = fleet.order
      .flatMap((k) => (fleet.hosts[k]?.chats ?? []).filter((c) => !c.archived).map((c) => ({ k, c })))
      .sort((a, b) => b.c.updated_at - a.c.updated_at)[0];
    if (newest) { landing.current = true; select(newest.k, newest.c.id); }
  }, [view, sel, fresh, fleet.ready, fleet.hosts, fleet.order]);

  // An empty composer asked for in the Chat place is for that visit: coming
  // back to the place later opens on the newest chat again.
  useEffect(() => { if (view !== 'chats') setFresh(false); }, [view]);

  // A ticket handed to the Terminal tab is for that one visit.
  useEffect(() => { if (view !== 'terminal') { setTicket(null); setTicketFrom(null); } }, [view]);

  const open = useCallback((hostKey: string, chatId: string) => {
    select(hostKey, chatId);
    setPeek(false);
    setView('chats');
  }, [select]);

  /** A chip in the project bar, or a row on the Dashboard: the same thing, and
   *  both of them scope this page rather than opening another one — which is
   *  why neither can be pressed from anywhere else.
   *
   *  It does not touch the address itself. Where the panel is is one value and
   *  one effect writes it, which is what makes the back button work: this used
   *  to `replaceState` a product into the URL, and that is exactly the entry
   *  Back needed and never had. */
  const chooseProject = useCallback((key: string | null) => {
    setProject(key);
    setTab('overview');
    setCard(null);
  }, []);

  /** One of a product's chats, read in the middle of that product's page. */
  const openHere = useCallback((hostKey: string, chatId: string) => {
    select(hostKey, chatId);
    setCard(null);
    setTab('chat');
  }, [select]);

  /** A new chat is written in the Composer: home, and the field focused.
   *  In the Chat place it is written right there instead — the list stays on
   *  the left, nothing is selected, and the middle is the empty composer. */
  const compose = useCallback(() => {
    if (placeRef.current === 'chat') {
      setView('chats');
      setSel(null);
      setFresh(true);
      setPeek(false);
      setTimeout(() => firstWordRef.current?.focus(), 0);
      return;
    }
    go(HOME);
    setTimeout(() => composerRef.current?.focus(), 0);
  }, [go]);

  /** Ask: a chat with these words in it, read on its product's page — the
   *  product's other chats beside it. The product is the one the Project chip
   *  named, failing that the one the computer filed the chat under; a chat
   *  that belongs to none has only the Chat place to be read in. */
  const ask = useCallback(async (text: string, key: string | null, picks: ToldPicks, files: File[] = []) => {
    const p = projectIn(divan, key);
    const told = await tell(text, p ? { name: p.name, repos: p.repos, hosts: p.hosts } : null, picks, files);
    // It is read where chats are read, not as a window on the Dashboard.
    useTold.getState().close(idOfTold(told));
    const home = p ?? (told.projectId
      ? divan.projects.find((q) => q.ids[told.host] === told.projectId) ?? null : null);
    if (!home) { open(told.host, told.chatId); return; }
    setProject(home.key);
    openHere(told.host, told.chatId);
  }, [divan, open, openHere]);

  /** A notice from the queue, pressed: the chat it was put in, where Hermes
   *  has said what it wants and the answer goes. A notice with no chat (a kind
   *  that opens none, an older daemon) is its ticket's page, under its product;
   *  a ticket with no card on the board (filed before the board mirrored, or
   *  on a machine whose board has not answered) gets its report on its own. */
  const [reportOf, setReportOf] = useState<Notice | null>(null);
  const openNotice = useCallback((n: Notice) => {
    if (n.chat) { open(n.host, n.chat); return; }
    const found = n.ticket == null ? null
      : divan.cards.find((c) => c.host === n.host && c.ustabasi_id === n.ticket);
    if (!found) { setReportOf(n); return; }
    go({ ...HOME, project: found.projectKey, tab: 'board', card: `${found.host}:${found.id}` });
  }, [divan.cards, go, open]);
  const openNoticeRef = useRef(openNotice);
  openNoticeRef.current = openNotice;

  // The inbox: every computer polled for what its queue sent since the last
  // answer, and a browser notification for whatever arrives while this is open.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const news = await useInbox.getState().poll();
      if (alive) for (const n of news) announce(n, (x) => openNoticeRef.current(x));
    };
    void tick();
    const t = setInterval(() => { void tick(); }, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // The chat on screen catches itself up the moment its computer answers
  // again. Without this a panel that was asleep, or whose socket died quietly
  // under a long turn, goes on drawing the timeline it had when the connection
  // went — and every event it missed is a hole no later event fills, because
  // the live feed only ever appends.
  const selStatus = sel ? (fleet.hosts[sel.hostKey]?.status ?? null) : null;
  useEffect(() => {
    if (!sel || selStatus !== 'online') return;
    void useLogs.getState().open(sel.hostKey, sel.chatId);
  }, [sel?.hostKey, sel?.chatId, selStatus]);

  // The chat being read is seen: its light goes out here and on the phone.
  // Asked again whenever a turn ends in it while it is on screen, and when the
  // tab comes back — a hidden tab is not anybody looking.
  const reading = sel && (view === 'chats' || (view === 'overview' && tab === 'chat')) ? sel : null;
  const readChat = reading ? fleet.hosts[reading.hostKey]?.chats.find((c) => c.id === reading.chatId) : undefined;
  const [tabShown, setTabShown] = useState(() => !document.hidden);
  useEffect(() => {
    const look = () => setTabShown(!document.hidden);
    document.addEventListener('visibilitychange', look);
    return () => document.removeEventListener('visibilitychange', look);
  }, []);
  useEffect(() => {
    if (!reading || !readChat || !tabShown || !unseen(readChat)) return;
    markSeen(reading.hostKey, reading.chatId).catch(() => { /* an older computer; nothing lit there */ });
  }, [reading?.hostKey, reading?.chatId, readChat?.done_at, readChat?.seen_at, tabShown]);

  // A tab in the background is where sockets go to die unnoticed.
  useEffect(() => {
    const wake = () => { if (!document.hidden) pokeAll(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    };
  }, []);

  // Live token count belongs to the turn that is running, not to the chat, so
  // it is dropped the moment that turn ends rather than lingering as a total.
  useEffect(() => {
    if (!sel) return;
    return onAnyEvent((k, ev) => {
      if (k !== sel.hostKey || ev.chat_id !== sel.chatId) return;
      if (ev.event === 'turn.progress') {
        setLiveTokens(ev.data?.output_tokens ?? null);
        if (ev.data?.context_tokens) setLiveContext(ev.data.context_tokens);
      }
      if (ev.event === 'turn.done' || ev.event === 'turn.error' || ev.event === 'turn.started') setLiveTokens(null);
      // The finished turn carries the figure itself; the one in flight is only
      // worth holding while there is one.
      if (ev.event === 'turn.done' || ev.event === 'turn.error') setLiveContext(null);
    });
  }, [sel?.hostKey, sel?.chatId]);
  // …and it belongs to the chat it was measured in.
  useEffect(() => { setLiveContext(null); }, [sel?.hostKey, sel?.chatId]);

  // Approvals from every paired computer, not just the chat on screen. A
  // destructive command sitting on a chat nobody has open is the exact thing
  // this panel is here to catch, so the queue is filled two ways: live events,
  // and a read of any chat the daemon already reports as waiting.
  useEffect(() => onAnyEvent((key, ev) => {
    if (!ev.chat_id) return;
    if (ev.event === 'approval.request') {
      const d: any = ev.data ?? {};
      const slot = useFleet.getState().hosts[key];
      setPending((q) => (
        q.some((p) => p.requestId === d.request_id) ? q : [...q, {
          hostKey: key, hostName: slot?.info?.name ?? slot?.cfg.name ?? key,
          chatId: ev.chat_id!, requestId: d.request_id, tool: d.tool ?? '?',
          input: d.input ?? {}, preview: d.preview ?? '', danger: !!d.danger,
          reason: d.reason ?? null, ts: ev.ts,
        }]
      ));
    }
    if (ev.event === 'approval.resolved') {
      const rid = (ev.data as any)?.request_id;
      setPending((q) => q.filter((p) => p.requestId !== rid));
    }
  }), []);

  // Cold start: a chat can already be waiting when the panel opens. Reading it
  // once fills in the request the live stream never carried.
  const waiting = useMemo(() => fleet.order.flatMap((k) =>
    (fleet.hosts[k]?.chats ?? [])
      .filter((c) => c.status === 'awaiting_approval')
      .map((c) => `${k}/${c.id}`)), [fleet.hosts, fleet.order]);

  useEffect(() => {
    for (const id of waiting) {
      const [hostKey, chatId] = [id.slice(0, id.lastIndexOf('/')), id.slice(id.lastIndexOf('/') + 1)];
      if (pending.some((p) => p.hostKey === hostKey && p.chatId === chatId)) continue;
      const existing = useLogs.getState().logs[logKey(hostKey, chatId)];
      if (!existing) { useLogs.getState().open(hostKey, chatId); continue; }
      const slot = useFleet.getState().hosts[hostKey];
      // Only what the daemon says it still holds. An unanswered card in the log
      // is not enough: one that died unresolved can never be answered.
      const open = existing.items.filter((it: any) => it.kind === 'approval' && it.decision == null
        && existing.pending.includes(it.requestId) && !dismissed.current.has(it.requestId));
      if (!open.length) continue;
      setPending((q) => {
        const add = open
          .filter((it: any) => !q.some((p) => p.requestId === it.requestId))
          .map((it: any) => ({
            hostKey, hostName: slot?.info?.name ?? slot?.cfg.name ?? hostKey, chatId,
            requestId: it.requestId, tool: it.tool, input: it.input, preview: it.preview,
            danger: it.danger, reason: it.reason, ts: it.ts,
          }));
        return add.length ? [...q, ...add] : q;
      });
    }
  }, [waiting, logs.logs, pending]);

  const blocking = pending.find((p) => p.danger) ?? null;

  // Escape closes the chat held over terminal mode — but only when it is the
  // topmost thing. A field sheet or an approval opened from inside it gets the
  // key first, and taking the chat out from under them would answer a question
  // nobody asked.
  useEffect(() => {
    if (!peek || palette || field || blocking) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPeek(false); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [peek, palette, field, blocking]);

  const doSend = async (text: string, attachments: any[] = []) => {
    if (!sel) return;
    setSending(true);
    try { await send(sel.hostKey, sel.chatId, text, attachments); }
    catch (e) { console.error(e); }
    finally { setSending(false); }
  };

  // The upload happens as the file is chosen; the send waits for the composer,
  // so a picture can be looked at (and captioned) before the agent gets it.
  const doUpload = async (f: File) => {
    if (!sel) throw new Error('No chat open');
    return upload(sel.hostKey, sel.chatId, f);
  };

  // Which sign-in this chat spends, and how full it is. `account.list` shells
  // out to the CLIs, so it is asked for once the chat screen actually needs it.
  const accountKey = chat ? (chat.account_id || `default-${chat.provider}`) : null;
  const account = accountKey && slot
    ? slot.accounts.find((a) => a.id === accountKey) ?? null
    : null;
  const accountLabel = account ? accountName(account) : null;
  const accountLimits = accountKey && slot ? slot.limits[accountKey] : undefined;
  const accountUsage = useMemo(() => {
    const top = (accountLimits ?? [])
      .filter((w) => typeof w.utilization === 'number')
      .sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))[0];
    return top ? (top.utilization ?? 0) : null;
  }, [accountLimits]);

  // Asked of the computer the open chat is on — on the All computers list that
  // is not always the one in focus — and asked again each time it comes back
  // online, so a list that failed or went stale is not kept until a reload.
  const chatHost = sel?.hostKey ?? fleet.focus;
  const chatSlot = chatHost ? fleet.hosts[chatHost] : undefined;
  const accountsRead = useRef(new Map<string, number | null>());
  useEffect(() => {
    if (view !== 'chats' || !chatHost) return;
    const s = useFleet.getState().hosts[chatHost];
    if (s?.status !== 'online' || s.loading.accounts) return;
    const fresh = accountsRead.current.has(chatHost) && accountsRead.current.get(chatHost) === s.lastOnline;
    if (fresh && s.accounts.length && !s.accountsError) return;
    accountsRead.current.set(chatHost, s.lastOnline);
    fleet.refreshAccounts(chatHost).catch(() => {});
  }, [view, chatHost, chatSlot?.status, chatSlot?.lastOnline]);

  // The Account sheet reads the list afresh every time it is opened: it is the
  // one place a person goes to see which sign-ins work, and what was read
  // before may say they are all signed out.
  useEffect(() => {
    if (field !== 'account_id' || !sel) return;
    fleet.refreshAccounts(sel.hostKey).catch(() => {});
  }, [field, sel?.hostKey]);

  // The chat surface is drawn in two places — as the chat screen, and held over
  // terminal mode — and both are looking at the same selection. One set of
  // handlers, so what the overlay does cannot drift from what the screen does.
  const popOut = () => {
    if (!sel) return;
    const to: Place = { ...HOME, view: 'chats', chat: sel.chatId, host: sel.hostKey };
    window.open(pathOf(to) + searchOf(to), '_blank', 'width=1100,height=860');
  };

  /** The product this conversation is filed under, by the name the board
   *  gives it. */
  const filedIn = chat?.project_id && sel
    ? divan.projects.find((p) => p.ids[sel.hostKey] === chat.project_id) ?? null
    : null;
  const filedUnder = filedIn?.name ?? null;
  /** The same product, for the middle of the chat's head: its name, and the
   *  key its own page is addressed by. */
  const filedProject = useMemo(
    () => (filedIn ? { name: filedIn.name, key: filedIn.key } : null), [filedIn?.name, filedIn?.key]);
  /** Dashboard, from the chat's head: that product's own page. One move, so
   *  one entry, and Back is the chat again. */
  const toDashboard = useCallback((key: string) => {
    setPeek(false);
    setView('overview');
    chooseProject(key);
  }, [chooseProject]);
  /** A card the conversation filed: its card on a board where there is one,
   *  and the queue's own wall where there is not. */
  const tickets = {
    open: (id: number) => {
      const found = divan.cards.find((c) => c.ustabasi_id === id);
      setPeek(false);
      if (found) {
        go({ ...HOME, project: found.projectKey, tab: 'board', card: `${found.host}:${found.id}` });
        return;
      }
      go({ ...HOME, view: 'terminal', sub: 'ustabasi', ticket: id });
      setTicketFrom(where);
    },
    describe: (id: number) => {
      const found = divan.cards.find((c) => c.ustabasi_id === id);
      return found ? {
        column: COLUMN_WORD[found.column] ?? found.column, title: found.title,
        project: divan.projects.find((p) => p.key === found.projectKey)?.name ?? null,
      } : null;
    },
  };

  /** A ticket pressed on the Work page: the same page the wall and a product's
   *  page open — its card on a board where it has one, the queue's wall on the
   *  computer it is on where it has none. */
  const openTicket = useCallback((host: string, id: number) => {
    const found = divan.cards.find((c) => c.host === host && c.ustabasi_id === id);
    if (found) {
      go({ ...HOME, project: found.projectKey, tab: 'board', card: `${found.host}:${found.id}` });
      return;
    }
    if (useFleet.getState().focus !== host) useFleet.getState().setFocus(host);
    go({ ...HOME, view: 'terminal', sub: 'ustabasi', ticket: id });
    setTicketFrom(where);
  }, [divan.cards, go, where]);

  const chatProps = {
    chat, hostKey: sel?.hostKey ?? null, log, sending, filedUnder, tickets,
    project: filedProject, onDashboard: toDashboard,
    groupName: chat?.group_id
      ? (slot?.groups.find((g) => g.id === chat.group_id)?.name ?? null)
      : null,
    accountLabel,
    accountUsage,
    accountLimits,
    now: divan.now,
    liveContext,
    liveTokens,
    onPopOut: popOut,
    groups: slot?.groups ?? [],
    onSend: doSend,
    onUpload: doUpload,
    onInterrupt: () => { if (sel) interrupt(sel.hostKey, sel.chatId).catch(() => {}); },
    onRespond: (rid: string, d: 'allow' | 'allow_session' | 'deny', response?: ApprovalResponse) => {
      if (!sel) return Promise.reject(new Error('Chat unavailable'));
      return respond(sel.hostKey, sel.chatId, rid, d, response);
    },
    onEdit: setField,
    onUpdate: (patch: Record<string, any>) => {
      if (!sel) return;
      const { hostKey } = sel;
      return updateChat(hostKey, sel.chatId, patch)
        .then((chat) => { if (chat?.id) putChat(hostKey, chat); })
        .catch(() => {});
    },
    // A group made from a chat's own menu is made for that chat, so the two
    // go out together: the name, and then the chat into what it named.
    onNewGroup: async (name: string) => {
      if (!sel) return;
      const made = await createGroup(sel.hostKey, name);
      await updateChat(sel.hostKey, sel.chatId, { group_id: made.id });
    },
    onDelete: () => {
      if (!sel) return;
      const { hostKey, chatId } = sel;
      // The chat is gone, and so is its page: Back is not to a chat that is not there.
      replacing.current = true;
      setSel(null);
      setPeek(false);
      deleteChat(hostKey, chatId).catch(() => {});
    },
  };

  const commands: Command[] = useMemo(() => {
    const list: Command[] = [
      { id: 'new', label: 'New chat', shortcut: '⌘N', hint: 'in the Composer', run: compose },
      { id: 'new-options', label: 'New chat with every option', hint: slot?.info?.name, run: () => setNewChat({}) },
      // The three places first, then every page of the third one: the palette is
      // the one list of everywhere you can go, so it says the same thing the
      // shell does and in the same order.
      { id: 'dashboard', label: PLACE_LABEL.dashboard, hint: 'every product', run: () => goView(PLACE_VIEW.dashboard) },
      { id: 'chat', label: PLACE_LABEL.chat, hint: slot?.info?.name, run: () => goView(PLACE_VIEW.chat) },
      { id: 'machine', label: PLACE_LABEL.machine, hint: 'the computers', run: () => goView(PLACE_VIEW.machine) },
      // The line's own button: Settings, which is a tab of the Machine place.
      { id: 'settings-line', label: 'Settings', shortcut: '⌘,', hint: 'the button on the line', run: () => goView('settings') },
      ...MACHINE_ROWS.map((row) => ({
        id: row.view,
        label: `${PLACE_LABEL.machine} › ${row.label}`,
        shortcut: row.shortcut,
        run: () => goView(row.view),
      })),
      // …and the pages that have no row of their own, by name: they are opened
      // from the page above them, and a page you can only reach by remembering
      // which button it is behind is a page that was mislaid.
      ...MACHINE_ASIDE.map((aside) => ({
        id: aside.view,
        label: `${PLACE_LABEL.machine} › ${aside.label}`,
        run: () => goView(aside.view),
      })),
      {
        id: 'theme',
        label: theme.scheme === 'dark' ? 'Light theme' : 'Dark theme',
        hint: theme.choice === 'system' ? 'following this computer' : 'set by hand',
        run: () => setThemeChoice(theme.scheme === 'dark' ? 'light' : 'dark'),
      },
    ];
    // Only means anything with more than one computer paired.
    if (fleet.order.length > 1) {
      list.push({
        id: 'all-hosts',
        label: fleet.allHosts ? 'Show one computer' : 'Show every computer',
        hint: fleet.allHosts ? (slot?.info?.name ?? undefined) : `${fleet.order.length} paired`,
        run: () => { fleet.setAllHosts(!fleet.allHosts); goView(PLACE_VIEW.chat); },
      });
    }
    const running = fleet.order.flatMap((k) =>
      (fleet.hosts[k]?.chats ?? []).filter((c) => c.status !== 'idle').map((c) => ({ k, c })));
    if (running.length) {
      list.push({
        id: 'stop-all',
        label: 'Stop every session',
        hint: `${running.length} running`,
        danger: true,
        run: () => { for (const r of running) interrupt(r.k, r.c.id).catch(() => {}); },
      });
    }
    return list;
  }, [fleet.hosts, fleet.order, fleet.allHosts, slot?.info?.name, theme.scheme, theme.choice, compose, goView]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === 'k') { e.preventDefault(); setPalette((p) => !p); }
      else if (e.key === 'b') { e.preventDefault(); setRailTo('toggle'); }
      else if (e.key === 'n') { e.preventDefault(); compose(); }
      else if (e.key === 'f') { e.preventDefault(); goView('chats'); setTimeout(() => searchRef.current?.focus(), 0); }
      else if (e.key === ',') { e.preventDefault(); goView('settings'); }
      // No digit is taken. ⌘/Ctrl with 1–9 picks a tab and with 0 resets the
      // zoom, and those are the browser's: the pages they used to open here are
      // in the palette and on the Machine place's own tabs.
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (fleet.ready && !fleet.order.length) {
    return (
      <>
        <style>{themeCss()}</style>
        <style>{KEYFRAMES}</style>
        <Onboarding onPaired={() => go(HOME)} />
      </>
    );
  }

  return (
    <>
      <style>{themeCss()}</style>
      <style>{KEYFRAMES}</style>
      <Shell
        view={view} onView={goView} fleet={divan} dots={dots}
        onHome={() => go(HOME)}
        back={back}
        work={{
          on: view === 'overview' && !project && tab === 'work',
          onOpen: () => go({ ...HOME, tab: 'work' }),
        }}
        inbox={<InboxBell onOpen={openNotice} />}
        // Hiding the chat list is on this line, over the list; the rail it
        // leaves behind has the way back.
        lead={place === 'chat' && !rail
          ? { node: <ListToggle shown onClick={() => setRailTo(true)} />, width: SIDEBAR_W } : null}
      >
        {place === 'dashboard' && (
          <Overview
            view={divan} project={projectIn(divan, project)} onProject={chooseProject}
            composer={(
              <Composer view={divan} onAsk={ask} inputRef={composerRef}
                onOptions={() => setNewChat({})} />
            )}
            onOpenCard={(c) => { setProject(c.projectKey); setTab('board'); setCard(idOf(c)); }}
            onOpenChat={open}
            onOpenTicket={openTicket}
            work={workLayout} onWork={setWorkLayout}
            group={poolGroup} onGroup={setPoolGroup}
            // The Composer at the foot of a product: everything it sends is
            // about that product, and the chat it starts is read right here,
            // in the middle of the product's page, with the list beside it.
            projectComposer={scopedTo ? (
              <Composer view={divan} lock={scopedTo.key} inputRef={projectComposerRef}
                onAsk={async (text, _key, picks, files) => {
                  const told = await tell(text, scope, picks, files);
                  useTold.getState().close(idOfTold(told));
                  openHere(told.host, told.chatId);
                }}
                onOptions={() => {
                  const at = whereFor(scope, fleet.hosts, fleet.focus);
                  setNewChat({ cwd: at.cwd ?? undefined, host: at.host, stay: true });
                }} />
            ) : null}
            tab={tab} onTab={setTab}
            card={card} onCard={setCard}
            // The product's own chats: the list is only the ones filed under
            // it, down the left of every page of the product, and the one that
            // is open is read in the middle. New chat is the product's page
            // with its Composer in hand — no dialog, and nowhere else to go.
            chats={scopedTo ? {
              list: (
                <Sidebar
                  project={scopedTo}
                  selected={tab === 'chat' ? sel?.chatId ?? null : null}
                  selectedHost={tab === 'chat' ? sel?.hostKey ?? null : null}
                  onSelect={openHere}
                  onNewChat={() => {
                    setCard(null); setTab('overview');
                    setTimeout(() => projectComposerRef.current?.focus(), 0);
                  }}
                />
              ),
              open: chat ? <ChatView {...chatProps} onCloseView={() => setTab('overview')} /> : null,
            } : null}
          />
        )}

        {/* The chat list down the left, and the newest conversation open and
            writable beside it the moment the place is entered — or, on the
            Panes page, several chats at once: the same list down the left,
            and every chat dragged off it (or pressed in it) a pane beside the
            others. */}
        {place === 'chat' && (view === 'panes' ? (
          <div className="dv-chatpane" data-panes-screen="" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
            <Sidebar
              selected={null} selectedHost={null}
              onSelect={(hostKey, chatId) => usePanes.getState().open(hostKey, chatId)}
              dragOut
              onNewChat={compose}
              onNewChatIn={(host, cwd, groupId) => setNewChat({ host, cwd, groupId })}
              searchRef={searchRef}
              collapsed={rail} onCollapse={setRailTo}
            />
            <Panes />
          </div>
        ) : (
          <div className="dv-chatpane" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
            <Sidebar
              selected={sel?.chatId ?? null} selectedHost={sel?.hostKey ?? null} onSelect={open}
              onNewChat={compose}
              onNewChatIn={(host, cwd, groupId) => setNewChat({ host, cwd, groupId })}
              searchRef={searchRef}
              collapsed={rail} onCollapse={setRailTo}
            />
            <div data-chat-column="" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', paddingRight: askingRoom }}>
              {chat ? <ChatView {...chatProps} /> : (
                // No conversation yet: a chat's own box, with no chat under it.
                // What is said in it opens one with every default this
                // computer has (`tell`) — nothing is chosen first, and nothing
                // is made on the computer until it is sent.
                <div data-first-word style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  {!!fleet.focus && <DraftHead hostKey={fleet.focus} picks={draftPicks} onPicks={setDraftPicks} />}
                  <div style={{ flex: 1 }} />
                  <p className="dv-meta" style={{ margin: '0 0 4px', textAlign: 'center' }}>No conversation yet.</p>
                  <div style={{ width: '100%', maxWidth: 800, margin: '0 auto', flexShrink: 0 }}>
                    <ChatComposer
                      chat={null} hostKey={fleet.focus ?? ''} busy={false} sending={false}
                      placeholder="Talk to Hermes" autoFocus={fresh} fieldRef={firstWordRef}
                      onInterrupt={() => {}}
                      onSend={async (text, held) => {
                        const told = await tell(text, null, draftPicks, held.map((a) => a.file));
                        setDraftPicks({});
                        useTold.getState().close(idOfTold(told));
                        // The chat takes over the empty composer's entry: Back
                        // from it is the chat that was open before New chat.
                        landing.current = true;
                        select(told.host, told.chatId);
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            {/* What agents are asking, as on the Dashboard: the same windows
                from the same store, not rows in the list. */}
            <Asking view={divan} />
          </div>
        ))}

        {place === 'machine' && (
          <Machine
            view={view} onView={goView} fleet={divan}
            sub={sub} onSub={(part) => setSub(part)}
            onTicket={(id) => { setTicketFrom(null); setTicket(id); }}
            onOpenChat={open}
            onNewChat={compose}
            onNewChatIn={(cwd) => setNewChat({ cwd })}
            onStartChat={(agent, accountId) => setNewChat({ agent: { agent, accountId } })}
            onPeek={(hostKey, chatId) => { select(hostKey, chatId); setPeek(true); }}
            ticket={ticket}
          />
        )}
      </Shell>

      {reportOf?.ticket != null && (
        <Modal onClose={() => setReportOf(null)} width={760}>
          <ModalHead title={`#${reportOf.ticket} ${reportOf.title}`} subtitle={reportOf.project ?? undefined}
            onClose={() => setReportOf(null)} />
          <div style={{ overflowY: 'auto', padding: 20 }}>
            <Report host={reportOf.host} ticket={reportOf.ticket} status={reportOf.status} />
          </div>
        </Modal>
      )}

      {/* A chat answered without leaving the wall. It is the whole chat — the
          same timeline, the same composer, the same approvals — because half a
          chat is the thing that sends you to the other screen anyway. */}
      {view === 'terminal' && peek && chat && sel && (
        <div
          onClick={() => setPeek(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 25, padding: 24,
            background: T.scrim, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 1040, height: 'min(880px, 100%)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              background: T.bg, border: `1px solid ${T.line2}`, borderRadius: RADIUS.card,
              boxShadow: SHADOW.drawer,
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
              padding: '9px 10px 9px 18px', background: T.s1,
              borderBottom: `1px solid ${T.line}`,
            }}>
              <span style={{
                ...mono, flex: 1, minWidth: 0, fontSize: 12.5, color: T.ink3,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{slot?.info?.name ?? slot?.cfg.name ?? sel.hostKey}</span>
              <Button
                small face="outline" icon={P.external} label="Open"
                title="Open in the chat screen"
                onClick={() => open(sel.hostKey, sel.chatId)}
              />
              <Button
                small face="outline" icon={P.x} label="Close"
                title="Back to the wall (Esc)" onClick={() => setPeek(false)}
              />
            </div>
            <ChatView {...chatProps} />
          </div>
        </div>
      )}

      {newChat && (newChat.host ?? fleet.focus) && (
        <NewChat
          hostKey={(newChat.host ?? fleet.focus)!}
          initialCwd={newChat.cwd}
          groupId={newChat.groupId}
          initialAgent={newChat.agent ?? null}
          onDone={(c) => {
            const host = (newChat.host ?? fleet.focus)!;
            setNewChat(null);
            if (newChat.stay) openHere(host, c.id); else open(host, c.id);
          }}
          onClose={() => setNewChat(null)}
        />
      )}

      {palette && (
        <Palette
          commands={commands}
          onOpenChat={open}
          onNewChatIn={(cwd) => setNewChat({ cwd })}
          onClose={() => setPalette(false)}
        />
      )}

      {blocking && (
        <ApprovalModal
          pending={blocking}
          queued={pending.length}
          chat={fleet.hosts[blocking.hostKey]?.chats.find((c) => c.id === blocking.chatId) ?? null}
          onRespond={async (d, response) => {
            try {
              await respond(blocking.hostKey, blocking.chatId, blocking.requestId, d, response);
            } catch (e) {
              if (!isGone(e)) throw e;
            }
            setPending((q) => q.filter((p) => p.requestId !== blocking.requestId));
          }}
          onOpenChat={() => open(blocking.hostKey, blocking.chatId)}
          onClose={() => {
            dismissed.current.add(blocking.requestId);
            setPending((q) => q.filter((p) => p.requestId !== blocking.requestId));
          }}
        />
      )}

      {field && chat && sel && (
        <FieldSheet
          field={field} chat={chat}
          catalog={fleet.hosts[sel.hostKey]?.catalog ?? null}
          projects={fleet.hosts[sel.hostKey]?.projects ?? []}
          accounts={fleet.hosts[sel.hostKey]?.accounts ?? []}
          accountsLoading={!!fleet.hosts[sel.hostKey]?.loading.accounts}
          accountsError={fleet.hosts[sel.hostKey]?.accountsError ?? null}
          limits={fleet.hosts[sel.hostKey]?.limits ?? {}}
          busy={log.busy || chat.status !== 'idle'}
          onPick={(value) => updateChat(sel.hostKey, sel.chatId, { [field]: value })
            .catch((e) => window.alert(e?.message ?? 'That did not work'))}
          onClose={() => setField(null)}
        />
      )}
    </>
  );
}

const COLUMN_WORD: Record<string, string> = {
  ice_box: 'Ice Box', queued: 'Queued', in_progress: 'In Progress', done: 'Done',
};

/** A place, as the words the way back to it says: `Waiting on you`,
 *  `Quire · Board`, `Dashboard`. */
function placeName(p: Place, view: ReturnType<typeof useDivanView>): string {
  if (p.view !== 'overview') return p.view === 'chats' ? 'Chats' : p.view === 'panes' ? 'Panes' : 'Machine';
  if (!p.project) {
    return p.tab === 'waiting' ? 'Waiting on you' : p.tab === 'work' ? 'Work' : p.tab === 'havuz' ? 'Havuz' : 'Dashboard';
  }
  const name = projectIn(view, p.project)?.name ?? p.project;
  if (p.card) return name;
  if (p.tab === 'board') return `${name} · Board`;
  return name;
}
