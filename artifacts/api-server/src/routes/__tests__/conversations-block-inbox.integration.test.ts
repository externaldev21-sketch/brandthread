import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray, or } from "drizzle-orm";
import { blocks, conversationParticipants, conversations, db, users } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id") || auth.userId;
    next();
  },
}));
vi.mock("../notifications-feed", () => ({ publishNotification: async () => {} }));

const suffix = crypto.randomBytes(6).toString("hex");
const id = (n: string) => `inbox-block-${n}-${suffix}`;
const me = id("me");
const iBlocked = id("iblocked");
const blockedMe = id("blockedme");
const friend = id("friend");
const userIds = [me, iBlocked, blockedMe, friend];

let server: Server;
let base = "";
const conv: Record<string, string> = {};

async function inbox(userId: string) {
  const response = await fetch(`${base}/api/conversations`, { headers: { "x-test-user-id": userId } });
  expect(response.status).toBe(200);
  const body = await response.json() as Array<{ id: string }>;
  return body.map((c) => c.id);
}

async function createConversation(type: string, members: string[]) {
  const [row] = await db.insert(conversations).values({ type }).returning({ id: conversations.id });
  await db.insert(conversationParticipants).values(members.map((u) => ({ conversationId: row.id, userId: u, name: u })));
  return row.id;
}

beforeAll(async () => {
  await db.insert(users).values(userIds.map((u) => ({
    clerkId: u, email: `${u}@t.local`, name: u, username: u.replace(/-/g, "_"), role: "buyer", accountType: "buyer",
  })));
  conv.iBlocked = await createConversation("buyer_to_buyer", [me, iBlocked]);
  conv.blockedMe = await createConversation("buyer_to_buyer", [me, blockedMe]);
  conv.friend = await createConversation("buyer_to_buyer", [me, friend]);
  conv.group = await createConversation("group", [me, iBlocked, friend]);
  await db.insert(blocks).values([
    { blockerId: me, blockedId: iBlocked },
    { blockerId: blockedMe, blockedId: me },
  ]);
  const { default: router } = await import("../conversations");
  const app = express();
  app.use(express.json());
  app.use("/api/conversations", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(blocks).where(or(inArray(blocks.blockerId, userIds), inArray(blocks.blockedId, userIds)));
  await db.delete(conversations).where(inArray(conversations.id, Object.values(conv)));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/conversations with blocks", () => {
  it("hides 1:1 chats with someone I blocked and someone who blocked me", async () => {
    const ids = await inbox(me);
    expect(ids).toContain(conv.friend);
    expect(ids).not.toContain(conv.iBlocked);
    expect(ids).not.toContain(conv.blockedMe);
  });

  it("hides the chat from the other side too", async () => {
    expect(await inbox(iBlocked)).not.toContain(conv.iBlocked);
    expect(await inbox(blockedMe)).not.toContain(conv.blockedMe);
  });

  it("keeps group chats that include a blocked member", async () => {
    expect(await inbox(me)).toContain(conv.group);
    expect(await inbox(iBlocked)).toContain(conv.group);
  });

  it("brings the chat back after unblocking", async () => {
    await db.delete(blocks).where(inArray(blocks.blockerId, [me]));
    expect(await inbox(me)).toContain(conv.iBlocked);
  });
});
