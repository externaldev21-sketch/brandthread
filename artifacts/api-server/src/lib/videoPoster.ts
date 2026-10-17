/**
 * Video poster (still frame) generation for posts that have no thumbnail.
 *
 * Discover and every grid render a still image per tile. A video post saved
 * without `thumbnail_url` (seeded posts, direct-URL uploads, older clients)
 * otherwise renders as an empty black tile forever. This module grabs one
 * frame with ffmpeg, stores it as a small public JPEG next to the post's
 * media, and writes the URL back to `posts.thumbnail_url`.
 *
 * Deliberately separate from the media-quality pipeline (post-video.ts /
 * claude/full-quality-media): it only ever READS the source video and only
 * ever WRITES `thumbnail_url` when it is still null.
 *
 * Used by:
 *  - POST /api/posts (fire-and-forget for a new video with no thumbnail)
 *  - GET /api/public/discover (self-heal a few missing posters per request)
 *  - scripts/backfillVideoPosters.ts (one-off backfill, incl. @brandthread seeds)
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db, posts } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

/** Grid tiles are at most ~260pt wide at 3x; 540px wide keeps posters small. */
export const POSTER_WIDTH = 540;
const MEDIA_MARKER = "/api/posts/media/";

export type PosterExec = (file: string, args: string[], opts: { timeout: number }) => Promise<unknown>;

export interface PosterDeps {
  exec?: PosterExec;
  storage?: Pick<ObjectStorageService, "getObjectEntityFile" | "createObjectEntityFromBuffer" | "trySetObjectEntityAclPolicy">;
  /** Absolute origin for the stored poster URL when the video is not served by /api/posts/media. */
  origin?: string | null;
}

export interface PosterTarget {
  id: string;
  userId: string;
  mediaType: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
}

/** `/objects/...` path for a URL served by GET /api/posts/media/*, else null. */
export function objectPathFromMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const index = url.indexOf(MEDIA_MARKER);
  if (index < 0) return null;
  const suffix = decodeURIComponent(url.slice(index + MEDIA_MARKER.length).split(/[?#]/)[0]);
  if (!suffix || suffix.includes("..")) return null;
  return `/objects/${suffix.replace(/^\/+/, "")}`;
}

/** Origin (scheme + host + any mount prefix) of a /api/posts/media URL, else null. */
export function mediaOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  const index = url.indexOf(MEDIA_MARKER);
  if (index <= 0 || !/^https?:\/\//.test(url)) return null;
  return url.slice(0, index);
}

/** ffmpeg arguments for one scaled JPEG frame ~0.5s in (skips black fade-ins). */
export function posterFfmpegArgs(input: string, output: string): string[] {
  return [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", "0.5", "-i", input,
    "-frames:v", "1",
    "-vf", `scale='min(${POSTER_WIDTH},iw)':-2`,
    "-q:v", "4",
    output,
  ];
}

const inflight = new Map<string, Promise<string | null>>();

/**
 * Ensures `post` has a poster. Returns the thumbnail URL (existing or new),
 * or null when one could not be produced. Never throws.
 */
export function ensureVideoPoster(post: PosterTarget, deps: PosterDeps = {}): Promise<string | null> {
  if (post.mediaType !== "video") return Promise.resolve(post.thumbnailUrl);
  if (post.thumbnailUrl) return Promise.resolve(post.thumbnailUrl);
  const existing = inflight.get(post.id);
  if (existing) return existing;
  const job = generate(post, deps).finally(() => inflight.delete(post.id));
  inflight.set(post.id, job);
  return job;
}

async function generate(post: PosterTarget, deps: PosterDeps): Promise<string | null> {
  const exec = deps.exec ?? ((file, args, opts) => execFileAsync(file, args, { ...opts, maxBuffer: 1024 * 1024 }));
  const storage = deps.storage ?? new ObjectStorageService();
  const sourcePath = objectPathFromMediaUrl(post.mediaUrl);
  const origin = mediaOrigin(post.mediaUrl) ?? deps.origin ?? null;
  if (!origin) {
    logger.warn({ postId: post.id }, "videoPoster: no public origin for poster URL; skipped");
    return null;
  }
  if (!sourcePath && !/^https?:\/\//.test(post.mediaUrl)) return null;

  const dir = await fs.mkdtemp(join(tmpdir(), "bt-poster-"));
  try {
    let input = post.mediaUrl;
    if (sourcePath) {
      input = join(dir, "source");
      const file = await storage.getObjectEntityFile(sourcePath);
      await file.download({ destination: input });
    }
    const output = join(dir, "poster.jpg");
    await exec("ffmpeg", posterFfmpegArgs(input, output), { timeout: 30_000 });
    const jpeg = await fs.readFile(output);
    if (jpeg.length === 0) return null;

    const objectPath = await storage.createObjectEntityFromBuffer(jpeg, "image/jpeg", undefined, {
      cacheControl: "public, max-age=31536000, immutable",
    });
    await storage.trySetObjectEntityAclPolicy(objectPath, { owner: post.userId, visibility: "public" });
    const url = `${origin}${MEDIA_MARKER}${objectPath.replace(/^\/objects\//, "")}`;

    // Only fill a still-empty thumbnail; never overwrite one set meanwhile.
    const updated = await db.update(posts)
      .set({ thumbnailUrl: url })
      .where(and(eq(posts.id, post.id), isNull(posts.thumbnailUrl)))
      .returning({ id: posts.id });
    return updated.length > 0 ? url : null;
  } catch (err) {
    logger.warn({ err, postId: post.id }, "videoPoster: could not generate poster");
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface PosterBackfillResult {
  scanned: number;
  generated: number;
  failed: string[];
}

/**
 * Generates posters for every video post (any author, incl. the @brandthread
 * seed videos) that still has no thumbnail. Idempotent: a second run finds
 * nothing to do. `dryRun` only counts.
 */
export async function runVideoPosterBackfill(
  opts: { origin?: string | null; dryRun?: boolean; batchSize?: number; max?: number } = {},
  deps: PosterDeps = {},
): Promise<PosterBackfillResult> {
  const batchSize = opts.batchSize ?? 25;
  const max = opts.max ?? Number.POSITIVE_INFINITY;
  const result: PosterBackfillResult = { scanned: 0, generated: 0, failed: [] };
  const tried = new Set<string>();
  while (result.scanned < max) {
    const rows = await db
      .select({ id: posts.id, userId: posts.userId, mediaType: posts.mediaType, mediaUrl: posts.mediaUrl, thumbnailUrl: posts.thumbnailUrl })
      .from(posts)
      .where(and(
        eq(posts.mediaType, "video"),
        isNull(posts.thumbnailUrl),
        sql`jsonb_array_length(coalesce(${posts.slides}, '[]'::jsonb)) = 0`,
        tried.size > 0 ? notInArray(posts.id, [...tried]) : undefined,
      ))
      .orderBy(asc(posts.createdAt))
      .limit(batchSize);
    if (rows.length === 0) break;
    for (const row of rows) {
      if (result.scanned >= max) break;
      tried.add(row.id);
      result.scanned++;
      if (opts.dryRun) continue;
      const url = await ensureVideoPoster(row, { ...deps, origin: deps.origin ?? opts.origin ?? null });
      if (url) result.generated++;
      else result.failed.push(row.id);
    }
    if (opts.dryRun && rows.length < batchSize) break;
  }
  return result;
}
