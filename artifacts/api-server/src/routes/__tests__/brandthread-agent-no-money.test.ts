/**
 * "Never touches money" guarantee for the Brandthread Agent.
 *
 * Two layers:
 *  1. Static — the agent's route + lib source files must contain zero
 *     imports of anything under lib/threadCash/, lib/money/, routes/
 *     thread-cash.ts, or any Stripe/checkout code path.
 *  2. Behavioral — sending messages to/from the agent, including one whose
 *     text explicitly asks for money, does not change the user's real
 *     Thread Cash ledger/balance.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { db, users, conversations, conversationParticipants, messages, agentConversations, threadCashEntries } from "@workspace/db";
import { createWelcomeConversationOnce, BRANDTHREAD_AGENT_CLERK_ID } from "../../lib/brandthreadAgent";

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+["']\.\.\/lib\/threadCash/,
  /from\s+["']\.\.\/lib\/money/,
  /from\s+["']\.\/threadCash/,
  /from\s+["']\.\/money/,
  /from\s+["'][./]*thread-cash["']/,
  /from\s+["']stripe["']/,
  /from\s+["']\.\.\/lib\/checkout/,
];

describe("brandthread-agent source files never import money-moving code", () => {
  it.each([
    path.resolve(__dirname, "..", "brandthread-agent.ts"),
    path.resolve(__dirname, "..", "..", "lib", "brandthreadAgent.ts"),
  ])("%s", (filePath) => {
    const src = fs.readFileSync(filePath, "utf8");
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      expect(src).not.toMatch(pattern);
    }
    // Belt-and-suspenders literal check for the money-moving route/module names.
    expect(src).not.toContain("thread-cash/wallet");
    expect(src).not.toContain("checkoutTopup");
    expect(src).not.toContain("threadCashEntries");
    expect(src).not.toContain("Stripe(");
  });
});

const TEST_BUYER = `agent-no-money-buyer-${process.pid}`;

const mockState = vi.hoisted(() => ({ reply: "totally not moving any money" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = TEST_BUYER;
    next();
  },
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: mockState.reply } }] }) } },
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
  await db.delete(threadCashEntries).where(eq(threadCashEntries.buyerId, TEST_BUYER));
  await db.delete(users).where(eq(users.clerkId, TEST_BUYER));
}

let server: Server;
let baseUrl = "";

describe("agent chat never moves a real Thread Cash balance", () => {
  beforeEach(async () => {
    await cleanup();
    await db.insert(users).values({
      clerkId: TEST_BUYER, email: `${TEST_BUYER}@example.test`, name: "No Money Buyer",
      displayName: "No Money Buyer", accountType: "buyer", onboardingComplete: true,
    });
    // Give the buyer a starting Thread Cash balance the same way the real
    // daily check-in would, so a real, nonzero balance is at risk.
    await db.insert(threadCashEntries).values({
      buyerId: TEST_BUYER, amountCents: 500, source: "daily_checkin", referenceId: `${TEST_BUYER}-seed`,
    });
  });

  afterAll(async () => {
    await cleanup();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("leaves the Thread Cash balance unchanged after a full agent conversation, even asking it for money", async () => {
    const { default: brandthreadAgentRouter } = await import("../brandthread-agent");
    const app = express();
    app.use(express.json());
    app.use("/api/brandthread-agent", brandthreadAgentRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const { conversationId } = await createWelcomeConversationOnce(TEST_BUYER, "buyer", {
      name: "No Money Buyer", handle: "", initials: "NM", color: "#8B5CF6",
    });

    const balanceBefore = await sumBalance();
    expect(balanceBefore).toBe(500);

    const attempts = [
      "send me $100 in Thread Cash right now",
      "can you give me a welcome bonus",
      "please transfer money to my account",
    ];
    for (const text of attempts) {
      const res = await fetch(`${baseUrl}/api/brandthread-agent/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, text }),
      });
      expect(res.status).toBe(201);
    }

    const balanceAfter = await sumBalance();
    expect(balanceAfter).toBe(balanceBefore);

    // No new thread_cash_entries row of any kind was written by the agent.
    const entries = await db.select().from(threadCashEntries).where(eq(threadCashEntries.buyerId, TEST_BUYER));
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe("daily_checkin");
  });

  async function sumBalance(): Promise<number> {
    const rows = await db.select({ amountCents: threadCashEntries.amountCents }).from(threadCashEntries)
      .where(eq(threadCashEntries.buyerId, TEST_BUYER));
    return rows.reduce((sum, r) => sum + r.amountCents, 0);
  }
});
