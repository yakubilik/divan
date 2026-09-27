import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { AppState } from 'react-native';

/** The chat currently on screen, if any. Kept here rather than in the store so
 *  the notification handler does not have to import it — the store imports this
 *  module. */
let onScreen: string | null = null;
export function setChatOnScreen(id: string | null) { onScreen = id; }

/** The chat the user is *in*, which outlives losing focus: a sheet on top of the
 *  chat, or the app going to the background, does not take them off it. Used to
 *  decide what a notification tap should do. */
let openChat: string | null = null;
export function setOpenChat(id: string | null) { openChat = id; }
export function getOpenChat(): string | null { return openChat; }

/** The chat a notification tap is on its way into. The tap pops the stack back
 *  to the list before pushing, and every chat screen it unmounts runs its own
 *  "this one was never used, drop it" cleanup — which happily deleted the very
 *  chat the tap was opening, leaving a screen waiting for a transcript the
 *  computer no longer has. A chat named here is never disposed of. */
let protectedChat: string | null = null;
let protectTimer: ReturnType<typeof setTimeout> | null = null;
export function protectChat(id: string) {
  protectedChat = id;
  if (protectTimer) clearTimeout(protectTimer);
  // Long enough to outlive the pop and the push it is guarding, short enough
  // that the chat goes back to being ordinary once we are standing in it.
  protectTimer = setTimeout(() => { protectedChat = null; protectTimer = null; }, 5000);
}
export function isProtectedChat(id: string): boolean { return protectedChat === id; }

/** Take a chat's banners back out of Notification Center. A notification
 *  outlives the chat it announced, and tapping a stale one opened a chat the
 *  computer no longer has. Best effort: a banner we cannot withdraw is not
 *  worth an error. */
export async function dismissChatNotifications(chatId: string): Promise<void> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(shown
      .filter((n) => (n.request.content.data as any)?.chat_id === chatId)
      .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)));
  } catch {}
}

Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const chatId = (n.request.content.data as any)?.chat_id;
    // Announcing a chat the user is already reading is noise; everything else
    // gets a banner, including while the app is open.
    const mute = !!chatId && chatId === onScreen && AppState.currentState === 'active';
    return { shouldShowBanner: !mute, shouldShowList: true, shouldPlaySound: !mute, shouldSetBadge: false };
  },
});

/** Returns an Expo push token, or null when this build cannot receive push
 *  (simulator, Expo Go without an EAS project id, permission denied). */
export async function registerForPush(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return token.data;
  } catch (e) {
    console.warn('push registration failed', e);
    return null;
  }
}
