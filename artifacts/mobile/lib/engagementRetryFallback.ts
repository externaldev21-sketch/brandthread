/**
 * App-wide replay for queued engagement actions (lib/engagementRetryQueue.ts).
 *
 * The feed registers its own executor only while it is mounted, so an action
 * queued from another screen (e.g. a like in the full-screen post viewer)
 * would otherwise wait until the feed is opened again. Started once from the
 * root layout: it replays the kinds that need nothing screen-specific, and
 * leaves the rest (a save that needs the feed item's title, a follow) queued
 * for the feed's own executor.
 */
import { serviceRequest } from './serviceConfig';
import {
  setFallbackEngagementRetryExecutor,
  startEngagementRetryQueuePump,
  type QueuedEngagementAction,
} from './engagementRetryQueue';

function interact(postId: string, body: { type: string; value?: string }) {
  return serviceRequest(`/api/posts/${encodeURIComponent(postId)}/interact`, {
    method: 'POST', body: JSON.stringify(body),
  }, false);
}

/** Replays one queued action; false when this kind needs the feed's executor. */
export async function replayEngagementAction(action: QueuedEngagementAction): Promise<boolean> {
  const value = typeof action.payload?.value === 'string' ? action.payload.value : undefined;
  switch (action.kind) {
    case 'like':
      await interact(action.targetId, { type: 'like', value });
      return true;
    case 'repost':
      await interact(action.targetId, { type: 'repost', value });
      return true;
    case 'not_interested':
      await interact(action.targetId, { type: 'not_interested' });
      return true;
    case 'save':
      if (value !== 'remove') return false;
      await serviceRequest(`/api/buyer/saved/${encodeURIComponent(action.targetId)}`, { method: 'DELETE' }, false);
      return true;
    default:
      return false;
  }
}

/** Registers the app-wide executor and drains the queue periodically. Returns cleanup. */
export function startEngagementRetryFallback(): () => void {
  setFallbackEngagementRetryExecutor(replayEngagementAction);
  const stopPump = startEngagementRetryQueuePump();
  return () => {
    stopPump();
    setFallbackEngagementRetryExecutor(null);
  };
}
