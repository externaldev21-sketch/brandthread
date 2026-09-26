/**
 * Integration test (real DB): POST /api/brandthread-agent/message is rate
 * limited under its own "agent-chat" policy, separate from ordinary DM
 * "messaging" rate limits.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { db, users, conversations, conversationParticipants, messages, agentConversations } from "@workspace/db";
import { createWelcomeConversationOnce } from "../../lib/brandthreadAgent";
import { RATE_LIMIT_POLICIES } from "../../middlewares/rateLimit";

const TEST_BUYER = `agent-rate-limit-buyer-${process.pid}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = TEST_BUYER;
    next();
  },
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: "hey there" } }] }) } },
  },
}));

let server: Server;
let baseUrl = "";
let conversationId = "";

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
}

describe("agent-chat rate limit", () => {
  beforeAll(async () => {
    await cleanup();
    await db.insert(users).values({
      clerkId: TEST_BUYER, email: `${TEST_BUYER}@example.test`, name: "Rate Limit Buyer",
      displayName: "Rate Limit Buyer", accountType: "buyer", onboardingComplete: true,
    });
    const welcome = await createWelcomeConversationOnce(TEST_BUYER, "buyer", {
      name: "Rate Limit Buyer", handle: "", initials: "RB", color: "#8B5CF6",
    });
    conversationId = welcome.conversationId;

    const { default: brandthreadAgentRouter } = await import("../brandthread-agent");
    const app = express();
    app.use(express.json());
    app.use("/api/brandthread-agent", brandthreadAgentRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await cleanup();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("has its own named policy, distinct from ordinary DM messaging", () => {
    expect(RATE_LIMIT_POLICIES["agent-chat"]).toBeDefined();
    expect(RATE_LIMIT_POLICIES["agent-chat"].id).not.toBe(RATE_LIMIT_POLICIES.messaging.id);
  });

  it("returns 429 once the per-user limit is exceeded", async () => {
    const limit = RATE_LIMIT_POLICIES["agent-chat"].limit;
    let sawRateLimited = false;
    for (let i = 0; i < limit + 3; i++) {
      const res = await fetch(`${baseUrl}/api/brandthread-agent/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, text: `message number ${i}` }),
      });
      if (res.status === 429) {
        sawRateLimited = true;
        const body = await res.json() as { code?: string };
        expect(body.code).toBe("RATE_LIMITED");
        break;
      }
      expect(res.status).toBe(201);
    }
    expect(sawRateLimited).toBe(true);
  }, 60_000);
});
