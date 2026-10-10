/**
 * Conversation-screen side of the realtime messages socket: pure helpers that
 * fold socket events into a screen's message list, plus the hooks the DM
 * screens use (live events + a REST poll that only runs while the socket is
 * down).
 */
import { useEffect, useRef, useState } from 'react';
import type { Message } from '@/services/socialTypes';
import {
  isRealtimeConnected,
  subscribeRealtime,
  subscribeRealtimeStatus,
  type RealtimeEvent,
} from './messagesSocket';

/** How long a "typing" signal stays on without a refresh (server window is 8s). */
export const TYPING_TTL_MS = 8_000;

/** Adds or replaces `incoming` by id and keeps the list in time order. */
export function mergeIncomingMessage<T extends Pick<Message, 'id' | 'ts'>>(list: readonly T[], incoming: T): T[] {
  const idx = list.findIndex((m) => m.id === incoming.id);
  if (idx >= 0) {
    const next = list.slice();
    next[idx] = { ...list[idx], ...incoming };
    return next;
  }
  const next = [...list, incoming];
  if (list.length > 0 && incoming.ts < list[list.length - 1].ts) next.sort((a, b) => a.ts - b.ts);
  return next;
}

/**
 * The other participant read the thread: every message they did not send and
 * that has no readAt yet is now read. Returns the same array when nothing
 * changed so React can skip the render.
 */
export function applyReadReceipt<T extends { fromId: string; readAt?: string; status: string }>(
  list: readonly T[],
  readerId: string,
  readAt: string,
): T[] {
  let changed = false;
  const next = list.map((m) => {
    if (m.fromId === readerId || m.readAt) return m;
    changed = true;
    return { ...m, readAt, status: 'read' };
  });
  return changed ? next : (list as T[]);
}

/** True while the realtime socket is connected. */
export function useRealtimeConnected(): boolean {
  const [connected, setConnected] = useState(isRealtimeConnected);
  useEffect(() => {
    setConnected(isRealtimeConnected());
    return subscribeRealtimeStatus(setConnected);
  }, []);
  return connected;
}

/**
 * Subscribes to realtime events while mounted and `enabled`. The handler is
 * kept in a ref, so it always sees fresh state without re-subscribing.
 */
export function useRealtimeEvents(handler: (event: RealtimeEvent) => void, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    return subscribeRealtime((event) => ref.current(event));
  }, [enabled]);
}

/**
 * Runs `fn` every `intervalMs` only while the realtime socket is down (the
 * fallback poll), and once more whenever the socket reconnects so anything
 * missed while disconnected is caught up.
 */
export function useFallbackPoll(fn: () => void, intervalMs: number, enabled = true): void {
  const connected = useRealtimeConnected();
  const ref = useRef(fn);
  ref.current = fn;
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (!enabled) return;
    if (connected) {
      if (!wasConnected.current) ref.current();
      wasConnected.current = true;
      return;
    }
    wasConnected.current = false;
    const timer = setInterval(() => ref.current(), intervalMs);
    return () => clearInterval(timer);
  }, [connected, enabled, intervalMs]);
}
