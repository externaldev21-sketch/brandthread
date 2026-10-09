import { and, eq, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { db, stories, storyArchive, storyMediaCleanup } from "@workspace/db";
import { logger } from "../lib/logger";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { scheduleJob } from "./runner";

const INTERVAL_MS = 15 * 60 * 1000;
const BATCH_SIZE = 200;
const ARCHIVE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
/** Object paths checked/deleted per batch, and batches per run (bounds one run's work). */
const MEDIA_BATCH_SIZE = 50;
const MEDIA_MAX_BATCHES_PER_RUN = 4;
const MEDIA_CLAIM_TTL_MS = 10 * 60 * 1000;

type ObjectDeleter = Pick<ObjectStorageService, "deleteObjectEntity">;
let defaultStorage: ObjectDeleter | null = null;
function storage(): ObjectDeleter {
  defaultStorage ??= new ObjectStorageService();
  return defaultStorage;
}

/** Fields of a StoryMedia item that hold the media itself (overlays/stickers are not ours). */
const MEDIA_URL_KEYS = ["imageUri", "uri", "url", "videoUri", "thumbnailUri", "posterUri", "mediaUrl", "thumbnailUrl"];

/**
 * Maps a stored media reference to an `/objects/...` path in our object
 * storage, or null when it isn't one this job may delete: device URIs,
 * external URLs and `/api/posts/media/...` URLs (post-owned media, whose
 * lifecycle belongs to the post) are never touched.
 */
export function storyObjectPath(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  let pathname: string;
  if (value.startsWith("/objects/")) {
    pathname = value.split(/[?#]/)[0];
  } else {
    let url: URL;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    pathname = url.pathname;
    if (!pathname.startsWith("/objects/")) return null;
  }
  try { pathname = decodeURIComponent(pathname); } catch { return null; }
  const suffix = pathname.slice("/objects/".length);
  if (suffix.length < 8 || suffix.includes("..")) return null;
  return pathname;
}

/** Every object path referenced by a story's media array. */
export function storyMediaObjectPaths(media: unknown): string[] {
  const out = new Set<string>();
  for (const item of Array.isArray(media) ? media : []) {
    if (!item || typeof item !== "object") continue;
    for (const key of MEDIA_URL_KEYS) {
      const path = storyObjectPath((item as Record<string, unknown>)[key]);
      if (path) out.add(path);
    }
  }
  return [...out];
}

function likePattern(objectPath: string): string {
  const suffix = objectPath.slice("/objects/".length).replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${suffix}%`;
}

function textArray(values: string[]): SQL {
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

type Executor = Pick<typeof db, "insert">;

async function enqueueObjectPaths(tx: Executor, paths: string[], now: Date): Promise<void> {
  if (paths.length === 0) return;
  await tx.insert(storyMediaCleanup)
    .values([...new Set(paths)].map((objectPath) => ({ objectPath, nextAttemptAt: now })))
    .onConflictDoNothing();
}

/**
 * Returns the subset of `paths` that something still references. Matching is
 * a substring match on the path after `/objects/` (a raw path, a full URL or a
 * JSON-embedded value all match), so it errs on the side of keeping objects.
 */
export async function referencedObjectPaths(paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const result = await db.execute(sql`
    SELECT c.path FROM unnest(${textArray(paths)}, ${textArray(paths.map(likePattern))}) AS c(path, pat)
    WHERE EXISTS (SELECT 1 FROM stories s WHERE s.media::text LIKE c.pat)
       OR EXISTS (SELECT 1 FROM story_archive a WHERE a.media::text LIKE c.pat)
       OR EXISTS (SELECT 1 FROM story_highlight_items hi WHERE hi.media::text LIKE c.pat)
       OR EXISTS (SELECT 1 FROM story_highlights h WHERE h.cover_url LIKE c.pat)
       OR EXISTS (SELECT 1 FROM posts p WHERE p.media_url LIKE c.pat OR p.thumbnail_url LIKE c.pat
                    OR p.media_urls::text LIKE c.pat OR p.media_paths::text LIKE c.pat OR p.slides::text LIKE c.pat)
       OR EXISTS (SELECT 1 FROM products pr WHERE pr.images::text LIKE c.pat OR pr.size_chart_image_url LIKE c.pat)
       OR EXISTS (SELECT 1 FROM media_moderation_results m WHERE m.media_refs::text LIKE c.pat)
  `);
  return new Set(((result as unknown as { rows: { path: string }[] }).rows).map((r) => r.path));
}

/** Story ids moderators may still need (open report or unreviewed screening result). */
async function storiesUnderReview(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const result = await db.execute(sql`
    SELECT target_id AS id FROM reports
      WHERE target_type = 'story' AND status = 'pending' AND target_id = ANY(${textArray(ids)})
    UNION
    SELECT target_id AS id FROM media_moderation_results
      WHERE target_type = 'story' AND reviewed_at IS NULL AND target_id = ANY(${textArray(ids)})
  `);
  return new Set(((result as unknown as { rows: { id: string }[] }).rows).map((r) => r.id));
}

/**
 * Deletes queued story media objects that nothing references any more.
 * Idempotent: an already-missing object counts as deleted, a still-referenced
 * path is just dropped from the queue (the object stays), and a failed delete
 * is retried with back-off. Returns the number of objects deleted.
 */
export async function drainStoryMediaCleanup(
  now = new Date(),
  objectStorage: ObjectDeleter = storage(),
): Promise<number> {
  const claimExpiredAt = new Date(now.getTime() - MEDIA_CLAIM_TTL_MS);
  const claimable = and(
    lte(storyMediaCleanup.nextAttemptAt, now),
    or(isNull(storyMediaCleanup.claimedAt), lte(storyMediaCleanup.claimedAt, claimExpiredAt)),
  );
  let deleted = 0;
  for (let batchNo = 0; batchNo < MEDIA_MAX_BATCHES_PER_RUN; batchNo++) {
    const due = await db.select({ objectPath: storyMediaCleanup.objectPath })
      .from(storyMediaCleanup).where(claimable).orderBy(storyMediaCleanup.nextAttemptAt).limit(MEDIA_BATCH_SIZE);
    if (due.length === 0) break;
    const claimed = await db.update(storyMediaCleanup).set({ claimedAt: now })
      .where(and(inArray(storyMediaCleanup.objectPath, due.map((d) => d.objectPath)), claimable))
      .returning({ objectPath: storyMediaCleanup.objectPath, attemptCount: storyMediaCleanup.attemptCount });
    if (claimed.length === 0) break;

    const referenced = await referencedObjectPaths(claimed.map((c) => c.objectPath));
    const done: string[] = [];
    for (const row of claimed) {
      if (referenced.has(row.objectPath)) { done.push(row.objectPath); continue; }
      try {
        await objectStorage.deleteObjectEntity(row.objectPath);
        done.push(row.objectPath);
        deleted++;
      } catch (error) {
        if (error instanceof ObjectNotFoundError) { done.push(row.objectPath); continue; }
        const attemptCount = row.attemptCount + 1;
        const delayMs = Math.min(24 * 60 * 60 * 1000, 60 * 1000 * 2 ** Math.min(attemptCount - 1, 10));
        await db.update(storyMediaCleanup).set({
          attemptCount,
          nextAttemptAt: new Date(now.getTime() + delayMs),
          claimedAt: null,
          lastError: error instanceof Error ? error.message.slice(0, 500) : "Object deletion failed",
        }).where(eq(storyMediaCleanup.objectPath, row.objectPath));
        logger.warn({ err: error, job: "storyCleanup", objectPath: row.objectPath, attemptCount },
          "Story media deletion failed; will retry");
      }
    }
    if (done.length) await db.delete(storyMediaCleanup).where(inArray(storyMediaCleanup.objectPath, done));
    if (due.length < MEDIA_BATCH_SIZE) break;
  }
  return deleted;
}

/**
 * Deletes stories whose 24h TTL has elapsed. Reads already exclude expired
 * stories via `gt(stories.expiresAt, now)`, so this job only reclaims
 * storage — it never affects what users can see. `story_likes` and
 * `story_views` cascade-delete with their parent story.
 *
 * Before an expired story is deleted, a copy (media URLs, audience) goes into
 * the author-only `story_archive` so it can still be added to a highlight; its
 * media objects are kept. Moderation-removed and screening-held stories are
 * not archived: their media object paths are queued for deletion, unless a
 * moderator still has an open report / unreviewed screening result on the
 * story. Archive rows older than a year are pruned and their media queued the
 * same way. A queued object is deleted only once nothing (other stories, the
 * archive, highlights, posts, products, moderation records) references it —
 * see drainStoryMediaCleanup. Rows and queue entries change in one
 * transaction, so a crash in between never loses track of an object.
 */
export async function runStoryCleanup(
  now = new Date(),
  objectStorage: ObjectDeleter = storage(),
): Promise<number> {
  let totalDeleted = 0;
  for (;;) {
    const batch = await db.select().from(stories)
      .where(lt(stories.expiresAt, now))
      .limit(BATCH_SIZE);
    if (batch.length === 0) break;
    const archivable = batch.filter((r) => r.moderationStatus === "visible");
    const notArchived = batch.filter((r) => r.moderationStatus !== "visible");
    const underReview = await storiesUnderReview(notArchived.map((r) => r.id));
    const mediaToQueue = notArchived
      .filter((r) => !underReview.has(r.id))
      .flatMap((r) => storyMediaObjectPaths(r.media));
    await db.transaction(async (tx) => {
      if (archivable.length) {
        await tx.insert(storyArchive).values(archivable.map((r) => ({
          storyId: r.id,
          authorId: r.authorId,
          media: (Array.isArray(r.media) ? r.media : []) as unknown[],
          visibility: r.privacyVisibility,
          storyCreatedAt: r.createdAt,
        }))).onConflictDoNothing();
      }
      await enqueueObjectPaths(tx, mediaToQueue, now);
      await tx.delete(stories).where(inArray(stories.id, batch.map((r) => r.id)));
    });
    totalDeleted += batch.length;
    if (batch.length < BATCH_SIZE) break;
  }

  const archiveCutoff = new Date(now.getTime() - ARCHIVE_RETENTION_MS);
  let archivePruned = 0;
  for (;;) {
    const expired = await db.select({ storyId: storyArchive.storyId, media: storyArchive.media })
      .from(storyArchive).where(lt(storyArchive.archivedAt, archiveCutoff)).limit(BATCH_SIZE);
    if (expired.length === 0) break;
    await db.transaction(async (tx) => {
      await enqueueObjectPaths(tx, expired.flatMap((r) => storyMediaObjectPaths(r.media)), now);
      await tx.delete(storyArchive).where(inArray(storyArchive.storyId, expired.map((r) => r.storyId)));
    });
    archivePruned += expired.length;
    if (expired.length < BATCH_SIZE) break;
  }

  const mediaDeleted = await drainStoryMediaCleanup(now, objectStorage);
  if (totalDeleted > 0 || archivePruned > 0 || mediaDeleted > 0) {
    logger.info({ job: "storyCleanup", deleted: totalDeleted, archivePruned, mediaDeleted }, "Expired stories cleaned up");
  }
  return totalDeleted;
}

export function startStoryCleanupJob(): void {
  scheduleJob("storyCleanup", () => runStoryCleanup(), { intervalMs: INTERVAL_MS, initialDelayMs: 30_000 });
}
