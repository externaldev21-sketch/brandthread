/**
 * Thread Cash in Live, driven from BOTH sides through the real routes:
 * a buyer gifts the host of a live stream (POST /thread-cash/live-gift), the
 * seller's wallet (GET /thread-cash) shows the gift as cashable, and the
 * seller cashes it out (POST /thread-cash/cash-out) — with the guards that
 * keep money honest: no gifts into an ended or unknown stream, and reward
 * credit is never cashable.
 *
 * Real Express router, real Postgres. Only Clerk identity (a header) and the
 * Stripe client (the shared money-test fake) are stubbed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, liveStreams, notificationsFeed, threadCashEntries, users } from "@workspace/db";

const fakeStripe = vi.hoisted(() => ({ client: null as any }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const id = req.header("x-test-user-id");
    if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = id;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  // The seller is acting on their own store; team gating has its own suite.
  requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../lib/stripe", () => ({
  get stripe() { return fakeStripe.client; },
  requireStripe: () => fakeStripe.client,
}));

import { createFakeStripe } from "../../lib/money/__tests__/fakeStripe";
import threadCashRouter from "../thread-cash";

const suffix = crypto.randomUUID().slice(0, 8);
const SELLER = `tc-two-sided-seller-${suffix}`;
const BUYER = `tc-two-sided-buyer-${suffix}`;
let server: Server;
let base = "";
let liveId = "";
let endedId = "";
const stripeState = createFakeStripe();
fakeStripe.client = stripeState.stripe;

async function call(method: string, path: string, userId: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "x-test-user-id": userId, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@test.example`, name: "Host", stripeAccountId: `acct_test_${suffix}` },
    { clerkId: BUYER, email: `${BUYER}@test.example`, name: "Viewer" },
  ]);
  liveId = crypto.randomUUID();
  endedId = crypto.randomUUID();
  await db.insert(liveStreams).values([
    { id: liveId, sellerId: SELLER, channelName: `tc-live-${liveId}`, title: "Live", status: "live" },
    { id: endedId, sellerId: SELLER, channelName: `tc-ended-${endedId}`, title: "Ended", status: "ended" },
  ]);
  // The buyer's spendable reward credit, and some reward credit the seller
  // also holds (which must never become cash).
  await db.insert(threadCashEntries).values([
    { buyerId: BUYER, amountCents: 1_000, source: "daily_checkin", referenceId: "2026-10-05" },
    { buyerId: SELLER, amountCents: 400, source: "daily_checkin", referenceId: "2026-10-05" },
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/thread-cash", threadCashRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await db.delete(threadCashEntries).where(inArray(threadCashEntries.buyerId, [SELLER, BUYER]));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, [SELLER, BUYER]));
  await db.delete(liveStreams).where(eq(liveStreams.sellerId, SELLER));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, BUYER]));
});

describe("Thread Cash in Live — buyer ↔ seller", () => {
  it("the seller starts with reward credit that is spendable but not cashable", async () => {
    const wallet = await call("GET", "/api/thread-cash", SELLER);
    expect(wallet.status).toBe(200);
    expect(wallet.body).toMatchObject({ balanceCents: 400, cashableCents: 0 });

    const cashOut = await call("POST", "/api/thread-cash/cash-out", SELLER, { threadCashCents: 100, idempotencyKey: crypto.randomUUID() });
    expect(cashOut.status).toBe(400);
    expect(cashOut.body.code).toBe("THREAD_CASH_NOT_CASHABLE");
  });

  it("a gift into an ended or unknown live is refused and moves nothing", async () => {
    const ended = await call("POST", "/api/thread-cash/live-gift", BUYER, { streamId: endedId, amountCents: 100, idempotencyKey: crypto.randomUUID() });
    expect(ended.status).toBe(409);
    expect(ended.body.code).toBe("LIVE_STREAM_NOT_LIVE");

    const junk = await call("POST", "/api/thread-cash/live-gift", BUYER, { streamId: "not-a-uuid", amountCents: 100, idempotencyKey: crypto.randomUUID() });
    expect(junk.status).toBe(404);

    expect((await call("GET", "/api/thread-cash", BUYER)).body.balanceCents).toBe(1_000);
  });

  it("buyer gifts in the live → seller sees it in their wallet as cashable, and is notified", async () => {
    const key = crypto.randomUUID();
    const gift = await call("POST", "/api/thread-cash/live-gift", BUYER, { streamId: liveId, amountCents: 300, idempotencyKey: key });
    expect(gift.status).toBe(200);
    // A retried tap with the same key is the same gift.
    const retry = await call("POST", "/api/thread-cash/live-gift", BUYER, { streamId: liveId, amountCents: 300, idempotencyKey: key });
    expect(retry.body.giftId).toBe(gift.body.giftId);

    expect((await call("GET", "/api/thread-cash", BUYER)).body.balanceCents).toBe(700);
    const seller = await call("GET", "/api/thread-cash", SELLER);
    expect(seller.body).toMatchObject({ balanceCents: 700, cashableCents: 300 });

    await vi.waitFor(async () => {
      const rows = await db.select().from(notificationsFeed).where(eq(notificationsFeed.userId, SELLER));
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  it("the seller cashes out exactly what was earned and the wallet reflects it", async () => {
    const tooMuch = await call("POST", "/api/thread-cash/cash-out", SELLER, { threadCashCents: 500, idempotencyKey: crypto.randomUUID() });
    expect(tooMuch.body.code).toBe("THREAD_CASH_NOT_CASHABLE");

    const ok = await call("POST", "/api/thread-cash/cash-out", SELLER, { threadCashCents: 300, idempotencyKey: crypto.randomUUID() });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ threadCashCents: 300, payoutCents: 300 });
    expect(stripeState.state.transfers.at(-1)).toMatchObject({ amount: 300, destination: `acct_test_${suffix}` });

    const seller = await call("GET", "/api/thread-cash", SELLER);
    expect(seller.body).toMatchObject({ balanceCents: 400, cashableCents: 0 });
  });
});
