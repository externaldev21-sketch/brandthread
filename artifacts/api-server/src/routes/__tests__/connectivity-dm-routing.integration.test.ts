/**
 * END-TO-END CONNECTIVITY SUITE — section 3 (DM + message-request routing).
 * Run it as part of the whole suite: see the header comment in
 * connectivity-suite.integration.test.ts for the one-command invocation, or
 * `pnpm run test:connectivity` from artifacts/api-server.
 *
 * Exercises every branch of lib/conversationRouting.ts's single rule
 * (buyer<->buyer, buyer<->seller, seller<->buyer, seller<->seller — no
 * role-pair exceptions):
 *   Recipient R's MAIN INBOX if R already follows sender S, OR R is a seller
 *   AND S has a real paid order with R. Otherwise R's REQUESTS.
 *
 * There is deliberately no "migrate existing conversations" test here — Dev
 * explicitly dropped that rule; existing conversations are never re-sorted,
 * only NEW conversations/requests are governed by this rule.
 *
 * Read receipts, typing, attachments, reactions, mute, and block-mid-
 * conversation already have real coverage elsewhere (see the matrix); this
 * file only covers request/inbox routing, acceptance/decline, and
 * auto-promotion.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  db, users, follows, orders, conversations, conversationParticipants, messages, interactions, posts,
} from "@workspace/db";
import { promotePendingRequestsOnOrder } from "../../lib/conversationRouting";

const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const S = `conn-dm-seller-${suffix}`;
const A = `conn-dm-buyer-a-${suffix}`;
const B = `conn-dm-buyer-b-${suffix}`;
const B2 = `conn-dm-buyer-b2-${suffix}`; // a SECOND Clerk account, narratively "the same person" as B
const S2 = `conn-dm-seller-2-${suffix}`; // a second seller, for seller<->seller
const ALL_IDS = [S, A, B, B2, S2];

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const header = req.header("x-test-user-id");
    if (!header) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = header;
    next();
  },
}));

let server: Server;
let base = "";

function asHeader(userId: string) {
  return { "x-test-user-id": userId, "content-type": "application/json" };
}

async function call(method: string, path: string, userId: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: asHeader(userId),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function participantInput(userId: string, name: string, accountType: string) {
  return { userId, name, handle: `@${name.toLowerCase().replace(/\s+/g, "")}`, initials: name.slice(0, 2).toUpperCase(), color: "#123456", accountType };
}

async function createConversation(senderId: string, recipientId: string, recipientName: string, recipientAccountType: string, senderName: string, senderAccountType: string) {
  return call("POST", "/api/conversations", senderId, {
    type: senderAccountType === "buyer" && recipientAccountType === "buyer" ? "buyer_to_buyer" : "buyer_to_seller",
    participant: participantInput(recipientId, recipientName, recipientAccountType),
    myInfo: { name: senderName, handle: `@${senderName.toLowerCase()}`, initials: senderName.slice(0, 2).toUpperCase(), color: "#654321", accountType: senderAccountType },
  });
}

async function cleanupConversationsAndFollows() {
  const convRows = await db.select({ id: conversationParticipants.conversationId })
    .from(conversationParticipants).where(inArray(conversationParticipants.userId, ALL_IDS));
  const ids = [...new Set(convRows.map((r) => r.id))];
  for (const id of ids) {
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));
  }
  await db.delete(follows).where(or(inArray(follows.followerId, ALL_IDS), inArray(follows.followingId, ALL_IDS)));
  await db.delete(orders).where(inArray(orders.ownerId, ALL_IDS));
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: S, email: `${S}@example.test`, name: "DM Seller", displayName: "DM Seller", accountType: "seller", onboardingComplete: true },
    { clerkId: A, email: `${A}@example.test`, name: "DM Buyer A", displayName: "DM Buyer A", accountType: "buyer", onboardingComplete: true },
    { clerkId: B, email: `${B}@example.test`, name: "DM Buyer B", displayName: "DM Buyer B", accountType: "buyer", onboardingComplete: true },
    { clerkId: B2, email: `${B2}@example.test`, name: "DM Buyer B Alt", displayName: "DM Buyer B Alt", accountType: "buyer", onboardingComplete: true },
    { clerkId: S2, email: `${S2}@example.test`, name: "DM Seller Two", displayName: "DM Seller Two", accountType: "seller", onboardingComplete: true },
  ]);

  const [{ default: conversationsRouter }, { default: socialRouter }] = await Promise.all([
    import("../conversations"),
    import("../social"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error() {}, warn() {}, info() {} }; next(); });
  app.use("/api/conversations", conversationsRouter);
  app.use("/api/social", socialRouter);

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(cleanupConversationsAndFollows);

afterAll(async () => {
  await cleanupConversationsAndFollows();
  await db.delete(orders).where(inArray(orders.ownerId, ALL_IDS));
  await db.delete(interactions).where(inArray(interactions.userId, ALL_IDS));
  await db.delete(posts).where(inArray(posts.userId, ALL_IDS));
  await db.delete(users).where(inArray(users.clerkId, ALL_IDS));
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

async function insertRealOrder(overrides: Partial<typeof orders.$inferInsert> = {}) {
  const [row] = await db.insert(orders).values({
    ownerId: S,
    buyerId: A,
    orderNumber: `DM-ORD-${suffix}-${crypto.randomBytes(3).toString("hex")}`,
    status: "fulfilled",
    totalCents: 4_000,
    subtotalCents: 4_000,
    refundedCents: 0,
    paidAt: new Date(),
    stripeCheckoutSessionId: `dm-ord-${suffix}-${crypto.randomBytes(3).toString("hex")}`,
    ...overrides,
  }).returning();
  return row;
}

describe("3. DM + request routing (lib/conversationRouting.ts, every branch)", () => {
  it("non-follower, no order → lands in recipient's Requests, isRequest true, requestedBy = sender", async () => {
    const res = await createConversation(A, S, "DM Seller", "seller", "DM Buyer A", "buyer");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ isRequest: true, requestedBy: A });
  });

  it("recipient cannot reply until accepting: POST /:id/messages 403s with REQUEST_NOT_ACCEPTED", async () => {
    const conv = await createConversation(A, S, "DM Seller", "seller", "DM Buyer A", "buyer");
    const convId = conv.body.id as string;

    const replyBeforeAccept = await call("POST", `/api/conversations/${convId}/messages`, S, { text: "too soon" });
    expect(replyBeforeAccept.status).toBe(403);
    expect(replyBeforeAccept.body).toMatchObject({ code: "REQUEST_NOT_ACCEPTED" });

    // The requester themself CAN still send follow-up messages while pending.
    const requesterFollowUp = await call("POST", `/api/conversations/${convId}/messages`, A, { text: "following up" });
    expect(requesterFollowUp.status).toBe(201);
  });

  it("accept moves it to both inboxes (isRequest false, requestedBy null); only the non-requester may accept", async () => {
    const conv = await createConversation(A, S, "DM Seller", "seller", "DM Buyer A", "buyer");
    const convId = conv.body.id as string;

    // The requester (A) trying to accept their own request is rejected.
    const requesterAccepts = await call("PATCH", `/api/conversations/${convId}/accept`, A);
    expect(requesterAccepts.status).toBe(403);

    const acceptRes = await call("PATCH", `/api/conversations/${convId}/accept`, S);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body).toMatchObject({ isRequest: false });
    expect(acceptRes.body.requestedBy).toBeUndefined();

    // Both sides now see it as a normal (non-request) conversation.
    const viewAsA = await call("GET", `/api/conversations/${convId}`, A);
    expect(viewAsA.body).toMatchObject({ isRequest: false });
    const viewAsS = await call("GET", `/api/conversations/${convId}`, S);
    expect(viewAsS.body).toMatchObject({ isRequest: false });

    // Seller can now reply.
    const replyAfterAccept = await call("POST", `/api/conversations/${convId}/messages`, S, { text: "hi there" });
    expect(replyAfterAccept.status).toBe(201);
  });

  it("decline (DELETE /:id) removes the conversation entirely", async () => {
    const conv = await createConversation(A, S, "DM Seller", "seller", "DM Buyer A", "buyer");
    const convId = conv.body.id as string;

    const declineRes = await call("DELETE", `/api/conversations/${convId}`, S);
    expect(declineRes.status).toBe(200);

    const rows = await db.select().from(conversations).where(eq(conversations.id, convId));
    expect(rows).toHaveLength(0);
  });

  it("if recipient already follows sender → straight to main inbox, no accept needed", async () => {
    expect((await call("POST", "/api/social/follow", S, { userId: A })).status).toBe(200);

    const conv = await createConversation(A, S, "DM Seller", "seller", "DM Buyer A", "buyer");
    expect(conv.status).toBe(201);
    expect(conv.body).toMatchObject({ isRequest: false });
    expect(conv.body.requestedBy).toBeUndefined();

    const replyImmediately = await call("POST", `/api/conversations/${conv.body.id}/messages`, S, { text: "no gate here" });
    expect(replyImmediately.status).toBe(201);
  });

  it("seller recipient + buyer sender WITH a real paid order → straight to main inbox", async () => {
    await insertRealOrder({ buyerId: A, ownerId: S });

    const conv = await createConversation(A, S, "DM Seller", "seller", "DM Buyer A", "buyer");
    expect(conv.status).toBe(201);
    expect(conv.body).toMatchObject({ isRequest: false });
    expect(conv.body.requestedBy).toBeUndefined();
  });

  it("seller recipient + buyer sender with NO order → Requests", async () => {
    const conv = await createConversation(A, S, "DM Seller", "seller", "DM Buyer A", "buyer");
    expect(conv.body).toMatchObject({ isRequest: true, requestedBy: A });
  });

  it("an order on a DIFFERENT buyer Clerk ID (even 'the same person' narratively) does NOT count", async () => {
    await insertRealOrder({ buyerId: B, ownerId: S }); // B has the order, not B2

    const conv = await createConversation(B2, S, "DM Seller", "seller", "DM Buyer B Alt", "buyer");
    expect(conv.body).toMatchObject({ isRequest: true, requestedBy: B2 });
  });

  it("a fully refunded order does NOT count as real", async () => {
    await insertRealOrder({ buyerId: A, ownerId: S, totalCents: 3_000, refundedCents: 3_000 });

    const conv = await createConversation(A, S, "DM Seller", "seller", "DM Buyer A", "buyer");
    expect(conv.body).toMatchObject({ isRequest: true, requestedBy: A });
  });

  it("a partially refunded order still counts as real (per conversationRouting.ts's documented rule)", async () => {
    await insertRealOrder({ buyerId: A, ownerId: S, totalCents: 3_000, refundedCents: 1_000 });

    const conv = await createConversation(A, S, "DM Seller", "seller", "DM Buyer A", "buyer");
    expect(conv.body).toMatchObject({ isRequest: false });
  });

  it("a cancelled order does NOT count", async () => {
    await insertRealOrder({ buyerId: A, ownerId: S, status: "cancelled" });

    const conv = await createConversation(A, S, "DM Seller", "seller", "DM Buyer A", "buyer");
    expect(conv.body).toMatchObject({ isRequest: true, requestedBy: A });
  });

  it("an unpaid order (paidAt null) does NOT count", async () => {
    await insertRealOrder({ buyerId: A, ownerId: S, paidAt: null });

    const conv = await createConversation(A, S, "DM Seller", "seller", "DM Buyer A", "buyer");
    expect(conv.body).toMatchObject({ isRequest: true, requestedBy: A });
  });

  it("seller -> buyer (unsolicited, buyer doesn't follow seller): must land in Requests — no special-casing for sellers as senders", async () => {
    const conv = await createConversation(S, A, "DM Buyer A", "buyer", "DM Seller", "seller");
    expect(conv.body).toMatchObject({ isRequest: true, requestedBy: S });
  });

  it("seller<->seller: same universal rule applies, no exception", async () => {
    const convNoFollow = await createConversation(S, S2, "DM Seller Two", "seller", "DM Seller", "seller");
    expect(convNoFollow.body).toMatchObject({ isRequest: true, requestedBy: S });

    await db.delete(conversations).where(eq(conversations.id, convNoFollow.body.id));
    await db.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, convNoFollow.body.id));

    expect((await call("POST", "/api/social/follow", S2, { userId: S })).status).toBe(200);
    const convFollowed = await createConversation(S, S2, "DM Seller Two", "seller", "DM Seller", "seller");
    expect(convFollowed.body).toMatchObject({ isRequest: false });
  });

  it("auto-promotion: a pending request auto-moves to main inbox when the recipient follows the sender back", async () => {
    const conv = await createConversation(A, S, "DM Seller", "seller", "DM Buyer A", "buyer");
    expect(conv.body).toMatchObject({ isRequest: true, requestedBy: A });

    // S (the recipient) now follows A back — exactly the condition that
    // would have routed this to the main inbox in the first place.
    const followRes = await call("POST", "/api/social/follow", S, { userId: A });
    expect(followRes.status).toBe(200);

    const refetched = await call("GET", `/api/conversations/${conv.body.id}`, S);
    expect(refetched.body).toMatchObject({ isRequest: false });
    expect(refetched.body.requestedBy).toBeUndefined();
    const refetchedAsA = await call("GET", `/api/conversations/${conv.body.id}`, A);
    expect(refetchedAsA.body).toMatchObject({ isRequest: false });
  });

  it("auto-promotion: a pending request auto-moves to main inbox when the buyer places a real paid order afterward", async () => {
    const conv = await createConversation(A, S, "DM Seller", "seller", "DM Buyer A", "buyer");
    expect(conv.body).toMatchObject({ isRequest: true, requestedBy: A });

    // Exercising the full Stripe webhook end-to-end needs a live Stripe
    // session this sandbox can't produce cheaply; per the task's documented
    // fallback, this calls promotePendingRequestsOnOrder directly — the
    // exact function webhooks.ts's handleCheckoutPaid calls after recording
    // a paid order (see webhooks.ts's diff importing it). The commerce
    // section's own tests (connectivity-commerce-social...) separately
    // exercise the real webhook route end-to-end for order visibility and
    // the new_order_received notification.
    await insertRealOrder({ buyerId: A, ownerId: S });
    await promotePendingRequestsOnOrder(A, S);

    const refetched = await call("GET", `/api/conversations/${conv.body.id}`, S);
    expect(refetched.body).toMatchObject({ isRequest: false });
    expect(refetched.body.requestedBy).toBeUndefined();
  });

  it("regression guard: a like or a comment on a post never creates a conversation/message row", async () => {
    const [post] = await db.insert(posts).values({ userId: S, mediaUrl: "https://example.test/dm-guard.jpg" }).returning({ id: posts.id });

    const [convBefore, msgBefore] = await Promise.all([
      db.select({ id: conversations.id }).from(conversations),
      db.select({ id: messages.id }).from(messages),
    ]);

    const { default: postsRouter } = await import("../posts");
    const { default: postCommentsRouter } = await import("../post-comments");
    const likeApp = express();
    likeApp.use(express.json());
    likeApp.use((req, _res, next) => { (req as any).log = { error() {}, warn() {}, info() {} }; next(); });
    likeApp.use("/api/posts", postsRouter);
    likeApp.use("/api/posts", postCommentsRouter);
    const likeServer = likeApp.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => likeServer.once("listening", resolve));
    const likeBase = `http://127.0.0.1:${(likeServer.address() as AddressInfo).port}`;
    try {
      const likeRes = await fetch(`${likeBase}/api/posts/${post.id}/interact`, {
        method: "POST", headers: asHeader(A), body: JSON.stringify({ type: "like" }),
      });
      expect(likeRes.status).toBe(200);
      const commentRes = await fetch(`${likeBase}/api/posts/${post.id}/comments`, {
        method: "POST", headers: asHeader(A), body: JSON.stringify({ body: "nice post!" }),
      });
      expect(commentRes.status).toBe(201);
    } finally {
      await new Promise<void>((resolve) => likeServer.close(() => resolve()));
    }

    const [convAfter, msgAfter] = await Promise.all([
      db.select({ id: conversations.id }).from(conversations),
      db.select({ id: messages.id }).from(messages),
    ]);
    expect(convAfter.length).toBe(convBefore.length);
    expect(msgAfter.length).toBe(msgBefore.length);

    await db.delete(interactions).where(eq(interactions.postId, post.id));
    await db.delete(posts).where(eq(posts.id, post.id));
  });

  it("COVERED ELSEWHERE: read receipts, typing, persistence — conversation-two-account-e2e.test.ts", () => { expect(true).toBe(true); });
  it("COVERED ELSEWHERE: typing indicator edge cases — conversation-typing.test.ts", () => { expect(true).toBe(true); });
  it("COVERED ELSEWHERE: attachments/media upload — conversation-upload-media.test.ts", () => { expect(true).toBe(true); });
  it("COVERED ELSEWHERE: reactions — message-reactions.test.ts", () => { expect(true).toBe(true); });
  it("COVERED ELSEWHERE: mute, block-mid-conversation — conversation-two-account-e2e.test.ts / social-follow.integration.test.ts block-race case", () => { expect(true).toBe(true); });
});
