/**
 * Integration test (real DB): seller quick replies CRUD, away auto-reply, and
 * lock-in tests for the pre-existing read-receipt + message-request wiring.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db, users, conversations, conversationParticipants, messages, sellerQuickReplies, sellerAwaySettings,
} from "@workspace/db";

const BUYER = `smt-buyer-${process.pid}`;
const SELLER = `smt-seller-${process.pid}`;
const OTHER_SELLER = `smt-seller2-${process.pid}`;
const ALL = [BUYER, SELLER, OTHER_SELLER];

let actingAs = BUYER;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = actingAs;
    next();
  },
}));
vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: any, _res: any, next: () => void) => next(),
}));

async function cleanup() {
  const rows = await db.select({ id: conversationParticipants.conversationId })
    .from(conversationParticipants).where(inArray(conversationParticipants.userId, ALL));
  for (const row of rows) {
    await db.delete(messages).where(eq(messages.conversationId, row.id));
    await db.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, row.id));
    await db.delete(conversations).where(eq(conversations.id, row.id));
  }
  await db.delete(sellerQuickReplies).where(inArray(sellerQuickReplies.sellerId, ALL));
  await db.delete(sellerAwaySettings).where(inArray(sellerAwaySettings.sellerId, ALL));
  await db.delete(users).where(inArray(users.clerkId, ALL));
}

let server: Server;
let baseUrl = "";
let convId = "";

const json = { "Content-Type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });

async function makeConversation(isRequest = false) {
  const [conv] = await db.insert(conversations).values({
    type: "buyer_to_seller", isRequest, requestedBy: isRequest ? BUYER : null,
  }).returning();
  await db.insert(conversationParticipants).values([
    { conversationId: conv!.id, userId: BUYER, name: "Buyer", accountType: "buyer" },
    { conversationId: conv!.id, userId: SELLER, name: "Shop", accountType: "seller" },
  ]);
  return conv!.id;
}

describe("seller messaging tools", () => {
  beforeEach(async () => {
    actingAs = BUYER;
    await cleanup();
    await db.insert(users).values([
      { clerkId: BUYER, email: `${BUYER}@example.test`, name: "Buyer", displayName: "Buyer", accountType: "buyer", onboardingComplete: true },
      { clerkId: SELLER, email: `${SELLER}@example.test`, name: "Shop", displayName: "Shop", accountType: "seller", onboardingComplete: true },
      { clerkId: OTHER_SELLER, email: `${OTHER_SELLER}@example.test`, name: "Shop2", displayName: "Shop2", accountType: "seller", onboardingComplete: true },
    ]);
    convId = await makeConversation();
    if (!server) {
      const { default: conversationsRouter } = await import("../conversations");
      const { quickRepliesRouter, awayMessageRouter } = await import("../seller-messaging-tools");
      const app = express();
      app.use(express.json());
      app.use("/api/conversations", conversationsRouter);
      app.use("/api/seller/quick-replies", quickRepliesRouter);
      app.use("/api/seller/away-message", awayMessageRouter);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
  });

  afterAll(async () => {
    await cleanup();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  describe("quick replies", () => {
    it("create / list / edit / delete, scoped per seller", async () => {
      actingAs = SELLER;
      const created = await call("POST", "/api/seller/quick-replies", { title: "Shipping", body: "Ships in 3 days", shortcut: "Shipping" });
      expect(created.status).toBe(201);
      const qr = await created.json() as { id: string; shortcut: string };
      expect(qr.shortcut).toBe("/shipping");

      const edited = await call("PUT", `/api/seller/quick-replies/${qr.id}`, { title: "Shipping", body: "Ships in 2 days", shortcut: "ship" });
      expect(edited.status).toBe(200);
      expect((await edited.json() as { body: string }).body).toBe("Ships in 2 days");

      const list = await (await call("GET", "/api/seller/quick-replies")).json() as { quickReplies: unknown[] };
      expect(list.quickReplies).toHaveLength(1);

      // Another seller can neither see, edit nor delete it.
      actingAs = OTHER_SELLER;
      const theirs = await (await call("GET", "/api/seller/quick-replies")).json() as { quickReplies: unknown[] };
      expect(theirs.quickReplies).toHaveLength(0);
      expect((await call("PUT", `/api/seller/quick-replies/${qr.id}`, { title: "x", body: "y" })).status).toBe(404);
      expect((await call("DELETE", `/api/seller/quick-replies/${qr.id}`)).status).toBe(404);

      actingAs = SELLER;
      expect((await call("DELETE", `/api/seller/quick-replies/${qr.id}`)).status).toBe(200);
      const after = await (await call("GET", "/api/seller/quick-replies")).json() as { quickReplies: unknown[] };
      expect(after.quickReplies).toHaveLength(0);
    });

    it("rejects duplicate shortcuts (case-insensitive) for the same seller but allows them across sellers", async () => {
      actingAs = SELLER;
      expect((await call("POST", "/api/seller/quick-replies", { title: "A", body: "a", shortcut: "/hi" })).status).toBe(201);
      const dup = await call("POST", "/api/seller/quick-replies", { title: "B", body: "b", shortcut: "HI" });
      expect(dup.status).toBe(409);
      actingAs = OTHER_SELLER;
      expect((await call("POST", "/api/seller/quick-replies", { title: "B", body: "b", shortcut: "hi" })).status).toBe(201);
    });

    it("validates input and enforces the per-seller limit", async () => {
      actingAs = SELLER;
      expect((await call("POST", "/api/seller/quick-replies", { title: "", body: "x" })).status).toBe(400);
      await db.insert(sellerQuickReplies).values(
        Array.from({ length: 50 }, (_, i) => ({ sellerId: SELLER, title: `t${i}`, body: "b" })),
      );
      const over = await call("POST", "/api/seller/quick-replies", { title: "one more", body: "x" });
      expect(over.status).toBe(409);
    });

    it("buyers cannot use the seller endpoints", async () => {
      actingAs = BUYER;
      expect((await call("GET", "/api/seller/quick-replies")).status).toBe(403);
      expect((await call("POST", "/api/seller/quick-replies", { title: "a", body: "b" })).status).toBe(403);
      expect((await call("PUT", "/api/seller/away-message", { enabled: false })).status).toBe(403);
    });
  });

  describe("away auto-reply", () => {
    const enable = (extra: Record<string, unknown> = {}) =>
      call("PUT", "/api/seller/away-message", { enabled: true, message: "We're away, back soon!", mode: "always", ...extra });

    async function thread() {
      return db.select().from(messages).where(eq(messages.conversationId, convId)).orderBy(messages.createdAt);
    }

    it("replies once per conversation per window, flagged automated, from the seller", async () => {
      actingAs = SELLER;
      expect((await enable()).status).toBe(200);

      actingAs = BUYER;
      expect((await call("POST", `/api/conversations/${convId}/messages`, { text: "hello?" })).status).toBe(201);
      expect((await call("POST", `/api/conversations/${convId}/messages`, { text: "anyone there?" })).status).toBe(201);

      const rows = await thread();
      expect(rows.map((r) => r.body)).toEqual(["hello?", "We're away, back soon!", "anyone there?"]);
      const auto = rows[1]!;
      expect(auto.isAutomated).toBe(true);
      expect(auto.senderId).toBe(SELLER);
      expect(rows[0]!.isAutomated).toBe(false);

      // The API marks it automated for clients.
      const listed = await (await call("GET", `/api/conversations/${convId}/messages`)).json() as any;
      const items = Array.isArray(listed) ? listed : listed.messages;
      expect(items.find((m: any) => m.id === auto.id).automated).toBe(true);
    });

    it("re-saving settings starts a new window (buyer is answered again)", async () => {
      actingAs = SELLER;
      await enable();
      actingAs = BUYER;
      await call("POST", `/api/conversations/${convId}/messages`, { text: "one" });
      actingAs = SELLER;
      await enable({ message: "Updated away message" });
      actingAs = BUYER;
      await call("POST", `/api/conversations/${convId}/messages`, { text: "two" });
      const bodies = (await thread()).map((r) => r.body);
      expect(bodies).toEqual(["one", "We're away, back soon!", "two", "Updated away message"]);
    });

    it("does not reply when disabled, or to the seller's own messages", async () => {
      actingAs = BUYER;
      await call("POST", `/api/conversations/${convId}/messages`, { text: "hi" });
      actingAs = SELLER;
      await enable();
      await call("POST", `/api/conversations/${convId}/messages`, { text: "seller writes" });
      expect((await thread()).map((r) => r.body)).toEqual(["hi", "seller writes"]);
    });

    it("does not reply inside a pending request, and never loops", async () => {
      actingAs = SELLER;
      await enable();
      const reqConv = await makeConversation(true);
      actingAs = BUYER;
      await call("POST", `/api/conversations/${reqConv}/messages`, { text: "request hello" });
      const reqRows = await db.select().from(messages).where(eq(messages.conversationId, reqConv));
      expect(reqRows).toHaveLength(1);

      // Normal conversation: exactly one automated row no matter how many sends.
      for (let i = 0; i < 3; i++) {
        await call("POST", `/api/conversations/${convId}/messages`, { text: `m${i}` });
      }
      expect((await thread()).filter((r) => r.isAutomated)).toHaveLength(1);
    });

    it("outside_hours: replies only when the seller is closed", async () => {
      actingAs = SELLER;
      // Open every day, all day -> never away.
      await enable({ mode: "outside_hours", timezone: "UTC", openDays: 127, openMinute: 0, closeMinute: 0 });
      actingAs = BUYER;
      await call("POST", `/api/conversations/${convId}/messages`, { text: "open now" });
      expect((await thread()).filter((r) => r.isAutomated)).toHaveLength(0);

      // No open days -> always away.
      actingAs = SELLER;
      await enable({ mode: "outside_hours", timezone: "UTC", openDays: 0 });
      actingAs = BUYER;
      await call("POST", `/api/conversations/${convId}/messages`, { text: "closed now" });
      expect((await thread()).filter((r) => r.isAutomated)).toHaveLength(1);
    });

    it("validates away settings", async () => {
      actingAs = SELLER;
      expect((await call("PUT", "/api/seller/away-message", { enabled: true, message: "" })).status).toBe(400);
      expect((await enable({ timezone: "Nope/Nope" })).status).toBe(400);
      const got = await (await call("GET", "/api/seller/away-message")).json() as { enabled: boolean };
      expect(got.enabled).toBe(false);
    });
  });

  describe("existing behaviour lock-in: read receipts + message requests", () => {
    it("PATCH /:id/read stamps readAt on the other side's messages, visible to the sender; delivered is stamped on send", async () => {
      actingAs = BUYER;
      const sent = await (await call("POST", `/api/conversations/${convId}/messages`, { text: "ping" })).json() as any;
      expect(sent.deliveredAt).toBeTruthy();
      expect(sent.readAt).toBeUndefined();

      actingAs = SELLER;
      expect((await call("PATCH", `/api/conversations/${convId}/read`)).status).toBe(200);

      actingAs = BUYER;
      const listed = await (await call("GET", `/api/conversations/${convId}/messages`)).json() as any;
      const items = Array.isArray(listed) ? listed : listed.messages;
      const mine = items.find((m: any) => m.id === sent.id);
      expect(mine.readAt).toBeTruthy();
      expect(mine.status).toBe("read");
    });

    it("a request recipient cannot reply until accepting; the requester cannot accept; accept moves it to the inbox", async () => {
      const reqConv = await makeConversation(true);
      actingAs = SELLER;
      const blocked = await call("POST", `/api/conversations/${reqConv}/messages`, { text: "reply" });
      expect(blocked.status).toBe(403);
      expect((await blocked.json() as any).code).toBe("REQUEST_NOT_ACCEPTED");

      actingAs = BUYER;
      expect((await call("PATCH", `/api/conversations/${reqConv}/accept`)).status).toBe(403);

      actingAs = SELLER;
      const accepted = await call("PATCH", `/api/conversations/${reqConv}/accept`);
      expect(accepted.status).toBe(200);
      const [row] = await db.select().from(conversations).where(eq(conversations.id, reqConv));
      expect(row!.isRequest).toBe(false);
      expect((await call("POST", `/api/conversations/${reqConv}/messages`, { text: "reply" })).status).toBe(201);
    });
  });
});
