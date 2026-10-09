import type { ApprovalResponse } from './lib/approval-input';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RADIUS, SHADOW, T, setThemeChoice, themeCss, useTheme } from './lib/theme';
import { KEYFRAMES, P, mono } from './ui/kit';
import { Button } from './ui/divan';
import { Sidebar } from './components/Sidebar';
import { Shell } from './components/Shell';
import { ChatView } from './components/ChatView';
import { NewChat } from './components/NewChat';
import { Palette, type Command } from './components/Palette';
import { FieldSheet, accountName, type Field } from './components/FieldSheet';
import { ApprovalModal, type Pending } from './components/ApprovalModal';
import { Machine } from './screens/Machine';
import { Overview, type ProjectTab } from './screens/Overview';
import { Composer } from './components/Composer';
import { Onboarding } from './screens/Onboarding';
import { useFleet, onAnyEvent, pokeAll } from './lib/fleet';
import { project as projectIn, useDivanView } from './lib/divan';
import { idOf } from './lib/sessions';
import {
  MACHINE_ASIDE, MACHINE_ROWS, PLACE_LABEL, PLACE_VIEW, chatNeedsYou, placeOf,
  updateWaiting, type View,
} from './lib/shell';
import { HOME, pathOf, placeOfState, readPlace, samePlace, searchOf, type Place } from './lib/nav';
import { useLogs, logKey, emptyLog } from './lib/timeline';
import { InboxBell } from './components/Inbox';
import { Report } from './components/Report';
import { Modal, ModalHead } from './components/Modal';
import { POLL_MS, announce, useInbox, type Notice } from './lib/inbox';
import { createGroup, deleteChat, interrupt, respond, send, updateChat, upload } from './lib/actions';
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
  // Terminal mode opens a chat over the wall rather than leaving it: the point
  // of the wall is that you can answer one thing and still be looking at the
  // other eleven. It is the same selection the chat screen uses, so everything
  // hung off `sel` — the live token count, the approval queue, the field sheet
  // — works inside the overlay without a second copy of any of it.
  const [peek, setPeek] = useState(false);
  /** A ticket a card link in a chat asked for, with no card on any board: it is
   *  read on the queue's wall under Machine › Terminal. */
  const [ticket, setTicket] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** The Dashboard's Composer, which ⌘N and every "new chat" now lead to. */
  const composerRef = useRef<HTMLTextAreaElement>(null);
  /** …and the one at the foot of a product's page, where its New chat leads. */
  const projectComposerRef = useRef<HTMLTextAreaElement>(null);

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

  /** Where the panel is, as one value: what goes in the address, and what the
   *  back button puts back. */
  const where: Place = useMemo(() => ({
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
  }), [view, project, tab, card, sel?.chatId]);

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
      if (location.pathname + location.search !== url) history.replaceState(where, '', url);
      return;
    }
    if (samePlace(shown.current, where)) return;
    // A card opened by a press in the panel remembers the page it was opened
    // from, so its Back is the browser's own Back and lands there. A card the
    // panel was opened on has no such page, and its Back is its product's board.
    if (where.card && where.card !== shown.current.card) setCameFrom(shown.current);
    if (landing.current && where.chat && !shown.current.chat) history.replaceState(where, '', url);
    else history.pushState(where, '', url);
    landing.current = false;
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
  const back = view !== 'overview'
    ? { label: 'Dashboard', onBack: () => setView('overview') }
    : project && card
      ? (from
        ? { label: placeName(from, divan), onBack: () => history.back() }
        : { label: `${scopedName ?? 'Project'} · Board`, onBack: () => { setCard(null); setTab('board'); } })
        : project && (tab === 'board' || (tab === 'chat' && sel))
          ? { label: scopedName ?? 'Project', onBack: () => setTab('overview') }
          : project
          ? { label: 'Dashboard', onBack: () => chooseProject(null) }
          : tab === 'waiting'
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
    if (useFleet.getState().focus !== hostKey) fleet.setFocus(hostKey);
    logs.open(hostKey, chatId);
  }, []);

  // …and the other direction: the browser hands an entry back, and the panel
  // is drawn where that entry says. Never a push, or Back would be a loop.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const to: Place = (e.state && typeof e.state === 'object' && 'view' in e.state)
        ? placeOfState(e.state as Partial<Place>)
        : readPlace(location.pathname, location.search);
      going.current = true;
      shown.current = to;
      setView(to.view);
      setProject(to.project);
      setTab(to.tab as ProjectTab);
      setCard(cardKey(to.card));
      setPeek(false);
      const host = to.host ?? hostOfChat(to.chat);
      if (host && to.chat) select(host, to.chat);
      else setSel(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [select]);

  const scopedTo = projectIn(divan, project);

  // The Chat place opens writable, on the newest conversation, without anybody
  // choosing one. An address that names a chat is honoured instead (above).
  useEffect(() => {
    if (view !== 'chats' || sel || !fleet.ready) return;
    if (opened.current.chat && opened.current.view === 'chats') return;
    const newest = fleet.order
      .flatMap((k) => (fleet.hosts[k]?.chats ?? []).filter((c) => !c.archived).map((c) => ({ k, c })))
      .sort((a, b) => b.c.updated_at - a.c.updated_at)[0];
    if (newest) { landing.current = true; select(newest.k, newest.c.id); }
  }, [view, sel, fleet.ready, fleet.hosts, fleet.order]);

  // A ticket handed to the Terminal tab is for that one visit.
  useEffect(() => { if (view !== 'terminal') setTicket(null); }, [view]);

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

  /** A new chat is written in the Composer: home, and the field focused. */
  const compose = useCallback(() => {
    setView('overview');
    setProject(null);
    setCard(null);
    setTimeout(() => composerRef.current?.focus(), 0);
  }, []);

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

  /** A notice from the queue, pressed: its ticket's page, under its product.
   *  A ticket with no card on the board (filed before the board mirrored, or
   *  on a machine whose board has not answered) gets its report on its own. */
  const [reportOf, setReportOf] = useState<Notice | null>(null);
  const openNotice = useCallback((n: Notice) => {
    const found = n.ticket == null ? null
      : divan.cards.find((c) => c.host === n.host && c.ustabasi_id === n.ticket);
    if (!found) { setReportOf(n); return; }
    setView('overview');
    setProject(found.projectKey);
    setTab('overview');
    setCard(`${found.host}:${found.id}`);
  }, [divan.cards]);
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
      const open = existing.items.filter((it) => it.kind === 'approval' && it.decision == null);
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

  useEffect(() => {
    if (view !== 'chats' || !fleet.focus) return;
    const s = fleet.hosts[fleet.focus];
    if (s?.status === 'online' && !s.accounts.length && !s.loading.accounts) {
      fleet.refreshAccounts(fleet.focus).catch(() => {});
    }
  }, [view, fleet.focus, slot?.status, slot?.accounts.length]);

  // The chat surface is drawn in two places — as the chat screen, and held over
  // terminal mode — and both are looking at the same selection. One set of
  // handlers, so what the overlay does cannot drift from what the screen does.
  const popOut = () => sel && window.open(
    `${location.pathname}?host=${encodeURIComponent(sel.hostKey)}&chat=${encodeURIComponent(sel.chatId)}`,
    '_blank', 'width=1100,height=860');

  /** The product this conversation is filed under, by the name the board
   *  gives it. */
  const filedUnder = chat?.project_id && sel
    ? divan.projects.find((p) => p.ids[sel.hostKey] === chat.project_id)?.name ?? null
    : null;
  /** A card the conversation filed: its card on a board where there is one,
   *  and the queue's own wall where there is not. */
  const tickets = {
    open: (id: number) => {
      const found = divan.cards.find((c) => c.ustabasi_id === id);
      setPeek(false);
      if (found) {
        setView('overview'); setProject(found.projectKey); setTab('board');
        setCard(`${found.host}:${found.id}`);
        return;
      }
      setTicket(id);
      setView('terminal');
    },
    describe: (id: number) => {
      const found = divan.cards.find((c) => c.ustabasi_id === id);
      return found ? { column: COLUMN_WORD[found.column] ?? found.column, title: found.title } : null;
    },
  };

  const chatProps = {
    chat, hostKey: sel?.hostKey ?? null, log, sending, filedUnder, tickets,
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
      if (sel) updateChat(sel.hostKey, sel.chatId, patch).catch(() => {});
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
      { id: 'dashboard', label: PLACE_LABEL.dashboard, hint: 'every product', run: () => setView(PLACE_VIEW.dashboard) },
      { id: 'chat', label: PLACE_LABEL.chat, hint: slot?.info?.name, run: () => setView(PLACE_VIEW.chat) },
      { id: 'machine', label: PLACE_LABEL.machine, hint: 'the computers', run: () => setView(PLACE_VIEW.machine) },
      ...MACHINE_ROWS.map((row) => ({
        id: row.view,
        label: `${PLACE_LABEL.machine} › ${row.label}`,
        shortcut: row.shortcut,
        run: () => setView(row.view),
      })),
      // …and the pages that have no row of their own, by name: they are opened
      // from the page above them, and a page you can only reach by remembering
      // which button it is behind is a page that was mislaid.
      ...MACHINE_ASIDE.map((aside) => ({
        id: aside.view,
        label: `${PLACE_LABEL.machine} › ${aside.label}`,
        shortcut: aside.view === 'projects' ? '⌘2' : undefined,
        run: () => setView(aside.view),
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
        run: () => { fleet.setAllHosts(!fleet.allHosts); setView(PLACE_VIEW.chat); },
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
  }, [fleet.hosts, fleet.order, fleet.allHosts, slot?.info?.name, theme.scheme, theme.choice, compose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === 'k') { e.preventDefault(); setPalette((p) => !p); }
      else if (e.key === 'b') { e.preventDefault(); setRailTo('toggle'); }
      else if (e.key === 'n') { e.preventDefault(); compose(); }
      else if (e.key === 'f') { e.preventDefault(); setView('chats'); setTimeout(() => searchRef.current?.focus(), 0); }
      // The keys the panel already had open the pages they always did — they
      // are pages of the Machine place now, and nothing about where they land
      // has changed. ⌘0 is for the place the panel opens on; ⌘7 and ⌘8 are the
      // two rows the drawer gained, and ⌘2 still opens a computer's folders,
      // which is a page under the first row rather than a row of its own.
      else if (e.key === '0') {
        e.preventDefault();
        setView('overview'); setProject(null); setTab('overview'); setCard(null);
      }
      else if (e.key === ',') { e.preventDefault(); setView('settings'); }
      else if (e.key === '1') { e.preventDefault(); setView('machines'); }
      else if (e.key === '2') { e.preventDefault(); setView('projects'); }
      else if (e.key === '3') { e.preventDefault(); setView('executors'); }
      else if (e.key === '4') { e.preventDefault(); setView('terminal'); }
      else if (e.key === '5') { e.preventDefault(); setView('screen'); }
      else if (e.key === '6') { e.preventDefault(); setView('admin'); }
      else if (e.key === '7') { e.preventDefault(); setView('accounts'); }
      else if (e.key === '8') { e.preventDefault(); setView('quota'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (fleet.ready && !fleet.order.length) {
    return (
      <>
        <style>{themeCss()}</style>
        <style>{KEYFRAMES}</style>
        <Onboarding onPaired={() => setView(PLACE_VIEW.dashboard)} />
      </>
    );
  }

  return (
    <>
      <style>{themeCss()}</style>
      <style>{KEYFRAMES}</style>
      <Shell
        view={view} onView={setView} fleet={divan} dots={dots}
        onHome={() => { setView('overview'); chooseProject(null); }}
        back={back}
        inbox={<InboxBell onOpen={openNotice} />}
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
              open: chat ? <ChatView {...chatProps} /> : null,
              onClose: () => setTab('overview'),
            } : null}
          />
        )}

        {/* The chat list down the left, and the newest conversation open and
            writable beside it the moment the place is entered. */}
        {place === 'chat' && (
          <div className="dv-chatpane" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
            <Sidebar
              selected={sel?.chatId ?? null} selectedHost={sel?.hostKey ?? null} onSelect={open}
              onNewChat={compose}
              onNewChatIn={(host, cwd, groupId) => setNewChat({ host, cwd, groupId })}
              searchRef={searchRef}
              collapsed={rail} onCollapse={setRailTo}
            />
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {chat ? <ChatView {...chatProps} /> : (
                <FirstWord onSay={async (text) => {
                  const told = await tell(text, null);
                  useTold.getState().close(idOfTold(told));
                  select(told.host, told.chatId);
                }} />
              )}
            </div>
          </div>
        )}

        {place === 'machine' && (
          <Machine
            view={view} onView={setView} fleet={divan}
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
            await respond(blocking.hostKey, blocking.chatId, blocking.requestId, d, response);
            setPending((q) => q.filter((p) => p.requestId !== blocking.requestId));
          }}
          onOpenChat={() => open(blocking.hostKey, blocking.chatId)}
          onClose={() => setPending((q) => q.filter((p) => p.requestId !== blocking.requestId))}
        />
      )}

      {field && chat && sel && (
        <FieldSheet
          field={field} chat={chat}
          catalog={fleet.hosts[sel.hostKey]?.catalog ?? null}
          projects={fleet.hosts[sel.hostKey]?.projects ?? []}
          accounts={fleet.hosts[sel.hostKey]?.accounts ?? []}
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

/** The Chat place with no conversation in it yet: a box that is already
 *  writable. What is said in it opens a chat with every default this computer
 *  has (`tell`) — nothing is chosen first. */
function FirstWord({ onSay }: { onSay: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const say = async () => {
    const words = text.trim();
    if (!words || busy) return;
    setBusy(true); setError(null);
    try { await onSay(words); setText(''); }
    catch (e: any) { setError(e?.message ?? 'That did not go through'); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '20px 24px 32px' }}>
      <div style={{ width: '100%', maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p className="dv-meta" style={{ margin: 0, textAlign: 'center' }}>No conversation yet.</p>
        <form className="dv-glass-strong dv-composer" data-first-word
          style={{ padding: '12px 12px 12px 18px', display: 'flex', alignItems: 'center', gap: 8 }}
          onSubmit={(e) => { e.preventDefault(); void say(); }}>
          <label htmlFor="first-word" className="dv-hidden">Message to Hermes</label>
          <input id="first-word" value={text} onChange={(e) => setText(e.target.value)} placeholder="Talk to Hermes"
            style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', color: 'inherit', font: '400 15px/22px var(--font-sans)' }} />
          <button type="submit" className="dv-send" aria-label="Send" disabled={busy || !text.trim()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
          </button>
        </form>
        {!!error && <p style={{ margin: 0, fontSize: 13, color: T.red }}>{error}</p>}
      </div>
    </div>
  );
}

/** A place, as the words the way back to it says: `Waiting on you`,
 *  `Quire · Board`, `Dashboard`. */
function placeName(p: Place, view: ReturnType<typeof useDivanView>): string {
  if (p.view !== 'overview') return p.view === 'chats' ? 'Chats' : 'Machine';
  if (!p.project) return p.tab === 'waiting' ? 'Waiting on you' : 'Dashboard';
  const name = projectIn(view, p.project)?.name ?? p.project;
  if (p.card) return name;
  if (p.tab === 'board') return `${name} · Board`;
  return name;
}
