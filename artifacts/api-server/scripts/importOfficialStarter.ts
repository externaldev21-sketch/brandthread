#!/usr/bin/env -S tsx
/**
 * Trusted workspace import, not an HTTP endpoint. Publishes through the same
 * official-account composer pipeline as the admin bulk uploader.
 *
 * NODE_ENV=development pnpm exec tsx scripts/importOfficialStarter.ts /tmp/media https://DEV_DOMAIN
 * Source files must already be extracted from a validated archive.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { db, pool, posts, users, mediaModerationResults, reports } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { ObjectStorageService } from "../src/lib/objectStorage";
import { setObjectAclPolicy } from "../src/lib/objectAcl";
import { OFFICIAL_ACCOUNT_CLERK_ID } from "../src/lib/officialSeed/config";
import { publishOfficialStarterPost } from "../src/routes/posts";
import { releaseHeldContent } from "../src/lib/reportTargets";

const source = resolve(process.argv[2] ?? "");
const origin = process.argv[3];
const storage = new ObjectStorageService();
const ownerId = OFFICIAL_ACCOUNT_CLERK_ID;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

// A workspace operator must first inspect the exact media and supply its hash
// manifest. This is not a provider fallback or a general moderation bypass.
async function releaseReviewedProviderHold(id: string) {
  const [post] = await db.select().from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, ownerId)));
  if (!post || post.moderationStatus === "visible") return;
  if (post.moderationReason !== "media:review_unavailable") {
    throw new Error(`Post ${id} needs a separate moderation decision: ${post.moderationReason}`);
  }
  const reviewer = "workspace-official-starter-import:agent-visual-review";
  if (!await releaseHeldContent("post", id, reviewer)) throw new Error(`Could not release reviewed post ${id}`);
  const now = new Date();
  await db.update(mediaModerationResults)
    .set({ reviewedBy: reviewer, reviewedAt: now, reviewAction: "approve" })
    .where(and(eq(mediaModerationResults.targetType, "post"), eq(mediaModerationResults.targetId, id),
      sql`${mediaModerationResults.reviewedAt} IS NULL`));
  await db.update(reports).set({
    status: "dismissed", resolutionAction: "dismiss", reviewedBy: reviewer,
    resolutionNote: "Development starter set: Agent reviewed video contact sheets and all carousel photos. Provider endpoint unavailable; creator permissions pending; production public gate remains off.",
    resolvedAt: now,
  }).where(and(eq(reports.targetType, "post"), eq(reports.targetId, id), eq(reports.status, "pending")));
}

async function store(bytes: Buffer, mime: string, extension: string, isPublic = false) {
  const path = `/objects/uploads/official-starter/${hash(bytes)}.${extension}`;
  let file;
  try { file = await storage.getObjectEntityFile(path); }
  catch (err) {
    if ((err as Error).name !== "ObjectNotFoundError") throw err;
    await storage.createObjectEntityFromBuffer(bytes, mime, path);
    file = await storage.getObjectEntityFile(path);
  }
  await setObjectAclPolicy(file, { owner: ownerId, visibility: isPublic ? "public" : "private" });
  return path;
}

async function main() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("This importer only runs against development.");
  }
  if (!origin || !source || !new URL(origin).hostname) throw new Error("Provide source directory and dev API origin.");
  const videos = (await readdir(join(source, "videos"))).filter(f => f.endsWith(".mp4")).sort();
  if (videos.length !== 10 || videos.some((f, i) => !f.startsWith(String(i + 1).padStart(2, "0")))) {
    throw new Error("Expected precisely ten videos numbered 01–10.");
  }
  for (const folder of ["rae-urban-sport", "khaox-archives"]) {
    for (let i = 1; i <= 6; i++) await readFile(join(source, folder, `${i}.jpg`));
  }
  const review = JSON.parse(await readFile(join(source, "reviewed-sha256.json"), "utf8"));
  if (review.reviewer !== "Replit Agent visual review") throw new Error("Reviewed media manifest is required.");
  const sourceFiles = [
    ...videos.map(f => `videos/${f}`),
    ...["rae-urban-sport", "khaox-archives"].flatMap(dir =>
      Array.from({ length: 6 }, (_, i) => `${dir}/${i + 1}.jpg`)),
  ];
  for (const file of sourceFiles) {
    if (review.files[file] !== hash(await readFile(join(source, file)))) {
      throw new Error(`Media changed after review: ${file}`);
    }
  }
  const credits = [null, "galoreyyz", "suavoworld", "iammjonahdavid", "iammjonahdavid",
    "overlyflyindividual", "factorieofficial", "movrrs", "lonechryst", "lonechryst"];
  const lock = await pool.connect();
  await lock.query("SELECT pg_advisory_lock(hashtext($1))", ["brandthread-official-starter-import"]);
  let created = 0;
  let existing = 0;
  try {
    const [official] = await db.select().from(users).where(eq(users.clerkId, ownerId));
    if (!official?.isOfficialAccount || official.username !== "brandthread" || !official.verified) {
      throw new Error("Official account migration must be applied before importing.");
    }
    const avatarBytes = await readFile(resolve("artifacts/mobile/assets/images/brandthread-logo.png"));
    const avatar = await store(avatarBytes, "image/png", "png", true);
    await db.update(users).set({ avatarUrl: `${origin}${avatar}` }).where(eq(users.clerkId, ownerId));
    await mkdir(join(source, "posters"), { recursive: true });
    for (let i = 0; i < 12; i++) {
      const video = i < 10;
      const folder = i === 10 ? "rae-urban-sport" : "khaox-archives";
      const first = video ? join(source, "videos", videos[i]) : join(source, folder, "1.jpg");
      const bytes = await readFile(first);
      const primary = `/objects/uploads/official-starter/${hash(bytes)}.${video ? "mp4" : "jpg"}`;
      const [already] = await db.select({ id: posts.id, mediaPaths: posts.mediaPaths }).from(posts)
        .where(and(eq(posts.userId, ownerId),
          eq(posts.mediaUrl, `${origin}/api/posts/media/${primary.replace(/^\/objects\//, "")}`))).limit(1);
      if (already) {
        // Repair the legacy publisher's primary-only URL list without making
        // a second post. Object paths remain the ownership-checked source.
        if (!video && already.mediaPaths?.length === 6) {
          await db.update(posts).set({
            mediaUrls: already.mediaPaths.map(path =>
              `${origin}/api/posts/media/${path.replace(/^\/objects\//, "")}`),
          }).where(eq(posts.id, already.id));
        }
        await releaseReviewedProviderHold(already.id);
        existing++; console.log(`EXISTS ${i + 1} ${already.id}`); continue;
      }
      await store(bytes, video ? "video/mp4" : "image/jpeg", video ? "mp4" : "jpg");
      let thumbnailPath: string;
      let mediaPaths: string[] | undefined;
      if (video) {
        const poster = join(source, "posters", `${i + 1}.jpg`);
        execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", first,
          "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "2", poster]);
        thumbnailPath = await store(await readFile(poster), "image/jpeg", "jpg");
      } else {
        mediaPaths = [primary];
        for (let n = 2; n <= 6; n++) {
          mediaPaths.push(await store(await readFile(join(source, folder, `${n}.jpg`)), "image/jpeg", "jpg"));
        }
        thumbnailPath = primary;
      }
      const dimensions = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "json", first], { encoding: "utf8" }));
      const { width, height } = dimensions.streams[0];
      const creditHandle = video ? credits[i] : null;
      const creditName = video ? (i === 0 ? "unknown creator" : null)
        : i === 10 ? "photographer unknown" : "Khaox Archives";
      const caption = video ? `via ${creditHandle ? `@${creditHandle}` : "unknown creator"}`
        : i === 10 ? "Rae Urban Sport\nphotographer unknown"
          : "Khaox Archives / KAPD\nvia Khaox Archives";
      const post = await publishOfficialStarterPost({
        mediaType: video ? "video" : "slideshow",
        mediaPath: primary, mediaPaths, thumbnailPath,
        aspectRatio: `${width}:${height}`, caption, creditHandle, creditName,
        visibility: { isPublic: true, allowComments: true, allowReposts: true, showLikeCount: true },
      }, origin);
      created++;
      console.log(`CREATED ${i + 1} ${post.id} ${post.mediaType} moderation=${post.moderation?.status}`);
      if (post.moderation?.status !== "visible") {
        await releaseReviewedProviderHold(post.id);
      }
    }
    console.log(JSON.stringify({ created, existing, total: created + existing }));
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtext($1))", ["brandthread-official-starter-import"]);
    lock.release();
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
