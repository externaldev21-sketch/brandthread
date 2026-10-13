/**
 * Activity status for Messages — the green dot on an avatar and "Active now"
 * under a chat's name (Instagram iOS, https://mobbin.com/flows/fe474697-1948-4140-bcd4-353c1a748c05).
 *
 * - Every authenticated request bumps users.last_active_at, at most once a
 *   minute per user per server instance (fire-and-forget, never blocks or
 *   fails the request).
 * - Someone is "online" when their last activity is within ONLINE_WINDOW_MS.
 * - Privacy, Instagram's rule: if either person turned "Show activity status"
 *   off, neither sees the other's status.
 */
import { db, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger";

export const TOUCH_INTERVAL_MS = 60_000;
export const ONLINE_WINDOW_MS = 5 * 60_000;

const lastTouch = new Map<string, number>();

/** Record that `userId` is active now (throttled). Safe to call on every request. */
export function touchPresence(userId: string, now: number = Date.now()): void {
  const previous = lastTouch.get(userId);
  if (previous !== undefined && now - previous < TOUCH_INTERVAL_MS) return;
  lastTouch.set(userId, now);
  if (lastTouch.size > 50_000) lastTouch.clear();
  try {
    void db.update(users)
      .set({ lastActiveAt: new Date(now) })
      .where(eq(users.clerkId, userId))
      .catch((err: unknown) => logger.debug({ err }, "presence touch failed"));
  } catch (err) {
    logger.debug({ err }, "presence touch failed");
  }
}

/** Test hook. */
export function resetPresenceThrottle(): void {
  lastTouch.clear();
}

export type PresenceRow = {
  lastActiveAt: Date | null;
  showActivityStatus: boolean;
  /** Public profile photo (an uploaded photo wins over the Clerk avatar). */
  avatarUrl?: string | null;
};

/** What the viewer may see about one other person's activity. */
export function presenceFor(
  viewer: PresenceRow | undefined,
  other: PresenceRow | undefined,
  now: number = Date.now(),
): { isOnline: boolean; lastSeenAt?: string } {
  if (!viewer?.showActivityStatus || !other?.showActivityStatus || !other.lastActiveAt) {
    return { isOnline: false };
  }
  const at = other.lastActiveAt.getTime();
  return { isOnline: now - at <= ONLINE_WINDOW_MS, lastSeenAt: other.lastActiveAt.toISOString() };
}

/** Presence rows (and public profile photos) for a set of users, one query. */
export async function loadPresence(userIds: readonly string[]): Promise<Map<string, PresenceRow>> {
  const ids = [...new Set(userIds)];
  const map = new Map<string, PresenceRow>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      clerkId: users.clerkId,
      lastActiveAt: users.lastActiveAt,
      showActivityStatus: users.showActivityStatus,
      profileImageUrl: users.profileImageUrl,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(inArray(users.clerkId, ids));
  for (const row of rows) {
    // Same resolution as the Activity feed: only public http(s) photos, never
    // a private /objects/ storage path.
    const photo = typeof row.profileImageUrl === "string" && row.profileImageUrl.startsWith("http")
      ? row.profileImageUrl
      : row.avatarUrl;
    map.set(row.clerkId, {
      lastActiveAt: row.lastActiveAt ?? null,
      showActivityStatus: row.showActivityStatus,
      avatarUrl: typeof photo === "string" && photo.startsWith("http") ? photo : null,
    });
  }
  return map;
}
