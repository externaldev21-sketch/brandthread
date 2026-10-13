/**
 * Search in chat → jump to the message (polish #164, Instagram Direct): the
 * search screen leaves a pending focus here and dismisses back to the chat,
 * which scrolls to that message and highlights it briefly.
 */
let pending: { conversationId: string; messageId: string } | null = null;

export function setPendingChatFocus(conversationId: string, messageId: string): void {
  pending = { conversationId, messageId };
}

/** Returns (and clears) the message to focus in this conversation, if any. */
export function takePendingChatFocus(conversationId: string | null | undefined): string | null {
  if (!pending || !conversationId || pending.conversationId !== conversationId) return null;
  const { messageId } = pending;
  pending = null;
  return messageId;
}

/** How long the found message stays highlighted. */
export const CHAT_FOCUS_HIGHLIGHT_MS = 1600;

/** Index of a message row in a chat list (rows of { type: 'message', msg }). Pure. */
export function messageRowIndex(rows: ReadonlyArray<{ type: string; msg?: { id: string } }>, messageId: string): number {
  return rows.findIndex((row) => row.type === 'message' && row.msg?.id === messageId);
}
