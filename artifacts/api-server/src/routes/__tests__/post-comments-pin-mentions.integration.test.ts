import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import {
  blocks, commentMentions, db, notificationsFeed, postCommentLikes, postComments, posts, users,
} from "@workspace/db";

const published = vi.hoisted(() => ({ calls: [] as any[] }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const who = req.header("x-test-user-id");
    if (!who) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = who;
    next();
  },
}));
vi.mock("../../middlewares/rateLimit", () => ({ rateLimit: () => (_q: any, _s: any, next: () => void) => next() }));
vi.mock("../../lib/safety", async (orig) => {
  const actual: any = await orig();
  return { ...actual, optionalViewerId: (req: any) => req.header("x-test-user-id") || null };
});
vi.mock("../notifications-feed", () => ({
  // Mirrors the real publisher closely enough for the pin dedupe check.
  publishNotification: async (n: any) => {
    published.calls.push(n);
    const { db: d, notificationsFeed: nf } = await import("@workspace/db");
    await d.insert(nf).values({
      userId: n.userId, category: n.category, type: n.type, title: n.title, body: n.body ?? "",
      targetId: n.targetId ?? null, targetType: n.targetType ?? null, commentId: n.commentId ?? null,
    });
  },
}));

const suffix = crypto.randomBytes(6).toString("hex");
const id = (n: string) => `pc-${n}-${suffix}`;
const owner = id("owner");
const alice = id("alice");
const bob = id("bob");
const carol = id("carol");
const blockedUser = id("blocked");
const gone = id("gone");
const suspended = id("susp");
const userIds = [owner, alice, bob, carol, blockedUser, gone, suspended];
const h = (u: string) => u.replace(/-/g, "_");

let server: Server;
let base = "";
let postId = "";

async function call(path: string, userId: string | null, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}
const comment = (who: string, text: string, parentId?: string) =>
  call(`/api/posts/${postId}/comments`, who, "POST", { body: text, parentId });
const list = (who: string | null) => call(`/api/posts/${postId}/comments`, who);
const pin = (commentId: string, who: string | null, method = "POST") =>
  call(`/api/posts/${postId}/comments/${commentId}/pin`, who, method);
const notes = (userId: string, type: string) => published.calls.filter((c) => c.userId === userId && c.type === type);

beforeAll(async () => {
  const mk = (clerkId: string, extra: Record<string, unknown> = {}) => ({
    clerkId, email: `${clerkId}@t.local`, name: clerkId, username: h(clerkId), role: "buyer", accountType: "buyer", ...extra,
  });
  await db.insert(users).values([
    mk(owner), mk(alice), mk(bob), mk(carol), mk(blockedUser),
    mk(gone, { deletedAt: new Date() }), mk(suspended, { suspendedAt: new Date() }),
  ] as any);
  await db.insert(blocks).values({ blockerId: alice, blockedId: blockedUser });
  const [p] = await db.insert(posts).values({
    userId: owner, mediaUrl: `https://cdn.test/${suffix}.jpg`, mediaType: "image", postStatus: "published",
  }).returning({ id: posts.id });
  postId = p.id;
  const { default: router } = await import("../post-comments");
  const app = express();
  app.use(express.json());
  app.use("/api/posts", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, userIds));
  await db.delete(posts).where(eq(posts.id, postId));
  await db.delete(blocks).where(inArray(blocks.blockerId, userIds));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

beforeEach(() => { published.calls.length = 0; });

describe("pinned comments", () => {
  let oldest = "";
  let newer = "";
  let reply = "";

  it("owner-only, top-level only", async () => {
    oldest = (await comment(alice, "first!")).body.comment.id;
    await new Promise((r) => setTimeout(r, 20));
    newer = (await comment(bob, "second")).body.comment.id;
    reply = (await comment(carol, "a reply", oldest)).body.comment.id;
    await comment(carol, "third");

    expect((await pin(oldest, alice)).status).toBe(403);
    expect((await pin(oldest, null)).status).toBe(401);
    expect((await pin(reply, owner)).status).toBe(400);
    expect((await pin(crypto.randomUUID(), owner)).status).toBe(404);
    expect((await pin(oldest, alice, "DELETE")).status).toBe(403);
  });

  it("pinned comment leads the list even if oldest; flags are set", async () => {
    expect((await pin(oldest, owner)).status).toBe(200);
    const view = await list(null);
    expect(view.body.comments[0].id).toBe(oldest);
    expect(view.body.comments[0].pinned).toBe(true);
    expect(view.body.comments.slice(1).every((c: any) => c.pinned === false)).toBe(true);
    expect(view.body.comments).toHaveLength(3);
    expect(view.body.isPostOwner).toBe(false);
    expect((await list(owner)).body.isPostOwner).toBe(true);
    await vi.waitFor(() => expect(notes(alice, "comment_pinned")).toHaveLength(1));
    expect(notes(alice, "comment_pinned")[0].title).toBe("Your comment was pinned");
  });

  it("pinning another replaces the first; re-pinning does not notify twice", async () => {
    expect((await pin(newer, owner)).status).toBe(200);
    const view = await list(alice);
    expect(view.body.comments[0].id).toBe(newer);
    expect(view.body.comments.filter((c: any) => c.pinned)).toHaveLength(1);
    const rows = await db.select().from(postComments).where(eq(postComments.postId, postId));
    expect(rows.filter((r) => r.pinnedAt)).toHaveLength(1);

    await pin(oldest, owner);
    await pin(oldest, owner, "DELETE");
    await pin(oldest, owner);
    await new Promise((r) => setTimeout(r, 100));
    const feed = await db.select().from(notificationsFeed).where(eq(notificationsFeed.commentId, oldest));
    expect(feed.filter((r) => r.type === "comment_pinned")).toHaveLength(1);
  });

  it("unpin removes the marker", async () => {
    expect((await pin(oldest, owner, "DELETE")).body).toMatchObject({ pinned: false });
    const view = await list(null);
    expect(view.body.comments.some((c: any) => c.pinned)).toBe(false);
    expect(view.body.comments[0].id).not.toBe(oldest);
  });

  it("creatorLiked reflects the post owner's like only", async () => {
    await db.insert(postCommentLikes).values([
      { commentId: newer, userId: owner }, { commentId: oldest, userId: carol },
    ]);
    const view = await list(null);
    const byId = new Map<string, any>(view.body.comments.map((c: any) => [c.id, c]));
    expect(byId.get(newer).creatorLiked).toBe(true);
    expect(byId.get(oldest).creatorLiked).toBe(false);
    expect(byId.get(oldest).likesCount).toBe(1);
  });
});

describe("comment mentions", () => {
  it("resolves, persists and returns mentions; one notification per person", async () => {
    const parent = (await comment(bob, "hello")).body.comment.id;
    published.calls.length = 0;
    const res = await comment(alice, `@${h(bob)} and @${h(carol)} and @${h(carol)} again`, parent);
    expect(res.status).toBe(201);
    expect(res.body.comment.mentions.map((m: any) => m.userId).sort()).toEqual([bob, carol].sort());
    expect(res.body.comment.mentions[0]).toHaveProperty("handle");
    const rows = await db.select().from(commentMentions).where(eq(commentMentions.commentId, res.body.comment.id));
    expect(rows).toHaveLength(2);

    await vi.waitFor(() => expect(notes(carol, "mention")).toHaveLength(1));
    // bob is the reply target AND mentioned: exactly one notification (the reply).
    expect(notes(bob, "comment_reply")).toHaveLength(1);
    expect(notes(bob, "mention")).toHaveLength(0);
    expect(notes(owner, "post_comment").filter((c) => c.commentId === res.body.comment.id)).toHaveLength(1);

    const view = await list(null);
    const parentView = view.body.comments.find((c: any) => c.id === parent);
    expect(parentView.replies[0].mentions).toHaveLength(2);
  });

  it("drops self, blocked (either direction), deleted, suspended and unknown handles", async () => {
    const tokens = [h(alice), h(blockedUser), h(gone), h(suspended), `nobody_${suffix}`, h(carol)];
    const res = await comment(alice, tokens.map((x) => `@${x}`).join(" "));
    expect(res.status).toBe(201);
    expect(res.body.comment.mentions.map((m: any) => m.userId)).toEqual([carol]);
    // The blocked person mentioning their blocker is dropped as well.
    const res2 = await comment(blockedUser, `@${h(alice)} hi @${h(carol)}`);
    expect(res2.body.comment.mentions.map((m: any) => m.userId)).toEqual([carol]);
    await new Promise((r) => setTimeout(r, 100));
    expect(notes(blockedUser, "mention")).toHaveLength(0);
    expect(notes(alice, "mention")).toHaveLength(0);
    expect(notes(gone, "mention")).toHaveLength(0);
    expect(notes(suspended, "mention")).toHaveLength(0);
  });

  it("caps at 5 mentions", async () => {
    const extras = [1, 2, 3, 4, 5, 6].map((n) => id(`m${n}`));
    await db.insert(users).values(extras.map((clerkId) => ({
      clerkId, email: `${clerkId}@t.local`, name: clerkId, username: h(clerkId), role: "buyer", accountType: "buyer",
    })) as any);
    userIds.push(...extras);
    const res = await comment(alice, extras.map((x) => `@${h(x)}`).join(" "));
    expect(res.body.comment.mentions).toHaveLength(5);
    await vi.waitFor(() => expect(published.calls.filter((c) => c.type === "mention")).toHaveLength(5));
    expect(notes(extras[5], "mention")).toHaveLength(0);
  });
});
