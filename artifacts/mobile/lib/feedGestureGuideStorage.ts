/**
 * Storage for the buyer feed's first-time "Watching Threads" gesture coach
 * (kept separate from FeedGestureGuide.tsx, which pulls in RN UI components,
 * so this logic can be unit tested directly).
 *
 * Server is the source of truth (users.feedGesturesTipSeenVersion, via
 * /api/auth/feed-gestures-tip) so the tip stays "seen" across reinstalls,
 * new devices and cleared local storage — not just AsyncStorage on one
 * device. A local cache is kept for fast/offline reads and as the fallback
 * when no backend user exists yet (e.g. a preview/dev session with no real
 * signed-in account): in that case the local flag is authoritative and the
 * tip behaves exactly like it would for a real account.
 *
 * The tip is versioned: bumping FEED_GESTURES_TIP_VERSION (e.g. because the
 * feed's gestures changed) shows it one more time per user, then persists
 * the new version so it never shows again until the next bump.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Bump this when the feed's gestures change enough to warrant a re-tip. */
export const FEED_GESTURES_TIP_VERSION = 1;

export interface FeedGesturesTipApi {
  feedGesturesTip: {
    get: () => Promise<{ seenVersion: number }>;
    markSeen: (version: number) => Promise<{ seenVersion: number }>;
  };
}

export function feedGestureGuideKey(userId: string | null | undefined): string {
  return `feed_gesture_guide_seen_version:${userId ?? 'anon'}`;
}

async function readLocalSeenVersion(userId: string | null | undefined): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(feedGestureGuideKey(userId));
    if (raw == null) return 0;
    // Older builds stored the literal string '1' as a plain "seen" boolean —
    // treat that as having seen version 1 so existing users aren't re-shown
    // the tip the moment this version-aware storage ships.
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 1;
  } catch {
    return FEED_GESTURES_TIP_VERSION; // fail closed — never re-show on a storage error
  }
}

async function writeLocalSeenVersion(userId: string | null | undefined, version: number): Promise<void> {
  try { await AsyncStorage.setItem(feedGestureGuideKey(userId), String(version)); } catch {}
}

/**
 * Whether the current user has already seen the current tip version.
 * Tries the server first (source of truth), falling back to the local cache
 * — e.g. offline, or a preview session with no real backend user — so the
 * tip still behaves correctly (shown once, then never again on that device).
 */
export async function hasSeenFeedGestureGuide(
  userId: string | null | undefined,
  api?: FeedGesturesTipApi,
): Promise<boolean> {
  if (api) {
    try {
      const { seenVersion } = await api.feedGesturesTip.get();
      await writeLocalSeenVersion(userId, seenVersion);
      return seenVersion >= FEED_GESTURES_TIP_VERSION;
    } catch {
      // Fall through to the local cache below.
    }
  }
  const localVersion = await readLocalSeenVersion(userId);
  return localVersion >= FEED_GESTURES_TIP_VERSION;
}

/** Marks the current tip version as seen, locally and (best-effort) on the server. */
export async function markFeedGestureGuideSeen(
  userId: string | null | undefined,
  api?: FeedGesturesTipApi,
): Promise<void> {
  await writeLocalSeenVersion(userId, FEED_GESTURES_TIP_VERSION);
  if (api) {
    try { await api.feedGesturesTip.markSeen(FEED_GESTURES_TIP_VERSION); } catch {}
  }
}
