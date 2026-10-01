/**
 * Automatic media screening against the real development database: flagged
 * post images are held (author-only, queued for moderators), hard-rejected
 * images return 422 IMAGE_REJECTED, held stories never reach other viewers,
 * and the moderator queue approves / removes held items.
 *
 * Only the Clerk boundary, object storage and the moderation provider are mocked.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { db, follows, mediaModerationResults, posts, reports, stories, users } from "@workspace/db";
import { setMediaModerationProvider } from "../../lib/mediaModeration";

vi.mock("../../middlewares/requireAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/requireAuth")>();
  return {
    ...actual,
    requireAuth: (req: any, res: any, next: () => void) => {
      const userId = req.header("x-test-user-id");
      if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
      req.clerkUserId = userId;
      next();
    },
  };
});
vi.mock("@clerk/express", () => ({
  getAuth: (req: any) => ({ userId: req.header?.("x-test-user-id") || null, sessionId: null }),
  clerkClient: { users: { banUser: async () => undefined, unbanUser: async () => undefined } },
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async trySetObjectEntityAclPolicy(path: string) { return path; }
    async getObjectEntityDownloadURL(path: string) { return `https://signed.test/${encodeURIComponent(path)}`; }
  },
}));
vi.mock("../notifications-feed", () => ({ publishNotification: async () => undefined }));

const RUN = `mm${crypto.randomBytes(5).toString("hex")}`;
const AUTHOR = `${RUN}_author`;
const VIEWER = `${RUN}_viewer`;
const ADMIN = `${RUN}_admin`;
let server: Server;
let base = "";

async function call(path: string, options: { method?: string; user?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.user) headers["x-test-user-id"] = options.user;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? "GET", headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) as any };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: AUTHOR, email: `${AUTHOR}@example.test`, name: `Author ${RUN}`, displayName: `Author ${RUN}`, accountType: "buyer", role: "buyer", username: `${RUN}a` },
    { clerkId: VIEWER, email: `${VIEWER}@example.test`, name: `Viewer ${RUN}`, displayName: `Viewer ${RUN}`, accountType: "buyer", role: "buyer", username: `${RUN}v` },
    { clerkId: ADMIN, email: `${ADMIN}@example.test`, name: "Moderator", accountType: "buyer", role: "admin" },
  ]);
  await db.insert(follows).values({ followerId: VIEWER, followingId: AUTHOR });
  const { default: postsRouter } = await import("../posts");
  const { default: socialRouter } = await import("../social");
  const { default: moderationRouter } = await import("../moderation");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: () => {}, warn: () => {}, info: () => {} }; next(); });
  app.use("/api/posts", postsRouter);
  app.use("/api/social", socialRouter);
  app.use("/api/moderation", moderationRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => setMediaModerationProvider());

afterAll(async () => {
  const ids = [AUTHOR, VIEWER, ADMIN];
  await db.delete(mediaModerationResults).where(inArray(mediaModerationResults.ownerId, ids));
  await db.delete(reports).where(inArray(reports.targetOwnerId, ids));
  await db.delete(stories).where(inArray(stories.authorId, ids));
  await db.delete(posts).where(eq(posts.userId, AUTHOR));
  await db.delete(follows).where(inArray(follows.followerId, ids));
  await db.delete(users).where(like(users.clerkId, `${RUN}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("media screening on create", () => {
  it("holds a flagged post image and queues it for moderators", async () => {
    setMediaModerationProvider(async () => ({ flags: { sexual: true }, scores: { sexual: 0.8 } }));
    const created = await call("/api/posts", {
      method: "POST", user: AUTHOR,
      body: { mediaUrl: "https://cdn.test/held.jpg", mediaType: "photo", caption: "new fit" },
    });
    expect(created.status).toBe(201);
    expect(created.body.moderationStatus).toBe("held");
    expect(created.body.moderation.status).toBe("held");

    const queue = await call("/api/moderation/held?type=post", { user: ADMIN });
    const item = queue.body.items.find((i: any) => i.id === created.body.id);
    expect(item.moderation).toMatchObject({ verdict: "hold", categories: ["sexual"] });

    const approved = await call(`/api/moderation/held/post/${created.body.id}/approve`, { method: "POST", user: ADMIN });
    expect(approved.status).toBe(200);
    const [row] = await db.select().from(posts).where(eq(posts.id, created.body.id));
    expect(row.moderationStatus).toBe("visible");
  });

  it("rejects clear violations with 422 IMAGE_REJECTED", async () => {
    setMediaModerationProvider(async () => ({ flags: { "violence/graphic": true }, scores: { "violence/graphic": 0.95 } }));
    const res = await call("/api/posts", {
      method: "POST", user: AUTHOR, body: { mediaUrl: "https://cdn.test/gore.jpg", mediaType: "photo" },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("IMAGE_REJECTED");
    const [flag] = await db.select().from(mediaModerationResults).where(eq(mediaModerationResults.ownerId, AUTHOR));
    expect(flag.priority).toBe("high");
  });

  it("hides a held story from followers but not its author", async () => {
    setMediaModerationProvider(async () => ({ flags: { sexual: true }, scores: { sexual: 0.8 } }));
    const created = await call("/api/social/stories", {
      method: "POST", user: AUTHOR, body: { media: [{ type: "image", uri: "https://cdn.test/story.jpg" }] },
    });
    expect(created.status).toBe(201);
    expect(created.body.moderation.status).toBe("held");
    expect((await call(`/api/social/stories/user/${AUTHOR}`, { user: VIEWER })).body).toHaveLength(0);
    expect((await call("/api/social/stories/me", { user: AUTHOR })).body.length).toBeGreaterThan(0);

    const counts = await call("/api/moderation/held/counts", { user: ADMIN });
    expect(counts.body.stories).toBeGreaterThan(0);
    const approved = await call(`/api/moderation/held/story/${created.body.id}/approve`, { method: "POST", user: ADMIN });
    expect(approved.status).toBe(200);
    expect((await call(`/api/social/stories/user/${AUTHOR}`, { user: VIEWER })).body.length).toBeGreaterThan(0);
  });

  it("does nothing when screening is off (no provider, no AI env)", async () => {
    const res = await call("/api/posts", {
      method: "POST", user: AUTHOR, body: { mediaUrl: "https://cdn.test/fine.jpg", mediaType: "photo" },
    });
    expect(res.status).toBe(201);
    expect(res.body.moderationStatus).toBe("visible");
  });
});
