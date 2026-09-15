import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  designStudioAssets,
  designStudioObjectCleanup,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const INTERVAL_MS = 5 * 60 * 1000;
const CLAIM_TTL_MS = 10 * 60 * 1000;
const BATCH_SIZE = 25;
const storage = new ObjectStorageService();

export async function runDesignStudioObjectCleanup(
  now = new Date(),
  objectStorage = storage,
): Promise<void> {
  const claimExpiredAt = new Date(now.getTime() - CLAIM_TTL_MS);
  const candidates = await db.select({ objectPath: designStudioObjectCleanup.objectPath })
    .from(designStudioObjectCleanup)
    .where(and(
      lte(designStudioObjectCleanup.nextAttemptAt, now),
      or(
        isNull(designStudioObjectCleanup.claimedAt),
        lte(designStudioObjectCleanup.claimedAt, claimExpiredAt),
      ),
    ))
    .limit(BATCH_SIZE);

  for (const candidate of candidates) {
    const claimed = await db.update(designStudioObjectCleanup)
      .set({ claimedAt: now })
      .where(and(
        eq(designStudioObjectCleanup.objectPath, candidate.objectPath),
        or(
          isNull(designStudioObjectCleanup.claimedAt),
          lte(designStudioObjectCleanup.claimedAt, claimExpiredAt),
        ),
      ))
      .returning({
        objectPath: designStudioObjectCleanup.objectPath,
        attemptCount: designStudioObjectCleanup.attemptCount,
      });
    if (claimed.length === 0) continue;

    const [reference] = await db.select({ id: designStudioAssets.id })
      .from(designStudioAssets)
      .where(eq(designStudioAssets.objectPath, candidate.objectPath))
      .limit(1);
    if (reference) {
      await db.delete(designStudioObjectCleanup)
        .where(eq(designStudioObjectCleanup.objectPath, candidate.objectPath));
      continue;
    }

    try {
      await objectStorage.deleteObjectEntity(candidate.objectPath);
      await db.delete(designStudioObjectCleanup)
        .where(eq(designStudioObjectCleanup.objectPath, candidate.objectPath));
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        await db.delete(designStudioObjectCleanup)
          .where(eq(designStudioObjectCleanup.objectPath, candidate.objectPath));
        continue;
      }
      const attemptCount = claimed[0].attemptCount + 1;
      const delayMs = Math.min(24 * 60 * 60 * 1000, 60 * 1000 * 2 ** Math.min(attemptCount - 1, 10));
      await db.update(designStudioObjectCleanup).set({
        attemptCount: sql`${designStudioObjectCleanup.attemptCount} + 1`,
        nextAttemptAt: new Date(now.getTime() + delayMs),
        claimedAt: null,
        lastError: error instanceof Error ? error.message.slice(0, 500) : "Object deletion failed",
      }).where(eq(designStudioObjectCleanup.objectPath, candidate.objectPath));
      logger.warn(
        { err: error, objectPath: candidate.objectPath, attemptCount },
        "Design Studio object cleanup will retry",
      );
    }
  }
}

export function startDesignStudioObjectCleanupJob(): void {
  setTimeout(() => {
    void runDesignStudioObjectCleanup().catch(err =>
      logger.error({ err, job: "designStudioObjectCleanup" }, "Design Studio cleanup job failed"),
    );
  }, 30_000);
  setInterval(() => {
    void runDesignStudioObjectCleanup().catch(err =>
      logger.error({ err, job: "designStudioObjectCleanup" }, "Design Studio cleanup job failed"),
    );
  }, INTERVAL_MS);
  logger.info({ job: "designStudioObjectCleanup", intervalMs: INTERVAL_MS }, "Design Studio cleanup job scheduled");
}