/**
 * People tags from caption @handles: creating a post / editing its caption
 * syncs post_user_tags (not self, not blocked, not missing), the Tagged tab
 * shows the post, and tagged people get one post_tag notification once the
 * post is live (published + visible).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, or } from "drizzle-orm";
import { blocks, db, follows, notificationsFeed, postUserTags, posts, users } from "@workspace/db";

const spies = vi.hoisted(() => ({ push: vi.fn(async () => undefined) }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const uid = req.header("x-test-user-id");
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = uid;
    next();
  },
}));
vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return { ...actual, sendPushToUser: spies.push };
});

const suffix = crypto.randomBytes(5).toString("hex");
const handle = (n: string) => `pt_${n}_${suffix}`;
const author = `pt-author-${suffix}`;
const ana = `pt-ana-${suffix}`;
const ben = `pt-ben-${suffix}`;
const cy = `pt-cy-${suffix}`;
const blocker = `pt-blocker-${suffix}`;
const priv = `pt-priv-${suffix}`;
const viewer = `pt-viewer-${suffix}`;
const userIds = [author, ana, ben, cy, blocker, priv, viewer];
let server: Server;
let base = "";

async function call(method: string, urlPath: string, userId?: string, body?: unknown) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

async function tagsOf(postId: string) {
  const rows = await db.select({ id: postUserTags.taggedUserId }).from(postUserTags).where(eq(postUserTags.postId, postId));
  return rows.map((r) => r.id).sort();
}

async function tagNotifications(postId: string) {
  const rows = await db.select({ userId: notificationsFeed.userId }).from(notificationsFeed)
    .where(and(eq(notificationsFeed.type, "post_tag"), eq(notificationsFeed.targetId, postId)));
  return rows.map((r) => r.userId).sort();
}

function u(clerkId: string, name: string, extra: Record<string, unknown> = {}) {
  return { clerkId, email: `${clerkId}@t.local`, name, username: handle(name.toLowerCase()), role: "seller", accountType: "seller", ...extra } as any;
}

beforeAll(async () => {
  await db.insert(users).values([
    u(author, "Author"),
    u(ana, "Ana", { role: "buyer", accountType: "buyer" }),
    u(ben, "Ben", { role: "buyer", accountType: "buyer" }),
    u(cy, "Cy", { role: "buyer", accountType: "buyer" }),
    u(blocker, "Blocker", { role: "buyer", accountType: "buyer" }),
    u(priv, "Priv", { role: "buyer", accountType: "buyer", isPrivate: true }),
    u(viewer, "Viewer", { role: "buyer", accountType: "buyer" }),
  ]);
  await db.insert(blocks).values({ blockerId: blocker, blockedId: author });

  const [{ default: postsRouter }, { default: socialRouter }] = await Promise.all([import("../posts"), import("../social")]);
  const app = express();
  app.use(express.json());
  app.use("/api/posts", postsRouter);
  app.use("/api/social", socialRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  const ids = (await db.select({ id: posts.id }).from(posts).where(eq(posts.userId, author))).map((r) => r.id);
  if (ids.length) {
    await db.delete(notificationsFeed).where(inArray(notificationsFeed.targetId, ids));
    await db.delete(postUserTags).where(inArray(postUserTags.postId, ids));
  }
  await db.delete(posts).where(eq(posts.userId, author));
  await db.delete(follows).where(or(inArray(follows.followerId, userIds), inArray(follows.followingId, userIds)));
  await db.delete(blocks).where(inArray(blocks.blockerId, userIds));
  await db.delete(users).where(inArray(users.clerkId, userIds));
});

describe("caption @handles become people tags", () => {
  let postId = "";

  it("tags valid accounts on create (not self, blocked or unknown) and notifies them", async () => {
    const created = await call("POST", "/api/posts", author, {
      mediaUrl: "https://img.test/tag.jpg",
      caption: `With @${handle("ana")} and @${handle("BEN")} @${handle("author")} @${handle("blocker")} @nobody_${suffix} @${handle("ana")}`,
    });
    expect(created.status).toBe(201);
    postId = created.body.id;
    expect(await tagsOf(postId)).toEqual([ana, ben].sort());
    expect(await tagNotifications(postId)).toEqual([ana, ben].sort());
  });

  it("shows the post on the tagged person's Tagged tab", async () => {
    const res = await call("GET", `/api/social/profile/${ana}/tagged`, viewer);
    expect(res.status).toBe(200);
    expect(res.body.map((r: any) => r.id)).toContain(postId);
  });

  it("syncs add/remove on caption edit and only notifies the newly tagged", async () => {
    const res = await call("PATCH", `/api/posts/${postId}`, author, { caption: `Now @${handle("ben")} and @${handle("cy")}` });
    expect(res.status).toBe(200);
    expect(await tagsOf(postId)).toEqual([ben, cy].sort());
    const notified = await tagNotifications(postId);
    expect(notified.filter((id) => id === ben)).toHaveLength(1);
    expect(notified).toContain(cy);
    // Idempotent: the same caption again changes nothing.
    await call("PATCH", `/api/posts/${postId}`, author, { caption: `Now @${handle("ben")} and @${handle("cy")}` });
    expect(await tagsOf(postId)).toEqual([ben, cy].sort());
    expect((await tagNotifications(postId)).filter((id) => id === cy)).toHaveLength(1);
  });

  it("tags a draft without notifying until it goes live", async () => {
    const created = await call("POST", "/api/posts", author, {
      mediaUrl: "https://img.test/draft.jpg",
      caption: `Draft with @${handle("cy")}`,
      isDraft: true,
    });
    expect(created.status).toBe(201);
    const draftId = created.body.id;
    expect(created.body.postStatus).toBe("draft");
    expect(await tagsOf(draftId)).toEqual([cy]);
    expect(await tagNotifications(draftId)).toEqual([]);
    const live = await call("POST", `/api/posts/${draftId}/publish-now`, author);
    expect(live.status).toBe(200);
    expect(await tagNotifications(draftId)).toEqual([cy]);
  });

  it("keeps a private account's Tagged tab for approved followers only", async () => {
    const created = await call("POST", "/api/posts", author, { mediaUrl: "https://img.test/p.jpg", caption: `Hi @${handle("priv")}` });
    expect(await tagsOf(created.body.id)).toEqual([priv]);
    const stranger = await call("GET", `/api/social/profile/${priv}/tagged`, viewer);
    expect(stranger.body).toEqual([]);
    const own = await call("GET", `/api/social/profile/${priv}/tagged`, priv);
    expect(own.body.map((r: any) => r.id)).toContain(created.body.id);
  });
});
