/** Dragging a chat around the wall. One place starts a drag and one catches it
 *  — a tile on the wall, picked up and put down in a different order — so the
 *  payload is agreed here rather than guessed at each end.
 *
 *  The chat list used to start one too, back when it and the wall shared a
 *  screen. They cannot be on screen together now: the list is the Chat place and
 *  the wall is a page of the Machine place, so a drag out of the list could only
 *  ever end where it began, and the list no longer offers one.
 *
 *  A private MIME type is what makes the catch safe: a file dragged in from the
 *  desktop, or a selection dragged out of a bubble, must not read as a chat
 *  being moved. */
export const CHAT_DND = 'application/x-rac-chat';

export interface ChatDrag { hostKey: string; chatId: string }

export function setChatDrag(dt: DataTransfer, drag: ChatDrag): void {
  dt.setData(CHAT_DND, `${drag.hostKey}/${drag.chatId}`);
  // Firefox will not start a drag that carries nothing it recognises, so the
  // payload rides twice. Nothing reads the text/plain copy.
  dt.setData('text/plain', drag.chatId);
  dt.effectAllowed = 'move';
}

export function readChatDrag(dt: DataTransfer | null): ChatDrag | null {
  const raw = dt?.getData(CHAT_DND);
  if (!raw) return null;
  const cut = raw.lastIndexOf('/');
  if (cut <= 0) return null;
  return { hostKey: raw.slice(0, cut), chatId: raw.slice(cut + 1) };
}

/** Whether the drag in flight is one of ours. During dragover the browser
 *  hides the data and offers only the type list, so this is all a drop target
 *  has to go on while it decides whether to light up. */
export function hasChatDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(CHAT_DND);
}
