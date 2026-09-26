/**
 * Integration tests (real DB) for the Brandthread Agent welcome-conversation
 * lifecycle: onboarding-hook idempotency and the one-time backfill script.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db, users, conversations, conversationParticipants, messages, agentConversations,
} from "@workspace/db";
import {
  BRANDTHREAD_AGENT_CLERK_ID,
  createWelcomeConversationOnce,
  runAgentWelcomeBackfill,
  canSendProactiveNudge,
  recordProactiveNudge,
} from "../brandthreadAgent";

const TEST_BUYER = `agent-welcome-buyer-${process.pid}`;
const TEST_SELLER = `agent-welcome-seller-${process.pid}`;
const TEST_BACKFILL_USER = `agent-welcome-backfill-${process.pid}`;

async function cleanupUser(clerkId: string) {
  const rows = await db.select({ conversationId: agentConversations.conversationId })
    .from(agentConversations).where(eq(agentConversations.userId, clerkId));
  for (const row of rows) {
    await db.delete(messages).where(eq(messages.conversationId, row.conversationId));
    await db.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, row.conversationId));
    await db.delete(conversations).where(eq(conversations.id, row.conversationId));
  }
  await db.delete(agentConversations).where(eq(agentConversations.userId, clerkId));
  await db.delete(users).where(eq(users.clerkId, clerkId));
}

afterAll(async () => {
  await cleanupUser(TEST_BUYER);
  await cleanupUser(TEST_SELLER);
  await cleanupUser(TEST_BACKFILL_USER);
});

describe("createWelcomeConversationOnce", () => {
  beforeEach(async () => {
    await cleanupUser(TEST_BUYER);
    await cleanupUser(TEST_SELLER);
  });

  it("creates one conversation with the buyer welcome steps + quick replies", async () => {
    const result = await createWelcomeConversationOnce(TEST_BUYER, "buyer", {
      name: "Test Buyer", handle: "@testbuyer", initials: "TB", color: "#8B5CF6",
    });
    expect(result.created).toBe(true);

    const msgs = await db.select().from(messages)
      .where(eq(messages.conversationId, result.conversationId))
      .orderBy(messages.createdAt);
    expect(msgs.length).toBe(3);
    expect(msgs.every((m) => m.senderId === BRANDTHREAD_AGENT_CLERK_ID)).toBe(true);
    expect(msgs[0].body).toContain("welcome to Brandthread");
    const last = msgs[msgs.length - 1];
    expect(last.attachment).toMatchObject({ type: "quick_replies" });
    expect(JSON.parse((last.attachment as any).meta.optionsJson).length).toBeGreaterThan(0);

    const parts = await db.select().from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, result.conversationId));
    expect(parts.map((p) => p.userId).sort()).toEqual([BRANDTHREAD_AGENT_CLERK_ID, TEST_BUYER].sort());
  });

  it("sends seller-specific copy for a seller account", async () => {
    const result = await createWelcomeConversationOnce(TEST_SELLER, "seller", {
      name: "Test Seller", handle: "@testseller", initials: "TS", color: "#8B5CF6",
    });
    const msgs = await db.select({ body: messages.body }).from(messages)
      .where(eq(messages.conversationId, result.conversationId))
      .orderBy(messages.createdAt);
    const allText = msgs.map((m) => m.body).join(" ");
    expect(allText).toMatch(/listing|Go live|payouts|Shopify/i);
  });

  it("is idempotent: calling it twice never creates a second conversation or duplicate messages", async () => {
    const first = await createWelcomeConversationOnce(TEST_BUYER, "buyer", {
      name: "Test Buyer", handle: "@testbuyer", initials: "TB", color: "#8B5CF6",
    });
    const second = await createWelcomeConversationOnce(TEST_BUYER, "buyer", {
      name: "Test Buyer", handle: "@testbuyer", initials: "TB", color: "#8B5CF6",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.conversationId).toBe(first.conversationId);

    const ledgerRows = await db.select().from(agentConversations).where(eq(agentConversations.userId, TEST_BUYER));
    expect(ledgerRows).toHaveLength(1);

    const convRows = await db.select().from(conversations).where(eq(conversations.id, first.conversationId));
    expect(convRows).toHaveLength(1);

    const msgs = await db.select().from(messages).where(eq(messages.conversationId, first.conversationId));
    expect(msgs).toHaveLength(3); // still exactly the one welcome batch, not six
  });

  it("is idempotent under concurrent calls (race-safe via the ledger's primary key)", async () => {
    const [a, b] = await Promise.all([
      createWelcomeConversationOnce(TEST_BUYER, "buyer", { name: "Test Buyer", handle: "", initials: "TB", color: "#8B5CF6" }),
      createWelcomeConversationOnce(TEST_BUYER, "buyer", { name: "Test Buyer", handle: "", initials: "TB", color: "#8B5CF6" }),
    ]);
    expect(a.conversationId).toBe(b.conversationId);
    const created = [a.created, b.created].filter(Boolean);
    expect(created).toHaveLength(1);

    const convRows = await db.select().from(conversations).where(eq(conversations.id, a.conversationId));
    expect(convRows).toHaveLength(1);
  });
});

describe("runAgentWelcomeBackfill", () => {
  beforeEach(async () => {
    await cleanupUser(TEST_BACKFILL_USER);
    await db.insert(users).values({
      clerkId: TEST_BACKFILL_USER,
      email: `${TEST_BACKFILL_USER}@example.test`,
      name: "Backfill Test User",
      displayName: "Backfill Test User",
      accountType: "buyer",
      onboardingComplete: true,
    });
  });

  it("sends the welcome conversation to a pre-existing user missing one", async () => {
    const result = await runAgentWelcomeBackfill(200, { onlyClerkIds: [TEST_BACKFILL_USER] });
    expect(result.created).toBe(1);
    expect(result.scanned).toBe(1);

    const ledger = await db.select().from(agentConversations).where(eq(agentConversations.userId, TEST_BACKFILL_USER));
    expect(ledger).toHaveLength(1);
  });

  it("converges to zero new conversations on a second run", async () => {
    await runAgentWelcomeBackfill(200, { onlyClerkIds: [TEST_BACKFILL_USER] });
    const second = await runAgentWelcomeBackfill(200, { onlyClerkIds: [TEST_BACKFILL_USER] });

    const ledger = await db.select().from(agentConversations).where(eq(agentConversations.userId, TEST_BACKFILL_USER));
    expect(ledger).toHaveLength(1);
    // No user still missing a conversation should have been (re)scanned as
    // needing one a second time.
    const stillMissing = await db.select({ id: users.id }).from(users)
      .leftJoin(agentConversations, eq(agentConversations.userId, users.clerkId))
      .where(and(eq(users.clerkId, TEST_BACKFILL_USER)));
    expect(stillMissing.length).toBe(1);
    expect(second.created).toBe(0);
  });
});

describe("proactive nudge anti-spam gate", () => {
  beforeEach(async () => {
    await cleanupUser(TEST_BUYER);
  });

  it("allows a nudge for a conversation that has never been nudged", async () => {
    const { conversationId } = await createWelcomeConversationOnce(TEST_BUYER, "buyer", {
      name: "Test Buyer", handle: "", initials: "TB", color: "#8B5CF6",
    });
    expect(await canSendProactiveNudge(conversationId)).toBe(true);
  });

  it("blocks a second nudge shortly after the first", async () => {
    const { conversationId } = await createWelcomeConversationOnce(TEST_BUYER, "buyer", {
      name: "Test Buyer", handle: "", initials: "TB", color: "#8B5CF6",
    });
    await recordProactiveNudge(conversationId);
    expect(await canSendProactiveNudge(conversationId)).toBe(false);
  });
});
