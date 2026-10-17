import { db, pool, posts } from "@workspace/db";
import { eq } from "drizzle-orm";
import { normalizeFeedVideoPath, createFeedVideoPoster } from "../src/lib/feedVideoEncoding";
import { publishComposedMedia } from "../src/routes/post-video";
import { feedStreamMasterPath } from "../src/lib/feedVideoRenditions";

async function main() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("This backfill is development-only.");
  }
  const rows = await db.select().from(posts).where(eq(posts.mediaType, "video"));
  let changed = 0;
  for (const post of rows) {
    const old = post.mediaUrl.match(/\/api\/(?:v1\/)?posts\/media\/(uploads\/[A-Za-z0-9._/-]+)$/)?.[1];
    if (!old) { console.log(JSON.stringify({ id: post.id, skipped: "Not an owned uploaded video" })); continue; }
    const oldPath = `/objects/${old}`;
    const path = await normalizeFeedVideoPath(oldPath, post.userId);
    // Imported posters were extracted at t=0; an opening fade can be entirely
    // black. Replace only the importer's automatic covers, never user covers.
    if (post.userId === "brandthread-official" && post.thumbnailUrl?.includes("/official-starter/")) {
      const poster = await createFeedVideoPoster(path, post.userId);
      if (post.postStatus === "published" && post.visibility?.isPublic !== false) await publishComposedMedia(post.userId, [poster]);
      await db.update(posts).set({
        thumbnailUrl: `${new URL(post.mediaUrl).origin}/api/posts/media/${poster.slice("/objects/".length)}`,
      }).where(eq(posts.id, post.id));
    }
    if (path !== oldPath) {
      const url = `${new URL(post.mediaUrl).origin}/api/posts/media/${path.slice("/objects/".length)}`;
      if (post.postStatus === "published" && post.visibility?.isPublic !== false) {
        await publishComposedMedia(post.userId, [path]);
      }
      await db.update(posts).set({
        mediaUrl: url, mediaUrls: [url],
        videoHlsUrl: `${new URL(post.mediaUrl).origin}/api/posts/media/${feedStreamMasterPath(path)!.slice("/objects/".length)}`,
        videoHlsStatus: "ready",
        slides: post.slides?.map(slide => slide.path === oldPath ? { ...slide, path, url } : slide),
      }).where(eq(posts.id, post.id));
      changed++;
    }
    console.log(JSON.stringify({ id: post.id, compliant: true, reencoded: path !== oldPath }));
  }
  console.log(JSON.stringify({ checked: rows.length, reencoded: changed }));
}
main().then(() => pool.end()).catch(async err => { console.error(err); await pool.end(); process.exitCode = 1; });
