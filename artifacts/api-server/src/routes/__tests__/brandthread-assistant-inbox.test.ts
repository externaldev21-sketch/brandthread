/**
 * Integration test (real DB): the pinned Brandthread chat in every inbox.
 *
 *   - GET /api/conversations creates the welcome thread on first open, once
 *     (idempotent across repeated and concurrent opens).
 *   - The Brandthread chat is always first — even when newer threads exist
 *     and even when the page is smaller than the inbox.
 *   - It can be muted but never deleted.
 *   - POST /api/brandthread-agent/message replies with an honest offline
 *     message when the LLM isn't configured or the flag is off, and turns an
 *     allowlisted [[open:...]] token into a deep-link card.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, pool, users, conversations, conversationParticipants, messages, agentConversations,
} from "@workspace/db";
import { BRANDTHREAD_AGENT_CLERK_ID, BUYER_WELCOME_STEPS } from "../../lib/brandthreadAgent";
import {
  ASSISTANT_FLAG_KEY, ASSISTANT_OFFLINE_REPLY, resetAssistantFlagCache, resetEnsuredWelcomeCache,
} from "../../lib/brandthreadAssistant";

const TEST_BUYER = `assistant-inbox-buyer-${process.pid}`;
const TEST_SELLER = `assistant-inbox-seller-${process.pid}`;
const OTHER = `assistant-inbox-other-${process.pid}`;
let currentUser = TEST_BUYER;
let llmReply = "";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = currentUser;
    next();
  },
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: llmReply } }] }) } },
  },
}));

// The seller prompt normally loads the /ai-brain snapshot; keep this test on
// the inbox plumbing only.
vi.mock("../../lib/sellerSnapshot", () => ({
  buildSellerSnapshot: async () => { throw new Error("snapshot not needed in this test"); },
}));

const ALL = [TEST_BUYER, TEST_SELLER, OTHER];

async function cleanup() {
  const parts = await db.select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants).where(inArray(conversationParticipants.userId, ALL));
  const ids = [...new Set(parts.map((p) => p.conversationId))];
  if (ids.length) {
    await db.delete(messages).where(inArray(messages.conversationId, ids));
    await db.delete(conversationParticipants).where(inArray(conversationParticipants.conversationId, ids));
    await db.delete(conversations).where(inArray(conversations.id, ids));
  }
  await db.delete(agentConversations).where(inArray(agentConversations.userId, ALL));
  await db.delete(users).where(inArray(users.clerkId, ALL));
}

async function agentConvIdFor(userId: string): Promise<string | undefined> {
  const [row] = await db.select({ id: agentConversations.conversationId })
    .from(agentConversations).where(eq(agentConversations.userId, userId));
  return row?.id;
}

async function newerOrdinaryConv(userId: string, minutesAhead: number) {
  const at = new Date(Date.now() + minutesAhead * 60_000);
  const [conv] = await db.insert(conversations)
    .values({ type: "buyer_to_buyer", lastMessage: "hey", lastMessageAt: at, updatedAt: at }).returning();
  await db.insert(conversationParticipants).values([
    { conversationId: conv.id, userId, name: "Me", accountType: "buyer" },
    { conversationId: conv.id, userId: OTHER, name: "Other", accountType: "buyer" },
  ]);
  return conv.id;
}

async function setFlag(enabled: boolean) {
  await pool.query(
    `INSERT INTO feature_flags (key, enabled, description) VALUES ($1, $2, '')
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [ASSISTANT_FLAG_KEY, enabled],
  );
  resetAssistantFlagCache();
}

let server: Server;
let baseUrl = "";
const savedEnv = {
  key: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  url: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
};

function setAiEnv(on: boolean) {
  if (on) {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "http://127.0.0.1:9/v1";
  } else {
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  }
}

describe("Brandthread assistant — pinned inbox chat", () => {
  beforeAll(async () => {
    const [{ default: conversationsRouter }, { default: agentRouter }] = await Promise.all([
      import("../conversations"),
      import("../brandthread-agent"),
    ]);
    const app = express();
    app.use(express.json());
    app.use("/api/conversations", conversationsRouter);
    app.use("/api/brandthread-agent", agentRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanup();
    resetEnsuredWelcomeCache();
    currentUser = TEST_BUYER;
    llmReply = "";
    setAiEnv(false);
    await db.insert(users).values([
      { clerkId: TEST_BUYER, email: `${TEST_BUYER}@example.test`, name: "Inbox Buyer", displayName: "Inbox Buyer", accountType: "buyer", onboardingComplete: true },
      { clerkId: TEST_SELLER, email: `${TEST_SELLER}@example.test`, name: "Inbox Seller", displayName: "Inbox Seller", accountType: "seller", onboardingComplete: true },
      { clerkId: OTHER, email: `${OTHER}@example.test`, name: "Other", displayName: "Other", accountType: "buyer", onboardingComplete: false },
    ]);
  });

  afterAll(async () => {
    await cleanup();
    await setFlag(true);
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = savedEnv.key;
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = savedEnv.url;
    if (savedEnv.key === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (savedEnv.url === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  describe("welcome on first open (idempotent)", () => {
    it("creates exactly one welcome thread across repeated and concurrent opens", async () => {
      expect(await agentConvIdFor(TEST_BUYER)).toBeUndefined();

      const first = await fetch(`${baseUrl}/api/conversations`);
      expect(first.status).toBe(200);
      const body = await first.json() as Array<{ id: string; isOfficial?: boolean; lastMessage?: string }>;
      expect(body).toHaveLength(1);
      expect(body[0].isOfficial).toBe(true);
      expect(body[0].lastMessage).toBeTruthy();

      // Drop the in-process cache so every open really hits the DB path.
      resetEnsuredWelcomeCache();
      await Promise.all([1, 2, 3].map(() => fetch(`${baseUrl}/api/conversations`)));
      resetEnsuredWelcomeCache();
      await fetch(`${baseUrl}/api/conversations`);

      const ledger = await db.select().from(agentConversations).where(eq(agentConversations.userId, TEST_BUYER));
      expect(ledger).toHaveLength(1);
      const agentParts = await db.select({ conversationId: conversationParticipants.conversationId })
        .from(conversationParticipants)
        .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
        .where(and(eq(conversationParticipants.userId, TEST_BUYER), eq(conversations.type, "brandthread_agent")));
      expect(agentParts).toHaveLength(1);
      const msgs = await db.select().from(messages).where(eq(messages.conversationId, ledger[0].conversationId));
      expect(msgs).toHaveLength(BUYER_WELCOME_STEPS.length);
      expect(msgs.every((m) => m.senderId === BRANDTHREAD_AGENT_CLERK_ID)).toBe(true);
    });

    it("never creates one for an account that hasn't finished onboarding", async () => {
      currentUser = OTHER;
      const res = await fetch(`${baseUrl}/api/conversations`);
      expect(res.status).toBe(200);
      expect(await agentConvIdFor(OTHER)).toBeUndefined();
    });
  });

  describe("pinned ordering", () => {
    it("lists the Brandthread chat first even when newer threads exist", async () => {
      await fetch(`${baseUrl}/api/conversations`); // creates the welcome
      const newer1 = await newerOrdinaryConv(TEST_BUYER, 5);
      const newer2 = await newerOrdinaryConv(TEST_BUYER, 10);

      const body = await (await fetch(`${baseUrl}/api/conversations`)).json() as Array<{ id: string; isPinned?: boolean }>;
      const agentId = await agentConvIdFor(TEST_BUYER);
      expect(body.map((c) => c.id)).toEqual([agentId, newer2, newer1]);
      expect(body[0].isPinned).toBe(true);
    });

    it("keeps it on page 1 when the page is smaller than the inbox", async () => {
      await fetch(`${baseUrl}/api/conversations`);
      await newerOrdinaryConv(TEST_BUYER, 5);
      await newerOrdinaryConv(TEST_BUYER, 10);
      const body = await (await fetch(`${baseUrl}/api/conversations?limit=1`)).json() as Array<{ id: string }>;
      expect(body.map((c) => c.id)).toEqual([await agentConvIdFor(TEST_BUYER)]);
    });
  });

  describe("mute yes, delete no", () => {
    it("refuses to delete the Brandthread chat but lets the user mute it", async () => {
      await fetch(`${baseUrl}/api/conversations`);
      const agentId = (await agentConvIdFor(TEST_BUYER))!;

      const del = await fetch(`${baseUrl}/api/conversations/${agentId}`, { method: "DELETE" });
      expect(del.status).toBe(409);
      expect((await del.json() as { code: string }).code).toBe("AGENT_THREAD_PERMANENT");
      expect(await agentConvIdFor(TEST_BUYER)).toBe(agentId);

      const mute = await fetch(`${baseUrl}/api/conversations/${agentId}/mute`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ muted: true }),
      });
      expect(mute.status).toBe(200);
    });

    it("still deletes an ordinary conversation", async () => {
      const convId = await newerOrdinaryConv(TEST_BUYER, 1);
      const del = await fetch(`${baseUrl}/api/conversations/${convId}`, { method: "DELETE" });
      expect(del.status).toBe(200);
    });
  });

  describe("assistant replies", () => {
    async function send(text: string) {
      await fetch(`${baseUrl}/api/conversations`);
      const conversationId = (await agentConvIdFor(currentUser))!;
      const res = await fetch(`${baseUrl}/api/brandthread-agent/message`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, text }),
      });
      return { res, body: await res.json() as { agentMessage: { text: string; attachment?: any } } };
    }

    it("replies with the offline message (persisted) when the LLM isn't configured", async () => {
      llmReply = "this must never be shown";
      const { res, body } = await send("How do I post?");
      expect(res.status).toBe(201);
      expect(body.agentMessage.text).toBe(ASSISTANT_OFFLINE_REPLY);
      const conversationId = (await agentConvIdFor(TEST_BUYER))!;
      const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
      expect(conv.lastMessage).toBe(ASSISTANT_OFFLINE_REPLY);
    });

    it("replies with the offline message when the feature flag is off", async () => {
      setAiEnv(true);
      await setFlag(false);
      llmReply = "this must never be shown";
      const { body } = await send("What's LIVE?");
      expect(body.agentMessage.text).toBe(ASSISTANT_OFFLINE_REPLY);
      await setFlag(true);
    });

    it("turns an allowlisted link token into a deep-link card for sellers", async () => {
      setAiEnv(true);
      await setFlag(true);
      currentUser = TEST_SELLER;
      llmReply = "Start in Store Builder: add your name and theme, then publish. [[open:store_builder]]";
      const { body } = await send("Set up my store");
      expect(body.agentMessage.text).toBe("Start in Store Builder: add your name and theme, then publish.");
      expect(body.agentMessage.attachment).toMatchObject({
        type: "agent_card", title: "Open Store Builder", meta: { cardKind: "link", deepLink: "/store-builder" },
      });
    });

    it("drops link tokens that aren't allowed for the user's role", async () => {
      setAiEnv(true);
      await setFlag(true);
      llmReply = "Sellers use Store Builder. [[open:store_builder]]";
      const { body } = await send("How do stores work?");
      expect(body.agentMessage.text).toBe("Sellers use Store Builder.");
      expect(body.agentMessage.attachment).toBeUndefined();
    });
  });
});
