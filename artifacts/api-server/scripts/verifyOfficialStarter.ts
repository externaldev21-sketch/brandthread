import { createHash } from "node:crypto";
import { db, pool, posts } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { OFFICIAL_ACCOUNT_CLERK_ID } from "../src/lib/officialSeed/config";
import { planOfficialSeed } from "../src/lib/officialSeed/service";

async function main() {
  if (process.env.NODE_ENV !== "development") throw new Error("Development verification only.");
  const rows = await db.select().from(posts).where(eq(posts.userId, OFFICIAL_ACCOUNT_CLERK_ID))
    .orderBy(asc(posts.createdAt), asc(posts.id));
  if (rows.length !== 12) throw new Error(`Expected 12 official posts, found ${rows.length}`);
  if (rows.filter(p => p.mediaType === "video").length !== 10) throw new Error("Expected ten videos.");
  const urls = new Set<string>();
  for (const post of rows) {
    if (post.moderationStatus !== "visible" || post.postStatus !== "published") throw new Error(`Not live: ${post.id}`);
    if (post.mediaType === "slideshow" && post.mediaUrls?.length !== 6) throw new Error(`Not six slides: ${post.id}`);
    for (const url of [...post.mediaUrls ?? [], post.thumbnailUrl].filter(Boolean)) urls.add(url!);
  }
  for (const url of urls) {
    const checksum = new URL(url).pathname.match(/\/(?:official-starter|feed-video-posters)\/(?:[a-f0-9]{16}\/)?([a-f0-9]{64})\./)?.[1];
    if (!checksum) throw new Error("A placeholder or non-imported media URL was found.");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Media returned HTTP ${response.status}: ${new URL(url).pathname}`);
    if (response.headers.get("cross-origin-resource-policy") !== "cross-origin") throw new Error("Media embedding is blocked.");
    const actual = createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
    if (actual !== checksum) throw new Error("Stored bytes do not match imported media.");
  }
  const seed = await planOfficialSeed({
    viewerId: OFFICIAL_ACCOUNT_CLERK_ID, preview: true, organicIds: [], exclude: [],
    cursor: { position: 0, lastOfficialPosition: 0 }, isLastPage: true,
  });
  if (!seed.seeding || seed.items[0]?.type !== "official" || seed.items[0].post.id !== rows[0].id) {
    throw new Error("The real starter planner did not put video 01 first.");
  }
  console.log(JSON.stringify({
    posts: rows.length, videos: 10, carousels: 2, mediaObjectsVerified: urls.size,
    firstSeededPost: rows[0].id, every: seed.every,
  }));
}
main().then(() => pool.end()).catch(async error => {
  console.error(error); await pool.end(); process.exitCode = 1;
});
