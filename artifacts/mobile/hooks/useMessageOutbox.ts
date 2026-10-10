/**
 * The open thread's view of lib/messageOutbox.ts: the messages still queued
 * for this conversation (rendered with the chat's existing "sending" clock /
 * "Tap to retry" states) plus a `flush` that delivers them in order.
 *
 * Flushes when the thread opens, whenever the device comes back online
 * (hooks/useIsOffline.ts), and — via lib/messageOutboxPump.ts — when the app
 * returns to the foreground and on a light interval.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  flushOutbox,
  getOutboxSnapshot,
  loadOutbox,
  subscribeOutbox,
  type OutboxEntry,
  type OutboxSender,
} from '@/lib/messageOutbox';
import { ensureMessageOutboxPump } from '@/lib/messageOutboxPump';
import { useIsOffline } from '@/hooks/useIsOffline';

const NONE: OutboxEntry[] = [];

export function useMessageOutbox(
  userId: string | null | undefined,
  conversationId: string | null | undefined,
  send: OutboxSender,
  enabled = true,
): { entries: OutboxEntry[]; flush: () => Promise<void> } {
  const active = enabled && !!userId && !!conversationId;
  const [entries, setEntries] = useState<OutboxEntry[]>(() => (
    active ? getOutboxSnapshot(userId!, conversationId!) : NONE
  ));
  const sendRef = useRef(send);
  sendRef.current = send;

  const flush = useCallback(async () => {
    if (!active) return;
    await flushOutbox(userId!, conversationId!, (entry) => sendRef.current(entry)).catch(() => {});
  }, [active, userId, conversationId]);

  useEffect(() => {
    if (!active) {
      setEntries(NONE);
      return;
    }
    let alive = true;
    setEntries(getOutboxSnapshot(userId!, conversationId!));
    const unsubscribe = subscribeOutbox(userId!, conversationId!, (next) => { if (alive) setEntries(next); });
    void loadOutbox(userId!, conversationId!).then((loaded) => {
      if (!alive) return;
      setEntries(loaded);
      if (loaded.length > 0) void flush();
    });
    ensureMessageOutboxPump();
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [active, userId, conversationId, flush]);

  const isOffline = useIsOffline();
  const wasOffline = useRef(isOffline);
  useEffect(() => {
    if (wasOffline.current && !isOffline) void flush();
    wasOffline.current = isOffline;
  }, [isOffline, flush]);

  return { entries, flush };
}
