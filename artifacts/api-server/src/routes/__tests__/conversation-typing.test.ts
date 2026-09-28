/**
 * Integration test (real DB): PATCH /api/conversations/:id/typing sets the
 * caller's conversation_participants.typing_until, and GET /api/conversations/:id
 * reflects the OTHER participant's typing state as `otherTyping` — never my
 * own, and never for the Brandthread Agent's conversation (that one's own
 * "typing…" signal is `agentTyping`, driven by conversations.agentTypingUntil).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { db, users, conversations, conversationParticipants } from "@workspace/db";

const BUYER = `typing-buyer-${process.pid}`;
const SELLER = `typing-seller-${process.pid}`;

let actingAs = BUYER;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = actingAs;
    next();
  },
}));

async function cleanup() {
  const rows = await db.select({ id: conversationParticipants.conversationId })
    .from(conversationParticipants).where(eq(conversationParticipants.userId, BUYER));
  for (const row of rows) {
    await db.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, row.id));
    await db.delete(conversations).where(eq(conversations.id, row.id));
  }
  await db.delete(users).where(eq(users.clerkId, BUYER));
  await db.delete(users).where(eq(users.clerkId, SELLER));
}

let server: Server;
let baseUrl = "";
let convId = "";

describe("PATCH /api/conversations/:id/typing", () => {
  beforeEach(async () => {
    actingAs = BUYER;
    await cleanup();
    await db.insert(users).values([
      { clerkId: BUYER, email: `${BUYER}@example.test`, name: "Typing Buyer", displayName: "Typing Buyer", accountType: "buyer", onboardingComplete: true },
      { clerkId: SELLER, email: `${SELLER}@example.test`, name: "Typing Seller", displayName: "Typing Seller", accountType: "seller", onboardingComplete: true },
    ]);
    const [conv] = await db.insert(conversations).values({ type: "buyer_to_seller" }).returning();
    convId = conv.id;
    await db.insert(conversationParticipants).values([
      { conversationId: convId, userId: BUYER, name: "Typing Buyer", accountType: "buyer" },
      { conversationId: convId, userId: SELLER, name: "Typing Seller", accountType: "seller" },
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

  it("the OTHER participant sees otherTyping:true after I set typing:true, never on my own view", async () => {
    actingAs = BUYER;
    const setRes = await fetch(`${baseUrl}/api/conversations/${convId}/typing`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ typing: true }),
    });
    expect(setRes.status).toBe(200);

    const mine = await fetch(`${baseUrl}/api/conversations/${convId}`).then((r) => r.json()) as { otherTyping?: boolean };
    expect(mine.otherTyping).toBe(false);

    actingAs = SELLER;
    const theirs = await fetch(`${baseUrl}/api/conversations/${convId}`).then((r) => r.json()) as { otherTyping?: boolean };
    expect(theirs.otherTyping).toBe(true);
  });

  it("clears with typing:false", async () => {
    actingAs = BUYER;
    await fetch(`${baseUrl}/api/conversations/${convId}/typing`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ typing: true }),
    });
    await fetch(`${baseUrl}/api/conversations/${convId}/typing`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ typing: false }),
    });

    actingAs = SELLER;
    const theirs = await fetch(`${baseUrl}/api/conversations/${convId}`).then((r) => r.json()) as { otherTyping?: boolean };
    expect(theirs.otherTyping).toBe(false);
  });

  it("a non-member gets 404", async () => {
    actingAs = `typing-stranger-${process.pid}`;
    const res = await fetch(`${baseUrl}/api/conversations/${convId}/typing`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ typing: true }),
    });
    expect(res.status).toBe(404);
  });
});
