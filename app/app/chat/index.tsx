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
import type { Chat } from '../../src/protocol';

/** The one section the flat view draws. It is never shown as a heading, so it
 *  needs an id no group or folder could ever collide with. */
const FLAT = '__flat__';

function timeLabel(ts: number, T: ReturnType<typeof useT>, locale: string) {
  const d = new Date(ts * 1000); const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return T('now');
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (diff < 86400 * 2) return T('yesterday');
  if (diff < 86400 * 7) return d.toLocaleDateString(locale, { weekday: 'short' });
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

type Section = { id: string; title: string; mono: boolean; data: Chat[]; count: number };

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
  const defaults = useStore((s) => s.defaults);
  const projects = useStore((s) => s.projects);
  const showArchived = useStore((s) => s.showArchived);
  const chatView = useStore((s) => s.prefs.chatView);
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

  useEffect(() => { if (conn === 'online') { void refresh().catch(() => {}); void loadProjects().catch(() => {}); } }, [conn, refresh, loadProjects]);

  // Long-press: open a chat immediately with the defaults. Tap: the picker sheet.
  const creating = useRef(false);
  const quickNew = useCallback(async () => {
    const cwd = defaults.cwd || projects[0]?.path;
    if (!cwd) { go(() => router.push('/new-chat')); return; }
    // Creating a chat is a round trip to the computer; without this a second
    // tap while it is in flight makes a second chat nobody asked for.
    if (creating.current) return;
    creating.current = true;
    try {
      const chat = await createChat({ provider: defaults.provider, model: defaults.model, effort: defaults.effort, perm_mode: defaults.perm_mode, cwd, account_id: defaults.byProvider?.[defaults.provider]?.account_id ?? undefined } as any);
      router.push(`/chat/${chat.id}`);
    } catch (e: any) {
      // Being offline is already on the screen, and the picker is where this tap
      // was heading anyway — an alert about it would only be in the way. Say
      // something only when the computer answered and said no.
      router.push('/new-chat');
      // After the sheet is up, so the dialog lands on top of it.
      if (e?.code !== 'offline') setTimeout(() => alert(T('couldNotOpen'), e.message), 450);
    } finally {
      creating.current = false;
    }
  }, [defaults, projects, createChat, router, go, T]);

  const sections = useMemo<Section[]>(() => {
    // `chats` is keyed by id, so its natural order is whenever each chat was first
    // seen — sort explicitly: pinned first, then most recently active.
    const all = Object.values(chats)
      .filter((ch) => (showArchived || !ch.archived) && (!q || ch.title.toLowerCase().includes(q.toLowerCase()) || ch.last_preview.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => (b.pinned - a.pinned) || (b.updated_at - a.updated_at));
    // Grouping is a way of reading the list, not a property of it. Asked for the
    // flat view, hand back one unnamed section: same chats, newest first, no
    // walls. Nothing is regrouped or forgotten — the groups are still there the
    // moment the view is switched back.
    if (chatView === 'flat') return [{ id: FLAT, title: '', mono: false, data: all, count: all.length }];

    const byGroup: Record<string, Chat[]> = {};
    for (const ch of all) (byGroup[ch.group_id || ''] ||= []).push(ch);
    const out: Section[] = groups.map((g) => ({ id: g.id, title: g.name, mono: false, data: collapsed[g.id] ? [] : (byGroup[g.id] ?? []), count: byGroup[g.id]?.length ?? 0 }));

    // Chats nobody has filed fall into sections by the folder they work in.
    // One project is one section without anybody naming it, and a single
    // folder is not a grouping at all, so it stays as one plain list.
    const loose = byGroup[''] ?? [];
    const byCwd: Record<string, Chat[]> = {};
    for (const ch of loose) (byCwd[ch.cwd || ''] ||= []).push(ch);
    const folders = Object.keys(byCwd);
    if (folders.length > 1) {
      folders
        .sort((a, b) => (byCwd[b][0]?.updated_at ?? 0) - (byCwd[a][0]?.updated_at ?? 0))
        .forEach((path) => {
          const id = `cwd:${path}`;
          out.push({ id, title: path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+|^[A-Za-z]:\\Users\\[^\\]+/, '~').replace(/\\/g, '/') || T('ungrouped'), mono: true,
                     data: collapsed[id] ? [] : byCwd[path], count: byCwd[path].length });
        });
    } else if (loose.length || groups.length === 0) {
      out.push({ id: '', title: groups.length ? T('ungrouped') : T('chats'), mono: false,
                 data: collapsed[''] ? [] : loose, count: loose.length });
    }
    return out;
  }, [chats, groups, q, collapsed, showArchived, chatView, T]);

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

  function moveItems(chat: Chat, back?: () => void): MenuItem[] {
    return [
      ...(back ? [{ kind: 'back' as const, label: T('moveToGroup'), onPress: back }] : []),
      ...groups.map((g) => ({ label: g.name, checked: g.id === chat.group_id, onPress: () => void updateChat(chat.id, { group_id: g.id } as any).catch(err) })),
      { kind: 'divider' as const },
      { label: T('noGroup'), checked: false, onPress: () => void updateChat(chat.id, { group_id: null } as any).catch(err) },
      { label: T('newGroupAction'), icon: 'add', onPress: () => newGroup((id) => updateChat(chat.id, { group_id: id } as any)) },
    ];
  }

  function chatItems(chat: Chat): MenuItem[] {
    return [
      { label: chat.pinned ? T('unpin') : T('pin'), icon: chat.pinned ? 'keep_off' : 'keep', onPress: () => void updateChat(chat.id, { pinned: chat.pinned ? 0 : 1 } as any).catch(err) },
      { label: T('rename'), icon: 'edit', onPress: () => prompt({
          title: T('renameChat'), value: chat.title, placeholder: T('chatName'), confirm: T('save'), cancel: T('cancel'),
          submit: async (t) => { if (t.trim()) await updateChat(chat.id, { title: t.trim().slice(0, 60) } as any); },
        }) },
      { label: T('moveToGroup'), icon: 'folder_open', submenu: true, onPress: () => replaceMenu(moveItems(chat, () => replaceMenu(chatItems(chat)))) },
      { label: chat.archived ? T('unarchive') : T('archiveAction'), icon: chat.archived ? 'unarchive' : 'inventory_2', onPress: () => void updateChat(chat.id, { archived: chat.archived ? 0 : 1 } as any).catch(err) },
      { kind: 'divider' },
      { label: T('delete'), icon: 'delete', danger: true, onPress: () => alert(T('deleteChat'), T('deleteChatBody'), [
          { text: T('cancel'), style: 'cancel' }, { text: T('delete'), style: 'destructive', onPress: () => void deleteChat(chat.id).catch(err) }]) },
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
    if (!id || id.startsWith('cwd:')) return;
    void measure(ref).then((r) => openMenu({
      anchor: r, previewRect: { ...r, x: 12, width: r.width - 24 }, width: 230,
      preview: <GroupPreview title={name} count={count} />,
      items: actionsRef.current.groupItems(id, name),
    }));
  }, []);

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
          {/* Tap: the picker, with every choice the panel's dialog has. Long-press:
              a chat on the defaults, for when nothing needs choosing. */}
          {withControls && (
            <Pressable accessibilityLabel={T('newChat')} hitSlop={6}
              onPress={() => go(() => router.push('/new-chat'))} onLongPress={() => void quickNew()}
              style={({ pressed }) => [{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.5 }]}>
              <Icon name="edit_square" size={22} />
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
      <EmptyState icon="chat_bubble" title={T('noChats')} body={T('hintNew')}
        action={<SmallButton title={T('newChat')} onPress={() => go(() => router.push('/new-chat'))} />} />
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
          <GroupHeader section={section as Section} first={sections[0]?.id === section.id} collapsed={!!collapsed[section.id]} dimmed={viewMenu}
            onPress={() => setCollapsed((cl) => ({ ...cl, [section.id]: !cl[section.id] }))}
            onLongPress={onGroupLongPress} />
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

function GroupHeader({ section, first, collapsed, onPress, onLongPress, dimmed }: {
  section: Section; first: boolean; collapsed: boolean; onPress: () => void; dimmed?: boolean;
  onLongPress: (id: string, name: string, count: number, ref: React.RefObject<View | null>) => void;
}) {
  const c = useColors();
  const ref = useRef<View>(null);
  return (
    <Pressable ref={ref} onPress={onPress} onLongPress={() => onLongPress(section.id, section.title, section.count, ref)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: first ? 14 : 16, paddingHorizontal: 16, paddingBottom: 6, opacity: dimmed ? 0.4 : 1 }}>
      <View style={{ height: 20, justifyContent: 'center' }}><Icon name={collapsed ? 'chevron_right' : 'expand_more'} size={16} color={c.muted} /></View>
      {section.mono
        ? <Text mono numberOfLines={1} style={{ fontSize: 12, fontWeight: '500', color: c.muted, flexShrink: 1 }}>{section.title}</Text>
        : <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '600', letterSpacing: em(12, 0.06), textTransform: 'uppercase', color: c.muted, flexShrink: 1 }}>{section.title}</Text>}
      <View style={{ flex: 1 }} />
      <Text mono style={{ fontSize: 12, fontWeight: '500', color: c.muted }}>{section.count}</Text>
    </Pressable>
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
