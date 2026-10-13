/**
 * Seller Close Friends (item 84 — "Close Friends for top buyers").
 *
 *   GET /api/social/close-friends              my list
 *   PUT /api/social/close-friends              replace it { userIds }
 *   GET /api/social/close-friends/suggestions  sellers: top buyers by spend
 *   GET /api/social/followers                  people who follow me
 *
 * The server accepts a seller's paid buyers even when they don't follow the
 * seller, and returns `rejected` for anyone it refused.
 *
 * Signed-out seller web preview: never calls the API — the demo dataset
 * (?demo=1) gets fixtures, the default fresh preview gets empty lists.
 */
import { serviceRequest } from '@/lib/serviceConfig';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';

export interface CloseFriendPerson {
  userId: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
}

export interface TopBuyerSuggestion extends CloseFriendPerson {
  orderCount: number;
  totalCents: number;
  followsYou: boolean;
}

export interface SellerCloseFriendsData {
  list: CloseFriendPerson[];
  topBuyers: TopBuyerSuggestion[];
  followers: CloseFriendPerson[];
}

type ServerPerson = { userId: string; name?: string | null; handle?: string | null; avatarUrl?: string | null };

function person(p: ServerPerson): CloseFriendPerson {
  const handle = p.handle ?? '';
  return {
    userId: p.userId,
    name: p.name || handle.replace(/^@/, '') || 'Brandthread member',
    handle,
    avatarUrl: p.avatarUrl ?? null,
  };
}

/** 'demo' = fixtures, 'empty' = fresh preview, null = real API. */
function previewMode(): 'demo' | 'empty' | null {
  if (!isSellerDevPreview()) return null;
  return isPreviewDemoMode() ? 'demo' : 'empty';
}

const DEMO_LIST: CloseFriendPerson[] = [
  { userId: 'preview-cf-maya', name: 'Maya Chen', handle: '@mayachen', avatarUrl: null },
];
const DEMO_TOP_BUYERS: TopBuyerSuggestion[] = [
  { userId: 'preview-cf-jordan', name: 'Jordan Ellis', handle: '@jordan.ellis', avatarUrl: null, orderCount: 7, totalCents: 128400, followsYou: true },
  { userId: 'preview-cf-sam', name: 'Sam Rivera', handle: '@samrivera', avatarUrl: null, orderCount: 5, totalCents: 96200, followsYou: false },
  { userId: 'preview-cf-priya', name: 'Priya Nair', handle: '@priya.wears', avatarUrl: null, orderCount: 4, totalCents: 71500, followsYou: true },
  { userId: 'preview-cf-leo', name: 'Leo Martins', handle: '@leomartins', avatarUrl: null, orderCount: 3, totalCents: 52000, followsYou: false },
];
const DEMO_FOLLOWERS: CloseFriendPerson[] = [
  { userId: 'preview-cf-ava', name: 'Ava Brooks', handle: '@avabrooks', avatarUrl: null },
  { userId: 'preview-cf-noah', name: 'Noah Kim', handle: '@noah.k', avatarUrl: null },
  { userId: 'preview-cf-zoe', name: 'Zoe Laurent', handle: '@zoelaurent', avatarUrl: null },
];

/**
 * Everything the seller Close Friends screen shows, in one call. Each
 * section is deduped against the ones above it (list > top buyers > followers).
 */
export async function loadSellerCloseFriends(): Promise<SellerCloseFriendsData> {
  const mode = previewMode();
  if (mode === 'demo') return { list: DEMO_LIST, topBuyers: DEMO_TOP_BUYERS, followers: DEMO_FOLLOWERS };
  if (mode === 'empty') return { list: [], topBuyers: [], followers: [] };

  const [listRes, suggestionsRes, followersRes] = await Promise.all([
    serviceRequest<{ friends?: ServerPerson[] }>('/api/social/close-friends', {}, false),
    serviceRequest<{ suggestions?: Array<ServerPerson & { orderCount?: number; totalCents?: number; followsYou?: boolean }> }>(
      '/api/social/close-friends/suggestions', {}, false,
    ).catch(() => ({ suggestions: [] })),
    serviceRequest<ServerPerson[]>('/api/social/followers?limit=100', {}, false).catch(() => [] as ServerPerson[]),
  ]);
  return dedupeSections({
    list: (listRes.friends ?? []).map(person),
    topBuyers: (suggestionsRes.suggestions ?? []).map((s) => ({
      ...person(s), orderCount: s.orderCount ?? 0, totalCents: s.totalCents ?? 0, followsYou: !!s.followsYou,
    })),
    followers: (Array.isArray(followersRes) ? followersRes : []).map(person),
  });
}

export function dedupeSections(data: SellerCloseFriendsData): SellerCloseFriendsData {
  const seen = new Set(data.list.map((p) => p.userId));
  const topBuyers = data.topBuyers.filter((p) => !seen.has(p.userId) && (seen.add(p.userId), true));
  const followers = data.followers.filter((p) => !seen.has(p.userId) && (seen.add(p.userId), true));
  return { list: data.list, topBuyers, followers };
}

/** Replace the list. Resolves to the saved ids and the ones the server refused. */
export async function saveSellerCloseFriends(userIds: string[]): Promise<{ userIds: string[]; rejected: string[] }> {
  if (previewMode()) return { userIds, rejected: [] };
  const res = await serviceRequest<{ userIds?: string[]; rejected?: string[] }>('/api/social/close-friends', {
    method: 'PUT',
    body: JSON.stringify({ userIds }),
  });
  return { userIds: res.userIds ?? [], rejected: res.rejected ?? [] };
}
