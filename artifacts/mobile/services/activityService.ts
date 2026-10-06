/**
 * Activity Center service.
 *
 * A thin wrapper over the shared in-app notifications feed
 * (`/api/buyer/notifications`). The endpoint is per authenticated user, so the
 * same calls serve buyers (likes, follows, saved-item alerts, order updates)
 * and sellers (sales, payouts, inventory alerts).
 *
 * Read/dismiss changes are broadcast through the social service's existing
 * pub/sub so the bell badges and the older notifications screen stay in sync.
 */
import { serviceRequest } from '@/lib/serviceConfig';
import { subscribeSocial } from '@/services/socialService';
import { ACTIVITY_PAGE_SIZE, type ActivityFilter, type ActivityItem } from '@/lib/activity';
import {
  isPreviewActivityEnabled,
  isPreviewActivityId,
  isPreviewActivitySeedServed,
  markAllPreviewActivityRead,
  markPreviewActivityRead,
  previewUnreadActivityCount,
} from '@/lib/previewActivity';
import { isUserEventsConnected, subscribeUserEvents } from '@/lib/realtime/userEvents';

export type { ActivityItem, ActivityFilter } from '@/lib/activity';

const BASE = '/api/buyer/notifications';
const SOCIAL_BASE = '/api/social';

export interface SuggestedPerson {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  avatarUrl?: string | null;
  reason: string;
  isFollowing: boolean;
}

// ─── Change broadcast ─────────────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Subscribe to activity changes: local read/dismiss actions here, plus any
 * change the social service announces (the notifications screen, follows…).
 */
export function subscribeActivity(fn: Listener): () => void {
  listeners.add(fn);
  const unsubscribeSocial = subscribeSocial(fn);
  return () => {
    listeners.delete(fn);
    unsubscribeSocial();
  };
}

function emitChange(): void {
  listeners.forEach((fn) => {
    try { fn(); } catch { /* a listener must not break the others */ }
  });
}

// Optimistic unread count: "Mark all read" zeroes every badge (tab bar,
// seller bell) the instant it's tapped, in the same frame as the dots clear,
// instead of waiting for the PATCH and a badge refetch to land. A failed
// request triggers a normal change broadcast, which refetches the true count.
type UnreadOverrideListener = (count: number) => void;
const unreadOverrideListeners = new Set<UnreadOverrideListener>();

export function subscribeUnreadOverride(fn: UnreadOverrideListener): () => void {
  unreadOverrideListeners.add(fn);
  return () => { unreadOverrideListeners.delete(fn); };
}

function emitUnreadOverride(count: number): void {
  unreadOverrideListeners.forEach((fn) => {
    try { fn(count); } catch { /* a listener must not break the others */ }
  });
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getActivity(params: {
  limit?: number;
  offset?: number;
  filter?: ActivityFilter;
} = {}): Promise<ActivityItem[]> {
  const query = new URLSearchParams({
    limit: String(params.limit ?? ACTIVITY_PAGE_SIZE),
    offset: String(params.offset ?? 0),
  });
  if (params.filter && params.filter !== 'all') query.set('filter', params.filter);
  const rows = await serviceRequest<ActivityItem[]>(`${BASE}?${query.toString()}`);
  return Array.isArray(rows) ? rows : [];
}

/** One person behind a merged Activity row, with the viewer's follow state. */
export interface GroupedActivityActor {
  id: string;
  name: string;
  handle?: string;
  initials: string;
  color?: string;
  avatarUrl?: string;
  isFollowing: boolean;
  createdAt: string;
}

/**
 * The people behind a merged row ("Jay and 12 others…"), newest first, from
 * the row's own feed ids — GET /api/buyer/notifications/actors. Throws on
 * failure so the people list can show its error state.
 */
export async function getGroupedActivityActors(ids: readonly string[]): Promise<GroupedActivityActor[]> {
  const query = new URLSearchParams({ ids: ids.join(',') });
  const result = await serviceRequest<{ actors?: GroupedActivityActor[] }>(`${BASE}/actors?${query.toString()}`);
  return Array.isArray(result?.actors) ? result.actors : [];
}

/** Unread, unmuted activity count for the bell badge. Never throws. */
export async function getUnreadActivityCount(): Promise<number> {
  try {
    const result = await serviceRequest<{ count?: number }>(`${BASE}/unread-count`, {}, false);
    const count = typeof result?.count === 'number' ? result.count : 0;
    // Dev-web preview showing the seeded feed: badge counts the seeded rows
    // too, so it agrees with the unread dots on the Activity screen.
    if (count === 0 && isPreviewActivityEnabled() && isPreviewActivitySeedServed()) return previewUnreadActivityCount();
    return count;
  } catch {
    return isPreviewActivityEnabled() ? previewUnreadActivityCount() : 0;
  }
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function markActivityRead(id: string): Promise<void> {
  // Seeded preview rows live only in the dev-web preview; there is nothing
  // server-side to PATCH, so their read state is kept in memory instead.
  if (isPreviewActivityEnabled() && isPreviewActivityId(id)) {
    markPreviewActivityRead([id]);
    emitChange();
    return;
  }
  await serviceRequest(`${BASE}/${encodeURIComponent(id)}/read`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  }, false);
  emitChange();
}

export async function markAllActivityRead(): Promise<void> {
  if (isPreviewActivityEnabled()) markAllPreviewActivityRead();
  emitUnreadOverride(0);
  try {
    await serviceRequest(`${BASE}/read-all`, { method: 'PATCH', body: JSON.stringify({}) });
  } catch (err) {
    // The dev-web preview has no backend: its (in-memory) mark-all already
    // happened above, so don't surface a false failure there.
    if (!isPreviewActivityEnabled() || !isPreviewActivitySeedServed()) {
      emitChange(); // badges refetch the true count
      throw err;
    }
  }
  emitChange();
}

export async function dismissActivity(id: string): Promise<void> {
  await serviceRequest(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  emitChange();
}

// ─── Suggested for you ────────────────────────────────────────────────────────

export async function getSuggestedPeople(limit = 20): Promise<SuggestedPerson[]> {
  const rows = await serviceRequest<SuggestedPerson[]>(`${SOCIAL_BASE}/suggested?limit=${limit}`, {}, false);
  return Array.isArray(rows) ? rows : [];
}

export async function dismissSuggestedPerson(userId: string): Promise<void> {
  await serviceRequest(`${SOCIAL_BASE}/suggested/${encodeURIComponent(userId)}/dismiss`, { method: 'POST', body: JSON.stringify({}) });
  emitChange();
}

// ─── Realtime (short polling while a screen is focused) ──────────────────────
//
// Polls the tiny `/unread-count` endpoint every ~1.5s while a screen is
// focused, and only fires `onChange` when the count or latest event actually
// moved. The per-user realtime socket (lib/realtime/userEvents.ts → api
// /ws/user) triggers an immediate tick the moment a row lands; while it is
// connected the poll relaxes to a 15s safety net.
const REALTIME_SAFETY_POLL_MS = 15_000;

export interface ActivityRealtimeHandle {
  stop(): void;
}

export function watchActivityRealtime(
  onChange: (info: { count: number; latestId: string | null }) => void,
  intervalMs = 1500,
): ActivityRealtimeHandle {
  let stopped = false;
  let lastKey = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  let inFlight = false;
  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    if (timer) { clearTimeout(timer); timer = null; }
    try {
      const result = await serviceRequest<{ count?: number; latestId?: string | null }>(
        `${BASE}/unread-count`, {}, false,
      );
      const count = typeof result?.count === 'number' ? result.count : 0;
      const latestId = result?.latestId ?? null;
      const key = `${count}:${latestId}`;
      if (key !== lastKey) {
        lastKey = key;
        onChange({ count, latestId });
      }
    } catch {
      // A failed poll just tries again next tick.
    } finally {
      inFlight = false;
      // With the realtime socket up, the server pushes `activity.updated` the
      // moment a row lands, so the poll only needs to be a slow safety net.
      if (!stopped) timer = setTimeout(tick, isUserEventsConnected() ? Math.max(intervalMs, REALTIME_SAFETY_POLL_MS) : intervalMs);
    }
  };

  const unsubscribeRealtime = subscribeUserEvents((event) => {
    if (event.type === 'activity.updated' || (event.type === 'conversation.updated' && event.reason === 'message')) void tick();
  });

  void tick();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      unsubscribeRealtime();
    },
  };
}
