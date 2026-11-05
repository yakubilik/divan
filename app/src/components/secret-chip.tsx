/** The chip a shared key is drawn as (`../secret-share.ts`). A tap asks the
 *  daemon for the value and puts it on the clipboard — the screen never shows
 *  it — and the clipboard is wiped a minute later if it still holds it, since
 *  iOS hands it to the Mac and to any app that asks. After the hour the chip
 *  turns grey and does nothing; the daemon would refuse it anyway. */
import React, { useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useColors } from '../theme';
import { useT } from '../store';
import { client } from '../ws';
import { Text } from './ui';
import type { Share } from '../secret-share';

export const CLIPBOARD_CLEAR_MS = 60_000;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

/** Put a value on the clipboard and take it off again in a minute, unless
 *  something else has been copied over it by then. */
export async function copyForAMinute(value: string): Promise<void> {
  await Clipboard.setStringAsync(value);
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    clearTimer = null;
    Clipboard.getStringAsync()
      .then((now) => (now === value ? Clipboard.setStringAsync('') : undefined))
      .catch(() => {});
  }, CLIPBOARD_CLEAR_MS);
}

type State = 'idle' | 'busy' | 'copied' | 'failed';

export function SecretChip({ share }: { share: Share }) {
  const c = useColors();
  const t = useT();
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [state, setState] = useState<State>('idle');
  const [gone, setGone] = useState(false);
  const expired = gone || now >= share.until;

  // Turn grey on time, with the chat open and nobody touching it.
  useEffect(() => {
    if (expired) return;
    const ms = Math.min((share.until - Date.now() / 1000) * 1000 + 250, 2 ** 31 - 1);
    const h = setTimeout(() => setNow(Date.now() / 1000), Math.max(ms, 0));
    return () => clearTimeout(h);
  }, [share.until, expired, now]);

  useEffect(() => {
    if (state !== 'copied' && state !== 'failed') return;
    const h = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(h);
  }, [state]);

  const onPress = async () => {
    if (state === 'busy') return;
    setState('busy');
    try {
      const r = await client.call('secret.copy', { chat_id: share.chatId, service: share.service });
      await copyForAMinute(String(r?.value ?? ''));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setState('copied');
    } catch (e: any) {
      if (e?.code === 'secret_expired' || e?.code === 'secret_not_shared' || e?.code === 'secret_gone') setGone(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setState('failed');
    }
  };

  const label = expired
    ? `🔒 ${share.label} · ${t('secretExpired')}`
    : state === 'copied' ? `✓ ${t('secretCopied')}`
      : state === 'failed' ? `⚠︎ ${t('secretFailed')}`
        : state === 'busy' ? `🔑 ${share.label} …` : `🔑 ${share.label}`;
  return (
    <Text
      onPress={expired ? undefined : onPress}
      accessibilityRole={expired ? 'text' : 'button'}
      accessibilityHint={expired ? undefined : t('secretHint')}
      style={{
        backgroundColor: c.fill, borderRadius: 6, overflow: 'hidden',
        color: expired ? c.faint : state === 'failed' ? c.danger : c.ink,
        fontWeight: expired ? '400' : '600',
      }}>
      {` ${label} `}
    </Text>
  );
}
