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
