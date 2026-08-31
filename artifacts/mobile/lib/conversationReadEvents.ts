type ConversationReadFailureListener = (conversationId: string) => void;

const readFailureListeners = new Set<ConversationReadFailureListener>();

export function subscribeConversationReadFailure(
  listener: ConversationReadFailureListener,
): () => void {
  readFailureListeners.add(listener);
  return () => readFailureListeners.delete(listener);
}

export function notifyConversationReadFailure(conversationId: string): void {
  for (const listener of readFailureListeners) {
    listener(conversationId);
  }
}