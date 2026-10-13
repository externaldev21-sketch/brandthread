/**
 * Storage for the buyer feed's first-time "Watching Threads" gesture coach
 * (kept separate from FeedGestureGuide.tsx, which pulls in RN UI components,
 * so this logic can be unit tested directly).
 *
 * The server (users.feedGesturesTipSeenVersion, via /api/auth/feed-gestures-tip)
 * keeps the tip "seen" across reinstalls, new devices and cleared local
 * storage. The device's own record counts too: the result is the higher of
 * the two, so a failed server write never makes the tip show again.
 * AsyncStorage is localStorage on web, so the web preview persists it too. A local cache is kept for fast/offline reads and as the fallback
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
 * The highest version this account has seen on this device. A tip seen while
 * the account id was still loading (stored under 'anon') counts for the
 * account too, so the null → real userId switch can't show it twice.
 */
async function readBestLocalSeenVersion(userId: string | null | undefined): Promise<number> {
  const own = await readLocalSeenVersion(userId);
  return userId ? Math.max(own, await readLocalSeenVersion(null)) : own;
}

/**
 * Whether the current user has already seen the current tip version.
 *
 * Seen-state only ever goes up: the answer is max(server, local). A server
 * that still says 0 (because the markSeen PATCH failed: offline, no auth in
 * a preview, a race) can never un-see a tip this device already showed.
 * When local is ahead, the server is re-sent markSeen to catch up.
 */
export async function hasSeenFeedGestureGuide(
  userId: string | null | undefined,
  api?: FeedGesturesTipApi,
): Promise<boolean> {
  const localVersion = await readBestLocalSeenVersion(userId);
  let seen = localVersion;
  if (api) {
    try {
      const { seenVersion } = await api.feedGesturesTip.get();
      seen = Math.max(seenVersion, localVersion);
      if (localVersion > seenVersion) {
        void api.feedGesturesTip.markSeen(localVersion).catch(() => {});
      }
    } catch {
      // Offline / no backend user: the local value stands.
    }
  }
  if (seen > (await readLocalSeenVersion(userId))) await writeLocalSeenVersion(userId, seen);
  return seen >= FEED_GESTURES_TIP_VERSION;
}

/**
 * Marks the current tip version as seen, locally and (best-effort) on the
 * server. Called the moment the tip is SHOWN, so swiping it away, switching
 * tabs or killing the app all count. Never lowers a newer stored version.
 */
export async function markFeedGestureGuideSeen(
  userId: string | null | undefined,
  api?: FeedGesturesTipApi,
): Promise<void> {
  if ((await readLocalSeenVersion(userId)) < FEED_GESTURES_TIP_VERSION) {
    await writeLocalSeenVersion(userId, FEED_GESTURES_TIP_VERSION);
  }
  if (api) {
    try { await api.feedGesturesTip.markSeen(FEED_GESTURES_TIP_VERSION); } catch {}
  }
}
