/**
 * Request-body validation on the social / messaging routes.
 *
 * Every schema is a shape + size guard placed in front of the existing
 * handler (see middlewares/bodySchemas.ts). These tests pin both sides:
 *   - malformed / oversized bodies are refused with 400 VALIDATION_ERROR
 *     before the handler runs, and
 *   - the payload shapes the mobile client actually sends still go through
 *     to the handler (real DB) and succeed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import {
  communities, communityMembers, communityMessages, conversationParticipants, conversations,
  db, follows, messages, postComments, posts, reports, users,
} from "@workspace/db";

const suffix = crypto.randomBytes(6).toString("hex");
const buyerId = `valsoc-buyer-${suffix}`;
const sellerId = `valsoc-seller-${suffix}`;
const authState = vi.hoisted(() => ({ clerkUserId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
  requireModerator: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

let server: Server;
let base = "";
let sellerPostId = "";
const createdPostIds: string[] = [];
const createdCommunityIds: string[] = [];
const createdConversationIds: string[] = [];

async function call(method: string, path: string, body?: unknown, as = buyerId) {
  authState.clerkUserId = as;
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, body: json };
}

function expectValidationError(res: { status: number; body: any }) {
  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("VALIDATION_ERROR");
  expect(res.body?.error).toBe("Invalid request");
  expect(Array.isArray(res.body?.details)).toBe(true);
}

function expectNotSchemaRejected(res: { status: number; body: any }) {
  expect(res.body?.error === "Invalid request" && res.body?.code === "VALIDATION_ERROR").toBe(false);
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: buyerId, email: `${buyerId}@test.local`, name: "Valsoc Buyer", displayName: "Valsoc Buyer", username: `vb${suffix}`, role: "buyer", accountType: "buyer", onboardingComplete: true },
    { clerkId: sellerId, email: `${sellerId}@test.local`, name: "Valsoc Seller", displayName: "Valsoc Seller", username: `vs${suffix}`, role: "seller", accountType: "seller", onboardingComplete: true },
  ]);
  const [post] = await db.insert(posts).values({
    userId: sellerId,
    mediaUrl: "https://cdn.test/valsoc-seller.jpg",
    mediaUrls: ["https://cdn.test/valsoc-seller.jpg"],
    mediaType: "photo",
    caption: "Seller post",
    postStatus: "published",
    publishedAt: new Date(),
  }).returning();
  sellerPostId = post.id;
  createdPostIds.push(post.id);

  const [
    { default: postsRouter },
    { default: postCommentsRouter },
    { default: socialRouter },
    { default: reportsRouter },
    { default: communitiesRouter },
    { default: conversationsRouter },
  ] = await Promise.all([
    import("../posts"),
    import("../post-comments"),
    import("../social"),
    import("../reports"),
    import("../communities"),
    import("../conversations"),
  ]);
  const app = express();
  app.use(express.json({ limit: "45mb" }));
  app.use("/api/posts", postCommentsRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/social", socialRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/communities", communitiesRouter);
  app.use("/api/conversations", conversationsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const people = [buyerId, sellerId];
  await db.delete(reports).where(inArray(reports.reporterId, people)).catch(() => undefined);
  if (createdConversationIds.length) {
    await db.delete(messages).where(inArray(messages.conversationId, createdConversationIds));
    await db.delete(conversationParticipants).where(inArray(conversationParticipants.conversationId, createdConversationIds));
    await db.delete(conversations).where(inArray(conversations.id, createdConversationIds));
  }
  if (createdCommunityIds.length) {
    await db.delete(communityMessages).where(inArray(communityMessages.communityId, createdCommunityIds));
    await db.delete(communityMembers).where(inArray(communityMembers.communityId, createdCommunityIds));
    await db.delete(communities).where(inArray(communities.id, createdCommunityIds));
  }
  await db.delete(postComments).where(inArray(postComments.postId, createdPostIds));
  await db.delete(posts).where(or(inArray(posts.id, createdPostIds), inArray(posts.userId, people)));
  await db.delete(follows).where(or(inArray(follows.followerId, people), inArray(follows.followingId, people)));
  await db.delete(users).where(inArray(users.clerkId, people));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/posts (create post)", () => {
  it("rejects an oversized caption and too many hashtags", async () => {
    expectValidationError(await call("POST", "/api/posts", { mediaType: "photo", mediaUrls: ["https://cdn.test/a.jpg"], caption: "x".repeat(10_001) }));
    expectValidationError(await call("POST", "/api/posts", { mediaType: "photo", mediaUrls: ["https://cdn.test/a.jpg"], hashtags: Array.from({ length: 201 }, (_, i) => `t${i}`) }));
  });

  it("rejects a non-object body", async () => {
    const res = await call("POST", "/api/posts", ["not", "an", "object"]);
    expectValidationError(res);
  });

  it("keeps the handler's own message for wrong-typed fields it already checks", async () => {
    const res = await call("POST", "/api/posts", { mediaType: "photo", mediaUrls: ["https://cdn.test/a.jpg"], caption: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("caption must be a string");
  });

  it("accepts the mobile photo post payload (2,200-char caption, hashtags, visibility)", async () => {
    const res = await call("POST", "/api/posts", {
      mediaType: "photo",
      mediaUrls: ["https://cdn.test/buyer-photo.jpg"],
      aspectRatio: "3:4",
      caption: "c".repeat(2_200),
      hashtags: ["ootd", "streetwear"],
      styleTags: [],
      visibility: { isPublic: true, allowComments: true, allowReposts: true, showLikeCount: true },
      isDraft: false,
      scheduledAt: null,
      sound: null,
    });
    expect(res.status).toBe(201);
    createdPostIds.push(res.body.id);
  });
});

describe("POST /api/posts/:id/interact", () => {
  it("rejects an oversized value", async () => {
    expectValidationError(await call("POST", `/api/posts/${sellerPostId}/interact`, { type: "view", value: "x".repeat(1_001) }));
  });

  it("accepts the mobile like / watch_time payloads", async () => {
    const like = await call("POST", `/api/posts/${sellerPostId}/interact`, { type: "like" });
    expect(like.status).toBe(200);
    const watch = await call("POST", `/api/posts/${sellerPostId}/interact`, { type: "watch_time", value: "3.25" });
    expectNotSchemaRejected(watch);
    expect(watch.status).toBeLessThan(400);
  });
});

describe("POST /api/posts/:postId/comments", () => {
  it("rejects a far-too-long comment before the handler runs", async () => {
    expectValidationError(await call("POST", `/api/posts/${sellerPostId}/comments`, { body: "x".repeat(5_001) }));
  });

  it("keeps the handler's friendly message for a comment just over its limit", async () => {
    const res = await call("POST", `/api/posts/${sellerPostId}/comments`, { body: "x".repeat(1_001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/up to 1000 characters/);
  });

  it("accepts the mobile comment payload", async () => {
    const res = await call("POST", `/api/posts/${sellerPostId}/comments`, { body: "Love this fit" });
    expect(res.status).toBe(201);
  });
});

describe("POST /api/social/follow", () => {
  it("rejects a non-string, oversized userId", async () => {
    expectValidationError(await call("POST", "/api/social/follow", { userId: "u".repeat(201) }));
  });

  it("accepts the mobile follow payload", async () => {
    const res = await call("POST", "/api/social/follow", { userId: sellerId });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/reports", () => {
  it("rejects an oversized note", async () => {
    expectValidationError(await call("POST", "/api/reports", {
      targetType: "post", targetId: sellerPostId, reason: "other", note: "n".repeat(5_001),
    }));
  });

  it("accepts the mobile report payload", async () => {
    const res = await call("POST", "/api/reports", {
      targetType: "post", targetId: sellerPostId, reason: "spam", note: "Looks like spam",
    });
    expectNotSchemaRejected(res);
    expect(res.status).toBeLessThan(300);
  });
});

describe("communities: create + message", () => {
  let communityId = "";

  it("accepts the mobile create payload", async () => {
    const res = await call("POST", "/api/communities", {
      name: `Valsoc ${suffix}`.slice(0, 40), description: "A test group", visibility: "public",
      requireApproval: false, iconUrl: null, coverUrl: null,
    }, sellerId);
    expect(res.status).toBe(201);
    communityId = res.body.id;
    createdCommunityIds.push(communityId);
  });

  it("rejects an oversized message and too many attachments", async () => {
    expectValidationError(await call("POST", `/api/communities/${communityId}/messages`, { text: "x".repeat(10_001) }, sellerId));
    expectValidationError(await call("POST", `/api/communities/${communityId}/messages`, {
      text: "hi", attachments: Array.from({ length: 51 }, () => ({ type: "image", url: "https://cdn.test/a.jpg" })),
    }, sellerId));
  });

  it("keeps the handler's message for text just over MAX_BODY", async () => {
    const res = await call("POST", `/api/communities/${communityId}/messages`, { text: "x".repeat(4_001) }, sellerId);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("That message is too long.");
  });

  it("accepts the mobile text message payload", async () => {
    const res = await call("POST", `/api/communities/${communityId}/messages`, { text: "Hello group", attachments: [] }, sellerId);
    expect(res.status).toBeLessThan(300);
    expectNotSchemaRejected(res);
  });
});

describe("conversations: create + send message", () => {
  let conversationId = "";

  it("accepts the mobile createOrGet payload", async () => {
    const res = await call("POST", "/api/conversations", {
      type: "buyer_to_seller",
      participant: { userId: sellerId, name: "Valsoc Seller", handle: `@vs${suffix}`, initials: "VS", color: "#333333", accountType: "seller" },
      myInfo: { name: "Valsoc Buyer", handle: `@vb${suffix}`, initials: "VB", color: "#444444", accountType: "buyer" },
    });
    expect(res.status).toBeLessThan(300);
    conversationId = res.body.id;
    createdConversationIds.push(conversationId);
  });

  it("rejects non-string and oversized message text", async () => {
    expectValidationError(await call("POST", `/api/conversations/${conversationId}/messages`, { text: { evil: true } }));
    expectValidationError(await call("POST", `/api/conversations/${conversationId}/messages`, { text: "x".repeat(20_001) }));
  });

  it("accepts the mobile text message payload", async () => {
    const res = await call("POST", `/api/conversations/${conversationId}/messages`, { text: "Is this still available?" });
    expect(res.status).toBeLessThan(300);
    expectNotSchemaRejected(res);
  });

  it("rejects an oversized nickname but accepts the mobile one", async () => {
    expectValidationError(await call("PATCH", `/api/conversations/${conversationId}/nickname`, { targetUserId: sellerId, nickname: "n".repeat(1_001) }));
    const ok = await call("PATCH", `/api/conversations/${conversationId}/nickname`, { targetUserId: sellerId, nickname: "Shop" });
    expect(ok.status).toBe(200);
  });
});
