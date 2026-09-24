import { inArray, lt } from "drizzle-orm";
import { db, stories } from "@workspace/db";
import { logger } from "../lib/logger";

const INTERVAL_MS = 15 * 60 * 1000;
const BATCH_SIZE = 200;

/**
 * Deletes stories whose 24h TTL has elapsed. Reads already exclude expired
 * stories via `gt(stories.expiresAt, now)`, so this job only reclaims
 * storage — it never affects what users can see. `story_likes` and
 * `story_views` cascade-delete with their parent story.
 */
export async function runStoryCleanup(now = new Date()): Promise<number> {
  let totalDeleted = 0;
  for (;;) {
    const batch = await db.select({ id: stories.id }).from(stories)
      .where(lt(stories.expiresAt, now))
      .limit(BATCH_SIZE);
    if (batch.length === 0) break;
    await db.delete(stories).where(inArray(stories.id, batch.map((r) => r.id)));
    totalDeleted += batch.length;
    if (batch.length < BATCH_SIZE) break;
  }
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
