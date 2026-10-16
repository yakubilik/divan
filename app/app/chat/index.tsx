// The second place: every conversation on this computer, searched, grouped,
// archived and unarchived again.
//
// Divan briefly made this place one conversation — the newest chat, opened
// directly, with no list in front of it. On a phone that holds a dozen of them
// that is one chat and eleven you cannot reach, so the list is the place again:
// the tab opens it, a row opens the conversation, and `/chat/<id>` is still the
// same screen a notification pushes. What the redesign did take away stays
// away — no computer picker over the top, no Agents tab beside it. The tab bar
// under it is the only thing the place adds.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, SectionList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { useStore, useT } from '../../src/store';
import { useNavGuard } from '../../src/nav';
import { LOCALE } from '../../src/i18n';
import { em, useColors } from '../../src/theme';
import { Chip, Dot, EmptyState, Icon, ProviderBadge, SkeletonCard, SmallButton, Spinner, SwipeActions, Text, TextInput } from '../../src/components/ui';
import { alert, measure, openMenu, prompt, replaceMenu, type MenuItem } from '../../src/components/overlay';
import { Shell } from '../../src/components/shell';
import { freshCwd } from '../../src/fresh-chat';
import { FirstWord, useFreshChat } from '../../src/components/first-word';
import type { Chat } from '../../src/protocol';
import { chatSections, FLAT, type Section } from '../../src/chat-sections';
import { EVERYONE, ownerOf } from '../../src/chat-list';

const NO_ORDER: string[] = [];
const NOBODY = { names: [] as string[], me: null };


function timeLabel(ts: number, T: ReturnType<typeof useT>, locale: string) {
  const d = new Date(ts * 1000); const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return T('now');
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (diff < 86400 * 2) return T('yesterday');
  if (diff < 86400 * 7) return d.toLocaleDateString(locale, { weekday: 'short' });
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export default function ChatPlace() {
  const router = useRouter();
  const go = useNavGuard();
  const c = useColors();
  // A no-selector `useStore()` subscribes this screen to *every* store write,
  // and a running turn writes on every streamed token. That re-rendered the
  // whole list dozens of times a second, so taps queued up behind the render
  // work instead of opening a chat. Subscribe to what this screen actually
  // draws; the actions never change identity, so a shallow slice of them costs
  // nothing.
  const chats = useStore((s) => s.chats);
  const groups = useStore((s) => s.groups);
  const conn = useStore((s) => s.conn);
  const hostInfo = useStore((s) => s.hostInfo);
  const host = useStore((s) => s.host);
  const projects = useStore((s) => s.projects);
  const showArchived = useStore((s) => s.showArchived);
  const chatView = useStore((s) => s.prefs.chatView);
  const people = useStore((s) => s.people) ?? NOBODY;
  const activeHostId = useStore((s) => s.activeHostId);
  // Whose chats, and the order the headings were arranged in: both this
  // phone's own, per computer, the way the web keeps them per browser.
  const chosen = useStore((s) => (s.activeHostId ? s.prefs.chatPerson?.[s.activeHostId] : undefined));
  const saved = useStore((s) => (s.activeHostId && s.prefs.chatSections?.[s.activeHostId]) || NO_ORDER);
  // A chat carries its product's name beside its id; where an older answer
  // left only the id, this computer's Divan board still knows what it is called.
  const products = useStore((s) => (s.activeHostId ? s.divan[s.activeHostId]?.snapshot?.projects : undefined));
  const productNames = useMemo(() => Object.fromEntries((products ?? []).map((p) => [p.id, p.name])) as Record<string, string>, [products]);
  const { refresh, loadProjects, createChat, updateChat, deleteChat, renameGroup, deleteGroup, createGroup, setShowArchived, setPrefs } =
    useStore(useShallow((s) => ({
      refresh: s.refresh, loadProjects: s.loadProjects, createChat: s.createChat, updateChat: s.updateChat,
      deleteChat: s.deleteChat, renameGroup: s.renameGroup, deleteGroup: s.deleteGroup, createGroup: s.createGroup,
      setShowArchived: s.setShowArchived, setPrefs: s.setPrefs,
    })));
  const T = useT();
  const locale = LOCALE;
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [viewMenu, setViewMenu] = useState(false);
  const viewPill = useRef<View>(null);
  const personCard = useRef<View>(null);

  // Which chats are a day old is a question about the clock, and a list left
  // open overnight has to notice the answer changing.
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now() / 1000), 60_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => { if (conn === 'online') { void refresh().catch(() => {}); void loadProjects().catch(() => {}); } }, [conn, refresh, loadProjects]);

  const send = useStore((s) => s.send);
  const openFresh = useFreshChat();
  const [first, setFirst] = useState('');
  const creating = useRef(false);
  const [starting, setStarting] = useState(false);

  /** No conversation yet: what is said here opens one on this computer's
   *  defaults and goes straight into it. */
  const sayFirst = useCallback(async () => {
    const words = first.trim();
    if (!words || creating.current) return;
    if (!freshCwd(hostInfo)) { go(() => router.push('/new-chat')); return; }
    creating.current = true;
    try {
      const chat = (await openFresh())!;
      await send(chat.id, words);
      setFirst('');
      router.replace(`/chat/${chat.id}`);
    } catch (e: any) {
      alert(T('couldNotOpen'), e?.message ?? String(e));
    } finally {
      creating.current = false;
    }
  }, [first, hostInfo, openFresh, send, router, go, T]);

  // Tap: a fresh chat, opened at once — no Dashboard, no sheet. Long-press: the
  // New chat sheet, for a different folder, tool or model.
  const quickNew = useCallback(async () => {
    if (!freshCwd(hostInfo)) { go(() => router.push('/new-chat')); return; }
    // Creating a chat is a round trip to the computer; without this a second
    // tap while it is in flight makes a second chat nobody asked for.
    if (creating.current) return;
    creating.current = true;
    setStarting(true);
    try {
      const chat = (await openFresh())!;
      router.push(`/chat/${chat.id}`);
    } catch (e: any) {
      // The list stays where it was; the dialog says why and offers the two
      // ways on: the same press again, or the sheet with every choice in it.
      alert(T('couldNotStart'), e?.message ?? String(e), [
        { text: T('cancel'), style: 'cancel' },
        { text: T('ncChooseSettings'), onPress: () => go(() => router.push('/new-chat')) },
        { text: T('tryAgain'), onPress: () => void quickNewRef.current() },
      ]);
    } finally {
      creating.current = false;
      setStarting(false);
    }
  }, [hostInfo, openFresh, router, go, T]);
  const quickNewRef = useRef(quickNew);
  quickNewRef.current = quickNew;

  const { sections, who, counts, shared } = useMemo(() => chatSections({
    chats, groups, people, chosen, saved, productNames, projects, q, collapsed, showArchived,
    flat: chatView === 'flat', now,
  }), [chats, groups, people, chosen, saved, productNames, projects, q, collapsed, showArchived, chatView, now]);

  /** Whose chats the list shows, picked the way the web's card picks it. */
  async function pickPerson() {
    const anchor = await measure(personCard);
    const total = people.names.reduce((n, p) => n + (counts[p] ?? 0), 0);
    const pick = (p: string) => {
      if (!activeHostId) return;
      void setPrefs({ chatPerson: { ...useStore.getState().prefs.chatPerson, [activeHostId]: p } });
    };
    openMenu({
      anchor, width: 240,
      items: [
        { label: `${EVERYONE} · ${total}`, checked: who === null, onPress: () => pick('') },
        ...people.names.map((p) => ({ label: `${p} · ${counts[p] ?? 0}`, checked: who === p, onPress: () => pick(p) })),
        { kind: 'cancel' as const, label: T('cancel') },
      ],
    });
  }

  // In the flat view a row is the only place its group can still be named.
  const groupNames = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups]);
  const err = useCallback((e: any) => alert(T('error'), e?.message ?? String(e)), [T]);

  function newGroup(then?: (id: string) => Promise<void> | void) {
    prompt({
      title: T('newGroupTitle'), message: then ? undefined : T('newGroupHint'),
      placeholder: T('groupName'), confirm: T('create'), cancel: T('cancel'),
      submit: async (n) => {
        if (!n.trim()) return T('groupNameEmpty');
        const g = await createGroup(n.trim().slice(0, 60));
        // A new group is invisible in the flat view, which would read as the
        // tap having done nothing. Show the view that can hold it.
        if (chatView !== 'grouped') await setPrefs({ chatView: 'grouped' });
        await then?.(g.id);
      },
    });
  }

  /** How the list is read, and the one place a group is made from nothing. A
   *  group that starts empty is worth having: it is where the next chats go. */
  async function listOptions() {
    const anchor = await measure(viewPill);
    setViewMenu(true);
    openMenu({
      anchor, align: 'right', width: 220, onClose: () => setViewMenu(false),
      items: [
        { label: T('viewGrouped'), checked: chatView === 'grouped', onPress: () => void setPrefs({ chatView: 'grouped' }) },
        { label: T('viewFlat'), checked: chatView === 'flat', onPress: () => void setPrefs({ chatView: 'flat' }) },
        { kind: 'divider' },
        { label: T('newGroupAction'), icon: 'add', onPress: () => newGroup() },
        { kind: 'divider' },
        { kind: 'cancel', label: T('cancel') },
      ],
    });
  }

  /** Where a chat can go, in the web's order (`ChatMenu.tsx`): Daily, every
   *  group, a new one. */
  function moveItems(chat: Chat, back?: () => void): MenuItem[] {
    return [
      ...(back ? [{ kind: 'back' as const, label: T('moveToGroup'), onPress: back }] : []),
      // Daily is out of every group and every product, for good: a chat the
      // computer filed under a product would otherwise stay there.
      { label: T('noGroup'), checked: !chat.group_id && !chat.project_id, onPress: () => void updateChat(chat.id, { group_id: null, project_id: '' }).catch(err) },
      ...groups.map((g) => ({ label: g.name, checked: g.id === chat.group_id, onPress: () => void updateChat(chat.id, { group_id: g.id } as any).catch(err) })),
      { label: T('newGroupAction'), icon: 'add', onPress: () => newGroup((id) => updateChat(chat.id, { group_id: id } as any)) },
    ];
  }

  /** A chat's own menu: the web's `ChatMenu`, entry for entry and in its order,
   *  each sending what the web's sends. */
  function chatItems(chat: Chat): MenuItem[] {
    const names = people.names;
    const owner = names.length > 1 ? ownerOf(chat, names) : null;
    return [
      { label: T('rename'), icon: 'edit', onPress: () => prompt({
          title: T('renameChat'), value: chat.title, placeholder: T('chatName'), confirm: T('save'), cancel: T('cancel'),
          submit: async (t) => { await updateChat(chat.id, { title: t.trim() || chat.title } as any); },
        }) },
      { label: chat.pinned ? T('unpin') : T('pin'), icon: chat.pinned ? 'keep_off' : 'keep', onPress: () => void updateChat(chat.id, { pinned: chat.pinned ? 0 : 1 } as any).catch(err) },
      { label: chat.archived ? T('unarchive') : T('archiveAction'), icon: chat.archived ? 'unarchive' : 'inventory_2', onPress: () => void updateChat(chat.id, { archived: chat.archived ? 0 : 1 } as any).catch(err) },
      { label: T('deleteChat'), icon: 'delete', danger: true, onPress: () => confirmDelete(chat) },
      { kind: 'divider' },
      { label: T('moveToGroupMore'), icon: 'folder_open', submenu: true, onPress: () => replaceMenu(moveItems(chat, () => replaceMenu(chatItems(chat)))) },
      // On a computer two people use, a chat can be handed to the other one.
      ...(owner ? names.filter((p) => p !== owner).map((p) => ({
        label: T('giveTo', { name: p }), icon: 'group', onPress: () => void updateChat(chat.id, { owner: p } as any).catch(err) })) : []),
    ];
  }

  function groupItems(id: string, name: string): MenuItem[] {
    return [
      { label: T('rename'), icon: 'edit', onPress: () => prompt({
          title: T('renameGroup'), value: name, placeholder: T('groupName'), confirm: T('save'), cancel: T('cancel'),
          submit: async (t) => { if (t.trim()) await renameGroup(id, t.trim().slice(0, 60)); },
        }) },
      { kind: 'divider' },
      { label: T('deleteGroup'), icon: 'delete', danger: true, onPress: () => alert(T('deleteGroup'), T('deleteGroupBody'), [
          { text: T('cancel'), style: 'cancel' }, { text: T('delete'), style: 'destructive', onPress: () => void deleteGroup(id).catch(err) }]) },
    ];
  }

  /** The two things a swipe offers — the same two the long-press menu does,
   *  one gesture earlier. Archiving is reversible and goes straight through;
   *  deleting takes the chat's history off the computer with it, so it asks
   *  first, with the same question the menu asks. */
  function archiveChat(chat: Chat) {
    void updateChat(chat.id, { archived: chat.archived ? 0 : 1 } as any).catch(err);
  }

  function confirmDelete(chat: Chat) {
    alert(T('deleteChat'), T('deleteChatBody'), [
      { text: T('cancel'), style: 'cancel' },
      { text: T('delete'), style: 'destructive', onPress: () => void deleteChat(chat.id).catch(err) },
    ]);
  }

  // Handed to every row, so they have to keep the same identity across renders
  // or memoising the row buys nothing. The menus close over this render's
  // state, so reach them through a ref rather than rebuilding.
  const actionsRef = useRef({ chatItems, groupItems, archiveChat, confirmDelete });
  actionsRef.current = { chatItems, groupItems, archiveChat, confirmDelete };
  // A heading's + is the web's onNewChatIn: the New chat sheet, already on the
  // heading's folder and, under a group, filed in that group.
  const onPlus = useCallback((s: Section) => go(() => router.push({ pathname: '/new-chat',
    params: { ...(s.cwd ? { cwd: s.cwd } : {}), ...(s.kind === 'group' ? { group: s.id } : {}) } })), [go, router]);
  const onRowPress = useCallback((chat: Chat) => go(() => router.push(`/chat/${chat.id}`)), [go, router]);
  const onRowArchive = useCallback((chat: Chat) => actionsRef.current.archiveChat(chat), []);
  const onRowDelete = useCallback((chat: Chat) => actionsRef.current.confirmDelete(chat), []);
  const onRowLongPress = useCallback((chat: Chat, ref: React.RefObject<View | null>) => {
    void measure(ref).then((r) => openMenu({
      anchor: r, previewRect: r, width: 250,
      preview: <RowPreview chat={chat} T={T} locale={locale} />,
      items: actionsRef.current.chatItems(chat),
    }));
  }, [T, locale]);
  const onGroupLongPress = useCallback((id: string, name: string, count: number, ref: React.RefObject<View | null>) => {
    if (!groups.some((g) => g.id === id)) return;
    void measure(ref).then((r) => openMenu({
      anchor: r, previewRect: { ...r, x: 12, width: r.width - 24 }, width: 230,
      preview: <GroupPreview title={name} count={count} />,
      items: actionsRef.current.groupItems(id, name),
    }));
  }, [groups]);

  const online = conn === 'online';
  const switching = useStore((st) => st.switching);
  const empty = Object.keys(chats).length === 0;
  // The outgoing computer's list stays up, dimmed and inert, until the new
  // one's list lands — a blank screen mid-switch is what read as a stutter.
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: switching ? 0.35 : 1, duration: switching ? 130 : 220, useNativeDriver: true }).start();
  }, [switching, fade]);
  // Until the computer has answered, an empty list is not an answer.
  const chatsLoaded = useStore((st) => st.chatsLoaded);
  const waitingForList = empty && !chatsLoaded && (conn === 'online' || conn === 'connecting');
  const hostName = hostInfo?.name?.replace('.local', '') || host?.name || T('computer');
  const flat = chatView === 'flat';

  const listHeader = (withControls: boolean) => (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18, paddingHorizontal: 16, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text style={{ fontSize: 30, fontWeight: '600', letterSpacing: em(30, -0.025) }}>{T('chats')}</Text>
          {/* Tap: a fresh chat on the defaults, opened at once. Long-press: the
              New chat sheet, where every choice can be changed first. */}
          {withControls && (
            <Pressable accessibilityLabel={T('newChat')} hitSlop={6} disabled={starting}
              onPress={() => void quickNew()} onLongPress={() => go(() => router.push('/new-chat'))}
              style={({ pressed }) => [{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.5 }]}>
              {starting ? <Spinner size={18} /> : <Icon name="edit_square" size={22} />}
            </Pressable>
          )}
          {/* The general call: this computer's Hermes, not any one chat. */}
          {withControls && (
            <Pressable accessibilityLabel={T('mCall')} hitSlop={6} onPress={() => go(() => router.push('/call'))}
              style={({ pressed }) => [{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.5 }]}>
              <Icon name="call" size={21} />
            </Pressable>
          )}
        </View>
        {withControls && (
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Pill innerRef={viewPill} icon={chatView === 'grouped' ? 'view_agenda' : 'reorder'} on={viewMenu}
              label={chatView === 'grouped' ? T('groupedShort') : T('flatShort')} onPress={() => void listOptions()} />
            <Pill icon="inventory_2" label={T('archive')} tone={showArchived ? 'accent' : undefined} onPress={() => setShowArchived(!showArchived)} />
          </View>
        )}
      </View>
      {(
        <View style={[{ marginHorizontal: 16, marginBottom: focused || q ? 10 : 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999 },
          focused || q
            ? { backgroundColor: c.card, borderWidth: 1.5, borderColor: c.ink, paddingVertical: 8, paddingHorizontal: 12 }
            : { backgroundColor: c.fill, paddingVertical: 9, paddingHorizontal: 14 }]}>
          <Icon name="search" size={18} color={focused || q ? c.muted : c.faint} />
          <TextInput value={q} onChangeText={setQ} placeholder={T('searchChats')} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            placeholderTextColor={c.faint} returnKeyType="search" style={{ flex: 1, fontSize: 14 }} />
          {!!q && <Pressable onPress={() => setQ('')} hitSlop={8}><Icon name="cancel" size={18} color={c.faint} /></Pressable>}
        </View>
      )}
      {/* Whose chats, on a computer more than one person uses: this phone's
          own person's by default, everyone's one tap away. */}
      {withControls && shared && (
        <Pressable ref={personCard} accessibilityRole="button" accessibilityLabel="Whose chats"
          onPress={() => void pickPerson()}
          style={({ pressed }) => [{ marginHorizontal: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
            pressed && { opacity: 0.6 }]}>
          <Icon name="group" size={17} color={who ? c.muted : c.accentText} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '600' }}>{who ?? EVERYONE}</Text>
          <Text mono style={{ fontSize: 12, color: c.muted }}>
            {who ? (counts[who] ?? 0) : people.names.reduce((n, p) => n + (counts[p] ?? 0), 0)}
          </Text>
          <Icon name="expand_more" size={16} color={c.muted} />
        </Pressable>
      )}
    </>
  );

  let body: React.ReactNode;
  if (switching) {
    body = (
      <View style={{ opacity: 0.35 }} pointerEvents="none">
        <View style={{ paddingTop: 18, paddingHorizontal: 16, paddingBottom: 10 }}>
          <Text style={{ fontSize: 30, fontWeight: '600', letterSpacing: em(30, -0.025) }}>{T('chats')}</Text>
        </View>
        <View style={{ marginHorizontal: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 14 }}>
          {sections.flatMap((s) => s.data).slice(0, 8).map((ch, i, all) => (
            <View key={ch.id} style={[{ flexDirection: 'row', gap: 10, paddingVertical: 12, paddingHorizontal: 14 }, i < all.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.line }]}>
              <ProviderBadge provider={ch.provider} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600' }}>{ch.title}</Text>
                <Text numberOfLines={1} style={{ fontSize: 13, color: c.muted }}>{statusLine(ch, T)}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  } else if (waitingForList) {
    body = (
      <>
        {listHeader(false)}
        <SkeletonCard rows={5} style={{ marginTop: 8, marginHorizontal: 12 }} />
      </>
    );
  } else if (empty) {
    body = online ? (
      <View style={{ flex: 1, justifyContent: 'flex-end', padding: 16, gap: 10 }}>
        <Text style={{ fontSize: 13, color: c.muted, textAlign: 'center' }}>{T('chNoneYet')}</Text>
        <FirstWord value={first} onChangeText={setFirst} onSend={() => void sayFirst()} />
      </View>
    ) : conn === 'unauthorized' ? (
      <EmptyState icon="key_off" title={T('noAccess')} body={T('noAccessHint', { host: hostName })}
        action={<SmallButton title={T('pairAgain')} onPress={() => go(() => router.push({ pathname: '/pair', params: { add: '1' } }))} />} />
    ) : (
      <EmptyState icon="cloud_off" title={T('cantConnect', { host: hostName })} body={T('hintOffline')} />
    );
  } else {
    body = (
      <SectionList
        sections={sections}
        keyExtractor={(ch) => ch.id}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={listHeader(true)}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderSectionHeader={({ section }) => section.id === FLAT ? null : (
          <GroupHeader section={section as Section} first={sections[0]?.id === section.id} dimmed={viewMenu}
            onPress={() => setCollapsed((cl) => ({ ...cl, [section.id]: !(section as Section).shut }))}
            onLongPress={onGroupLongPress} onPlus={onPlus} />
        )}
        renderItem={({ item, index, section }) => (
          <ChatRow chat={item} T={T} locale={locale} first={index === 0} last={index === section.data.length - 1} dimmed={viewMenu}
            chips={flat || item.status !== 'idle'}
            group={flat && item.group_id ? groupNames[item.group_id] : undefined}
            onPress={onRowPress} onLongPress={onRowLongPress} onArchive={onRowArchive} onDelete={onRowDelete} />
        )}
      />
    );
  }

  return (
    <Shell place="chat">
      <Animated.View style={{ flex: 1, opacity: switching ? 1 : fade }}>{body}</Animated.View>
    </Shell>
  );
}

function statusLine(chat: Chat, T: ReturnType<typeof useT>): string {
  if (chat.status === 'running') return T('runningFor', { m: Math.max(1, Math.round((Date.now() / 1000 - chat.updated_at) / 60)) });
  if (chat.status === 'awaiting_approval') return T('awaiting');
  return chat.last_preview || T('emptyChat');
}

/** A heading: its name and how many chats are under it, then — like the web's
 *  — a + that starts a chat in it, and a group's own ... menu. */
function GroupHeader({ section, first, onPress, onLongPress, onPlus, dimmed }: {
  section: Section; first: boolean; onPress: () => void; onPlus: (s: Section) => void; dimmed?: boolean;
  onLongPress: (id: string, name: string, count: number, ref: React.RefObject<View | null>) => void;
}) {
  const c = useColors();
  const ref = useRef<View>(null);
  const group = section.kind === 'group';
  return (
    <View ref={ref} style={{ flexDirection: 'row', alignItems: 'center', paddingTop: first ? 14 : 16, paddingLeft: 16, paddingRight: 10, paddingBottom: 6, opacity: dimmed ? 0.4 : 1 }}>
      <Pressable accessibilityRole="button" onPress={onPress} onLongPress={() => onLongPress(section.id, section.title, section.count, ref)}
        style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ height: 20, justifyContent: 'center' }}><Icon name={section.shut ? 'chevron_right' : 'expand_more'} size={16} color={c.muted} /></View>
        {section.mono
          ? <Text mono numberOfLines={1} style={{ fontSize: 12, fontWeight: '500', color: c.muted, flexShrink: 1 }}>{section.title}</Text>
          : <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '600', letterSpacing: em(12, 0.06), textTransform: 'uppercase', color: c.muted, flexShrink: 1 }}>{section.title}</Text>}
        <View style={{ flex: 1 }} />
        <Text mono style={{ fontSize: 12, fontWeight: '500', color: c.muted }}>{section.count}</Text>
      </Pressable>
      {/* The ... opens the menu a long press on the heading opens. The + opens
          the New chat sheet already in this section. */}
      {group && (
        <Pressable accessibilityRole="button" accessibilityLabel={`Group menu: ${section.title}`} hitSlop={6}
          onPress={() => onLongPress(section.id, section.title, section.count, ref)}
          style={{ width: 26, height: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>
          <Icon name="more_horiz" size={16} color={c.muted} />
        </Pressable>
      )}
      {section.plus && (
        <Pressable accessibilityRole="button" accessibilityLabel={`New chat in ${section.title}`} hitSlop={6} onPress={() => onPlus(section)}
          style={{ width: 26, height: 22, alignItems: 'center', justifyContent: 'center', marginLeft: group ? 0 : 4 }}>
          <Icon name="add" size={17} color={c.muted} />
        </Pressable>
      )}
    </View>
  );
}

function GroupPreview({ title, count }: { title: string; count: number }) {
  const c = useColors();
  return (
    <View style={{ backgroundColor: c.card, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 14,
                   boxShadow: c.shadow.menu }}>
      <Icon name="expand_more" size={16} color={c.text2} />
      <Text style={{ fontSize: 12, fontWeight: '600', letterSpacing: em(12, 0.06), textTransform: 'uppercase', color: c.text2 }}>{title}</Text>
      <View style={{ flex: 1 }} />
      <Text mono style={{ fontSize: 12, fontWeight: '500', color: c.text2 }}>{count}</Text>
    </View>
  );
}

/** What a long-pressed row looks like while its menu is open: the row, alone,
 *  lifted onto a card of its own. */
function RowPreview({ chat, T, locale }: { chat: Chat; T: ReturnType<typeof useT>; locale: string }) {
  const c = useColors();
  const waiting = chat.status === 'awaiting_approval';
  return (
    <View style={{ marginHorizontal: 0, backgroundColor: c.card, borderRadius: 14, flexDirection: 'row', gap: 10, paddingVertical: 12, paddingHorizontal: 14,
                   boxShadow: c.shadow.menu }}>
      <ProviderBadge provider={chat.provider} variant={chat.archived ? 'outline' : undefined} />
      <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', gap: 5 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '600' }}>{chat.title}</Text>
          <Text style={{ fontSize: 12, color: c.faint }}>{timeLabel(chat.updated_at, T, locale)}</Text>
        </View>
        <Text numberOfLines={1} style={{ fontSize: 13, color: c.muted }}>
          {waiting && chat.last_preview ? `${T('awaiting')} · ${chat.last_preview}` : statusLine(chat, T)}
        </Text>
      </View>
    </View>
  );
}

const ChatRow = React.memo(function ChatRow({ chat, onPress, onLongPress, onArchive, onDelete, T, locale, group, chips, first, last, dimmed }: {
  chat: Chat; onPress: (chat: Chat) => void; onLongPress: (chat: Chat, ref: React.RefObject<View | null>) => void;
  onArchive: (chat: Chat) => void; onDelete: (chat: Chat) => void;
  T: ReturnType<typeof useT>; locale: string; group?: string; chips: boolean; first: boolean; last: boolean; dimmed?: boolean;
}) {
  const c = useColors();
  const ref = useRef<View>(null);
  const waiting = chat.status === 'awaiting_approval';
  const running = chat.status === 'running';
  const archived = !!chat.archived;
  const tags = [group, chat.model, chat.effort, chat.perm_mode].filter(Boolean) as string[];
  return (
    <View style={{ marginHorizontal: 12, opacity: dimmed ? 0.4 : 1 }}>
      <SwipeActions
        style={[first && { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
                last && { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }]}
        actions={[
          // Grey for the reversible one and red for the one that is not, which
          // is the only thing anybody reads off these two tiles. Both carry
          // their own background, so the icon and label are white in both themes.
          { key: 'archive', label: chat.archived ? T('unarchive') : T('archiveAction'), color: c.muted,
            icon: (col) => <Icon name={archived ? 'unarchive' : 'inventory_2'} size={19} color={col} />,
            onPress: () => onArchive(chat) },
          { key: 'delete', label: T('delete'), color: c.danger,
            icon: (col) => <Icon name="delete" size={19} color={col} />,
            onPress: () => onDelete(chat) },
        ]}>
      <Pressable ref={ref} onPress={() => onPress(chat)} onLongPress={() => onLongPress(chat, ref)}
        style={({ pressed }) => [{ flexDirection: 'row', gap: 10, paddingVertical: 12, paddingHorizontal: 14,
          backgroundColor: pressed ? c.fill : c.card, borderLeftWidth: 1, borderRightWidth: 1, borderColor: c.line },
          first && { borderTopWidth: 1, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
          last ? { borderBottomWidth: 1, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 } : { borderBottomWidth: 1 },
        ]}>
        <ProviderBadge provider={chat.provider} variant={archived ? 'outline' : undefined} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {!!chat.pinned && <Icon name="keep" size={14} color={c.faint} />}
            {archived && <Icon name="inventory_2" size={14} color={c.faint} />}
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '600', color: archived ? c.muted : c.ink }}>{chat.title}</Text>
            <Text style={{ fontSize: 12, color: c.faint }}>{timeLabel(chat.updated_at, T, locale)}</Text>
          </View>
          {running ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Spinner size={11} />
              <Text numberOfLines={1} style={{ fontSize: 13, color: c.text2, flexShrink: 1 }}>{statusLine(chat, T)}</Text>
            </View>
          ) : waiting ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <Dot color={c.accent} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: c.accentText, flexShrink: 0 }}>{T('awaiting')}</Text>
              {!!chat.last_preview && <Text numberOfLines={1} style={{ fontSize: 13, color: c.muted, flexShrink: 1 }}>· {chat.last_preview}</Text>}
            </View>
          ) : (
            <Text numberOfLines={1} style={{ fontSize: 13, color: archived ? c.faint : c.muted }}>{chat.last_preview || T('emptyChat')}</Text>
          )}
          {chips && tags.length > 0 && (
            <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
              {tags.map((t, i) => <Chip key={i}>{t}</Chip>)}
            </View>
          )}
        </View>
      </Pressable>
      </SwipeActions>
    </View>
  );
});

function Pill({ icon, label, on, tone, onPress, innerRef }: {
  icon: string; label: string; on?: boolean; tone?: 'accent'; onPress: () => void; innerRef?: React.RefObject<View | null>;
}) {
  const c = useColors();
  return (
    <Pressable ref={innerRef} onPress={onPress} hitSlop={6}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: c.lineStrong, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
        on && { backgroundColor: c.ink, borderColor: c.ink },
        tone === 'accent' && { backgroundColor: c.accentTint, borderColor: c.accentTint }]}>
      <Icon name={icon} size={16} color={on ? c.onInk : tone === 'accent' ? c.accentText : c.text2} />
      <Text style={{ fontSize: 12, fontWeight: tone === 'accent' ? '600' : '500', color: on ? c.onInk : tone === 'accent' ? c.accentText : c.text2 }}>{label}</Text>
    </Pressable>
  );
}
