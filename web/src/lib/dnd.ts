/** Dragging a chat. Two things are picked up, and each is put down where it
 *  was picked up from: a tile on the wall, into a different order, and a row
 *  in the chat list, under a different group's heading. The payload is agreed
 *  here rather than guessed at each end.
 *
 *  The list and the wall cannot be on screen together — the list is the Chat
 *  place and the wall is a page of the Machine place — so neither can be
 *  dropped on the other, and nothing offers to.
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

// ── a section of the chat list ──────────────────────────────────────────────

/** Dragging a heading of the chat list above or below another. A type of its
 *  own, and for the reason above: a section catches chats being filed into it,
 *  and has to tell one of those from a heading being moved past it. */
export const SECTION_DND = 'application/x-rac-section';

export function setSectionDrag(dt: DataTransfer, key: string): void {
  dt.setData(SECTION_DND, key);
  // As above: Firefox will not start a drag that carries nothing it knows.
  dt.setData('text/plain', key);
  dt.effectAllowed = 'move';
}

export function readSectionDrag(dt: DataTransfer | null): string | null {
  return dt?.getData(SECTION_DND) || null;
}

export function hasSectionDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(SECTION_DND);
}
