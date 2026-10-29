/**
 * New-user seeding of @brandthread official Threads (client side of
 * GET /api/feed/official-seed and POST /api/feed/official-seed/progress).
 *
 * The server owns every rule (who is "new", spacing by pool size, never twice,
 * never back to back) — this only sends each organic Threads page, takes back
 * the merged order, and, while the server says the viewer is being seeded,
 * reports which Threads were actually on screen. Users outside the window
 * make no progress calls at all. Every call is optional and never throws.
 */
import { hasServiceToken, serviceRequest } from '@/lib/serviceConfig';

export type OfficialSeedCursor = {
  position: number;
  lastOfficialPosition: number;
  /** Official post ids served this session — never served again. */
  served: string[];
  /** Server said this viewer is not (or no longer) seeded; stop asking. */
  done?: boolean;
};

export function createOfficialSeedCursor(): OfficialSeedCursor {
  return { position: 0, lastOfficialPosition: 0, served: [] };
}

export type OfficialSeedItem = { type: 'organic'; id: string } | { type: 'official'; post: any };

export type OfficialSeedPage = {
  seeding: boolean;
  items: OfficialSeedItem[];
  cursor: OfficialSeedCursor;
};

let seedingActive = false;
/** Admin-only "preview the new-user feed" mode (set from the bulk upload screen). */
let previewMode = false;

export function setOfficialSeedPreview(on: boolean): void {
  previewMode = on;
}

export function isOfficialSeedPreview(): boolean {
  return previewMode;
}

/**
 * Merges official Threads into one organic page. On any failure (or when the
 * viewer isn't seeded) the organic order comes back unchanged.
 */
export async function fetchOfficialSeedPage(
  organicIds: string[],
  cursor: OfficialSeedCursor,
  isLastPage: boolean,
): Promise<OfficialSeedPage> {
  const passthrough: OfficialSeedPage = {
    seeding: false,
    items: organicIds.map((id) => ({ type: 'organic' as const, id })),
    cursor: { ...cursor, position: cursor.position + organicIds.length },
  };
  if (cursor.done && !previewMode) return passthrough;
  try {
    if (!(await hasServiceToken())) return passthrough;
    const params = new URLSearchParams();
    const uuids = organicIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50);
    if (uuids.length > 0) params.set('organicIds', uuids.join(','));
    if (cursor.served.length > 0) params.set('exclude', cursor.served.slice(-50).join(','));
    params.set('position', String(cursor.position));
    params.set('lastOfficialPosition', String(cursor.lastOfficialPosition));
    if (isLastPage) params.set('last', '1');
    if (previewMode) params.set('preview', '1');
    const res = await serviceRequest<{
      seeding: boolean;
      reason?: string;
      preview?: boolean;
      items?: OfficialSeedItem[];
      cursor?: { position: number; lastOfficialPosition: number };
    }>(`/api/feed/official-seed?${params.toString()}`, {}, false);
    // `reason: 'error'` is the server's answer to a transient failure (feed.ts
    // official-seed catch), not "this viewer isn't seeded": keep the organic
    // page and ask again on the next page, like a thrown request.
    if (res && !res.seeding && res.reason === 'error') return passthrough;
    if (!res?.seeding || !Array.isArray(res.items) || !res.cursor) {
      seedingActive = false;
      return { ...passthrough, cursor: { ...passthrough.cursor, done: true } };
    }
    // Preview never records progress — it must not change what Dev's own account has "seen".
    seedingActive = res.preview !== true;
    const items = res.items.filter((i) => (i.type === 'organic' ? typeof i.id === 'string' : typeof i.post?.id === 'string'));
    const officialIds = items.flatMap((i) => (i.type === 'official' ? [i.post.id as string] : []));
    return {
      seeding: true,
      items,
      cursor: {
        position: res.cursor.position,
        lastOfficialPosition: res.cursor.lastOfficialPosition,
        served: [...cursor.served, ...officialIds],
      },
    };
  } catch {
    return passthrough;
  }
}

// ─── Progress (only while seeded) ────────────────────────────────────────────

const pendingSeen = new Set<string>();
const countedViews = new Set<string>();
let pendingViewed = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Called when a Thread becomes the active page in the Threads (For You) tab. */
export function noteThreadOnScreen(postId: string, isOfficial: boolean): void {
  if (!seedingActive || !postId) return;
  const id = postId.replace(/__loop\d+$/, '');
  if (isOfficial) pendingSeen.add(id);
  if (!countedViews.has(id)) {
    countedViews.add(id);
    pendingViewed += 1;
  }
  if (!flushTimer) flushTimer = setTimeout(() => { void flushOfficialSeedProgress(); }, 3_000);
}

export async function flushOfficialSeedProgress(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const seenPostIds = [...pendingSeen].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 20);
  const viewedCount = Math.min(100, pendingViewed);
  pendingSeen.clear();
  pendingViewed = 0;
  if (seenPostIds.length === 0 && viewedCount === 0) return;
  try {
    if (!(await hasServiceToken())) return;
    await serviceRequest('/api/feed/official-seed/progress', {
      method: 'POST',
      body: JSON.stringify({ seenPostIds, viewedCount }),
    }, false);
  } catch {
    // Best effort: an unreported view only means that official post may be seeded once more.
  }
}
