/**
 * App Store guideline 1.2 coverage against the real development database:
 * comment filtering + hidden-until-reviewed, muted words, two-way block
 * visibility (feeds, comments, profiles, search, stories, DMs), report
 * creation, and moderator actions (dismiss, remove content, suspend user).
 *
 * Only the Clerk boundary and object storage are mocked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  blocks, db, mutedWords, postComments, posts, products, reports, stories, users,
} from "@workspace/db";

const clerk = vi.hoisted(() => ({ banned: [] as string[], unbanned: [] as string[] }));

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
  clerkClient: {
    users: {
      banUser: async (id: string) => { clerk.banned.push(id); },
      unbanUser: async (id: string) => { clerk.unbanned.push(id); },
    },
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async trySetObjectEntityAclPolicy(path: string) { return path; }
    async getObjectEntityDownloadURL(path: string) { return `https://signed.test/${encodeURIComponent(path)}`; }
  },
}));

vi.mock("../notifications-feed", () => ({ publishNotification: async () => undefined }));

const RUN = `ugc${crypto.randomBytes(5).toString("hex")}`;
const SELLER = `${RUN}_seller`;
const BUYER = `${RUN}_buyer`;
const OTHER = `${RUN}_other`;
const ADMIN = `${RUN}_admin`;
let server: Server;
let base = "";
let postId = "";
let productId = "";

async function call(path: string, options: { method?: string; user?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.user) headers["x-test-user-id"] = options.user;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) as any };
}

function commentBodies(payload: any): string[] {
  const out: string[] = [];
  for (const comment of payload?.comments ?? []) {
    out.push(comment.body);
    for (const reply of comment.replies ?? []) out.push(reply.body);
  }
  return out;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@example.test`, name: "Filter Seller", brandName: `Thread Test ${RUN}`, accountType: "seller", role: "owner", username: `${RUN}s` },
    { clerkId: BUYER, email: `${BUYER}@example.test`, name: `Buyer ${RUN}`, displayName: `Buyer ${RUN}`, accountType: "buyer", role: "buyer", username: `${RUN}b` },
    { clerkId: OTHER, email: `${OTHER}@example.test`, name: `Other ${RUN}`, displayName: `Other ${RUN}`, accountType: "buyer", role: "buyer", username: `${RUN}o` },
    { clerkId: ADMIN, email: `${ADMIN}@example.test`, name: "Moderator", accountType: "buyer", role: "admin" },
  ]);
  const [post] = await db.insert(posts).values({
    userId: SELLER, mediaUrl: "https://cdn.test/look.jpg", caption: "Fall capsule is live",
    postStatus: "published", publishedAt: new Date(),
  }).returning({ id: posts.id });
  postId = post.id;
  const [product] = await db.insert(products).values({
    ownerId: SELLER, name: "Counterfeit-looking tee", status: "active",
  }).returning({ id: products.id });
  productId = product.id;

  const { default: postCommentsRouter } = await import("../post-comments");
  const { default: postsRouter } = await import("../posts");
  const { default: publicRouter } = await import("../public");
  const { default: socialRouter } = await import("../social");
  const { default: reportsRouter } = await import("../reports");
  const { default: moderationRouter } = await import("../moderation");
  const { default: safetyRouter } = await import("../safety");
  const { default: conversationsRouter } = await import("../conversations");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: () => {}, warn: () => {}, info: () => {} }; next(); });
  app.use("/api/posts", postCommentsRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/public", publicRouter);
  app.use("/api/social", socialRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/moderation", moderationRouter);
  app.use("/api/safety", safetyRouter);
  app.use("/api/conversations", conversationsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const ids = [SELLER, BUYER, OTHER, ADMIN];
  await db.delete(reports).where(inArray(reports.targetOwnerId, ids));
  await db.delete(reports).where(inArray(reports.reporterId, ids));
  await db.delete(blocks).where(inArray(blocks.blockerId, ids));
  await db.delete(mutedWords).where(inArray(mutedWords.userId, ids));
  await db.delete(stories).where(inArray(stories.authorId, ids));
  await db.delete(posts).where(eq(posts.userId, SELLER));
  await db.delete(products).where(eq(products.ownerId, SELLER));
  await db.delete(users).where(like(users.clerkId, `${RUN}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("comment filtering", () => {
  it("publishes clean comments to everyone and counts them", async () => {
    const created = await call(`/api/posts/${postId}/comments`, { method: "POST", user: BUYER, body: { body: "Need this in olive" } });
    expect(created.status).toBe(201);
    expect(created.body.comment.pendingReview).toBe(false);
    expect(created.body.moderation.status).toBe("visible");

    const anonymous = await call(`/api/posts/${postId}/comments`);
    expect(anonymous.status).toBe(200);
    expect(commentBodies(anonymous.body)).toContain("Need this in olive");
    expect(anonymous.body.total).toBe(1);

    const feed = await call(`/api/public/posts?ownerId=${SELLER}`);
    expect(feed.body.find((p: any) => p.id === postId)?.commentsCount).toBe(1);
  });

  it("holds profanity so only the author sees it until review, and queues it", async () => {
    const created = await call(`/api/posts/${postId}/comments`, { method: "POST", user: BUYER, body: { body: "this is fucking fire" } });
    expect(created.status).toBe(201);
    expect(created.body.comment.pendingReview).toBe(true);
    expect(created.body.moderation.status).toBe("held");

    const asAuthor = await call(`/api/posts/${postId}/comments`, { user: BUYER });
    const heldView = asAuthor.body.comments.find((c: any) => c.body === "this is fucking fire");
    expect(heldView?.pendingReview).toBe(true);

    expect(commentBodies((await call(`/api/posts/${postId}/comments`)).body)).not.toContain("this is fucking fire");
    expect(commentBodies((await call(`/api/posts/${postId}/comments`, { user: OTHER })).body)).not.toContain("this is fucking fire");

    const [queued] = await db.select().from(reports)
      .where(and(eq(reports.targetId, created.body.comment.id), eq(reports.source, "auto_filter")));
    expect(queued).toMatchObject({ targetType: "comment", status: "pending", targetOwnerId: BUYER });
  });

  it("rejects slurs and threats outright without storing them", async () => {
    const slur = await call(`/api/posts/${postId}/comments`, { method: "POST", user: BUYER, body: { body: "what a f@ggot" } });
    expect(slur.status).toBe(422);
    expect(slur.body.code).toBe("CONTENT_REJECTED");
    const threat = await call(`/api/posts/${postId}/comments`, { method: "POST", user: BUYER, body: { body: "I know where you live" } });
    expect(threat.status).toBe(422);
    const stored = await db.select({ body: postComments.body }).from(postComments).where(eq(postComments.postId, postId));
    expect(stored.map((row) => row.body)).not.toContain("what a f@ggot");
  });

  it("holds flagged captions out of public feeds", async () => {
    const [held] = await db.insert(posts).values({
      userId: SELLER, mediaUrl: "https://cdn.test/held.jpg", caption: "held caption",
      postStatus: "published", moderationStatus: "held",
    }).returning({ id: posts.id });
    const feed = await call(`/api/public/posts?ownerId=${SELLER}`);
    expect(feed.body.map((p: any) => p.id)).not.toContain(held.id);
    expect((await call(`/api/posts/${held.id}`)).status).toBe(404);
  });

  it("hides muted words from the person who muted them only", async () => {
    const add = await call("/api/safety/muted-words", { method: "POST", user: OTHER, body: { phrase: "  Restock " } });
    expect(add.status).toBe(201);
    expect(add.body.phrase).toBe("restock");
    const list = await call("/api/safety/muted-words", { user: OTHER });
    expect(list.body.words.map((w: any) => w.phrase)).toEqual(["restock"]);

    await call(`/api/posts/${postId}/comments`, { method: "POST", user: BUYER, body: { body: "Restock when??" } });
    const muted = await call(`/api/posts/${postId}/comments`, { user: OTHER });
    expect(commentBodies(muted.body)).not.toContain("Restock when??");
    expect(muted.body.hiddenByMutedWords).toBeGreaterThanOrEqual(1);
    expect(commentBodies((await call(`/api/posts/${postId}/comments`)).body)).toContain("Restock when??");

    const removed = await call(`/api/safety/muted-words/${encodeURIComponent("restock")}`, { method: "DELETE", user: OTHER });
    expect(removed.status).toBe(200);
    expect(commentBodies((await call(`/api/posts/${postId}/comments`, { user: OTHER })).body)).toContain("Restock when??");
  });
});

describe("block visibility", () => {
  it("hides blocked people's comments, profiles, search results and stories both ways", async () => {
    await call("/api/social/stories", {
      method: "POST", user: OTHER,
      body: { authorName: "Other", media: [{ uri: "https://cdn.test/story.jpg", type: "image" }] },
    });
    expect((await call(`/api/social/stories/user/${OTHER}`, { user: BUYER })).body).toHaveLength(1);
    await call(`/api/posts/${postId}/comments`, { method: "POST", user: OTHER, body: { body: "Other says hi" } });

    const blocked = await call("/api/social/block", { method: "POST", user: OTHER, body: { userId: BUYER } });
    expect(blocked.status).toBe(200);

    // The blocker no longer sees the blocked person's comments, and vice versa.
    const otherView = commentBodies((await call(`/api/posts/${postId}/comments`, { user: OTHER })).body);
    expect(otherView).not.toContain("Need this in olive");
    const buyerView = commentBodies((await call(`/api/posts/${postId}/comments`, { user: BUYER })).body);
    expect(buyerView).not.toContain("Other says hi");
    // Everyone else still sees both.
    const anonymous = commentBodies((await call(`/api/posts/${postId}/comments`)).body);
    expect(anonymous).toEqual(expect.arrayContaining(["Need this in olive", "Other says hi"]));

    // The blocked person cannot see the blocker's profile or stories.
    expect((await call(`/api/social/profile/${OTHER}`, { user: BUYER })).status).toBe(404);
    expect((await call(`/api/social/stories/user/${OTHER}`, { user: BUYER })).body).toEqual([]);
    // The blocker sees a minimal profile so they can unblock.
    const blockerView = await call(`/api/social/profile/${BUYER}`, { user: OTHER });
    expect(blockerView.status).toBe(200);
    expect(blockerView.body.iBlockedThem).toBe(true);

    const search = await call(`/api/social/search?q=${RUN}`, { user: BUYER });
    expect(search.body.map((u: any) => u.userId)).not.toContain(OTHER);
    const reverseSearch = await call(`/api/social/search?q=${RUN}`, { user: OTHER });
    expect(reverseSearch.body.map((u: any) => u.userId)).not.toContain(BUYER);

    const list = await call("/api/social/blocks", { user: OTHER });
    expect(list.body).toEqual([expect.objectContaining({ userId: BUYER, name: `Buyer ${RUN}` })]);
  });

  it("stops messaging in both directions", async () => {
    const participant = (userId: string) => ({ userId, name: "x", handle: "@x", initials: "X", color: "#333", accountType: "buyer" });
    const fromBlocked = await call("/api/conversations", { method: "POST", user: BUYER, body: { type: "buyer_to_buyer", participant: participant(OTHER) } });
    expect(fromBlocked.status).toBe(403);
    expect(fromBlocked.body.code).toBe("BLOCKED");
    const fromBlocker = await call("/api/conversations", { method: "POST", user: OTHER, body: { type: "buyer_to_buyer", participant: participant(BUYER) } });
    expect(fromBlocker.status).toBe(403);
    expect(fromBlocker.body.code).toBe("BLOCKED_BY_ME");
  });

  it("stops comments on a blocker's posts and hides their feed and storefront", async () => {
    await call("/api/social/block", { method: "POST", user: SELLER, body: { userId: BUYER } });
    const comment = await call(`/api/posts/${postId}/comments`, { method: "POST", user: BUYER, body: { body: "hello?" } });
    expect(comment.status).toBe(403);
    expect(comment.body.code).toBe("BLOCKED");
    const feed = await call(`/api/public/posts?ownerId=${SELLER}`, { user: BUYER });
    expect(feed.body.map((p: any) => p.id)).not.toContain(postId);
    expect((await call(`/api/public/sellers/${SELLER}`, { user: BUYER })).status).toBe(404);
    expect((await call(`/api/posts/${postId}`, { user: BUYER })).status).toBe(404);

    const unblock = await call(`/api/social/block/${BUYER}`, { method: "DELETE", user: SELLER });
    expect(unblock.status).toBe(200);
    expect((await call(`/api/public/posts?ownerId=${SELLER}`, { user: BUYER })).body.map((p: any) => p.id)).toContain(postId);
  });
});

describe("reports and the moderation queue", () => {
  it("validates reasons and notes and refuses self-reports", async () => {
    expect((await call("/api/reports", { method: "POST", user: BUYER, body: { targetType: "post", targetId: postId, reason: "made_up" } })).status).toBe(400);
    const noNote = await call("/api/reports", { method: "POST", user: BUYER, body: { targetType: "post", targetId: postId, reason: "other" } });
    expect(noNote.status).toBe(400);
    expect(noNote.body.code).toBe("NOTE_REQUIRED");
    const self = await call("/api/reports", { method: "POST", user: SELLER, body: { targetType: "post", targetId: postId, reason: "spam" } });
    expect(self.body.code).toBe("SELF_REPORT");
    expect((await call("/api/reports", { method: "POST", user: BUYER, body: { targetType: "post", targetId: crypto.randomUUID(), reason: "spam" } })).status).toBe(404);
  });

  it("stores reports with the server-resolved owner and snapshot, once per person", async () => {
    const first = await call("/api/reports", { method: "POST", user: BUYER, body: { targetType: "product", targetId: productId, reason: "ip_counterfeit", note: "Copies a trademarked logo" } });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ targetType: "product", targetOwnerId: SELLER, reason: "ip_counterfeit", status: "pending" });
    expect(first.body.contentExcerpt).toContain("Counterfeit-looking tee");
    expect(first.body.reporterId).toBeUndefined();

    const again = await call("/api/reports", { method: "POST", user: BUYER, body: { targetType: "product", targetId: productId, reason: "scam" } });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("already_reported");

    const profile = await call("/api/reports", { method: "POST", user: BUYER, body: { targetType: "seller", targetId: SELLER, reason: "scam" } });
    expect(profile.status).toBe(201);
    expect(profile.body.targetType).toBe("profile");
  });

  it("restricts the queue to moderators", async () => {
    expect((await call("/api/moderation/reports", { user: BUYER })).status).toBe(403);
    expect((await call("/api/moderation/me", { user: BUYER })).body).toEqual({ isModerator: false });
    expect((await call("/api/moderation/me", { user: ADMIN })).body).toEqual({ isModerator: true });

    const queue = await call("/api/moderation/reports?type=product", { user: ADMIN });
    expect(queue.status).toBe(200);
    const item = queue.body.items.find((i: any) => i.targetId === productId);
    expect(item).toMatchObject({ reason: "ip_counterfeit", note: "Copies a trademarked logo", source: "user" });
    expect(item.owner).toMatchObject({ userId: SELLER });
    expect(item.reporter).toMatchObject({ userId: BUYER });
  });

  it("removes reported content and closes every open report on it", async () => {
    const report = await call("/api/reports", { method: "POST", user: OTHER, body: { targetType: "post", targetId: postId, reason: "nudity" } });
    await call("/api/reports", { method: "POST", user: BUYER, body: { targetType: "post", targetId: postId, reason: "nudity" } });
    const resolved = await call(`/api/moderation/reports/${report.body.id}/resolve`, { method: "POST", user: ADMIN, body: { action: "remove_content", note: "Explicit" } });
    expect(resolved.status).toBe(200);
    expect(resolved.body.resolvedReports).toBe(2);
    const [post] = await db.select({ moderationStatus: posts.moderationStatus }).from(posts).where(eq(posts.id, postId));
    expect(post.moderationStatus).toBe("removed");
    expect((await call(`/api/public/posts?ownerId=${SELLER}`)).body.map((p: any) => p.id)).not.toContain(postId);
    const open = await db.select().from(reports).where(and(eq(reports.targetId, postId), eq(reports.status, "pending")));
    expect(open).toEqual([]);
  });

  it("publishes held content when a moderator dismisses the flag", async () => {
    const [post] = await db.insert(posts).values({
      userId: SELLER, mediaUrl: "https://cdn.test/two.jpg", caption: "Second look", postStatus: "published",
    }).returning({ id: posts.id });
    const held = await call(`/api/posts/${post.id}/comments`, { method: "POST", user: OTHER, body: { body: "holy shit these are clean" } });
    expect(held.body.comment.pendingReview).toBe(true);
    const [queued] = await db.select().from(reports).where(eq(reports.targetId, held.body.comment.id));
    const dismissed = await call(`/api/moderation/reports/${queued.id}/resolve`, { method: "POST", user: ADMIN, body: { action: "dismiss" } });
    expect(dismissed.body.status).toBe("dismissed");
    expect(commentBodies((await call(`/api/posts/${post.id}/comments`)).body)).toContain("holy shit these are clean");
  });

  it("suspends the owner: content hidden, publishing refused, signed out; reinstatement reverses it", async () => {
    const [post] = await db.insert(posts).values({
      userId: SELLER, mediaUrl: "https://cdn.test/three.jpg", caption: "Third look", postStatus: "published",
    }).returning({ id: posts.id });
    const comment = await call(`/api/posts/${post.id}/comments`, { method: "POST", user: OTHER, body: { body: "Spammy comment from other" } });
    const report = await call("/api/reports", { method: "POST", user: BUYER, body: { targetType: "comment", targetId: comment.body.comment.id, reason: "harassment" } });
    expect(report.status).toBe(201);

    const suspended = await call(`/api/moderation/reports/${report.body.id}/resolve`, { method: "POST", user: ADMIN, body: { action: "suspend_user" } });
    expect(suspended.status).toBe(200);
    expect(suspended.body.suspendedUserId).toBe(OTHER);
    expect(clerk.banned).toContain(OTHER);

    expect(commentBodies((await call(`/api/posts/${post.id}/comments`)).body)).not.toContain("Spammy comment from other");
    const retry = await call(`/api/posts/${post.id}/comments`, { method: "POST", user: OTHER, body: { body: "still here" } });
    expect(retry.status).toBe(403);
    expect(retry.body.code).toBe("ACCOUNT_SUSPENDED");

    expect((await call(`/api/moderation/users/${OTHER}/reinstate`, { method: "POST", user: ADMIN })).status).toBe(200);
    expect(clerk.unbanned).toContain(OTHER);
    expect(commentBodies((await call(`/api/posts/${post.id}/comments`)).body)).toContain("Spammy comment from other");
  });
});
