/**
 * Integration test (real DB), items 93-95:
 *   • PATCH /:id/archive persists a per-viewer archive that GET / reflects as
 *     isArchived, and a new incoming message unarchives it for the recipient.
 *   • DELETE /:id/for-me removes the chat from MY inbox only (history hidden
 *     for me, untouched for the other side) until a newer message arrives.
 *   • DELETE /:id/messages/:messageId/for-me hides one message for me only,
 *     in the thread and in the inbox preview.
 *   • PATCH /:id/mute accepts both { durationMinutes } and the older
 *     { muted } body and always writes mutedUntil (what push suppression reads).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { and, eq } from "drizzle-orm";
import { db, users, conversations, conversationParticipants, messages } from "@workspace/db";

const ALICE = `archive-alice-${process.pid}`;
const BOB = `archive-bob-${process.pid}`;

let actingAs = ALICE;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = actingAs;
    next();
  },
}));

async function cleanup() {
  const rows = await db.select({ id: conversationParticipants.conversationId })
    .from(conversationParticipants).where(eq(conversationParticipants.userId, ALICE));
  for (const row of rows) await db.delete(conversations).where(eq(conversations.id, row.id));
  await db.delete(users).where(eq(users.clerkId, ALICE));
  await db.delete(users).where(eq(users.clerkId, BOB));
}

let server: Server;
let baseUrl = "";
let convId = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api/conversations${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

async function send(as: string, text: string) {
  actingAs = as;
  const res = await call("POST", `/${convId}/messages`, { text });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

async function myRow(userId: string) {
  const [row] = await db.select().from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, convId), eq(conversationParticipants.userId, userId)));
  return row;
}

describe("conversation archive / delete-for-me / mute", () => {
  beforeEach(async () => {
    actingAs = ALICE;
    await cleanup();
    await db.insert(users).values([
      { clerkId: ALICE, email: `${ALICE}@example.test`, name: "Alice Archive", displayName: "Alice Archive", accountType: "buyer", onboardingComplete: true },
      { clerkId: BOB, email: `${BOB}@example.test`, name: "Bob Archive", displayName: "Bob Archive", accountType: "seller", onboardingComplete: true },
    ]);
    const [conv] = await db.insert(conversations).values({ type: "buyer_to_seller" }).returning();
    convId = conv.id;
    await db.insert(conversationParticipants).values([
      { conversationId: convId, userId: ALICE, name: "Alice Archive", accountType: "buyer" },
      { conversationId: convId, userId: BOB, name: "Bob Archive", accountType: "seller" },
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

  describe("PATCH /:id/archive", () => {
    it("persists per viewer and survives a refetch", async () => {
      await send(BOB, "hi alice");
      actingAs = ALICE;
      const res = await call("PATCH", `/${convId}/archive`, { archived: true });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, isArchived: true });

      const mine = (await call("GET", "/")).body as any[];
      expect(mine.find((c) => c.id === convId)?.isArchived).toBe(true);

      actingAs = BOB;
      const theirs = (await call("GET", "/")).body as any[];
      expect(theirs.find((c) => c.id === convId)?.isArchived).toBe(false);
    });

    it("unarchives", async () => {
      actingAs = ALICE;
      await call("PATCH", `/${convId}/archive`, { archived: true });
      const res = await call("PATCH", `/${convId}/archive`, { archived: false });
      expect(res.body).toMatchObject({ ok: true, isArchived: false, archivedAt: null });
      const conv = (await call("GET", `/${convId}`)).body;
      expect(conv.isArchived).toBe(false);
    });

    it("a new incoming message brings it back for the recipient", async () => {
      actingAs = ALICE;
      await call("PATCH", `/${convId}/archive`, { archived: true });
      await send(BOB, "are you there?");
      actingAs = ALICE;
      const conv = (await call("GET", `/${convId}`)).body;
      expect(conv.isArchived).toBe(false);
    });

    it("rejects a non-boolean body and non-members", async () => {
      actingAs = ALICE;
      expect((await call("PATCH", `/${convId}/archive`, {})).status).toBe(400);
      actingAs = `archive-stranger-${process.pid}`;
      expect((await call("PATCH", `/${convId}/archive`, { archived: true })).status).toBe(404);
    });
  });

  describe("DELETE /:id/for-me (chat)", () => {
    it("removes the chat from my inbox only, and hides its history for me", async () => {
      await send(BOB, "old message");
      actingAs = ALICE;
      expect((await call("DELETE", `/${convId}/for-me`)).status).toBe(200);

      const mine = (await call("GET", "/")).body as any[];
      expect(mine.some((c) => c.id === convId)).toBe(false);

      actingAs = BOB;
      const theirs = (await call("GET", "/")).body as any[];
      expect(theirs.some((c) => c.id === convId)).toBe(true);
      const theirMsgs = (await call("GET", `/${convId}/messages`)).body as any[];
      expect(theirMsgs.map((m) => m.text)).toEqual(["old message"]);

      // The conversation row itself still exists — it was not deleted for both.
      const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId));
      expect(conv).toBeTruthy();
    });

    it("comes back with only newer messages when the other side writes again", async () => {
      await send(BOB, "before delete");
      actingAs = ALICE;
      await call("DELETE", `/${convId}/for-me`);
      // timestamps are millisecond-precision; make sure "after" is strictly later
      await new Promise((r) => setTimeout(r, 5));
      await send(BOB, "after delete");

      actingAs = ALICE;
      const mine = (await call("GET", "/")).body as any[];
      const row = mine.find((c) => c.id === convId);
      expect(row?.lastMessage).toBe("after delete");
      const msgs = (await call("GET", `/${convId}/messages`)).body as any[];
      expect(msgs.map((m) => m.text)).toEqual(["after delete"]);
    });
  });

  describe("DELETE /:id/messages/:messageId/for-me", () => {
    it("hides the message for me only, in the thread and the inbox preview", async () => {
      await send(BOB, "first");
      const second = await send(BOB, "second (to hide)");

      actingAs = ALICE;
      const res = await call("DELETE", `/${convId}/messages/${second.id}/for-me`);
      expect(res.status).toBe(200);

      const mine = (await call("GET", `/${convId}/messages`)).body as any[];
      expect(mine.map((m) => m.text)).toEqual(["first"]);
      const list = (await call("GET", "/")).body as any[];
      expect(list.find((c) => c.id === convId)?.lastMessage).toBe("first");

      actingAs = BOB;
      const theirs = (await call("GET", `/${convId}/messages`)).body as any[];
      expect(theirs.map((m) => m.text)).toEqual(["first", "second (to hide)"]);
      const [stillThere] = await db.select().from(messages).where(eq(messages.id, second.id));
      expect(stillThere).toBeTruthy();
    });

    it("never falls back to the shared lastMessage once every message is hidden for me", async () => {
      const only = await send(BOB, "secret");
      actingAs = ALICE;
      await call("DELETE", `/${convId}/messages/${only.id}/for-me`);
      const list = (await call("GET", "/")).body as any[];
      expect(list.find((c) => c.id === convId)?.lastMessage).not.toBe("secret");
    });

    it("is idempotent and checks membership / message ownership", async () => {
      const msg = await send(BOB, "x");
      actingAs = ALICE;
      expect((await call("DELETE", `/${convId}/messages/${msg.id}/for-me`)).status).toBe(200);
      expect((await call("DELETE", `/${convId}/messages/${msg.id}/for-me`)).status).toBe(200);
      expect((await call("DELETE", `/${convId}/messages/not-a-uuid/for-me`)).status).toBe(404);
      expect((await call("DELETE", `/${convId}/messages/00000000-0000-0000-0000-000000000000/for-me`)).status).toBe(404);
      actingAs = `archive-stranger-${process.pid}`;
      expect((await call("DELETE", `/${convId}/messages/${msg.id}/for-me`)).status).toBe(403);
    });
  });

  describe("PATCH /:id/mute", () => {
    it("{ durationMinutes } sets mutedUntil (no longer shadowed by the legacy handler)", async () => {
      actingAs = ALICE;
      const res = await call("PATCH", `/${convId}/mute`, { durationMinutes: 60 });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const until = Date.parse(res.body.mutedUntil);
      expect(until).toBeGreaterThan(Date.now() + 55 * 60_000);
      expect((await myRow(ALICE)).mutedUntil).toBeTruthy();
      const conv = (await call("GET", `/${convId}`)).body;
      expect(conv.isMuted).toBe(true);
      expect(conv.mutedUntil).toBeTruthy();
    });

    it("durationMinutes -1 mutes until turned back on; null unmutes", async () => {
      actingAs = ALICE;
      const forever = await call("PATCH", `/${convId}/mute`, { durationMinutes: -1 });
      expect(forever.body.mutedUntil).toBe("9999-12-31T00:00:00.000Z");
      const off = await call("PATCH", `/${convId}/mute`, { durationMinutes: null });
      expect(off.body).toMatchObject({ ok: true, muted: false, mutedUntil: null });
      expect((await myRow(ALICE)).mutedUntil).toBeNull();
    });

    it("legacy { muted: boolean } still works and writes mutedUntil", async () => {
      actingAs = ALICE;
      const on = await call("PATCH", `/${convId}/mute`, { muted: true });
      expect(on.status).toBe(200);
      expect(on.body).toMatchObject({ muted: true, mutedUntil: "9999-12-31T00:00:00.000Z" });
      expect((await myRow(ALICE)).mutedUntil).toBeTruthy();
      const off = await call("PATCH", `/${convId}/mute`, { muted: false });
      expect(off.body).toMatchObject({ muted: false, mutedUntil: null });
      expect((await myRow(ALICE)).mutedUntil).toBeNull();
    });

    it("rejects a malformed body and non-members", async () => {
      actingAs = ALICE;
      expect((await call("PATCH", `/${convId}/mute`, { durationMinutes: "soon" })).status).toBe(400);
      actingAs = `archive-stranger-${process.pid}`;
      expect((await call("PATCH", `/${convId}/mute`, { durationMinutes: 60 })).status).toBe(404);
    });
  });
});
