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

/** Unread, unmuted activity count for the bell badge. Never throws. */
export async function getUnreadActivityCount(): Promise<number> {
  try {
    const result = await serviceRequest<{ count?: number }>(`${BASE}/unread-count`, {}, false);
    return typeof result?.count === 'number' ? result.count : 0;
  } catch {
    return 0;
  }
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function markActivityRead(id: string): Promise<void> {
  await serviceRequest(`${BASE}/${encodeURIComponent(id)}/read`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  }, false);
  emitChange();
}

export async function markAllActivityRead(): Promise<void> {
  await serviceRequest(`${BASE}/read-all`, { method: 'PATCH', body: JSON.stringify({}) });
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
// There is no websocket/SSE layer in this codebase (see lib/api's polling
// helpers for the same pattern elsewhere, e.g. buyer-conversation.tsx). This
// polls the tiny `/unread-count` endpoint every ~1.5s while a screen is
// focused, and only fires `onChange` when the count or latest event actually
// moved — cheap enough to run this often, close enough to feel live.
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

  const tick = async () => {
    if (stopped) return;
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
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };

  void tick();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
