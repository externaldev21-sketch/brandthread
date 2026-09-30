/**
 * End-to-end narrative (real DB, real Express router — the exact app.mjs
 * mounts, not a hand-rolled fake): two REAL accounts (real `users` rows,
 * real `conversations`/`messages`/`conversation_participants` rows — no
 * preview/seed data anywhere in this file) exchange messages and the test
 * walks through every behavior Dev asked to have verified:
 *
 *   1. Buyer sends → Seller sees it on its own next fetch (the poll the
 *      client uses — GET /api/conversations/:id/messages) without any
 *      write from Seller's side. That poll IS the "real time" mechanism;
 *      see docs on Conversation.otherTyping/agentTyping and
 *      lib/live/apiLiveProvider.ts for why (no websocket layer exists).
 *   2. Read receipts: Seller marks the thread read → Buyer's next fetch of
 *      the SAME message shows a real `readAt`, not a client-side fake.
 *   3. Typing indicator: Buyer sets typing:true → Seller's next fetch of the
 *      conversation shows otherTyping:true; Buyer clears it → false again.
 *   4. Persistence: closing and "reopening" the thread (a fresh GET with no
 *      state carried over, standing in for a hard reload) returns every
 *      message and the read state exactly as left.
 *
 * `requireAuth` is stubbed to read the caller's identity off a header
 * instead of a live Clerk session — the same substitution this repo's own
 * pre-existing integration tests use throughout `__tests__/` (see
 * conversation-read-access.test.ts, message-reactions.test.ts,
 * brandthread-agent-conversation-view.test.ts) — because this sandbox has
 * no network egress to Clerk to run a real two-browser-session login. Every
 * other layer (Express router, Drizzle, Postgres) is the real thing.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { db, users, conversations, conversationParticipants, messages } from "@workspace/db";

const BUYER = `e2e-buyer-${process.pid}`;
const SELLER = `e2e-seller-${process.pid}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const actingAs = req.headers["x-test-acting-as"];
    if (!actingAs) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = actingAs;
    next();
  },
}));

async function cleanup() {
  const rows = await db.select({ id: conversationParticipants.conversationId })
    .from(conversationParticipants).where(eq(conversationParticipants.userId, BUYER));
  for (const row of rows) {
    await db.delete(messages).where(eq(messages.conversationId, row.id));
    await db.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, row.id));
    await db.delete(conversations).where(eq(conversations.id, row.id));
  }
  await db.delete(users).where(eq(users.clerkId, BUYER));
  await db.delete(users).where(eq(users.clerkId, SELLER));
}

let server: Server;
let baseUrl = "";

function asBuyer(path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { ...init.headers, "x-test-acting-as": BUYER, "Content-Type": "application/json" } });
}
function asSeller(path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { ...init.headers, "x-test-acting-as": SELLER, "Content-Type": "application/json" } });
}

describe("Two real accounts, real backend: full conversation lifecycle", () => {
  beforeEach(async () => {
    await cleanup();
    await db.insert(users).values([
      { clerkId: BUYER, email: `${BUYER}@example.test`, name: "E2E Buyer", displayName: "E2E Buyer", accountType: "buyer", onboardingComplete: true },
      { clerkId: SELLER, email: `${SELLER}@example.test`, name: "E2E Seller", displayName: "E2E Seller", accountType: "seller", onboardingComplete: true },
    ]);

    if (!server) {
      const { default: conversationsRouter } = await import("../conversations");
      const app = express();
      app.use(express.json());
      app.use("/api/conversations", conversationsRouter);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
  });

  afterAll(async () => {
    await cleanup();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("send, receive without a Seller-side write, read receipts, typing, and reload persistence", async () => {
    // ── Buyer creates the conversation and sends the first message ──────────
    const createRes = await asBuyer("/api/conversations", {
      method: "POST",
      body: JSON.stringify({
        type: "buyer_to_seller",
        participant: { userId: SELLER, name: "E2E Seller", handle: "@e2eseller", initials: "ES", color: "#111111", accountType: "seller" },
        myInfo: { name: "E2E Buyer", handle: "@e2ebuyer", initials: "EB", color: "#222222", accountType: "buyer" },
      }),
    });
    expect(createRes.status).toBe(201);
    const conv = await createRes.json() as { id: string };

    const send1 = await asBuyer(`/api/conversations/${conv.id}/messages`, {
      method: "POST", body: JSON.stringify({ text: "Hey — is this still available?" }),
    });
    expect(send1.status).toBe(201);
    const msg1 = await send1.json() as { id: string; readAt?: string };
    expect(msg1.readAt).toBeUndefined(); // not read yet — Seller hasn't opened it

    // ── "Real time" receive: Seller polls, with NO write of its own ─────────
    const sellerFetch1 = await asSeller(`/api/conversations/${conv.id}/messages`);
    const sellerView1 = await sellerFetch1.json() as Array<{ id: string; text: string; fromId: string }>;
    expect(sellerView1).toHaveLength(1);
    expect(sellerView1[0].text).toBe("Hey — is this still available?");
    expect(sellerView1[0].fromId).toBe(BUYER);

    // ── Read receipts: Seller marks read → Buyer's next fetch shows readAt ──
    const markRead = await asSeller(`/api/conversations/${conv.id}/read`, { method: "PATCH", body: JSON.stringify({}) });
    expect(markRead.status).toBe(200);
    const buyerFetch1 = await asBuyer(`/api/conversations/${conv.id}/messages`);
    const buyerView1 = await buyerFetch1.json() as Array<{ id: string; readAt?: string }>;
    expect(buyerView1[0].readAt).toBeTruthy();

    // ── Typing indicator: Buyer types → Seller's conv fetch sees it ─────────
    const typingOn = await asBuyer(`/api/conversations/${conv.id}/typing`, { method: "PATCH", body: JSON.stringify({ typing: true }) });
    expect(typingOn.status).toBe(200);
    const sellerConvWhileTyping = await asSeller(`/api/conversations/${conv.id}`).then((r) => r.json()) as { otherTyping?: boolean };
    expect(sellerConvWhileTyping.otherTyping).toBe(true);
    // Buyer's OWN view never shows its own typing as otherTyping.
    const buyerOwnConvWhileTyping = await asBuyer(`/api/conversations/${conv.id}`).then((r) => r.json()) as { otherTyping?: boolean };
    expect(buyerOwnConvWhileTyping.otherTyping).toBe(false);

    // Buyer sends the message (client clears typing on send) — Seller sees
    // the new message AND typing clearing.
    const typingOff = await asBuyer(`/api/conversations/${conv.id}/typing`, { method: "PATCH", body: JSON.stringify({ typing: false }) });
    expect(typingOff.status).toBe(200);
    const send2 = await asBuyer(`/api/conversations/${conv.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Also — do you ship internationally?" }) });
    expect(send2.status).toBe(201);
    const sellerConvAfterSend = await asSeller(`/api/conversations/${conv.id}`).then((r) => r.json()) as { otherTyping?: boolean };
    expect(sellerConvAfterSend.otherTyping).toBe(false);

    // This buyer has no real order with this seller and the seller doesn't
    // follow the buyer, so the conversation landed in the seller's Requests
    // (lib/conversationRouting.ts) — the seller can't reply until accepting.
    const replyBeforeAccept = await asSeller(`/api/conversations/${conv.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Too soon" }) });
    expect(replyBeforeAccept.status).toBe(403);
    const acceptRes = await asSeller(`/api/conversations/${conv.id}/accept`, { method: "PATCH" });
    expect(acceptRes.status).toBe(200);

    // Seller replies — now allowed, post-acceptance.
    const sellerReply = await asSeller(`/api/conversations/${conv.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Yep, still have it — and yes, we do!" }) });
    expect(sellerReply.status).toBe(201);

    // ── Persistence after "reload": fresh, independent fetches for both ─────
    // sides return the full thread, in order, with read state intact.
    const buyerReload = await asBuyer(`/api/conversations/${conv.id}/messages`).then((r) => r.json()) as Array<{ text: string; fromId: string; readAt?: string }>;
    expect(buyerReload.map((m) => m.text)).toEqual([
      "Hey — is this still available?",
      "Also — do you ship internationally?",
      "Yep, still have it — and yes, we do!",
    ]);
    expect(buyerReload[0].readAt).toBeTruthy(); // survived the reload

    const sellerReload = await asSeller(`/api/conversations/${conv.id}/messages`).then((r) => r.json()) as Array<{ text: string }>;
    expect(sellerReload).toHaveLength(3);
  });
});
