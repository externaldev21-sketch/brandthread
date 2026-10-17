import { desc, eq, isNull } from "drizzle-orm";
import { db, posts } from "@workspace/db";
import { logger } from "../lib/logger";
import { measurePostMedia } from "../lib/mediaDimensions";

const BATCH_SIZE = 25;
const CONCURRENCY = 4;

/**
 * Fills media_width/height, thumbnail_width/height, media_dimensions and
 * per-slide sizes for posts created before migration 271 (including the
 * @brandthread seed content). Newest first, so the feed fixes itself
 * fastest. Every processed post gets a value — 0 when the media can't be
 * measured — so a broken post is never retried forever. Re-runnable; a
 * second run converges to zero.
 */
export async function runMediaDimensionsBackfill(opts: { maxPosts?: number } = {}): Promise<{ measured: number; unknown: number }> {
  const maxPosts = opts.maxPosts ?? Number.POSITIVE_INFINITY;
  // No cross-instance lock: two instances measuring the same post write the
  // same values, so overlap only costs a little duplicate work.
  let measured = 0;
  let unknown = 0;
  while (measured + unknown < maxPosts) {
    const batch = await db.select({
      id: posts.id, mediaUrl: posts.mediaUrl, thumbnailUrl: posts.thumbnailUrl,
      mediaUrls: posts.mediaUrls, mediaPaths: posts.mediaPaths, slides: posts.slides, mediaType: posts.mediaType,
    }).from(posts)
      .where(isNull(posts.mediaWidth))
      .orderBy(desc(posts.createdAt))
      .limit(BATCH_SIZE);
    if (batch.length === 0) break;
    const results: Array<{ post: (typeof batch)[number]; dims: Awaited<ReturnType<typeof measurePostMedia>> | null }> = [];
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      results.push(...await Promise.all(batch.slice(i, i + CONCURRENCY).map(async (post) => ({
        post, dims: await measurePostMedia(post).catch(() => null),
      }))));
    }
    // A whole batch failing looks like a storage/network outage, not broken
    // media: stop without stamping 0s and let the next run retry.
    if (batch.length >= 5 && results.every((r) => !r.dims || r.dims.mediaWidth === 0)) {
      logger.warn({ job: "mediaDimensionsBackfill", batch: batch.length }, "No media measurable in batch; retrying later");
      break;
    }
    for (const { post, dims } of results) {
      if (dims && dims.mediaWidth > 0) measured += 1; else unknown += 1;
      await db.update(posts).set({
        mediaWidth: dims?.mediaWidth ?? 0,
        mediaHeight: dims?.mediaHeight ?? 0,
        thumbnailWidth: dims?.thumbnailWidth ?? 0,
        thumbnailHeight: dims?.thumbnailHeight ?? 0,
        mediaDimensions: dims?.mediaDimensions ?? [],
        ...(dims?.slides ? { slides: dims.slides as typeof post.slides } : {}),
      }).where(eq(posts.id, post.id));
    }
    if (batch.length < BATCH_SIZE) break;
  }
  if (measured + unknown > 0) {
    logger.info({ job: "mediaDimensionsBackfill", measured, unknown }, "Post media dimensions backfilled");
  }
  return { measured, unknown };
}

let running = false;

/** Runs once shortly after boot, then hourly to catch anything a create-time measure missed. */
export function startMediaDimensionsBackfillJob(): void {
  const run = () => {
    if (running) return;
    running = true;
    void runMediaDimensionsBackfill()
      .catch((err) => logger.error({ err, job: "mediaDimensionsBackfill" }, "Media dimensions backfill failed"))
      .finally(() => { running = false; });
  };
  setTimeout(run, 45_000).unref?.();
  setInterval(run, 60 * 60 * 1000).unref?.();
  logger.info({ job: "mediaDimensionsBackfill" }, "Media dimensions backfill scheduled");
}

