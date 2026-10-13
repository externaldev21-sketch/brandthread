/**
 * Keeps a chat's unsent composer text (offline polish #31), like iMessage /
 * Instagram DMs: leave a chat mid-sentence (or the app gets killed) and the
 * text is still in the box when you come back. Cleared as soon as the box is
 * emptied, which includes a send.
 */
import { useEffect, useRef, useState } from 'react';
import { getChatDraft, setChatDraft } from '@/services/socialService';

const SAVE_DEBOUNCE_MS = 400;

export function useChatDraft(
  conversationId: string | null | undefined,
  text: string,
  setText: (text: string) => void,
  ownerId?: string | null,
): void {
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const scope = ownerId === null || !conversationId ? null : `${ownerId ?? 'device'}:${conversationId}`;
  const previousScope = useRef(scope);
  const latestText = useRef(text);
  latestText.current = text;
  const pending = useRef<{ id: string; text: string; ownerId?: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore once per conversation, and only into an empty box (never over
  // something the person already started typing).
  useEffect(() => {
    if (previousScope.current !== scope) {
      previousScope.current = scope;
      latestText.current = '';
      setText('');
    }
    if (!conversationId || ownerId === null) return;
    let cancelled = false;
    setRestoredFor(null);
    getChatDraft(conversationId, ownerId).then((draft) => {
      if (cancelled) return;
      if (draft && !latestText.current) setText(draft);
      setRestoredFor(scope);
    }).catch(() => { if (!cancelled) setRestoredFor(scope); });
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      const next = pending.current;
      pending.current = null;
      if (next) void setChatDraft(next.id, next.text, next.ownerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, ownerId]);

  useEffect(() => {
    if (!conversationId || ownerId === null || restoredFor !== scope) return;
    pending.current = { id: conversationId, text, ownerId };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = pending.current;
      pending.current = null;
      if (next) void setChatDraft(next.id, next.text, next.ownerId);
    }, SAVE_DEBOUNCE_MS);
  }, [conversationId, text, ownerId, restoredFor, scope]);

  // Leaving the chat writes the last keystrokes right away.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (next) void setChatDraft(next.id, next.text, next.ownerId);
  }, []);
}
