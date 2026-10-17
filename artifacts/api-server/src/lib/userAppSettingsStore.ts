import { db, userSettings as userAppSettings, forYouFeedCache, buyerTasteProfiles, feedNotInterested } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import {
  mergeUserAppSettings, patchInvalidatesForYou, resolveUserAppSettings,
  type UserAppSettings, type UserAppSettingsPatch,
} from "./userAppSettings";

/** The account's settings with defaults filled in. Read failures fall back to defaults (and are logged). */
export async function getUserAppSettings(userId: string): Promise<{ settings: UserAppSettings; updatedAt: string | null }> {
  try {
    const [row] = await db.select().from(userAppSettings).where(eq(userAppSettings.userId, userId)).limit(1);
    return { settings: { ...(row?.settings ?? {}), ...resolveUserAppSettings(row?.settings) }, updatedAt: row?.updatedAt?.toISOString() ?? null };
  } catch (err) {
    logger.error({ err, userId }, "user app settings read failed; using defaults");
    return { settings: resolveUserAppSettings(null), updatedAt: null };
  }
}

/** Settings for several accounts at once (e.g. every other participant of a conversation). */
export async function getUserAppSettingsMany(userIds: string[]): Promise<Map<string, UserAppSettings>> {
  const out = new Map<string, UserAppSettings>();
  const ids = [...new Set(userIds)].filter(Boolean);
  for (const id of ids) out.set(id, resolveUserAppSettings(null));
  if (ids.length === 0) return out;
  try {
    const rows = await db.select().from(userAppSettings).where(inArray(userAppSettings.userId, ids));
    for (const row of rows) out.set(row.userId, resolveUserAppSettings(row.settings));
  } catch (err) {
    logger.error({ err }, "user app settings batch read failed; using defaults");
  }
  return out;
}

/** Validated partial update. Throws on DB failure so the route can return a real error. */
export async function updateUserAppSettings(userId: string, patch: UserAppSettingsPatch): Promise<{ settings: UserAppSettings; updatedAt: string }> {
  const { before, after, updatedAt } = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(userAppSettings)
      .where(eq(userAppSettings.userId, userId)).limit(1).for("update");
    const prior = resolveUserAppSettings(existing?.settings);
    const next = mergeUserAppSettings(existing?.settings, patch);
    const now = new Date();
    const stored = { ...(existing?.settings ?? {}), ...next };
    await tx.insert(userAppSettings).values({ userId, settings: stored, updatedAt: now })
      .onConflictDoUpdate({ target: userAppSettings.userId, set: { settings: stored, updatedAt: now } });
    return { before: prior, after: next, updatedAt: now };
  });
  if (patchInvalidatesForYou(before, after)) await clearForYouCache(userId);
  return { settings: after, updatedAt: updatedAt.toISOString() };
}

export async function clearForYouCache(userId: string): Promise<void> {
  try {
    await db.delete(forYouFeedCache).where(eq(forYouFeedCache.userId, userId));
  } catch (err) {
    logger.warn({ err, userId }, "For You cache clear failed");
  }
}

/**
 * "Reset suggested content": forgets the learned taste profile and the
 * "not interested" hides, and drops the cached ranking so the next For You
 * load is computed fresh. Liked brands / style picks the buyer chose
 * explicitly (buyer_preferences) are kept.
 */
export async function resetRecommendations(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(buyerTasteProfiles).where(eq(buyerTasteProfiles.userId, userId));
    await tx.delete(feedNotInterested).where(eq(feedNotInterested.userId, userId));
    await tx.delete(forYouFeedCache).where(eq(forYouFeedCache.userId, userId));
  });
}
