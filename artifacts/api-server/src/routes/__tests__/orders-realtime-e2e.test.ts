/**
 * Live orders + badges over the messages socket.
 *
 * Real Postgres with migration 280's trigger, the real LISTEN connection
 * (lib/orderChangeListener.ts), the real hub on a real http.Server and real
 * `ws` clients. The WebSocket token check treats the token as the user id
 * (no Clerk egress in this sandbox), like the other realtime e2e tests.
 *
 * An order written straight through Drizzle — standing in for any of the
 * routes, webhooks or jobs that create or move orders — reaches the seller
 * and buyer sockets, and a new Activity row moves the recipient's badges.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, users, orders, notificationsFeed } from "@workspace/db";
import WS from "ws";
import { orderChangeEvents, parseOrderChangePayload } from "../../lib/orderChangeListener";

vi.mock("../../ws/auth", () => ({
  verifyWsToken: async (token: string | undefined | null) => (token ? token : null),
}));

const SELLER = `ort-seller-${process.pid}`;
const BUYER = `ort-buyer-${process.pid}`;
const OTHER = `ort-other-${process.pid}`;

let server: http.Server;
let wsBase = "";
let stopListener: () => Promise<void>;
const sockets: WS[] = [];

async function cleanup() {
  await db.delete(orders).where(inArray(orders.ownerId, [SELLER]));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, [SELLER, BUYER, OTHER]));
  for (const id of [SELLER, BUYER, OTHER]) await db.delete(users).where(eq(users.clerkId, id));
}

function connect(userId: string): Promise<{ events: any[]; waitFor: (pred: (e: any) => boolean, ms?: number) => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const ws = new WS(`${wsBase}/ws/messages?token=${userId}`);
    sockets.push(ws);
    const events: any[] = [];
    const waiters: Array<{ pred: (e: any) => boolean; done: (e: any) => void }> = [];
    ws.on("message", (raw) => {
      const e = JSON.parse(raw.toString());
      events.push(e);
      for (const w of [...waiters]) if (w.pred(e)) { waiters.splice(waiters.indexOf(w), 1); w.done(e); }
      if (e.type === "ready") resolve(api);
    });
    ws.once("error", reject);
    const api = {
      events,
      waitFor(pred: (e: any) => boolean, ms = 4000) {
        const hit = events.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error("timed out waiting for event")), ms);
          waiters.push({ pred, done: (e) => { clearTimeout(t); res(e); } });
        });
      },
    };
  });
}

async function insertOrder() {
  const [row] = await db.insert(orders).values({
    ownerId: SELLER,
    buyerId: BUYER,
    orderNumber: `RT-${process.pid}-${Date.now()}`,
    status: "pending",
    totalCents: 4200,
    subtotalCents: 4200,
  }).returning({ id: orders.id });
  return row.id;
}

describe("order change events (pure)", () => {
  it("parses only well-formed payloads", () => {
    expect(parseOrderChangePayload("x")).toBeNull();
    expect(parseOrderChangePayload(JSON.stringify({ op: "delete", id: "o1" }))).toBeNull();
    expect(parseOrderChangePayload(JSON.stringify({ op: "insert", id: "o1", ownerId: "", buyerId: null, status: "pending" })))
      .toEqual({ op: "insert", id: "o1", ownerId: null, buyerId: null, status: "pending", trackingStatus: null });
  });

  it("tells the seller about a new order and both sides about a status change", () => {
    const created = orderChangeEvents({ op: "insert", id: "o1", ownerId: "s", buyerId: "b", status: "pending", trackingStatus: null });
    expect(created).toEqual([
      { userIds: ["s"], event: { type: "order.created", orderId: "o1" } },
      { userIds: ["s"], event: { type: "badges.changed" } },
      { userIds: ["b"], event: { type: "order.updated", orderId: "o1", status: "pending", trackingStatus: null } },
    ]);
    const shipped = orderChangeEvents({ op: "update", id: "o1", ownerId: "s", buyerId: "b", status: "shipped", trackingStatus: "in_transit" });
    expect(shipped).toEqual([{ userIds: ["s", "b"], event: { type: "order.updated", orderId: "o1", status: "shipped", trackingStatus: "in_transit" } }]);
    // A seller-created order with no buyer only reaches the seller.
    expect(orderChangeEvents({ op: "update", id: "o2", ownerId: "s", buyerId: null, status: "fulfilled", trackingStatus: null })[0].userIds).toEqual(["s"]);
  });
});

describe("orders realtime end to end", () => {
  beforeAll(async () => {
    const { attachMessagesWebSocket } = await import("../../ws/messagesHub");
    const listener = await import("../../lib/orderChangeListener");
    server = http.createServer((_req, res) => { res.statusCode = 404; res.end(); });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    attachMessagesWebSocket(server);
    wsBase = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
    listener.startOrderChangeListener();
    stopListener = listener.stopOrderChangeListener;
    // Give LISTEN a moment to register.
    await new Promise((r) => setTimeout(r, 300));
  });

  beforeEach(async () => {
    for (const s of sockets.splice(0)) s.close();
    await cleanup();
    await db.insert(users).values([
      { clerkId: SELLER, email: `${SELLER}@example.test`, name: "Seller", displayName: "Seller", accountType: "seller", onboardingComplete: true },
      { clerkId: BUYER, email: `${BUYER}@example.test`, name: "Buyer", displayName: "Buyer", accountType: "buyer", onboardingComplete: true },
      { clerkId: OTHER, email: `${OTHER}@example.test`, name: "Other", displayName: "Other", accountType: "buyer", onboardingComplete: true },
    ]);
  });

  afterAll(async () => {
    for (const s of sockets.splice(0)) s.close();
    await stopListener?.();
    await cleanup();
    await new Promise<void>((r) => server?.close(() => r()));
  });

  it("a new order reaches the seller live; a status change reaches buyer and seller; nobody else", async () => {
    const seller = await connect(SELLER);
    const buyer = await connect(BUYER);
    const other = await connect(OTHER);

    const orderId = await insertOrder();
    await seller.waitFor((e) => e.type === "order.created" && e.orderId === orderId);
    await seller.waitFor((e) => e.type === "badges.changed");

    await db.update(orders).set({ status: "shipped", trackingStatus: "in_transit" }).where(eq(orders.id, orderId));
    const atBuyer = await buyer.waitFor((e) => e.type === "order.updated" && e.status === "shipped");
    expect(atBuyer).toMatchObject({ orderId, trackingStatus: "in_transit" });
    await seller.waitFor((e) => e.type === "order.updated" && e.status === "shipped");

    // A write that doesn't change status / tracking stays quiet.
    const before = buyer.events.length;
    await db.update(orders).set({ notes: "gift wrap" } as any).where(eq(orders.id, orderId));
    await new Promise((r) => setTimeout(r, 250));
    expect(buyer.events.length).toBe(before);

    expect(other.events.filter((e) => e.type !== "ready")).toEqual([]);
  });

  it("a new Activity row moves the recipient's badges", async () => {
    const { publishNotification } = await import("../notifications-feed");
    const buyer = await connect(BUYER);
    await publishNotification({
      userId: BUYER, category: "social", type: "new_follower", title: "Someone followed you",
    });
    await buyer.waitFor((e) => e.type === "badges.changed");
  });
});
