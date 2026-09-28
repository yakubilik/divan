import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Image as RNImage, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View, type TextInput as RNTextInput } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useShallow } from 'zustand/react/shallow';
import { buildTimeline, fileUrl, useStore, useT, type Attachment, type TimelineItem } from '../../src/store';
import type { CliAccount } from '../../src/protocol';
import { useNavGuard } from '../../src/nav';
import { useFileDrop, type DroppedFile } from '../../modules/drop-target';
import { getOpenChat, isProtectedChat, setChatOnScreen, setOpenChat } from '../../src/push';
import { LimitsRing } from '../../src/components/limits';
import { em, useColors } from '../../src/theme';
import { Icon, SmallButton, Spinner, Text, TextInput } from '../../src/components/ui';
import { alert, measure, openMenu, prompt, replaceMenu, type MenuItem } from '../../src/components/overlay';
import { Sheet, useSheet } from '../../src/components/sheet';
import { GalleryProvider } from '../../src/components/media';
import { tailCwd, tilde } from '../../src/components/pickers';
import { ApprovalCard, AssistantText, ConnectionBanner, SwitchNote, ThinkingRow, ToolCard, ToolGroup, TranscriptSkeleton, TurnFooter, UserBubble, WorkingRow } from '../../src/components/chat';

/** What the tools call a tier, written the way the billing page writes it.
 *  Anything unrecognised is title-cased rather than dropped: a plan we have
 *  never heard of is still the plan the message is being charged to. */
const PLAN_NAMES: Record<string, string> = {
  max: 'Max', pro: 'Pro', plus: 'Plus', team: 'Team', enterprise: 'Enterprise',
  free: 'Free', api: 'API', business: 'Business',
};
function planName(account: CliAccount | undefined, provider: string | undefined): string {
  const p = (account?.plan ?? '').trim();
  if (p) return PLAN_NAMES[p] ?? p.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
  // No tier from the tool — the account's own name still answers "which
  // sign-in is this", which is more than the vendor's name ever does.
  if (account && !account.is_default && account.label.trim()) return account.label.trim();
  return provider === 'codex' ? 'Codex' : 'Claude';
}

const WINDOW_WORDS: Record<string, string> = { five_hour: '5-hour', seven_day: 'weekly', seven_day_opus: 'weekly Opus', seven_day_sonnet: 'weekly Sonnet' };

function fmt(sec: number) { const s = Math.max(0, Math.floor(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

function useTypewriter(target: string, segment: number | null): string {
  const [shown, setShown] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => { setShown(0); }, [segment]);
  useEffect(() => {
    if (segment == null) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setShown((cur) => {
        const len = targetRef.current.length;
        if (cur >= len) return cur;
        // drain whatever is buffered in ~400ms, never slower than a readable crawl
        const step = Math.max(2, Math.ceil((len - cur) / 12));
        return Math.min(len, cur + step);
      });
      // Every frame re-renders the whole message, so the cost of a frame grows
      // with the answer. Past a few screenfuls nobody is reading the reveal
      // anyway — slow it down rather than spend the phone on it.
      timer = setTimeout(tick, targetRef.current.length > 3000 ? 100 : 33);
    };
    timer = setTimeout(tick, 33);
    return () => clearTimeout(timer);
  }, [segment]);
  return target.slice(0, Math.min(shown, target.length));
}

export default function ChatScreen() {
  const router = useRouter();
  const go = useNavGuard();
  const insets = useSafeAreaInsets();
  const T = useT();
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chat = useStore((s) => s.chats[id!]);
  const events = useStore((s) => s.events[id!]);
  const live = useStore((s) => s.live[id!]);
  const thinking = useStore((s) => s.thinking[id!]);
  const progress = useStore((s) => s.progress[id!]);
  const busy = useStore((s) => s.busy[id!]);
  const conn = useStore((s) => s.conn);
  const catalog = useStore((s) => s.catalog);
  const groups = useStore((s) => s.groups);
  const accounts = useStore((s) => s.accounts);
  const accountsLoaded = useStore((s) => s.accountsLoaded);
  const hostInfo = useStore((s) => s.hostInfo);
  const host = useStore((s) => s.host);
  const limits = useStore((s) => s.limits);
  // Selector-less `useStore()` would subscribe this screen to every store write,
  // so a *different* chat streaming in the background re-rendered this one on
  // every token. Take just the actions; their identities never change.
  const { openChat, send, interrupt, respond, uploadAttachment, updateChat, deleteChat, createGroup, settleLive, loadAccounts } =
    useStore(useShallow((s) => ({
      openChat: s.openChat, send: s.send, interrupt: s.interrupt, respond: s.respond,
      uploadAttachment: s.uploadAttachment, updateChat: s.updateChat, deleteChat: s.deleteChat,
      createGroup: s.createGroup, settleLive: s.settleLive, loadAccounts: s.loadAccounts,
    })));
  const [text, setText] = useState('');
  // Elapsed is measured from the user message that opened the turn, not from
  // when this screen mounted: reopening a chat mid-turn — or coming back after
  // iOS froze the timers in the background — used to restart the clock at 0s
  // and make a long turn look stuck. The daemon stamps events in seconds.
  const mounted = useRef(Date.now());
  const turnStart = useMemo(() => {
    if (!busy) return null;
    const u = [...(events || [])].reverse().find((e) => e.event === 'message.user');
    return u ? u.ts * 1000 : mounted.current;
  }, [busy, events]);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [attachOpen, setAttachOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [kbVisible, setKbVisible] = useState(false);
  const [dim, setDim] = useState<0 | 1 | 2>(0);   // 1: the chat menu is open, 2: the limits card
  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<RNTextInput>(null);
  const moreRef = useRef<View>(null);

  /** iOS keeps its own copy of the field's text while autocorrect is mid-word,
   *  and a bare `setText('')` loses the race with it — the message goes out but
   *  the native view puts the old string straight back. Clearing the native
   *  field too is what actually empties the composer. */
  function clearComposer() { setText(''); inputRef.current?.clear(); }

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const rec = useAudioRecorderState(recorder, 120);
  const [recording, setRecording] = useState(false);
  const levels = useRef<number[]>([]);
  useEffect(() => {
    if (!recording) { levels.current = []; return; }
    const m = rec.metering ?? -160;              // dBFS, roughly -60..0
    const v = Math.max(0, Math.min(1, (m + 50) / 50));
    levels.current = [...levels.current.slice(-27), v];
  }, [rec.durationMillis, recording]); // eslint-disable-line react-hooks/exhaustive-deps

  // A transcript that fails to arrive used to leave the screen on its loading
  // skeleton for good: nothing retried, nothing said so, and `chat` stayed
  // undefined — which took the model sheet down with it. The error is kept, and
  // a chat the computer no longer has sends us back to the list rather than to
  // a screen that can never fill.
  const [openError, setOpenError] = useState<string | null>(null);
  const [tryCount, setTryCount] = useState(0);
  useEffect(() => {
    if (conn !== 'online') return;
    let alive = true;
    void openChat(id!).then(
      () => { if (alive) setOpenError(null); },
      (e: any) => {
        if (!alive) return;
        console.warn('openChat failed', e?.message);
        // Nothing to come back for: the list is where this belongs.
        if (e?.code === 'no_chat') { if (router.canGoBack()) router.back(); else router.replace('/chats'); return; }
        setOpenError(e?.message || T('error'));
      });
    return () => { alive = false; };
  }, [id, conn, openChat, tryCount]); // eslint-disable-line react-hooks/exhaustive-deps
  // Coming back to the screen is the natural moment to try again — the phone
  // has usually just woken up or reconnected. The error is read through a ref
  // so that regaining focus is the only thing that triggers a retry; keying it
  // on the message itself would retry on every error whose wording changed.
  const errorRef = useRef<string | null>(null);
  errorRef.current = openError;
  useFocusEffect(useCallback(() => {
    if (errorRef.current) setTryCount((n) => n + 1);
  }, []));
  // The header names the plan being spent, which only the account list knows.
  // Asking for it costs a shell-out per tool, so ask once per session.
  useEffect(() => {
    if (conn === 'online' && !accountsLoaded) void loadAccounts().catch(() => {});
  }, [conn, accountsLoaded, loadAccounts]);
  // Silences this chat's own "finished" notification while it is on screen.
  useFocusEffect(useCallback(() => {
    setChatOnScreen(id!);
    setOpenChat(id!);
    setOnScreen(true);
    return () => { setChatOnScreen(null); setOnScreen(false); };
  }, [id]));
  // Blur is not "left the chat" — a sheet blurs it too, and so does backgrounding
  // the app, which is exactly when a notification tap has to know where we are.
  useEffect(() => () => { if (getOpenChat() === id) setOpenChat(null); }, [id]);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardWillShow', () => setKbVisible(true));
    const b = Keyboard.addListener('keyboardWillHide', () => setKbVisible(false));
    return () => { a.remove(); b.remove(); };
  }, []);

  // A chat the user opened and left without saying anything should not linger in
  // the list; only drop it when we know it is genuinely empty.
  const loaded = useStore((s) => !!s.loadedChats[id!]);
  // A message that has left the composer counts even before its event comes
  // back: the answer is on its way, and the chat is no longer unused.
  const spokenTo = useRef(false);
  // Read the store at the moment of leaving rather than a value captured while
  // rendering. An unmount the user did not ask for — the stack being popped by
  // a notification tap — arrives after the last render, and a stale "this is
  // empty" from before the first message deleted chats out from under it.
  useEffect(() => () => {
    if (spokenTo.current || isProtectedChat(id!)) return;
    const st = useStore.getState();
    const ch = st.chats[id!];
    const empty = !!st.loadedChats[id!] && !st.busy[id!] && !st.live[id!]
      && (st.events[id!]?.length ?? 0) === 0
      && (ch?.total_cost_usd ?? 0) === 0
      && ch?.title === 'New chat';
    if (empty) void st.deleteChat(id!).catch(() => {});
  }, [id]);

  const items = useMemo(() => buildTimeline(events || []), [events]);
  // Every picture in the chat, oldest first: what the gallery pages through
  // when one of them is tapped (see GalleryProvider).
  const pictures = useMemo(() => {
    const out: Attachment[] = [];
    for (const it of items) {
      if (it.kind !== 'user' && it.kind !== 'assistant') continue;
      for (const a of (it.data?.attachments as Attachment[] | undefined) ?? []) {
        if (a.kind === 'image' || (!a.kind && /\.(png|jpe?g|gif|webp|heic)$/i.test(a.name || a.path || ''))) out.push(a);
      }
    }
    return out;
  }, [items]);
  const typed = useTypewriter(live?.text ?? '', live ? live.segment : null);
  useEffect(() => {
    if (live?.final && typed.length >= live.text.length) settleLive(id!);
  }, [live, typed, id, settleLive]);
  // Inverted list: index 0 is the newest item, so the list is pinned to the bottom by construction.
  const data = useMemo<TimelineItem[]>(() => {
    // While the finished segment is still being typed out, its persisted twin
    // would render the whole thing at once — hide it until the typing catches up.
    const out = live?.final
      ? items.filter((i) => !(i.kind === 'assistant' && i.data.segment === live.segment))
      : [...items];
    if (live) out.push({ key: 'live', kind: 'assistant', data: { text: typed, live: !live.final || typed.length < live.text.length } });
    else if (busy) {
      // No text yet: say what the turn is doing instead of showing nothing.
      const lastTool = [...items].reverse().find((i) => i.kind === 'tool' && !i.result);
      const phase = lastTool || progress?.open_tools ? T('wsWorking') : thinking ? T('wsThinking') : T('wsStarting');
      if (thinking?.trim()) out.push({ key: 'thinking', kind: 'thinking', data: { text: thinking.trim().slice(-240) } } as any);
      // A turn waiting on a decision is not working; the card says what it
      // is waiting for.
      if (!items.some((i) => i.kind === 'approval' && !i.decision)) out.push({ key: 'working', kind: 'working', data: { phase } } as any);
    }
    return out.reverse();
  }, [items, live, typed, busy, thinking, progress, turnStart, T]);

  // Every picture in the chat, oldest first, for the viewer to page through.
  const images = useMemo(() => {
    const out: Attachment[] = [];
    for (const it of items) {
      const atts: Attachment[] | undefined = it.data?.attachments;
      if (!atts) continue;
      for (const a of atts) if (a.kind === 'image' || (!a.kind && /\.(png|jpe?g|gif|webp|heic)$/i.test(a.name || a.path || ''))) out.push(a);
    }
    return out;
  }, [items]);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 1200); }

  // ── sending ────────────────────────────────────────────────────────────
  async function sendNow(t: string, atts: Attachment[]) {
    const voice = atts.find((a) => a.kind === 'audio');
    const body = t || voice?.transcript || (voice ? T('voiceMessage') : T('lookAtFile'));
    try { await send(id!, body, atts); }
    catch (e: any) {
      alert(T('notSent'), e?.message && e?.code !== 'offline' ? `${T('notSentBody')}\n${e.message}` : T('notSentBody'));
      setText(t); setPending(atts);
    }
  }
  async function onSend() {
    const t = text.trim();
    if (!t && pending.length === 0) return;
    const atts = pending;
    clearComposer(); setPending([]);
    spokenTo.current = true;
    await sendNow(t, atts);
  }

  // ── attachments ────────────────────────────────────────────────────────
  async function addAssets(assets: { uri: string; fileName?: string | null; duration?: number | null }[]) {
    let left = assets.length;
    setUploading((n) => n + left);
    try {
      for (const a of assets) {
        const name = a.fileName || a.uri.split('/').pop() || `file-${Date.now()}`;
        try {
          const up = await uploadAttachment(id!, a.uri, name);
          setPending((p) => [...p, { ...up, name, duration: a.duration != null ? a.duration / 1000 : undefined }]);
        } finally { left -= 1; setUploading((n) => Math.max(0, n - 1)); }
      }
    } catch (e: any) {
      // Only this batch's own uploads are given up on; another batch still
      // in flight keeps Send waiting for it.
      alert(T('uploadFailed'), e.message);
      const rest = left;
      setUploading((n) => Math.max(0, n - rest));
    }
  }
  // PHPicker needs no library permission; only the camera does.
  const pickPhotos = async () => { const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsMultipleSelection: true, selectionLimit: 4 }); if (!r.canceled) await addAssets(r.assets); };
  const pickVideo = async () => { const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], videoMaxDuration: 120 }); if (!r.canceled) await addAssets(r.assets); };
  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { alert(T('noPermission'), T('photosDenied')); return; }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (!r.canceled) await addAssets(r.assets);
  };
  const pickFile = async () => { const r = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true }); if (!r.canceled) await addAssets(r.assets.map((a) => ({ uri: a.uri, fileName: a.name }))); };
  /** Dragged in from another app — a screenshot out of Photos, a PDF out of
   *  Files. iOS has already copied it somewhere we can read, so it joins the
   *  queue the picker fills: uploaded now, sent when the message is. Only
   *  while this chat is the one on screen; a drop belongs to what you are
   *  looking at. */
  const onDropped = useCallback((files: DroppedFile[]) => {
    setDropping(false);
    if (!files.length) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    void addAssets(files.map((f) => ({ uri: f.uri, fileName: f.name })));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const onDragEnter = useCallback(() => setDropping(true), []);
  const onDragExit = useCallback(() => setDropping(false), []);
  useFileDrop(onScreen, { onDrop: onDropped, onEnter: onDragEnter, onExit: onDragExit });

  const attachActions: AttachAction[] = [
    { key: 'photos', label: T('photos'), icon: 'photo_library', run: pickPhotos },
    { key: 'camera', label: T('camera'), icon: 'photo_camera', run: takePhoto },
    { key: 'video', label: T('video'), icon: 'videocam', run: pickVideo },
    { key: 'file', label: T('file'), icon: 'draft', run: pickFile },
  ];

  // ── voice ──────────────────────────────────────────────────────────────
  async function startRecording() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { alert(T('noPermission'), T('micDenied')); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch (e: any) { setRecording(false); alert(T('error'), e?.message ?? String(e)); }
  }
  async function stopRecording(sendIt: boolean) {
    const seconds = Math.max(rec.durationMillis, recorder.currentTime * 1000) / 1000;
    try { await recorder.stop(); } catch {}
    setRecording(false);
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    const uri = recorder.uri;
    if (!sendIt || !uri || seconds < 0.5) return;
    setUploading((n) => n + 1);
    try {
      const up = await uploadAttachment(id!, uri, `voice-${Date.now()}.m4a`);
      const att: Attachment = { ...up, kind: 'audio', duration: seconds };
      spokenTo.current = true;
      await sendNow(text.trim(), [...pending, att]);
      clearComposer(); setPending([]);
    } catch (e: any) { alert(T('uploadFailed'), e.message); }
    finally { setUploading((n) => Math.max(0, n - 1)); }
  }

  const openModelSheet = () => go(() => router.push({ pathname: '/model-sheet', params: { id } }));

  // ── chat menu ──────────────────────────────────────────────────────────
  const err = (e: any) => alert(T('error'), e?.message ?? String(e));
  function moveItems(): MenuItem[] {
    if (!chat) return [];
    const newGroup = () => prompt({
      title: T('newGroupTitle'), placeholder: T('groupName'), confirm: T('create'), cancel: T('cancel'),
      submit: async (n) => { if (!n.trim()) return T('groupNameEmpty'); const g = await createGroup(n.trim()); await updateChat(chat.id, { group_id: g.id } as any); },
    });
    return [
      { kind: 'back', label: T('moveToGroup'), onPress: () => replaceMenu(menuItems()) },
      ...groups.map((g) => ({ label: g.name, checked: g.id === chat.group_id, onPress: () => void updateChat(chat.id, { group_id: g.id } as any).catch(err) })),
      { kind: 'divider' as const },
      { label: T('noGroup'), onPress: () => void updateChat(chat.id, { group_id: null } as any).catch(err) },
      { label: T('newGroupAction'), icon: 'add', onPress: newGroup },
    ];
  }
  function menuItems(): MenuItem[] {
    if (!chat) return [];
    return [
      { label: T('rename'), icon: 'edit', onPress: () => prompt({
          title: T('renameChat'), value: chat.title, placeholder: T('chatName'), confirm: T('save'), cancel: T('cancel'),
          submit: async (t) => { if (t.trim()) await updateChat(chat.id, { title: t.trim().slice(0, 60) } as any); },
        }) },
      { label: T('moveToGroup'), icon: 'folder_open', submenu: true, onPress: () => replaceMenu(moveItems()) },
      { label: chat.pinned ? T('unpin') : T('pin'), icon: chat.pinned ? 'keep_off' : 'keep', onPress: () => void updateChat(chat.id, { pinned: chat.pinned ? 0 : 1 } as any).catch(err) },
      { label: chat.archived ? T('unarchive') : T('archiveAction'), icon: chat.archived ? 'unarchive' : 'inventory_2', onPress: () => {
          updateChat(chat.id, { archived: chat.archived ? 0 : 1 } as any)
            .then(() => { if (!chat.archived) { showToast(T('archived')); setTimeout(() => router.back(), 400); } })
            .catch(err);
        } },
      { label: T('chatSettingsItem'), icon: 'tune', onPress: () => go(() => router.push({ pathname: '/chat-settings', params: { id } })) },
      { kind: 'divider' },
      { label: T('deleteChat'), icon: 'delete', danger: true, onPress: () => alert(T('deleteChat'), T('deleteChatBody'), [
          { text: T('cancel'), style: 'cancel' },
          { text: T('delete'), style: 'destructive', onPress: () => { router.back(); deleteChat(chat.id).catch(err); } }]) },
    ];
  }
  async function chatMenu() {
    if (!chat) return;
    const anchor = await measure(moreRef);
    setDim(1);
    openMenu({ anchor, align: 'right', width: 236, items: menuItems(), onClose: () => setDim(0) });
  }

  const online = conn === 'online';
  const dot = online ? c.ok : conn === 'connecting' ? c.warn : c.lineStrong;
  const canSend = (!!text.trim() || pending.length > 0) && online && uploading === 0;
  const modelLabel = chat ? (catalog?.[chat.provider]?.models.find((m) => m.id === chat.model)?.label ?? chat.model) : '';
  const effortLabel = chat?.effort === 'medium' ? 'med' : chat?.effort;
  const account = useMemo(
    () => (chat ? accounts.find((a) => a.id === (chat.account_id || `default-${chat.provider}`)) : undefined),
    [accounts, chat?.account_id, chat?.provider]); // eslint-disable-line react-hooks/exhaustive-deps
  const planLabel = planName(account, chat?.provider);
  // Two sign-ins on one tool means the tier alone no longer says which one is
  // being spent; the account's name does.
  const planSub = useMemo(() => {
    const same = accounts.filter((a) => a.provider === chat?.provider && a.logged_in);
    return same.length > 1 && account?.plan && account.label !== planLabel ? (account.is_default ? T('ownShort') : account.label) : undefined;
  }, [accounts, account, chat?.provider, planLabel, T]);
  // Which computer is running this. The folder alone stopped answering that
  // the moment a second one was paired, and it is nowhere in the transcript.
  // The live name when connected; the paired one is all that is left offline.
  const hostName = hostInfo?.name?.replace('.local', '') || host?.name || T('computer');

  const accountLabel = (accId?: string | null) => {
    const a = accounts.find((x) => x.id === accId);
    return a ? (a.is_default ? T('ownShort') : a.label) : accId ?? undefined;
  };
  const fullest = (accId?: string | null) => {
    const w = [...(limits[accId || ''] ?? [])].sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))[0];
    return w ? WINDOW_WORDS[w.window] : undefined;
  };

  const renderItem = useCallback(({ item }: { item: TimelineItem }) => {
    switch (item.kind as string) {
      case 'working':
        return <WorkingRow phase={item.data.phase} since={turnStart ?? Date.now()}
                 tokens={progress?.output_tokens} tools={progress?.open_tools} />;
      case 'thinking': return <ThinkingRow text={item.data.text} />;
      // No long-press wrapper on either bubble: long-press is the gesture that
      // starts a text selection, and a Pressable takes it first. Copying the
      // whole message is still one tap away — iOS offers Select All beside Copy
      // in the selection menu — and now part of a message can be taken too.
      case 'user': return <UserBubble text={item.data.text} attachments={item.data.attachments} />;
      case 'assistant':
        if (item.data.thinking) return <ThinkingRow text={item.data.thinking.trim().slice(-240)} />;
        return <AssistantText text={item.data.text} streaming={item.data.live} attachments={item.data.attachments} />;
      case 'tool': return <ToolCard id={item.data.id} tool={item.data.tool} input={item.data.input} result={item.result} />;
      case 'tools': return <ToolGroup items={item.data} />;
      case 'approval': return (
        <ApprovalCard tool={item.data.tool} input={item.data.input} preview={item.data.preview} danger={item.data.danger} decision={item.decision ?? null} cwd={chat?.cwd}
          onDecide={(d) => respond(id!, item.data.request_id, d).catch((e) => alert(T('error'), e.message))} />
      );
      case 'done': return <TurnFooter cost={item.data.cost_usd} duration={item.data.duration_ms} usage={item.data.usage} stopReason={item.data.stop_reason} />;
      case 'error': return <TurnFooter error={item.data.message} />;
      case 'switch': return <SwitchNote to={item.data.to} until={item.data.until} label={accountLabel(item.data.to)}
                              from={accountLabel(item.data.from)} window={fullest(item.data.from)} />;
      default: return null;
    }
  }, [id, respond, T, accounts, limits, turnStart, progress]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = !online ? (conn === 'connecting' ? T('connecting') : T('offline')) : chat?.perm_mode;
  const metaColor = !online ? c.warn : chat?.perm_mode === 'bypass' ? c.accentText : c.muted;
  const composerBottom = kbVisible ? 8 : Math.max(insets.bottom - 4, 10);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <GalleryProvider items={images}>
      {/* Header: back · plan chip (what this is being billed to) · more.
          The model moved down into the composer, where it is chosen. */}
      <View style={{ paddingTop: insets.top + 2, paddingHorizontal: 10, paddingBottom: 10, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
                     borderBottomWidth: 1, borderBottomColor: dim === 2 ? 'transparent' : c.line }}>
        <Pressable accessibilityLabel={T('back')} onPress={() => go(() => router.back())} hitSlop={6} style={({ pressed }) => [sq40, pressed && { opacity: 0.5 }]}>
          <Icon name="chevron_left" size={26} />
        </Pressable>
        {/* The meta line may run a little under the two buttons: their glyphs
            sit in the middle of 40 pt squares, and the path is worth the room. */}
        <View style={{ flex: 1, alignItems: 'center', gap: 5, minWidth: 0, marginHorizontal: -8 }}>
          <LimitsRing chatId={id} accountId={chat?.account_id} provider={chat?.provider} label={planLabel} sub={planSub} dot={dot}
            onOpenChange={(o) => setDim(o ? 2 : 0)} />
          {chat && (
            // State and computer first, because both are short and neither has
            // anywhere else to be read. The path gives way when the line runs
            // out, and gives way at the head: a path is identified by its tail.
            <Text mono numberOfLines={1} ellipsizeMode="head" style={{ fontSize: 11, color: metaColor, maxWidth: '100%' }}>
              {meta} · {hostName} · {tailCwd(chat.cwd)}
            </Text>
          )}
        </View>
        <Pressable ref={moreRef} accessibilityLabel={T('chatMenu')} onPress={() => void chatMenu()} hitSlop={6} style={({ pressed }) => [sq40, pressed && { opacity: 0.5 }]}>
          <Icon name="more_horiz" size={24} />
        </Pressable>
      </View>

      {conn !== 'online' && <ConnectionBanner text={T('wReconnecting')} />}

      <Animated.View style={{ flex: 1, opacity: dim === 1 ? 0.35 : dim === 2 ? 0.4 : 1 }}>
        <FlatList
          ref={listRef}
          data={data}
          inverted
          keyExtractor={(it) => it.key}
          contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, gap: 12, flexGrow: 1 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
          initialNumToRender={20}
          windowSize={9}
          ListEmptyComponent={
            // A transcript that has not arrived is not an empty transcript —
            // and one that is not coming is not a slow one. Say which.
            !loaded ? (
              openError ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12, transform: [{ scaleY: -1 }] }}>
                  <Icon name="cloud_off" size={26} color={c.faint} />
                  <Text style={{ fontSize: 14, color: c.muted, textAlign: 'center' }}>{openError}</Text>
                  <SmallButton title={T('tryAgain')} onPress={() => setTryCount((n) => n + 1)} />
                </View>
              ) : (
                <View style={{ transform: [{ scaleY: -1 }], paddingTop: 4 }}><TranscriptSkeleton /></View>
              )
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8, transform: [{ scaleY: -1 }] }}>
                <Text style={{ fontSize: 22, fontWeight: '600', letterSpacing: em(22, -0.01), textAlign: 'center' }}>{chat?.title}</Text>
                {chat && (
                  <Text style={{ fontSize: 13, color: c.muted, textAlign: 'center' }}>
                    {T('worksInLabel')}<Text mono style={{ color: c.text2 }}>{tilde(chat.cwd)}</Text>
                  </Text>
                )}
              </View>
            )
          }
          renderItem={renderItem}
        />
      </Animated.View>

      {toast && (
        <View pointerEvents="none" style={{ position: 'absolute', alignSelf: 'center', bottom: composerBottom + 110, flexDirection: 'row', alignItems: 'center', gap: 8,
                                            backgroundColor: c.ink, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16,
                                            boxShadow: c.scheme === 'dark' ? '0 8px 28px -10px rgba(0,0,0,.6)' : '0 8px 28px -10px rgba(28,27,22,.3)' }}>
          <Icon name="inventory_2" size={18} color={c.onInk} />
          <Text style={{ fontSize: 14, fontWeight: '500', color: c.onInk }}>{toast}</Text>
        </View>
      )}

      {/* Composer */}
      <View style={{ paddingHorizontal: 10, paddingBottom: composerBottom, gap: 8 }}>
        {(pending.length > 0 || uploading > 0) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', paddingHorizontal: 4, paddingTop: 6 }}>
            {/* A picture waiting to be sent is shown as the picture. The name of
                a photo out of the camera roll says nothing about which one it is. */}
            {pending.map((a) => a.kind === 'image' ? (
              <View key={a.path} style={{ width: 56, height: 56 }}>
                <View style={{ width: 56, height: 56, borderRadius: 12, overflow: 'hidden', backgroundColor: c.fill }}>
                  <RNImage source={{ uri: a.localUri || fileUrl(a.view || a.path) || undefined }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                </View>
                <Pressable onPress={() => setPending((p) => p.filter((x) => x.path !== a.path))} hitSlop={8}
                  style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close" size={14} weight={400} color={c.onInk} />
                </Pressable>
              </View>
            ) : (
              <Pressable key={a.path} onPress={() => setPending((p) => p.filter((x) => x.path !== a.path))}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingHorizontal: 10, height: 56 }}>
                <Icon name={a.kind === 'video' ? 'videocam' : a.kind === 'audio' ? 'mic' : 'draft'} size={20} weight={400} color={c.muted} />
                <View>
                  <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '500', maxWidth: 180 }}>{a.name}</Text>
                  {!!a.size && <Text mono style={{ fontSize: 10.5, color: c.faint }}>{fmtSize(a.size)}</Text>}
                </View>
              </Pressable>
            ))}
            {Array.from({ length: uploading }).map((_, i) => (
              <View key={`up${i}`} style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
                <Spinner size={18} track={c.spinTrack} />
              </View>
            ))}
          </View>
        )}
        {recording ? (
          <View style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.lineStrong, borderRadius: 28, padding: 6, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable onPress={() => void stopRecording(false)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={22} weight={400} color={c.text2} />
            </Pressable>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.danger }} />
            <Text mono style={{ fontSize: 14, fontWeight: '500' }}>{fmt(rec.durationMillis / 1000)}</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 28 }}>
              {Array.from({ length: 28 }, (_, i) => {
                const have = levels.current.length;
                const v = i >= 28 - have ? levels.current[have - (28 - i)] ?? 0 : null;
                const hgt = v == null ? 4 : 4 + v * 22;
                const col = v == null ? c.lineStrong : hgt >= 17 ? c.ink : hgt >= 12 ? c.text2 : hgt >= 8 ? c.muted : c.faint;
                return <View key={i} style={{ width: 2.5, height: hgt, borderRadius: 2, backgroundColor: col }} />;
              })}
            </View>
            <Pressable onPress={() => void stopRecording(true)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={22} weight={500} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : (
          <View style={{ backgroundColor: online ? c.card : c.fill, borderWidth: 1, borderColor: c.lineStrong, borderRadius: 26, padding: 8, gap: 6, boxShadow: c.shadow.card }}>
            <TextInput
              ref={inputRef}
              value={text} onChangeText={setText} placeholder={online ? T('message') : T('noConnection')}
              multiline editable={online} numberOfLines={Platform.OS === 'web' ? 1 : undefined}
              style={{ fontSize: 15, paddingVertical: 4, paddingHorizontal: 8, minHeight: 26, maxHeight: 160 }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: online ? 1 : 0.45 }}>
              <Pressable accessibilityLabel={T('attach')} onPress={() => setAttachOpen(true)} disabled={!online || uploading > 0}
                style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="add" size={20} weight={400} />
              </Pressable>
              {/* The model sits where it is picked, one tap from the message
                  being written with it. */}
              <Pressable onPress={openModelSheet} disabled={!online}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: c.line, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10 }}>
                <Text mono numberOfLines={1} style={{ fontSize: 11.5, color: c.text2 }}>{[modelLabel || '…', effortLabel].filter(Boolean).join(' · ')}</Text>
                <Icon name="expand_more" size={14} color={c.text2} />
              </Pressable>
              <View style={{ flex: 1 }} />
              {/* A running turn is not a locked door. Stop is always there, and
                  anything typed next goes in the queue for the agent to pick up
                  when it comes up for air — no need to cut it off first. */}
              {busy && online && (
                <Pressable accessibilityLabel={T('stop')} onPress={() => interrupt(id!)} style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: c.ink }} />
                </Pressable>
              )}
              {canSend ? (
                <Pressable accessibilityLabel={T('send')} onPress={() => void onSend()} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="arrow_upward" size={20} weight={500} color="#FFFFFF" />
                </Pressable>
              ) : (
                <Pressable accessibilityLabel={T('record')} onPress={() => void startRecording()} disabled={!online || uploading > 0} style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="mic" size={22} color={c.muted} />
                </Pressable>
              )}
            </View>
          </View>
        )}
      </View>

      {/* Attach sheet */}
      <Modal visible={attachOpen} transparent animationType="none" onRequestClose={() => setAttachOpen(false)} statusBarTranslucent>
        <AttachSheet host={hostName} actions={attachActions} onClose={() => setAttachOpen(false)} />
      </Modal>

      {/* What is about to happen if the finger lets go. Drawn over everything
          and touchable by nothing: a drag in flight belongs to the system. */}
      {dropping && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.veil, padding: 24, alignItems: 'center', justifyContent: 'center' }]}>
          <View style={{ width: '100%', height: '100%', borderWidth: 2, borderStyle: 'dashed', borderColor: c.ink, borderRadius: 34, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <Icon name="download" size={44} />
            <Text style={{ fontSize: 20, fontWeight: '600' }}>{T('dropHere')}</Text>
            <Text style={{ fontSize: 13, color: c.muted }}>{T('dropHint', { host: hostName })}</Text>
          </View>
        </View>
      )}
      </GalleryProvider>
    </KeyboardAvoidingView>
  );
}

type AttachAction = { key: string; label: string; icon: string; run: () => Promise<void> };

/** The attach sheet. The picker it leads to only opens once the sheet is
 *  gone: iOS will not present one modal over another that is still leaving. */
function AttachSheet({ host, actions, onClose }: { host: string; actions: AttachAction[]; onClose: () => void }) {
  const picked = useRef<AttachAction | null>(null);
  return (
    <Sheet onClose={() => { onClose(); const a = picked.current; if (a) setTimeout(() => void a.run(), 350); }}>
      <AttachBody host={host} actions={actions} onPick={(a) => { picked.current = a; }} />
    </Sheet>
  );
}

function AttachBody({ host, actions, onPick }: { host: string; actions: AttachAction[]; onPick: (a: AttachAction) => void }) {
  const c = useColors();
  const T = useT();
  const insets = useSafeAreaInsets();
  const { close } = useSheet();
  return (
    <View style={{ paddingTop: 16, paddingHorizontal: 16, paddingBottom: insets.bottom + 10, gap: 16 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {actions.map((a) => (
          <Pressable key={a.key} onPress={() => { onPick(a); close(); }} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
            <View style={{ width: '100%', aspectRatio: 1, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={a.icon} size={26} />
            </View>
            <Text style={{ fontSize: 12, color: c.text2 }}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ height: 1, backgroundColor: c.line }} />
      <View style={{ gap: 4, paddingHorizontal: 2 }}>
        <Text style={{ fontSize: 13, color: c.muted }}>{T('uploadsNote', { host })}</Text>
        <Text mono style={{ fontSize: 12.5 }}>~/.remote-ai-chat/uploads</Text>
      </View>
      <Text style={{ fontSize: 12, color: c.faint, paddingHorizontal: 2 }}>{T('uploadsLimits')}</Text>
    </View>
  );
}

function fmtSize(n?: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const sq40 = { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' } as const;
