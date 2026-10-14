// The first words of a chat that does not exist yet, and what sending them
// does: `chat.create` on what New chat would start with (`src/fresh-chat.ts`),
// then `chat.send` with the words, then that chat. The chat list draws it when
// there is no conversation yet; `useFreshChat` is also what the list's pen
// calls to open a fresh chat at once.
import React, { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import { useStore, useT } from '../store';
import { useColors } from '../theme';
import { freshAccount, freshAgent, freshChat, freshCwd } from '../fresh-chat';
import { Icon, TextInput } from './ui';
import type { Chat } from '../protocol';

/** Make a fresh chat. Null where there is no folder to
 *  open one in — only the New chat sheet can ask for one. The agent list is one
 *  more round trip, asked only when the remembered choice is an agent; if it
 *  cannot be read the chat opens without one rather than not at all. */
export function useFreshChat() {
  const defaults = useStore((s) => s.defaults);
  const projects = useStore((s) => s.projects);
  const accounts = useStore((s) => s.accounts);
  const catalog = useStore((s) => s.catalog);
  const listAgents = useStore((s) => s.listAgents);
  const createChat = useStore((s) => s.createChat);
  return useCallback(async (): Promise<Chat | null> => {
    const cwd = freshCwd(defaults, projects ?? []);
    if (!cwd) return null;
    const account = freshAccount(defaults, accounts);
    const agents = defaults.lastAgent === null ? []
      : await listAgents(account || null, cwd, defaults.provider).catch(() => []);
    return createChat(freshChat({ defaults, catalog, cwd, account, agent: freshAgent(defaults, agents) }) as any);
  }, [defaults, projects, accounts, catalog, listAgents, createChat]);
}

/** The field and its send button. Whatever is typed stays the caller's. */
export function FirstWord({ value, onChangeText, onSend, busy, autoFocus }: {
  value: string; onChangeText: (t: string) => void; onSend: () => void; busy?: boolean; autoFocus?: boolean;
}) {
  const c = useColors();
  const T = useT();
  const ready = !!value.trim() && !busy;
  const go = () => { if (ready) onSend(); };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 28, borderWidth: 1, borderColor: c.line,
                   backgroundColor: c.card, paddingLeft: 18, paddingRight: 6, minHeight: 56 }}>
      <TextInput value={value} onChangeText={onChangeText} placeholder={T('chTalk')} accessibilityLabel={T('chTalk')}
        autoFocus={autoFocus} placeholderTextColor={c.faint} returnKeyType="send" onSubmitEditing={go}
        style={{ flex: 1, fontSize: 15 }} />
      <Pressable accessibilityRole="button" accessibilityLabel={T('send')} onPress={go} disabled={!ready}
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
                 backgroundColor: ready ? c.ink : c.fill }}>
        <Icon name="arrow_upward" size={20} color={ready ? c.onInk : c.faint} />
      </Pressable>
    </View>
  );
}
