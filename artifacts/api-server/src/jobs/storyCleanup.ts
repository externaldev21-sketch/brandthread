import { inArray, lt } from "drizzle-orm";
import { db, stories, storyArchive } from "@workspace/db";
import { logger } from "../lib/logger";

const INTERVAL_MS = 15 * 60 * 1000;
const BATCH_SIZE = 200;
const ARCHIVE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Deletes stories whose 24h TTL has elapsed. Reads already exclude expired
 * stories via `gt(stories.expiresAt, now)`, so this job only reclaims
 * storage — it never affects what users can see. `story_likes` and
 * `story_views` cascade-delete with their parent story.
 *
 * Before an expired story is deleted, a copy (media URLs, audience) goes into
 * the author-only `story_archive` so it can still be added to a highlight. The
 * media objects themselves are never deleted here. Moderation-removed and screening-held stories
 * are not archived. Archive rows older than a year are pruned.
 */
export async function runStoryCleanup(now = new Date()): Promise<number> {
  let totalDeleted = 0;
  for (;;) {
    const batch = await db.select().from(stories)
      .where(lt(stories.expiresAt, now))
      .limit(BATCH_SIZE);
    if (batch.length === 0) break;
    const archivable = batch.filter((r) => r.moderationStatus === "visible");
    if (archivable.length) {
      await db.insert(storyArchive).values(archivable.map((r) => ({
        storyId: r.id,
        authorId: r.authorId,
        media: (Array.isArray(r.media) ? r.media : []) as unknown[],
        visibility: r.privacyVisibility,
        storyCreatedAt: r.createdAt,
      }))).onConflictDoNothing();
    }
    await db.delete(stories).where(inArray(stories.id, batch.map((r) => r.id)));
    totalDeleted += batch.length;
    if (batch.length < BATCH_SIZE) break;
  }
  await db.delete(storyArchive).where(lt(storyArchive.archivedAt, new Date(now.getTime() - ARCHIVE_RETENTION_MS)));
  if (totalDeleted > 0) {
    logger.info({ job: "storyCleanup", deleted: totalDeleted }, "Expired stories cleaned up");
  }
  return totalDeleted;
}

export function startStoryCleanupJob(): void {
  setTimeout(() => {
    void runStoryCleanup().catch(err =>
      logger.error({ err, job: "storyCleanup" }, "Story cleanup job failed"),
    );
  }, 30_000);
  setInterval(() => {
    void runStoryCleanup().catch(err =>
      logger.error({ err, job: "storyCleanup" }, "Story cleanup job failed"),
    );
  }, INTERVAL_MS).unref?.();
  logger.info({ job: "storyCleanup", intervalMs: INTERVAL_MS }, "Story cleanup job scheduled");
}
