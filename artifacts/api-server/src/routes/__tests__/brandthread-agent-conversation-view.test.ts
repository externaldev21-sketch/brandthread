/**
 * Integration test (real DB): GET /api/conversations emits isPinned/
 * isOfficial for the Brandthread Agent's conversation (and not for an
 * ordinary DM), and agentTyping reflects `conversations.agentTypingUntil`.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import {
  db, users, conversations, conversationParticipants, messages, agentConversations,
} from "@workspace/db";
import { createWelcomeConversationOnce } from "../../lib/brandthreadAgent";

const TEST_BUYER = `agent-conv-view-buyer-${process.pid}`;
const OTHER_SELLER = `agent-conv-view-seller-${process.pid}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = TEST_BUYER;
    next();
  },
}));

async function cleanup() {
  const rows = await db.select({ conversationId: agentConversations.conversationId })
    .from(agentConversations).where(eq(agentConversations.userId, TEST_BUYER));
  for (const row of rows) {
    await db.delete(messages).where(eq(messages.conversationId, row.conversationId));
    await db.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, row.conversationId));
    await db.delete(conversations).where(eq(conversations.id, row.conversationId));
  }
  await db.delete(agentConversations).where(eq(agentConversations.userId, TEST_BUYER));
  await db.delete(users).where(eq(users.clerkId, TEST_BUYER));
  await db.delete(users).where(eq(users.clerkId, OTHER_SELLER));
}

let server: Server;
let baseUrl = "";

describe("GET /api/conversations — Brandthread Agent pin/official/typing", () => {
  beforeEach(async () => {
    await cleanup();
    await db.insert(users).values([
      { clerkId: TEST_BUYER, email: `${TEST_BUYER}@example.test`, name: "Conv View Buyer", displayName: "Conv View Buyer", accountType: "buyer", onboardingComplete: true },
      { clerkId: OTHER_SELLER, email: `${OTHER_SELLER}@example.test`, name: "Conv View Seller", displayName: "Conv View Seller", accountType: "seller" },
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

  it("marks the agent conversation isPinned + isOfficial, and an ordinary one neither", async () => {
    const { conversationId: agentConvId } = await createWelcomeConversationOnce(TEST_BUYER, "buyer", {
      name: "Conv View Buyer", handle: "", initials: "CB", color: "#8B5CF6",
    });

    const [ordinaryConv] = await db.insert(conversations).values({ type: "buyer_to_seller" }).returning();
    await db.insert(conversationParticipants).values([
      { conversationId: ordinaryConv.id, userId: TEST_BUYER, name: "Conv View Buyer", accountType: "buyer" },
      { conversationId: ordinaryConv.id, userId: OTHER_SELLER, name: "Conv View Seller", accountType: "seller" },
    ]);

    const res = await fetch(`${baseUrl}/api/conversations`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string; isPinned?: boolean; isOfficial?: boolean; agentTyping?: boolean }>;

    const agentRow = body.find((c) => c.id === agentConvId);
    const ordinaryRow = body.find((c) => c.id === ordinaryConv.id);
    expect(agentRow?.isPinned).toBe(true);
    expect(agentRow?.isOfficial).toBe(true);
    expect(ordinaryRow?.isPinned).toBeUndefined();
    expect(ordinaryRow?.isOfficial).toBeUndefined();
  });

  it("reflects agentTypingUntil as agentTyping:true only while it's in the future", async () => {
    const { conversationId } = await createWelcomeConversationOnce(TEST_BUYER, "buyer", {
      name: "Conv View Buyer", handle: "", initials: "CB", color: "#8B5CF6",
    });
    await db.update(conversations)
      .set({ agentTypingUntil: new Date(Date.now() + 60_000) })
      .where(eq(conversations.id, conversationId));

    const resTyping = await fetch(`${baseUrl}/api/conversations/${conversationId}`);
    expect((await resTyping.json() as { agentTyping?: boolean }).agentTyping).toBe(true);

    await db.update(conversations)
      .set({ agentTypingUntil: new Date(Date.now() - 60_000) })
      .where(eq(conversations.id, conversationId));

    const resDone = await fetch(`${baseUrl}/api/conversations/${conversationId}`);
    expect((await resDone.json() as { agentTyping?: boolean }).agentTyping).toBe(false);
  });
});
