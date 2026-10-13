/**
 * Keeps a chat's unsent composer text (offline polish #31), like iMessage /
 * Instagram DMs: leave a chat mid-sentence (or the app gets killed) and the
 * text is still in the box when you come back. Cleared as soon as the box is
 * emptied, which includes a send.
 */
import { useEffect, useRef } from 'react';
import { getChatDraft, setChatDraft } from '@/services/socialService';

const SAVE_DEBOUNCE_MS = 400;

export function useChatDraft(
  conversationId: string | null | undefined,
  text: string,
  setText: (text: string) => void,
): void {
  const restoredFor = useRef<string | null>(null);
  const latestText = useRef(text);
  latestText.current = text;
  const pending = useRef<{ id: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore once per conversation, and only into an empty box (never over
  // something the person already started typing).
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    restoredFor.current = null;
    getChatDraft(conversationId).then((draft) => {
      if (cancelled) return;
      if (draft && !latestText.current) setText(draft);
      restoredFor.current = conversationId;
    }).catch(() => { if (!cancelled) restoredFor.current = conversationId; });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || restoredFor.current !== conversationId) return;
    pending.current = { id: conversationId, text };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = pending.current;
      pending.current = null;
      if (next) void setChatDraft(next.id, next.text);
    }, SAVE_DEBOUNCE_MS);
  }, [conversationId, text]);

  // Leaving the chat writes the last keystrokes right away.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    const next = pending.current;
    if (next) void setChatDraft(next.id, next.text);
  }, []);
}
