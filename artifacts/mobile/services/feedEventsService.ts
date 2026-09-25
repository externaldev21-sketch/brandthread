/**
 * For You ranking signal — the minimal client hook for POST /api/feed/events.
 *
 * Events are queued in-memory and flushed in small batches (idle debounce or
 * once the queue hits a size cap) so a fast-scrolling feed doesn't fire one
 * network request per impression. Each event gets a client-generated
 * `clientEventId` so a retried/duplicate flush is a no-op server-side
 * (POST /api/feed/events is idempotent on it).
 *
 * This intentionally does not track like/save/repost/comment/follow/purchase
 * — those already have their own dedicated write paths elsewhere and are
 * read directly by the ranking pipeline. This only covers the signals that
 * had nowhere else to land: view, watch_time, rewatch, shop taps,
 * add-to-bag, skip, and not-interested.
 */
import { serviceRequest } from '@/lib/serviceConfig';

export type FeedEventType =
  | 'view' | 'watch_time' | 'rewatch' | 'shop_click' | 'add_to_bag' | 'skip' | 'not_interested';

type QueuedEvent = {
  postId: string;
  type: FeedEventType;
  value?: string;
  clientEventId: string;
};

const MAX_BATCH_SIZE = 25;
const FLUSH_DEBOUNCE_MS = 1500;

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function genClientEventId(): string {
  return `fe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushFeedEvents();
  }, FLUSH_DEBOUNCE_MS);
}

/** Queues one ranking-signal event. Never throws — tracking must not break the feed. */
export function trackFeedEvent(postId: string, type: FeedEventType, value?: string): void {
  if (!postId || !type) return;
  queue.push({ postId, type, value, clientEventId: genClientEventId() });
  if (queue.length >= MAX_BATCH_SIZE) {
    void flushFeedEvents();
  } else {
    scheduleFlush();
  }
}

/** Sends every queued event now. Safe to call directly (e.g. on screen blur/app background). */
export async function flushFeedEvents(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH_SIZE);
  try {
    await serviceRequest('/api/feed/events', {
      method: 'POST',
      body: JSON.stringify({ events: batch }),
    }, false /* reportErrors */);
  } catch {
    // Ranking signal is best-effort; a dropped batch just means slightly
    // slower personalization, never a user-facing error.
  }
  if (queue.length > 0) scheduleFlush();
}

/** Convenience: watch-time completion fraction (0..1) as the event value. */
export function trackWatchTime(postId: string, completionFraction: number): void {
  const clamped = Math.min(1, Math.max(0, completionFraction));
  trackFeedEvent(postId, 'watch_time', clamped.toFixed(2));
}
