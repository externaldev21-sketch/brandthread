/**
 * Messages realtime hub (ws/messagesHub.ts) end to end.
 *
 * Real Express conversations router, a real http.Server with the real `ws`
 * hub attached, real `ws` clients for two accounts, and the real local
 * Postgres. `requireAuth` reads identity from a header and the WebSocket
 * token check treats the token as the user id — the same Clerk stand-ins the
 * other e2e tests here use (no network egress to Clerk in this sandbox).
 *
 * Covers: auth on upgrade, message.created reaching the recipient and the
 * sender's other device, badges.changed for the recipient, typing relay,
 * read receipts, reactions/accept/delete hints, and that a third account
 * never receives another conversation's events.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { db, users, conversations, conversationParticipants, messages, messageReactions } from "@workspace/db";
import WS from "ws";

const BUYER = `rt-buyer-${process.pid}`;
const SELLER = `rt-seller-${process.pid}`;
const STRANGER = `rt-stranger-${process.pid}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const actingAs = req.headers["x-test-acting-as"];
    if (!actingAs) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = actingAs;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../../ws/auth", () => ({
  verifyWsToken: async (token: string | undefined | null) => (token ? token : null),
}));

async function cleanup() {
  for (const who of [BUYER, SELLER]) {
    const rows = await db.select({ id: conversationParticipants.conversationId })
      .from(conversationParticipants).where(eq(conversationParticipants.userId, who));
    for (const row of rows) {
      const msgs = await db.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, row.id));
      for (const m of msgs) await db.delete(messageReactions).where(eq(messageReactions.messageId, m.id));
      await db.delete(messages).where(eq(messages.conversationId, row.id));
      await db.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, row.id));
      await db.delete(conversations).where(eq(conversations.id, row.id));
    }
  }
  for (const who of [BUYER, SELLER, STRANGER]) await db.delete(users).where(eq(users.clerkId, who));
}

let server: Server;
let baseUrl = "";
let wsBase = "";

function as(userId: string, path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { ...init.headers, "x-test-acting-as": userId, "Content-Type": "application/json" } });
}

type Client = { ws: WS; events: any[]; waitFor: (pred: (e: any) => boolean, ms?: number) => Promise<any> };

function connect(token: string | null): Promise<Client> {
  return new Promise((resolve, reject) => {
    const url = token ? `${wsBase}/ws/messages?token=${encodeURIComponent(token)}` : `${wsBase}/ws/messages`;
    const ws = new WS(url);
    const events: any[] = [];
    const waiters: Array<{ pred: (e: any) => boolean; resolve: (e: any) => void }> = [];
    ws.on("message", (raw) => {
      const e = JSON.parse(raw.toString());
      events.push(e);
      for (const w of [...waiters]) if (w.pred(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e); }
    });
    const client: Client = {
      ws,
      events,
      waitFor(pred, ms = 3000) {
        const hit = events.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error("timed out waiting for event")), ms);
          waiters.push({ pred, resolve: (e) => { clearTimeout(timer); res(e); } });
        });
      },
    };
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    // The hub greets every authenticated socket with {type:"ready"}.
    client.waitFor((e) => e.type === "ready").then(() => resolve(client), reject);
  });
}

async function newConversation(): Promise<string> {
  const res = await as(BUYER, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({
      type: "buyer_to_seller",
      participant: { userId: SELLER, name: "RT Seller", handle: "@rtseller", initials: "RS", color: "#111111", accountType: "seller" },
      myInfo: { name: "RT Buyer", handle: "@rtbuyer", initials: "RB", color: "#222222", accountType: "buyer" },
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json() as { id: string }).id;
}

describe("messages realtime hub", () => {
  const open: WS[] = [];

  beforeAll(async () => {
    const { default: conversationsRouter } = await import("../conversations");
    const { attachMessagesWebSocket } = await import("../../ws/messagesHub");
    const app = express();
    app.use(express.json());
    app.use("/api/conversations", conversationsRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    attachMessagesWebSocket(server);
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;
  });

  beforeEach(async () => {
    for (const ws of open.splice(0)) ws.close();
    await cleanup();
    await db.insert(users).values([
      { clerkId: BUYER, email: `${BUYER}@example.test`, name: "RT Buyer", displayName: "RT Buyer", accountType: "buyer", onboardingComplete: true },
      { clerkId: SELLER, email: `${SELLER}@example.test`, name: "RT Seller", displayName: "RT Seller", accountType: "seller", onboardingComplete: true },
      { clerkId: STRANGER, email: `${STRANGER}@example.test`, name: "RT Stranger", displayName: "RT Stranger", accountType: "buyer", onboardingComplete: true },
    ]);
  });

  afterAll(async () => {
    for (const ws of open.splice(0)) ws.close();
    await cleanup();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  async function client(token: string | null) {
    const c = await connect(token);
    open.push(c.ws);
    return c;
  }

  it("refuses an upgrade without a valid token", async () => {
    await expect(connect(null)).rejects.toThrow(/401/);
  });

  it("delivers a new message to the recipient and the sender's other device, never to a stranger", async () => {
    const conversationId = await newConversation();
    const seller = await client(SELLER);
    const buyerOtherDevice = await client(BUYER);
    const stranger = await client(STRANGER);

    const send = await as(BUYER, `/api/conversations/${conversationId}/messages`, {
      method: "POST", body: JSON.stringify({ text: "Is the black one in M?" }),
    });
    expect(send.status).toBe(201);
    const sent = await send.json() as { id: string };

    const atSeller = await seller.waitFor((e) => e.type === "message.created");
    expect(atSeller.conversationId).toBe(conversationId);
    expect(atSeller.message.id).toBe(sent.id);
    expect(atSeller.message.text).toBe("Is the black one in M?");
    expect(atSeller.message.fromId).toBe(BUYER);
    await seller.waitFor((e) => e.type === "badges.changed");

    const atMyOtherDevice = await buyerOtherDevice.waitFor((e) => e.type === "message.created");
    expect(atMyOtherDevice.message.id).toBe(sent.id);
    // My own send doesn't move my unread badge.
    expect(buyerOtherDevice.events.some((e) => e.type === "badges.changed")).toBe(false);

    await new Promise((r) => setTimeout(r, 100));
    expect(stranger.events.filter((e) => e.type !== "ready")).toEqual([]);
  });

  it("relays typing on and off to the other participant only", async () => {
    const conversationId = await newConversation();
    const seller = await client(SELLER);
    const buyer = await client(BUYER);

    await as(BUYER, `/api/conversations/${conversationId}/typing`, { method: "PATCH", body: JSON.stringify({ typing: true }) });
    const on = await seller.waitFor((e) => e.type === "typing" && e.typing === true);
    expect(on).toMatchObject({ conversationId, userId: BUYER });

    await as(BUYER, `/api/conversations/${conversationId}/typing`, { method: "PATCH", body: JSON.stringify({ typing: false }) });
    await seller.waitFor((e) => e.type === "typing" && e.typing === false);

    await new Promise((r) => setTimeout(r, 50));
    expect(buyer.events.some((e) => e.type === "typing")).toBe(false);
  });

  it("sends a read receipt to the sender and a badge refresh to the reader", async () => {
    const conversationId = await newConversation();
    await as(BUYER, `/api/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ text: "hello" }) });
    const buyer = await client(BUYER);
    const seller = await client(SELLER);

    const read = await as(SELLER, `/api/conversations/${conversationId}/read`, { method: "PATCH", body: "{}" });
    expect(read.status).toBe(200);

    const receipt = await buyer.waitFor((e) => e.type === "message.read");
    expect(receipt).toMatchObject({ conversationId, readerId: SELLER });
    expect(typeof receipt.readAt).toBe("string");
    await seller.waitFor((e) => e.type === "badges.changed");
    expect(seller.events.some((e) => e.type === "message.read")).toBe(false);
  });

  it("hints reactions and deletion to both sides", async () => {
    const conversationId = await newConversation();
    const send = await as(BUYER, `/api/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ text: "hi" }) });
    const msg = await send.json() as { id: string };
    const buyer = await client(BUYER);
    const seller = await client(SELLER);

    await as(SELLER, `/api/conversations/${conversationId}/messages/${msg.id}/reactions`, {
      method: "PUT", body: JSON.stringify({ reactionType: "love" }),
    });
    await buyer.waitFor((e) => e.type === "conversation.updated" && e.reason === "reaction");

    await as(BUYER, `/api/conversations/${conversationId}`, { method: "DELETE" });
    await seller.waitFor((e) => e.type === "conversation.updated" && e.reason === "deleted" && e.conversationId === conversationId);
  });

  it("a write still succeeds when nobody is connected", async () => {
    const conversationId = await newConversation();
    const send = await as(BUYER, `/api/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ text: "offline" }) });
    expect(send.status).toBe(201);
  });
});
