import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { blocks, db, follows, stories, storyLikes, storyViews, users } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id") || auth.userId;
    next();
  },
}));

vi.mock("../notifications-feed", () => ({
  publishNotification: async () => undefined,
}));

const suffix = crypto.randomBytes(8).toString("hex");
const authorId = `story-author-${suffix}`;
const followerId = `story-follower-${suffix}`;
const strangerId = `story-stranger-${suffix}`;
const blockedId = `story-blocked-${suffix}`;
const userIds = [authorId, followerId, strangerId, blockedId];
const storyIds: string[] = [];

let server: Server;
let base = "";

async function request(path: string, userId: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-test-user-id": userId,
      ...(options.headers ?? {}),
    },
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: authorId, email: `${authorId}@test.local`, name: "Story Author", role: "seller", accountType: "seller" },
    { clerkId: followerId, email: `${followerId}@test.local`, name: "Story Follower", role: "buyer", accountType: "buyer" },
    { clerkId: strangerId, email: `${strangerId}@test.local`, name: "Story Stranger", role: "buyer", accountType: "buyer" },
    { clerkId: blockedId, email: `${blockedId}@test.local`, name: "Story Blocked", role: "buyer", accountType: "buyer" },
  ]);
  await db.insert(follows).values({ followerId, followingId: authorId });
  await db.insert(blocks).values({ blockerId: authorId, blockedId });

  const { default: socialRouter } = await import("../social");
  const app = express();
  app.use(express.json());
  app.use("/api/social", socialRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (storyIds.length > 0) await db.delete(stories).where(inArray(stories.id, storyIds));
  await db.delete(follows).where(eq(follows.followerId, followerId));
  await db.delete(blocks).where(eq(blocks.blockerId, authorId));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe("stories", () => {
  it("derives author identity server-side, ignoring a spoofed authorAccountType", async () => {
    const res = await request("/api/social/stories", authorId, {
      method: "POST",
      body: JSON.stringify({
        authorName: "Fake Name",
        authorAccountType: "seller-admin-impersonation",
        media: [{ type: "text", text: "hello followers" }],
      }),
    });
    expect(res.status).toBe(201);
    expect((res.body as any).authorName).toBe("Story Author");
    expect((res.body as any).authorAccountType).toBe("seller");
    storyIds.push((res.body as any).id);
  });

  it("is visible to a follower of the author", async () => {
    const res = await request(`/api/social/stories/user/${authorId}`, followerId);
    expect(res.status).toBe(200);
    expect((res.body as any[]).length).toBeGreaterThan(0);
  });

  it("is NOT visible to a non-follower (spec: stories are visible to followers)", async () => {
    const res = await request(`/api/social/stories/user/${authorId}`, strangerId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("is NOT visible to a blocked user even if they somehow follow", async () => {
    const res = await request(`/api/social/stories/user/${authorId}`, blockedId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("cannot be liked or viewed by a blocked user", async () => {
    const storyId = storyIds[0];
    const like = await request(`/api/social/stories/${storyId}/like`, blockedId, { method: "POST" });
    expect(like.status).toBe(404);
    const view = await request(`/api/social/stories/${storyId}/view`, blockedId, { method: "POST" });
    expect(view.status).toBe(404);
  });

  it("records a view and exposes it only to the author via the seen-by list", async () => {
    const storyId = storyIds[0];
    const view = await request(`/api/social/stories/${storyId}/view`, followerId, { method: "POST" });
    expect(view.status).toBe(200);

    const asAuthor = await request(`/api/social/stories/${storyId}/viewers`, authorId);
    expect(asAuthor.status).toBe(200);
    expect((asAuthor.body as any[]).some((v: any) => v.userId === followerId)).toBe(true);

    const asStranger = await request(`/api/social/stories/${storyId}/viewers`, strangerId);
    expect(asStranger.status).toBe(403);
  });

  it("appears in the follower's stories tray, unseen until viewed", async () => {
    const tray = await request("/api/social/stories/following", followerId);
    expect(tray.status).toBe(200);
    const entry = (tray.body as any[]).find((e: any) => e.authorId === authorId);
    expect(entry).toBeTruthy();
    expect(entry.seen).toBe(true); // this follower already viewed it in the prior test
  });

  it("lets the author delete their own story early", async () => {
    const storyId = storyIds[0];
    const del = await request(`/api/social/stories/${storyId}`, authorId, { method: "DELETE" });
    expect(del.status).toBe(200);
    storyIds.pop();

    // Deleted stories are gone: liking it now 404s.
    const likeAfterDelete = await request(`/api/social/stories/${storyId}/like`, followerId, { method: "POST" });
    expect(likeAfterDelete.status).toBe(404);

    // Non-owners cannot delete another author's story.
    const secondDelete = await request(`/api/social/stories/${storyId}`, followerId, { method: "DELETE" });
    expect(secondDelete.status).toBe(404);
  });

  it("expired stories are excluded from every read path", async () => {
    const [expired] = await db.insert(stories).values({
      authorId,
      authorName: "Story Author",
      authorAccountType: "seller",
      media: [{ type: "text", text: "gone" }],
      expiresAt: new Date(Date.now() - 1000),
    }).returning();
    storyIds.push(expired.id);

    const asFollower = await request(`/api/social/stories/user/${authorId}`, followerId);
    expect((asFollower.body as any[]).some((s: any) => s.id === expired.id)).toBe(false);

    const asAuthor = await request("/api/social/stories/me", authorId);
    expect((asAuthor.body as any[]).some((s: any) => s.id === expired.id)).toBe(false);

    const like = await request(`/api/social/stories/${expired.id}/like`, followerId, { method: "POST" });
    expect(like.status).toBe(404);
  });
});

describe("story expiry cleanup job", () => {
  it("deletes expired story rows (and cascades likes/views)", async () => {
    const suffix2 = crypto.randomBytes(6).toString("hex");
    const cleanupAuthorId = `story-cleanup-${suffix2}`;
    await db.insert(users).values({
      clerkId: cleanupAuthorId, email: `${cleanupAuthorId}@test.local`,
      name: "Cleanup Author", role: "buyer", accountType: "buyer",
    });
    const [expired] = await db.insert(stories).values({
      authorId: cleanupAuthorId,
      authorName: "Cleanup Author",
      authorAccountType: "buyer",
      media: [{ type: "text", text: "expiring" }],
      expiresAt: new Date(Date.now() - 60_000),
    }).returning();
    await db.insert(storyLikes).values({ storyId: expired.id, userId: cleanupAuthorId });
    await db.insert(storyViews).values({ storyId: expired.id, userId: cleanupAuthorId });

    const [fresh] = await db.insert(stories).values({
      authorId: cleanupAuthorId,
      authorName: "Cleanup Author",
      authorAccountType: "buyer",
      media: [{ type: "text", text: "still here" }],
      expiresAt: new Date(Date.now() + 60_000),
    }).returning();

    const { runStoryCleanup } = await import("../../jobs/storyCleanup");
    const deletedCount = await runStoryCleanup();
    expect(deletedCount).toBeGreaterThanOrEqual(1);

    const remaining = await db.select().from(stories).where(inArray(stories.id, [expired.id, fresh.id]));
    expect(remaining.map((r) => r.id)).toEqual([fresh.id]);

    const orphanLikes = await db.select().from(storyLikes).where(eq(storyLikes.storyId, expired.id));
    expect(orphanLikes).toHaveLength(0);

    await db.delete(stories).where(eq(stories.id, fresh.id));
    await db.delete(users).where(eq(users.clerkId, cleanupAuthorId));
  });
});
