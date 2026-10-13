/**
 * Integration test (real DB) for Messages polish:
 *  - #165 PATCH /:id/mute: one handler; the app's { durationMinutes } body
 *    works (it used to 400), -1 means "until I turn it back on", and the
 *    conversation view reports isMuted/mutedUntil.
 *  - #157 read receipts off: the sender never sees "read"/readAt on messages
 *    sent to someone who turned receipts off.
 *  - #166 DELETE /:id/messages/:messageId: sender-only, within 10 minutes,
 *    gone for everyone, inbox preview falls back.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { db, users, conversations, conversationParticipants, messages } from "@workspace/db";

const BUYER = `mur-buyer-${process.pid}`;
const SELLER = `mur-seller-${process.pid}`;
let actingAs = BUYER;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = actingAs; next(); },
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

const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
  const r = await fetch(`${baseUrl}/api/conversations${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};

async function addMessage(senderId: string, body: string, minutesAgo = 0, extra: Record<string, unknown> = {}) {
  const [m] = await db.insert(messages).values({
    conversationId: convId, senderId, body, createdAt: new Date(Date.now() - minutesAgo * 60_000), ...extra,
  } as any).returning({ id: messages.id });
  return m.id;
}

describe("messages polish", () => {
  beforeEach(async () => {
    actingAs = BUYER;
    await cleanup();
    await db.insert(users).values([
      { clerkId: BUYER, email: `${BUYER}@example.test`, name: "Mur Buyer", displayName: "Mur Buyer", accountType: "buyer", onboardingComplete: true },
      { clerkId: SELLER, email: `${SELLER}@example.test`, name: "Mur Seller", displayName: "Mur Seller", accountType: "seller", onboardingComplete: true },
    ]);
    const [conv] = await db.insert(conversations).values({ type: "buyer_to_seller" }).returning();
    convId = conv.id;
    await db.insert(conversationParticipants).values([
      { conversationId: convId, userId: BUYER, name: "Mur Buyer", accountType: "buyer" },
      { conversationId: convId, userId: SELLER, name: "Mur Seller", accountType: "seller" },
    ]);
    if (!server) {
      const { default: router } = await import("../conversations");
      const app = express();
      app.use(express.json());
      app.use("/api/conversations", router);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
  });

  afterAll(async () => {
    await cleanup();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  describe("mute (#165)", () => {
    it("accepts the app's durationMinutes body and reflects it on the conversation", async () => {
      const timed = await call(`/${convId}/mute`, { method: "PATCH", body: { durationMinutes: 60 } });
      expect(timed.status).toBe(200);
      expect(timed.body.muted).toBe(true);
      const until = Date.parse(timed.body.mutedUntil);
      expect(until - Date.now()).toBeGreaterThan(55 * 60_000);
      const view = await call(`/${convId}`);
      expect(view.body.isMuted).toBe(true);
      expect(view.body.mutedUntil).toBe(timed.body.mutedUntil);
    });

    it("-1 means until turned back on; null unmutes; { muted } also works", async () => {
      const forever = await call(`/${convId}/mute`, { method: "PATCH", body: { durationMinutes: -1 } });
      expect(forever.body.mutedUntil?.startsWith("9999-")).toBe(true);
      const off = await call(`/${convId}/mute`, { method: "PATCH", body: { durationMinutes: null } });
      expect(off.body).toMatchObject({ muted: false, mutedUntil: null });
      expect((await call(`/${convId}`)).body.isMuted).toBe(false);
      const legacy = await call(`/${convId}/mute`, { method: "PATCH", body: { muted: true } });
      expect(legacy.body.muted).toBe(true);
    });

    it("rejects junk and only affects my own row", async () => {
      expect((await call(`/${convId}/mute`, { method: "PATCH", body: { durationMinutes: "soon" } })).status).toBe(400);
      expect((await call(`/${convId}/mute`, { method: "PATCH", body: { durationMinutes: 1.5 } })).status).toBe(400);
      await call(`/${convId}/mute`, { method: "PATCH", body: { durationMinutes: -1 } });
      actingAs = SELLER;
      expect((await call(`/${convId}`)).body.isMuted).toBe(false);
    });
  });

  describe("read receipts (#157)", () => {
    it("hides Seen from the sender only when the reader turned receipts off", async () => {
      await addMessage(BUYER, "hi", 1, { status: "read", readAt: new Date() });
      const seen = await call(`/${convId}/messages`);
      expect(seen.body[0]).toMatchObject({ status: "read" });
      expect(seen.body[0].readAt).toBeTruthy();

      await db.update(users).set({ readReceiptsEnabled: false }).where(eq(users.clerkId, SELLER));
      const hidden = await call(`/${convId}/messages`);
      expect(hidden.body[0].status).toBe("delivered");
      expect(hidden.body[0].readAt).toBeUndefined();

      // The seller's own messages are unaffected by the buyer's setting.
      await addMessage(SELLER, "hello back", 0, { status: "read", readAt: new Date() });
      actingAs = SELLER;
      const sellerView = await call(`/${convId}/messages`);
      expect(sellerView.body.find((m: any) => m.text === "hello back").status).toBe("read");
    });
  });

  describe("unsend (#166)", () => {
    it("removes a recent message for everyone and rolls the inbox preview back", async () => {
      await addMessage(BUYER, "first", 3);
      const oops = await addMessage(BUYER, "oops", 1);
      await db.update(conversations).set({ lastMessage: "oops", lastMessageAt: new Date(Date.now() - 60_000) })
        .where(eq(conversations.id, convId));

      const r = await call(`/${convId}/messages/${oops}`, { method: "DELETE" });
      expect(r.status).toBe(200);
      expect((await call(`/${convId}/messages`)).body.map((m: any) => m.text)).toEqual(["first"]);
      actingAs = SELLER;
      expect((await call(`/${convId}/messages`)).body.map((m: any) => m.text)).toEqual(["first"]);
      const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId));
      expect(conv.lastMessage).toBe("first");
      const [row] = await db.select().from(messages).where(eq(messages.id, oops));
      expect(row.deletedBy).toBe(BUYER);
    });

    it("refuses other people's messages and anything older than 10 minutes", async () => {
      const theirs = await addMessage(SELLER, "seller line", 1);
      expect((await call(`/${convId}/messages/${theirs}`, { method: "DELETE" })).status).toBe(403);
      const old = await addMessage(BUYER, "old line", 11);
      const late = await call(`/${convId}/messages/${old}`, { method: "DELETE" });
      expect(late.status).toBe(409);
      expect(late.body.code).toBe("UNSEND_WINDOW_PASSED");
      expect((await call(`/${convId}/messages/${crypto.randomUUID()}`, { method: "DELETE" })).status).toBe(404);
    });
  });
});
