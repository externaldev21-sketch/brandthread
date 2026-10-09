import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  posts,
  products,
  reports,
  stories,
  storyArchive,
  storyHighlightItems,
  storyHighlights,
  storyMediaCleanup,
} from "@workspace/db";
import { ObjectNotFoundError } from "../../lib/objectStorage";
import { runStoryCleanup, storyMediaObjectPaths, storyObjectPath } from "../storyCleanup";

const RUN = crypto.randomBytes(5).toString("hex");
const AUTHOR = `story-media-${RUN}`;
const DAY = 24 * 60 * 60 * 1000;

const created = {
  stories: [] as string[], archive: [] as string[], posts: [] as string[], products: [] as string[],
  highlights: [] as string[], reports: [] as string[], paths: [] as string[],
};

function objectPath(): string {
  const path = `/objects/uploads/${crypto.randomUUID()}`;
  created.paths.push(path);
  return path;
}

async function insertStory(values: { media: unknown[]; expiresAt: Date; moderationStatus?: string }) {
  const [row] = await db.insert(stories).values({
    authorId: AUTHOR, authorName: "Story Media", authorAccountType: "buyer",
    media: values.media, expiresAt: values.expiresAt, moderationStatus: values.moderationStatus ?? "visible",
  }).returning({ id: stories.id });
  created.stories.push(row.id);
  return row.id;
}

function fakeStorage(impl?: (path: string) => Promise<void>) {
  return { deleteObjectEntity: vi.fn(impl ?? (async () => {})) };
}

async function queued(paths: string[]) {
  return db.select().from(storyMediaCleanup).where(inArray(storyMediaCleanup.objectPath, paths));
}

afterEach(async () => {
  if (created.stories.length) await db.delete(stories).where(inArray(stories.id, created.stories.splice(0)));
  if (created.archive.length) await db.delete(storyArchive).where(inArray(storyArchive.storyId, created.archive.splice(0)));
  if (created.posts.length) await db.delete(posts).where(inArray(posts.id, created.posts.splice(0)));
  if (created.products.length) await db.delete(products).where(inArray(products.id, created.products.splice(0)));
  if (created.highlights.length) await db.delete(storyHighlights).where(inArray(storyHighlights.id, created.highlights.splice(0)));
  if (created.reports.length) await db.delete(reports).where(inArray(reports.id, created.reports.splice(0)));
  if (created.paths.length) await db.delete(storyMediaCleanup).where(inArray(storyMediaCleanup.objectPath, created.paths.splice(0)));
});

describe("story media path extraction", () => {
  it("only maps our own /objects/ paths, never device, external or post-owned URLs", () => {
    expect(storyObjectPath("/objects/uploads/abcdef1234")).toBe("/objects/uploads/abcdef1234");
    expect(storyObjectPath("https://api.test/objects/uploads/abcdef1234?x=1")).toBe("/objects/uploads/abcdef1234");
    expect(storyObjectPath("https://api.test/api/posts/media/uploads/abcdef1234")).toBeNull();
    expect(storyObjectPath("file:///var/mobile/photo.jpg")).toBeNull();
    expect(storyObjectPath("https://cdn.example.com/a.jpg")).toBeNull();
    expect(storyObjectPath("/objects/x")).toBeNull();
    expect(storyObjectPath("/objects/uploads/../../secret")).toBeNull();
    expect(storyMediaObjectPaths([
      { imageUri: "/objects/uploads/aaaaaaaa1", overlays: [{ imageUri: "/objects/uploads/sticker123" }] },
      { url: "/objects/uploads/aaaaaaaa1", thumbnailUri: "/objects/uploads/bbbbbbbb2" },
    ])).toEqual(["/objects/uploads/aaaaaaaa1", "/objects/uploads/bbbbbbbb2"]);
  });
});

describe("story cleanup media deletion", () => {
  it("deletes media of expired, non-archived stories unless something else still references it", async () => {
    const now = new Date();
    const orphan = objectPath();
    const usedByPost = objectPath();
    const usedByProduct = objectPath();
    const usedByLiveStory = objectPath();
    const usedByHighlight = objectPath();

    const [post] = await db.insert(posts).values({ userId: AUTHOR, mediaUrl: `https://api.test/api/posts/media/${usedByPost.slice("/objects/".length)}` })
      .returning({ id: posts.id });
    created.posts.push(post.id);
    const [product] = await db.insert(products).values({ ownerId: AUTHOR, name: "Tee", images: [usedByProduct] } as any)
      .returning({ id: products.id });
    created.products.push(product.id);
    await insertStory({ media: [{ imageUri: usedByLiveStory }], expiresAt: new Date(now.getTime() + DAY) });
    const [highlight] = await db.insert(storyHighlights).values({ userId: AUTHOR, title: "H" }).returning({ id: storyHighlights.id });
    created.highlights.push(highlight.id);
    await db.insert(storyHighlightItems).values({ highlightId: highlight.id, media: [{ imageUri: usedByHighlight }] });

    const expiredId = await insertStory({
      moderationStatus: "removed",
      expiresAt: new Date(now.getTime() - 60_000),
      media: [
        { imageUri: orphan },
        { imageUri: usedByPost },
        { imageUri: usedByProduct },
        { imageUri: usedByLiveStory },
        { imageUri: usedByHighlight },
        { imageUri: "file:///device/photo.jpg" },
        { imageUri: "https://api.test/api/posts/media/uploads/not-ours-123" },
      ],
    });

    const storage = fakeStorage();
    await runStoryCleanup(now, storage);

    expect(storage.deleteObjectEntity.mock.calls.map((c) => c[0])).toEqual([orphan]);
    expect(await db.select().from(stories).where(eq(stories.id, expiredId))).toHaveLength(0);
    expect(await db.select().from(storyArchive).where(eq(storyArchive.storyId, expiredId))).toHaveLength(0);
    expect(await queued(created.paths)).toHaveLength(0);

    // Re-running is a no-op.
    await runStoryCleanup(now, storage);
    expect(storage.deleteObjectEntity).toHaveBeenCalledTimes(1);
  });

  it("archives visible stories and keeps their media", async () => {
    const now = new Date();
    const media = objectPath();
    const id = await insertStory({ media: [{ imageUri: media }], expiresAt: new Date(now.getTime() - 60_000) });
    created.archive.push(id);
    const storage = fakeStorage();
    await runStoryCleanup(now, storage);
    expect(storage.deleteObjectEntity).not.toHaveBeenCalled();
    const [archived] = await db.select().from(storyArchive).where(eq(storyArchive.storyId, id));
    expect(archived.media).toEqual([{ imageUri: media }]);
    expect(await queued([media])).toHaveLength(0);
  });

  it("keeps media of a removed story a moderator still has an open report on", async () => {
    const now = new Date();
    const media = objectPath();
    const id = await insertStory({ moderationStatus: "removed", media: [{ imageUri: media }], expiresAt: new Date(now.getTime() - 60_000) });
    const [report] = await db.insert(reports).values({ reporterId: `${AUTHOR}-r`, targetType: "story", targetId: id, reason: "spam" })
      .returning({ id: reports.id });
    created.reports.push(report.id);
    const storage = fakeStorage();
    await runStoryCleanup(now, storage);
    expect(storage.deleteObjectEntity).not.toHaveBeenCalled();
    expect(await queued([media])).toHaveLength(0);
  });

  it("deletes media of archive rows pruned after a year unless a highlight still uses it", async () => {
    const now = new Date();
    const orphan = objectPath();
    const inHighlight = objectPath();
    const storyId = crypto.randomUUID();
    created.archive.push(storyId);
    await db.insert(storyArchive).values({
      storyId, authorId: AUTHOR, media: [{ imageUri: orphan }, { imageUri: inHighlight }],
      storyCreatedAt: new Date(now.getTime() - 400 * DAY), archivedAt: new Date(now.getTime() - 400 * DAY),
    });
    const [highlight] = await db.insert(storyHighlights).values({ userId: AUTHOR, title: "Keep" }).returning({ id: storyHighlights.id });
    created.highlights.push(highlight.id);
    await db.insert(storyHighlightItems).values({ highlightId: highlight.id, storyId, media: [{ imageUri: inHighlight }] });

    const storage = fakeStorage();
    await runStoryCleanup(now, storage);
    expect(storage.deleteObjectEntity.mock.calls.map((c) => c[0])).toEqual([orphan]);
    expect(await db.select().from(storyArchive).where(eq(storyArchive.storyId, storyId))).toHaveLength(0);
    expect(await queued([orphan, inHighlight])).toHaveLength(0);
  });

  it("treats an already-missing object as deleted and retries other failures with back-off", async () => {
    const now = new Date();
    const missing = objectPath();
    const flaky = objectPath();
    await insertStory({
      moderationStatus: "held", media: [{ imageUri: missing }, { imageUri: flaky }], expiresAt: new Date(now.getTime() - 60_000),
    });

    const failing = fakeStorage(async (path) => {
      if (path === missing) throw new ObjectNotFoundError();
      throw new Error("storage unavailable");
    });
    await runStoryCleanup(now, failing);
    const left = await queued([missing, flaky]);
    expect(left.map((r) => r.objectPath)).toEqual([flaky]);
    expect(left[0].attemptCount).toBe(1);
    expect(left[0].claimedAt).toBeNull();
    expect(left[0].nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());

    // Not due yet: nothing is attempted.
    const ok = fakeStorage();
    await runStoryCleanup(now, ok);
    expect(ok.deleteObjectEntity).not.toHaveBeenCalled();

    await runStoryCleanup(new Date(now.getTime() + DAY), ok);
    expect(ok.deleteObjectEntity.mock.calls.map((c) => c[0])).toEqual([flaky]);
    expect(await queued([missing, flaky])).toHaveLength(0);
  });
});
