/**
 * Seller-authored Thread posts.
 * GET  /api/posts/feed          — buyer's personalised Thread feed (requireAuth)
 *                                 Posts from sellers the buyer follows, newest-first.
 * GET  /api/public/posts        — paginated public feed of all published posts (no auth)
 * POST /api/posts              — create post + tag products (requireAuth)
 * GET  /api/posts/:id          — get single post + tags + counts (public)
 * GET  /api/posts/:id/analytics — owner-only verified performance (requireAuth)
 * POST /api/posts/:id/interact — toggle like / repost; record analytics events (requireAuth)
 */
import {
  db, posts, postTaggedProducts, products, users, interactions, follows, boosts,
  savedItems, orders,
} from "@workspace/db";
import { eq, and, inArray, count, sql, desc, lt, gte } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { deriveSellerVerified } from "../lib/sellerEligibility";
import express, { Router } from "express";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ObjectStorageService } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";

const router = Router();

const objectStorage = new ObjectStorageService();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_CONTENT_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const VIDEO_PATH_RE = /^\/objects\/uploads\/[a-zA-Z0-9_-]+$/;
const VIDEO_FILTERS = new Set(["none", "warm", "cool", "mono"]);
const MAX_CLIP_BYTES = 80 * 1024 * 1024;
const MAX_TOTAL_CLIP_BYTES = 240 * 1024 * 1024;
const MAX_TOTAL_DURATION_SECONDS = 600;
const MAX_CLIPS = 12;
const activeVideoCompositions = new Set<string>();
const execFileAsync = promisify(execFile);

function validSpeed(value: unknown): value is 0.5 | 1 | 2 | 3 {
  return value === 0.5 || value === 1 || value === 2 || value === 3;
}

function audioTempoFilter(speed: 0.5 | 1 | 2 | 3): string {
  if (speed === 3) return "atempo=1.5,atempo=2";
  return `atempo=${speed}`;
}

function isSupportedVideo(contentType: string, bytes: Buffer): boolean {
  if (!VIDEO_CONTENT_TYPES.has(contentType)) return false;
  const isFtyp = bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  const isWebm = bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return isFtyp || isWebm;
}

async function probeDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ], { maxBuffer: 1024 * 1024, timeout: 15_000 });
  const duration = Number.parseFloat(String(stdout).trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Video duration could not be read.");
  }
  return duration;
}

async function probeHasAudio(filePath: string): Promise<boolean> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index",
    "-of", "csv=p=0", filePath,
  ], { maxBuffer: 1024 * 1024, timeout: 15_000 });
  return String(stdout).trim().length > 0;
}

function mediaUrlFor(req: express.Request, objectPath: string): string {
  return `${req.protocol}://${req.get("host")}/api/posts/media/${objectPath.replace(/^\/objects\//, "")}`;
}

async function requireSeller(clerkId: string): Promise<boolean> {
  const [seller] = await db
    .select({ accountType: users.accountType })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  return seller?.accountType === "seller";
}

// ─── GET /api/posts/feed ──────────────────────────────────────────────────────
// Buyer's personalised Thread feed: posts from sellers the buyer follows,
// newest-first. Requires auth so we can resolve the buyer's follows.
// Query params: ?limit=30&offset=0
router.get("/feed", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const lim = Math.min(parseInt((req.query.limit as string) || "30", 10) || 30, 50);
  const off = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0);

  try {
    // 1. Which seller accounts does this buyer follow?
    const followRows = await db
      .select({ followingId: follows.followingId })
      .from(follows)
      .where(eq(follows.followerId, clerkId));

    const followedIds = followRows.map((r) => r.followingId);

    // No followed sellers → return empty feed (real empty, not demo)
    if (followedIds.length === 0) {
      return res.json([]);
    }

    // 2. Fetch posts from those followed accounts (seller-only gate via users join)
    const rows = await db
      .select({
        id:          posts.id,
        userId:      posts.userId,
        mediaUrl:    posts.mediaUrl,
        thumbnailUrl: posts.thumbnailUrl,
        mediaType:   posts.mediaType,
        caption:     posts.caption,
        styleTags:   posts.styleTags,
        createdAt:   posts.createdAt,
        displayName: users.displayName,
        brandName:   users.brandName,
        verified:    users.verified,
        verificationStatus: users.verificationStatus,
        activeStanding: users.activeStanding,
        policyRestricted: users.policyRestricted,
        accountType: users.accountType,
      })
      .from(posts)
      .innerJoin(users, and(
        eq(users.clerkId, posts.userId),
        eq(users.accountType, "seller"),        // seller-only gate
        inArray(posts.userId, followedIds),     // followed-only gate
      ))
      .orderBy(desc(posts.createdAt))
      .limit(lim)
      .offset(off);

    if (rows.length === 0) {
      return res.json([]);
    }

    const postIds = rows.map((r) => r.id);

    // 3. Fetch tagged products and interaction counts in parallel
    const [tagRows, likeRows, repostRows, commentRows] = await Promise.all([
      db
        .select({
          postId:    postTaggedProducts.postId,
          productId: postTaggedProducts.productId,
          position:  postTaggedProducts.position,
          name:      products.name,
          images:    products.images,
        })
        .from(postTaggedProducts)
        .leftJoin(products, eq(products.id, postTaggedProducts.productId))
        .where(inArray(postTaggedProducts.postId, postIds))
        .orderBy(postTaggedProducts.position),

      db
        .select({ postId: interactions.postId, cnt: count() })
        .from(interactions)
        .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "like")))
        .groupBy(interactions.postId),

      db
        .select({ postId: interactions.postId, cnt: count() })
        .from(interactions)
        .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "repost")))
        .groupBy(interactions.postId),

      db
        .select({ postId: interactions.postId, cnt: count() })
        .from(interactions)
        .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "comment")))
        .groupBy(interactions.postId),
    ]);

    // Index by postId for O(1) lookup
    const tagsByPost: Record<string, typeof tagRows> = {};
    for (const t of tagRows) {
      if (!tagsByPost[t.postId]) tagsByPost[t.postId] = [];
      tagsByPost[t.postId].push(t);
    }
    const likesByPost: Record<string, number> = {};
    for (const r of likeRows) if (r.postId) likesByPost[r.postId] = Number(r.cnt);
    const repostsByPost: Record<string, number> = {};
    for (const r of repostRows) if (r.postId) repostsByPost[r.postId] = Number(r.cnt);
    const commentsByPost: Record<string, number> = {};
    for (const r of commentRows) if (r.postId) commentsByPost[r.postId] = Number(r.cnt);

    // ─── Boost ranking: find active boosts for this page of posts ────────────
    const now = new Date();
    const boostRows = await db
      .select({ id: boosts.id, targetId: boosts.targetId })
      .from(boosts)
      .where(and(
        eq(boosts.targetType, "post"),
        eq(boosts.status, "active"),
        gte(boosts.endsAt, now),
        inArray(boosts.targetId, postIds),
      ));
    const boostedPostIds = new Set(boostRows.map((b) => b.targetId));

    // Fire-and-forget: increment impressions_count for each active boost that
    // appears in this feed page. One increment per boost row per request.
    if (boostRows.length > 0) {
      const boostIds = boostRows.map((b) => b.id);
      db.update(boosts)
        .set({ impressionsCount: sql`${boosts.impressionsCount} + 1` })
        .where(inArray(boosts.id, boostIds))
        .catch(() => {});
    }

    const result = rows.map((p) => ({
      id:        p.id,
      userId:    p.userId,
      mediaUrl:  p.mediaUrl,
      thumbnailUrl: p.thumbnailUrl,
      mediaType: p.mediaType,
      caption:   p.caption,
      styleTags: p.styleTags,
      createdAt: p.createdAt,
      boosted:   boostedPostIds.has(p.id),
      seller: {
        displayName: p.displayName,
        brandName:   p.brandName,
        verified:    deriveSellerVerified(p),
      },
      taggedProducts: (tagsByPost[p.id] ?? []).map((t) => ({
        productId: t.productId,
        position:  t.position,
        name:      t.name,
        images:    t.images,
      })),
      likesCount:    likesByPost[p.id]    ?? 0,
      repostsCount:  repostsByPost[p.id]  ?? 0,
      commentsCount: commentsByPost[p.id] ?? 0,
    }));

    // Stable-sort: boosted posts surface first, rest preserve createdAt DESC order
    result.sort((a, b) => {
      const boost = (b.boosted ? 1 : 0) - (a.boosted ? 1 : 0);
      return boost; // ties keep their original relative order (stable in V8)
    });

    return res.json(result);
  } catch (err) {
    req.log.error({ err, clerkId }, "Failed to fetch posts feed");
    return res.status(500).json({ error: "Failed to fetch feed" });
  }
});

// ─── POST /api/posts/video-clips ──────────────────────────────────────────────
router.post(
  "/video-clips",
  requireAuth,
  express.raw({ type: Array.from(VIDEO_CONTENT_TYPES), limit: MAX_CLIP_BYTES }),
  async (req, res) => {
    const clerkId = (req as any).clerkUserId as string;
    if (!(await requireSeller(clerkId))) {
      return res.status(403).json({ error: "Only seller accounts can upload post videos.", code: "SELLER_ONLY" });
    }

    const contentType = String(req.get("content-type") ?? "").split(";")[0].toLowerCase();
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length === 0 || !isSupportedVideo(contentType, bytes)) {
      return res.status(415).json({ error: "Upload an MP4, MOV, or WebM video." });
    }

    try {
      const objectPath = await objectStorage.createObjectEntityFromBuffer(bytes, contentType);
      await objectStorage.trySetObjectEntityAclPolicy(objectPath, {
        owner: clerkId,
        visibility: "private",
      });
      return res.status(201).json({ objectPath, contentType, size: bytes.length });
    } catch (err) {
      req.log.error({ err, clerkId }, "Failed to upload post video clip");
      return res.status(500).json({ error: "The video clip could not be uploaded." });
    }
  },
);

// ─── POST /api/posts/compose-video ────────────────────────────────────────────
router.post("/compose-video", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  if (!(await requireSeller(clerkId))) {
    return res.status(403).json({ error: "Only seller accounts can compose post videos.", code: "SELLER_ONLY" });
  }
  if (activeVideoCompositions.has(clerkId)) {
    return res.status(409).json({ error: "A video is already being processed for this account." });
  }

  const body = req.body as {
    clips?: Array<{ objectPath?: string; duration?: number; speed?: number; filter?: string }>;
    trimStart?: number;
    trimEnd?: number;
  };
  const clips = Array.isArray(body?.clips) ? body.clips : [];
  if (clips.length < 1 || clips.length > MAX_CLIPS) {
    return res.status(400).json({ error: `Choose between 1 and ${MAX_CLIPS} video clips.` });
  }
  if (clips.some((clip) =>
    !VIDEO_PATH_RE.test(String(clip.objectPath ?? "")) ||
    !validSpeed(clip.speed ?? 1) ||
    !VIDEO_FILTERS.has(String(clip.filter ?? "none"))
  )) {
    return res.status(400).json({ error: "One or more video clip settings are invalid." });
  }

  activeVideoCompositions.add(clerkId);
  let workDir: string | null = null;
  let outputObjectPath: string | null = null;
  let thumbnailObjectPath: string | null = null;
  try {
    workDir = await fs.mkdtemp(join(tmpdir(), "brandthread-video-"));
    const inputPaths: string[] = [];
    const durations: number[] = [];
    const audioTracks: boolean[] = [];
    let totalBytes = 0;

    for (let i = 0; i < clips.length; i += 1) {
      const clip = clips[i];
      const file = await objectStorage.getObjectEntityFile(clip.objectPath!);
      const allowed = await objectStorage.canAccessObjectEntity({
        userId: clerkId,
        objectFile: file,
        requestedPermission: ObjectPermission.READ,
      });
      if (!allowed) {
        return res.status(403).json({ error: "A video clip does not belong to this account." });
      }

      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size ?? 0);
      totalBytes += size;
      if (!Number.isFinite(size) || size <= 0 || size > MAX_CLIP_BYTES || totalBytes > MAX_TOTAL_CLIP_BYTES) {
        return res.status(413).json({ error: "The selected video clips are too large to process." });
      }

      const inputPath = join(workDir, `input-${i}.mp4`);
      const [bytes] = await file.download();
      await fs.writeFile(inputPath, bytes);
      inputPaths.push(inputPath);
      durations.push(await probeDuration(inputPath));
      audioTracks.push(await probeHasAudio(inputPath));
    }

    const totalDuration = durations.reduce((sum, duration, i) => {
      const speed = validSpeed(clips[i].speed) ? clips[i].speed : 1;
      return sum + duration / speed;
    }, 0);
    if (totalDuration > MAX_TOTAL_DURATION_SECONDS) {
      return res.status(400).json({ error: "The composed video must be 10 minutes or shorter." });
    }

    const requestedStart = Number(body.trimStart);
    const requestedEnd = Number(body.trimEnd);
    const start = Number.isFinite(requestedStart) ? Math.max(0, requestedStart) : 0;
    const end = Number.isFinite(requestedEnd) ? Math.min(requestedEnd, totalDuration) : totalDuration;
    if (end <= start) {
      return res.status(400).json({ error: "The video trim range is invalid." });
    }

    const speedFilters = inputPaths.map((_, i) => {
      const speed = validSpeed(clips[i].speed) ? clips[i].speed : 1;
      const colorFilter = clips[i].filter === "warm"
        ? ",eq=saturation=1.12:contrast=1.04:brightness=0.02"
        : clips[i].filter === "cool"
          ? ",colorbalance=bs=.08"
          : clips[i].filter === "mono"
            ? ",hue=s=0"
            : "";
      return `[${i}:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30${colorFilter},setpts=PTS/${speed}[v${i}]`;
    });
    const audioFilters = inputPaths.map((_, i) => {
      const speed = validSpeed(clips[i].speed) ? clips[i].speed : 1;
      return audioTracks[i]
        ? `[${i}:a]${audioTempoFilter(speed)},aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`
        : `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${durations[i] / speed}[a${i}]`;
    });
    const concatInputs = inputPaths.map((_, i) => `[v${i}][a${i}]`).join("");
    const filter = [
      ...speedFilters,
      ...audioFilters,
      `${concatInputs}concat=n=${inputPaths.length}:v=1:a=1[combinedv][combineda]`,
      `[combinedv]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[outv]`,
      `[combineda]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[outa]`,
    ].join(";");

    const outputPath = join(workDir, "output.mp4");
    const thumbnailPath = join(workDir, "thumbnail.jpg");
    await execFileAsync("ffmpeg", [
      "-y",
      ...inputPaths.flatMap((inputPath) => ["-i", inputPath]),
      "-filter_complex", filter,
      "-map", "[outv]", "-map", "[outa]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-c:a", "aac", "-movflags", "+faststart",
      outputPath,
    ], { maxBuffer: 8 * 1024 * 1024, timeout: 180_000 });
    await execFileAsync("ffmpeg", [
      "-y", "-ss", "0", "-i", outputPath, "-frames:v", "1", "-q:v", "2", thumbnailPath,
    ], { maxBuffer: 4 * 1024 * 1024, timeout: 30_000 });

    const outputBytes = await fs.readFile(outputPath);
    const thumbnailBytes = await fs.readFile(thumbnailPath);
    outputObjectPath = await objectStorage.createObjectEntityFromBuffer(outputBytes, "video/mp4");
    thumbnailObjectPath = await objectStorage.createObjectEntityFromBuffer(thumbnailBytes, "image/jpeg");
    await Promise.all([
      objectStorage.trySetObjectEntityAclPolicy(outputObjectPath, { owner: clerkId, visibility: "private" }),
      objectStorage.trySetObjectEntityAclPolicy(thumbnailObjectPath, { owner: clerkId, visibility: "private" }),
    ]);
    const [mediaUrl, thumbnailUrl] = await Promise.all([
      objectStorage.getObjectEntityDownloadURL(outputObjectPath),
      objectStorage.getObjectEntityDownloadURL(thumbnailObjectPath),
    ]);

    return res.json({
      mediaUrl,
      mediaPath: outputObjectPath,
      thumbnailUrl,
      thumbnailPath: thumbnailObjectPath,
      duration: await probeDuration(outputPath),
      clipCount: clips.length,
    });
  } catch (err) {
    if (outputObjectPath) await objectStorage.deleteObjectEntity(outputObjectPath).catch(() => {});
    if (thumbnailObjectPath) await objectStorage.deleteObjectEntity(thumbnailObjectPath).catch(() => {});
    req.log.error({ err, clerkId }, "Failed to compose post video");
    return res.status(500).json({ error: "The video could not be processed. Please try again." });
  } finally {
    activeVideoCompositions.delete(clerkId);
    if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

// Public media is served only after the create-post route changes its ACL.
router.get("/media/*storageKey", async (req, res) => {
  const rawStorageKey = (req.params as any).storageKey;
  const storageKey = Array.isArray(rawStorageKey) ? rawStorageKey.join("/") : String(rawStorageKey ?? "");
  const objectPath = `/objects/${storageKey}`;
  if (!VIDEO_PATH_RE.test(objectPath)) return res.status(404).end();

  try {
    const file = await objectStorage.getObjectEntityFile(objectPath);
    const isPublic = await objectStorage.canAccessObjectEntity({
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    if (!isPublic) return res.status(404).end();

    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size ?? 0);
    const contentType = String(metadata.contentType ?? "application/octet-stream");
    const range = req.get("range");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    if (range && Number.isFinite(size) && size > 0) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return res.status(416).end();
      const suffixLength = Number(match[2]);
      const start = match[1] ? Number(match[1]) : Math.max(0, size - suffixLength);
      const end = match[2] && match[1] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end) {
        return res.status(416).end();
      }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", String(end - start + 1));
      file.createReadStream({ start, end }).pipe(res);
      return res;
    }

    if (Number.isFinite(size) && size > 0) res.setHeader("Content-Length", String(size));
    file.createReadStream().pipe(res);
    return res;
  } catch {
    return res.status(404).end();
  }
});

// ─── POST /api/posts ─────────────────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;

  // ── Seller-only gate ────────────────────────────────────────────────────────
  // Only seller accounts may publish to the Thread feed. This is enforced
  // server-side so a buyer cannot bypass it by calling the API directly.
  const [poster] = await db
    .select({ accountType: users.accountType })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!poster || poster.accountType !== "seller") {
    return res.status(403).json({
      error: "Only seller accounts can post to the Thread feed.",
      code: "SELLER_ONLY",
    });
  }

  const {
    mediaUrl, mediaPath, thumbnailPath: requestedThumbnailPath, mediaType, caption, styleTags, taggedProductIds,
  } = req.body as {
    mediaUrl?:          string;
    mediaPath?:         string;
    thumbnailPath?:     string;
    mediaType?:         string;
    caption?:           string;
    styleTags?:         string[];
    taggedProductIds?:  string[];
  };

  let pendingMediaPath: string | null = null;
  let pendingThumbnailPath: string | null = null;
  let publishMediaUrl = mediaUrl ?? "";
  let publishThumbnailUrl: string | null = null;

  if (mediaPath) {
    if (!VIDEO_PATH_RE.test(mediaPath)) {
      return res.status(400).json({ error: "The composed video path is invalid." });
    }
    try {
      const mediaFile = await objectStorage.getObjectEntityFile(mediaPath);
      const allowed = await objectStorage.canAccessObjectEntity({
        userId: clerkId,
        objectFile: mediaFile,
        requestedPermission: ObjectPermission.READ,
      });
      if (!allowed) return res.status(403).json({ error: "The composed video does not belong to this account." });
      pendingMediaPath = mediaPath;
      publishMediaUrl = mediaUrlFor(req, mediaPath);
    } catch {
      return res.status(400).json({ error: "The composed video is no longer available." });
    }
  }

  if (requestedThumbnailPath) {
    if (!VIDEO_PATH_RE.test(requestedThumbnailPath)) {
      return res.status(400).json({ error: "The video thumbnail path is invalid." });
    }
    try {
      const thumbnailFile = await objectStorage.getObjectEntityFile(requestedThumbnailPath);
      const allowed = await objectStorage.canAccessObjectEntity({
        userId: clerkId,
        objectFile: thumbnailFile,
        requestedPermission: ObjectPermission.READ,
      });
      if (!allowed) return res.status(403).json({ error: "The video thumbnail does not belong to this account." });
      pendingThumbnailPath = requestedThumbnailPath;
      publishThumbnailUrl = mediaUrlFor(req, requestedThumbnailPath);
    } catch {
      return res.status(400).json({ error: "The video thumbnail is no longer available." });
    }
  }

  if (!publishMediaUrl) return res.status(400).json({ error: "Post media is required." });

  const [post] = await db.insert(posts).values({
    userId: clerkId,
    mediaUrl: publishMediaUrl,
    thumbnailUrl: publishThumbnailUrl,
    mediaType: (mediaType as any) ?? "photo",
    caption: caption ?? "",
    styleTags: styleTags ?? [],
  }).returning();

  try {
    if (pendingMediaPath) {
      await objectStorage.trySetObjectEntityAclPolicy(pendingMediaPath, { owner: clerkId, visibility: "public" });
    }
    if (pendingThumbnailPath) {
      await objectStorage.trySetObjectEntityAclPolicy(pendingThumbnailPath, { owner: clerkId, visibility: "public" });
    }
  } catch (error) {
    await db.delete(posts).where(eq(posts.id, post.id)).catch(() => {});
    if (pendingMediaPath) {
      await objectStorage.trySetObjectEntityAclPolicy(pendingMediaPath, { owner: clerkId, visibility: "private" }).catch(() => {});
    }
    if (pendingThumbnailPath) {
      await objectStorage.trySetObjectEntityAclPolicy(pendingThumbnailPath, { owner: clerkId, visibility: "private" }).catch(() => {});
    }
    req.log.error({ err: error, clerkId, postId: post.id }, "Could not publish composed video");
    return res.status(500).json({ error: "The video could not be published. You can retry without recomposing it." });
  }

  // Validate + tag products (must belong to the posting seller)
  const taggedProducts: any[] = [];
  if (taggedProductIds && taggedProductIds.length > 0) {
    const validIds = taggedProductIds.filter((id) => UUID_RE.test(id));
    if (validIds.length > 0) {
      const sellerProds = await db
        .select({ id: products.id, name: products.name, images: products.images })
        .from(products)
        .where(and(inArray(products.id, validIds), eq(products.ownerId, clerkId)));

      if (sellerProds.length > 0) {
        await db.insert(postTaggedProducts).values(
          sellerProds.map((p, i) => ({ postId: post.id, productId: p.id, position: i })),
        );
        taggedProducts.push(...sellerProds);
      }
    }
  }

  return res.status(201).json({ ...post, taggedProducts });
});

// ─── GET /api/posts/:id/analytics ────────────────────────────────────────────
// Owner-only, server-verified post performance.
//
// Metric availability:
// - likes/reposts: always returned from durable interaction rows.
// - views: returned only after explicit `view` events have been recorded.
// - saves: current live saves from saved_items (`item_type = post`).
// - product clicks: explicit `shop_click` events.
// - conversions: non-cancelled orders whose source_post_id matches this post.
// - retention: average watch time only when valid `watch_time` samples exist.
//
// We intentionally do not derive views from feed delivery, infer completion
// rate without media duration, or fabricate unavailable values.
router.get("/:id/analytics", requireAuth, async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Post not found" });

  const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);

  // Deliberately return the same response for a missing post and another
  // seller's post so this endpoint never reveals ownership information.
  if (!post || post.userId !== ownerId) {
    return res.status(404).json({ error: "Post analytics not found" });
  }

  try {
    const [interactionRows, saveRows, conversionRows, watchRows] = await Promise.all([
      db
        .select({
          type: interactions.type,
          count: sql<number>`count(*)::int`,
          uniqueUsers: sql<number>`count(distinct ${interactions.userId})::int`,
        })
        .from(interactions)
        .where(and(
          eq(interactions.postId, id),
          inArray(interactions.type, ["like", "repost", "view", "shop_click"]),
        ))
        .groupBy(interactions.type),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(savedItems)
        .where(and(eq(savedItems.itemType, "post"), eq(savedItems.targetId, id))),
      db
        .select({
          count: sql<number>`count(*)::int`,
          revenueCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
        })
        .from(orders)
        .where(and(
          eq(orders.ownerId, ownerId),
          eq(orders.sourcePostId, id),
          sql`${orders.status} != 'cancelled'`,
        )),
      db
        .select({ value: interactions.value })
        .from(interactions)
        .where(and(eq(interactions.postId, id), eq(interactions.type, "watch_time"))),
    ]);

    const interactionsByType = new Map(
      interactionRows.map((row) => [
        row.type,
        { count: Number(row.count), uniqueUsers: Number(row.uniqueUsers) },
      ]),
    );
    const views = interactionsByType.get("view");
    const productClicks = interactionsByType.get("shop_click");
    const validWatchSeconds = watchRows
      .map((row) => Number(row.value))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const conversionCount = Number(conversionRows[0]?.count ?? 0);
    const productClickCount = productClicks?.count ?? 0;

    return res.json({
      post: {
        ...post,
        createdAt: post.createdAt.toISOString(),
      },
      metrics: {
        likes: interactionsByType.get("like")?.count ?? 0,
        reposts: interactionsByType.get("repost")?.count ?? 0,
        views: views
          ? { tracked: true, count: views.count, uniqueViewers: views.uniqueUsers }
          : { tracked: false, count: null, uniqueViewers: null },
        saves: {
          tracked: true,
          count: Number(saveRows[0]?.count ?? 0),
        },
        productClicks: {
          tracked: true,
          count: productClickCount,
          uniqueClickers: productClicks?.uniqueUsers ?? 0,
        },
        conversions: {
          tracked: true,
          orders: conversionCount,
          revenueCents: Number(conversionRows[0]?.revenueCents ?? 0),
          rate: productClickCount > 0 ? conversionCount / productClickCount : null,
        },
        retention: validWatchSeconds.length > 0
          ? {
              tracked: true,
              sampleCount: validWatchSeconds.length,
              averageWatchTimeSeconds:
                validWatchSeconds.reduce((sum, seconds) => sum + seconds, 0) /
                validWatchSeconds.length,
            }
          : {
              tracked: false,
              sampleCount: 0,
              averageWatchTimeSeconds: null,
            },
      },
    });
  } catch (err) {
    req.log.error({ err, ownerId, postId: id }, "Failed to load post analytics");
    return res.status(500).json({ error: "Failed to load post analytics" });
  }
});

// ─── GET /api/posts/:id ──────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Post not found" });

  const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  if (!post) return res.status(404).json({ error: "Post not found" });

  const [sellerRows, tags, likeRows, repostRows] = await Promise.all([
    db.select({ displayName: users.displayName, brandName: users.brandName, verified: users.verified })
      .from(users).where(eq(users.clerkId, post.userId)).limit(1),
    db.select({
      productId: postTaggedProducts.productId,
      position:  postTaggedProducts.position,
      name:      products.name,
      images:    products.images,
    }).from(postTaggedProducts)
      .leftJoin(products, eq(products.id, postTaggedProducts.productId))
      .where(eq(postTaggedProducts.postId, id))
      .orderBy(postTaggedProducts.position),
    db.select({ count: count() }).from(interactions)
      .where(and(eq(interactions.postId, id), eq(interactions.type, "like"))),
    db.select({ count: count() }).from(interactions)
      .where(and(eq(interactions.postId, id), eq(interactions.type, "repost"))),
  ]);

  return res.json({
    ...post,
    seller:       sellerRows[0] ?? null,
    taggedProducts: tags,
    likeCount:    likeRows[0]?.count   ?? 0,
    repostCount:  repostRows[0]?.count ?? 0,
  });
});

// ─── POST /api/posts/:id/interact ────────────────────────────────────────────
router.post("/:id/interact", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { id } = req.params;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return res.status(404).json({ error: "Post not found" });
  }
  const { type, value } = req.body as {
    type: "like" | "repost" | "view" | "watch_time" | "shop_click";
    value?: string;
  };

  if (!["like", "repost", "view", "watch_time", "shop_click"].includes(type)) {
    return res.status(400).json({
      error: "type must be like, repost, view, watch_time, or shop_click",
    });
  }

  if (type === "view" || type === "watch_time" || type === "shop_click") {
    await db.insert(interactions).values({ userId: clerkId, postId: id, type, value: value ?? null });
    return res.json({ action: "recorded" });
  }

  // Toggle for like / repost
  const [existing] = await db
    .select({ id: interactions.id })
    .from(interactions)
    .where(and(eq(interactions.userId, clerkId), eq(interactions.postId, id), eq(interactions.type, type)))
    .limit(1);

  let action: string;
  if (existing) {
    await db.delete(interactions).where(eq(interactions.id, existing.id));
    action = "removed";
  } else {
    await db.insert(interactions).values({ userId: clerkId, postId: id, type, value: null });
    action = "added";
  }

  const [{ count: newCount }] = await db
    .select({ count: count() })
    .from(interactions)
    .where(and(eq(interactions.postId, id), eq(interactions.type, type)));

  return res.json({ action, count: newCount });
});

export default router;
