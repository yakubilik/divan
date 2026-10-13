// `/chat/new`: New chat, in the Chat place. The web's New chat there (#208)
// does not make a chat and does not leave the place: nothing is selected and
// the middle is an empty composer, and only what is said in it opens a chat.
// The phone does the same — the pen on the list lands here, an empty composer
// with nothing behind it, and sending is `chat.create` and then `chat.send`,
// after which this screen gives its place to the chat it made, so Back from
// that chat is the list again. Holding the pen still opens the New chat sheet,
// where every choice can be changed first.
import React, { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useStore, useT } from '../../src/store';
import { useNavGuard } from '../../src/nav';
import { useColors } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { alert } from '../../src/components/overlay';
import { Shell } from '../../src/components/shell';
import { FirstWord, useFreshChat } from '../../src/components/first-word';
import { freshCwd } from '../../src/fresh-chat';

export default function NewChatHere() {
  const router = useRouter();
  const go = useNavGuard();
  const c = useColors();
  const T = useT();
  const defaults = useStore((s) => s.defaults);
  const projects = useStore((s) => s.projects);
  const send = useStore((s) => s.send);
  const fresh = useFreshChat();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const creating = useRef(false);

  const say = useCallback(async (words: string) => {
    if (!words || creating.current) return;
    // No folder to open a chat in: only the sheet can ask for one.
    if (!freshCwd(defaults, projects ?? [])) { go(() => router.push('/new-chat')); return; }
    creating.current = true;
    setBusy(true);
    try {
      const chat = (await fresh())!;
      // The chat exists from here on: a send that fails is retried from the
      // chat's own composer, not by making a second one.
      await send(chat.id, words).catch((e: any) => alert(T('error'), e?.message ?? String(e)));
      setText('');
      router.replace(`/chat/${chat.id}`);
    } catch (e: any) {
      // Nothing was made. The words stay in the box, and the dialog offers the
      // two ways on: the same send again, or the sheet with every choice in it.
      alert(T('couldNotStart'), e?.message ?? String(e), [
        { text: T('cancel'), style: 'cancel' },
        { text: T('ncChooseSettings'), onPress: () => go(() => router.push('/new-chat')) },
        { text: T('tryAgain'), onPress: () => void sayRef.current(words) },
      ]);
    } finally {
      creating.current = false;
      setBusy(false);
    }
  }, [defaults, projects, fresh, send, router, go, T]);
  const sayRef = useRef(say);
  sayRef.current = say;

  return (
    <Shell place="chat">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ paddingTop: 18, paddingHorizontal: 16 }}>
          <Text style={{ fontSize: 30, fontWeight: '600' }}>{T('newChat')}</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'flex-end', padding: 16, gap: 10 }}>
          <Text style={{ fontSize: 13, color: c.muted, textAlign: 'center' }}>{T('chNoneYet')}</Text>
          <FirstWord value={text} onChangeText={setText} busy={busy} autoFocus onSend={() => void say(text.trim())} />
        </View>
      </KeyboardAvoidingView>
    </Shell>
  );
}
