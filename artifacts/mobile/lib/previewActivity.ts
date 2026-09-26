/**
 * Seeded PREVIEW buyer Activity Center feed.
 *
 * Mirrors lib/previewInbox.ts's pattern exactly: the buyer Activity Center
 * (app/activity-center.tsx, opened from the bell) reads a real, per-user
 * notifications feed that doesn't exist in the dev-web preview (there's no
 * authenticated preview user, so the request 401s) — which surfaced as the
 * generic "Your activity couldn't load" error state instead of showing the
 * screen's actual redesigned layout. This gives it a small, real-looking set
 * of rows to render instead: likes, follows, comments, an order shipped/
 * delivered pair, a price drop on a saved item, a Brandthread Agent nudge and
 * a Thread Cash received notice.
 *
 * Gating: `isPreviewActivityEnabled()` reuses `isPreviewCatalogEnabled()`
 * from previewCatalog.ts (same gate, not a new one) — true only when
 * `__DEV__` is true (stripped to `false`, dead code, in every production
 * build). Call sites must:
 *   1. Try the real API first.
 *   2. Only fall back to this seed data when the real call fails outright
 *      (e.g. the 401 a preview session gets — there's no backend/auth
 *      reachable in the web preview).
 *   3. Never run for a real signed-in production account.
 */
import { Asset } from 'expo-asset';
import { isPreviewCatalogEnabled } from './previewCatalog';
import { PREVIEW_ACTIVITY_SEEDS, type PreviewActivitySeed } from './previewActivityData';
import type { ActivityItem } from './activity';

export function isPreviewActivityEnabled(): boolean {
  return isPreviewCatalogEnabled();
}

// Same 10 fashion preview posters previewCatalog.ts/previewInbox.ts use, so
// the whole buyer preview reads as one consistent world.
const POSTER_SOURCES = [
  require('../assets/videos/fashion_runway_01.png'),
  require('../assets/videos/fashion_runway_02.png'),
  require('../assets/videos/fashion_runway_03.png'),
  require('../assets/videos/fashion_runway_04.png'),
  require('../assets/videos/fashion_runway_05.png'),
  require('../assets/videos/fashion_runway_06.png'),
  require('../assets/videos/fashion_runway_07.png'),
  require('../assets/videos/fashion_runway_08.png'),
  require('../assets/videos/fashion_runway_09.png'),
  require('../assets/videos/fashion_runway_10.png'),
];

function posterUri(index: number): string {
  return Asset.fromModule(POSTER_SOURCES[index]).uri;
}

function toActivityItem(seed: PreviewActivitySeed): ActivityItem {
  return {
    id: seed.id,
    category: seed.category,
    type: seed.type,
    title: seed.title,
    body: seed.body ?? '',
    isRead: seed.isRead,
    actorId: seed.actorId,
    actorName: seed.actorName,
    actorHandle: seed.actorHandle,
    actorInitials: seed.actorInitials,
    actorColor: seed.actorColor,
    targetId: seed.targetId,
    targetType: seed.targetType,
    targetImageUrl: typeof seed.posterIndex === 'number' ? posterUri(seed.posterIndex) : undefined,
    cta: seed.cta,
    createdAt: new Date(Date.now() - seed.minutesAgo * 60_000).toISOString(),
  };
}

let cachedActivity: ActivityItem[] | null = null;

/** The full seeded preview Activity Center feed, newest first. Callers must
 *  still gate on `isPreviewActivityEnabled()` and prefer real API data. */
export function getPreviewActivity(): ActivityItem[] {
  if (!cachedActivity) {
    cachedActivity = [...PREVIEW_ACTIVITY_SEEDS]
      .sort((a, b) => a.minutesAgo - b.minutesAgo)
      .map(toActivityItem);
  }
  return cachedActivity;
}
