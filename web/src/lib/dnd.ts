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

// ── a card on the board ─────────────────────────────────────────────────────

/** Dragging a ticket from one column of the board into another (Web12 W2). The
 *  same agreement as above and for the same reason: the column that catches a
 *  drop must be able to tell a card being moved from a file dropped in off the
 *  desktop, and during `dragover` the type list is all it is allowed to see.
 *
 *  What the drag *means* — which columns would take it, what a landing does —
 *  is `lib/board.ts` and the screen's own state. This is only the payload. */
export const CARD_DND = 'application/x-rac-card';

export interface CardDrag { hostKey: string; cardId: string }

export function setCardDrag(dt: DataTransfer, drag: CardDrag): void {
  dt.setData(CARD_DND, `${drag.hostKey}/${drag.cardId}`);
  // As above: Firefox will not start a drag that carries nothing it knows.
  dt.setData('text/plain', drag.cardId);
  dt.effectAllowed = 'move';
}

export function readCardDrag(dt: DataTransfer | null): CardDrag | null {
  const raw = dt?.getData(CARD_DND);
  if (!raw) return null;
  const cut = raw.lastIndexOf('/');
  if (cut <= 0) return null;
  return { hostKey: raw.slice(0, cut), cardId: raw.slice(cut + 1) };
}

export function hasCardDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(CARD_DND);
}
