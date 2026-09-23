/**
 * Integration coverage for the seller-scoped dispute and drop-wallet APIs.
 * These use Postgres rows (rather than a mocked repository) and an ephemeral
 * HTTP server. Stripe is deliberately the only external dependency faked.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const fake = vi.hoisted(() => {
  const transfers: any[] = [];
  const transfersByKey = new Map<string, Promise<any>>();
  const disputeUpdates: any[] = [];
  let disputeStatus = "under_review";
  let failDisputes = false;
  let failTransfers = false;
  let transferDelay = 0;
  const stripe = {
    disputes: {
      update: async (id: string, params: any) => {
        disputeUpdates.push({ id, params });
        if (failDisputes) throw Object.assign(new Error("Stripe dispute unavailable"), { status: 502 });
        return { id, status: disputeStatus };
      },
    },
    transfers: {
      create: (params: any, opts?: { idempotencyKey?: string }) => {
        const key = opts?.idempotencyKey ?? `no-key-${transfers.length}-${Math.random()}`;
        if (transfersByKey.has(key)) return transfersByKey.get(key)!;
        const result = (async () => {
          if (transferDelay) await new Promise(resolve => setTimeout(resolve, transferDelay));
          if (failTransfers) throw Object.assign(new Error("Stripe transfer unavailable"), { status: 502 });
          const transfer = { id: `tr_wallet_${transfers.length + 1}`, ...params, idempotencyKey: opts?.idempotencyKey };
          transfers.push(transfer);
          return transfer;
        })();
        transfersByKey.set(key, result);
        result.catch(() => transfersByKey.delete(key));
        return result;
      },
    },
    accounts: {
      retrieve: async (id: string) => ({ id, payouts_enabled: true }),
      update: async (id: string, params: any) => ({ id, ...params }),
    },
  };
  return {
    stripe, transfers, disputeUpdates,
    reset: () => {
      transfers.length = 0; disputeUpdates.length = 0; transfersByKey.clear();
      disputeStatus = "under_review"; failDisputes = false; failTransfers = false; transferDelay = 0;
    },
    disputeStatus: (value: string) => { disputeStatus = value; },
    failDisputes: (value: boolean) => { failDisputes = value; },
    failTransfers: (value: boolean) => { failTransfers = value; },
    transferDelay: (value: number) => { transferDelay = value; },
  };
});

vi.mock("../../lib/stripe", () => ({
  stripe: fake.stripe,
  requireStripe: () => fake.stripe,
  PLATFORM_COMMISSION_RATE: 0.05,
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"] ?? "";
    next();
  },
}));

import {
  db, disputes, drops, dropWallets, dropWalletTransactions, manufacturers, orderReleases, orders, users,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import disputesRouter from "../disputes";
import walletsRouter from "../drop-wallet";
import { recordOrderPaid } from "../../lib/money/escrow";
import { splitOrder } from "../../lib/money/fees";

const RUN = `task252_${Date.now()}`;
const SELLER = `${RUN}_seller`;
const OTHER = `${RUN}_other`;
let server: import("node:http").Server;
let base = "";

async function call(path: string, options: { method?: string; user?: string; body?: any } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json", "x-test-user": options.user ?? SELLER },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) as any };
}

async function seedDrop(ownerId = SELLER) {
  const [drop] = await db.insert(drops).values({
    ownerId, name: `${RUN} drop`, type: "pre-order", status: "active",
    escrowState: "collecting", fulfillmentDeadlineAt: new Date(Date.now() + 30 * 86_400_000),
  }).returning();
  return drop;
}
async function seedOrder(dropId: string, ownerId = SELLER, overrides: any = {}) {
  const [order] = await db.insert(orders).values({
    ownerId, dropId, orderNumber: `${RUN}-${Math.random().toString(36).slice(2, 8)}`,
    totalCents: 10_000, subtotalCents: 10_000, ...overrides,
  }).returning();
  return order;
}
async function seedDispute(sellerId = SELLER, overrides: any = {}) {
  const [dispute] = await db.insert(disputes).values({
    sellerId, stripeDisputeId: `dp_${RUN}_${Math.random().toString(36).slice(2)}`,
    amountCents: 1234, customerClaim: "not received", ...overrides,
  }).returning();
  return dispute;
}
async function wallet(dropId: string) {
  const response = await call(`/api/drop-wallets/${dropId}`, { method: "POST" });
  expect(response.status).toBe(201);
  return response.body;
}
async function clearRows() {
  await db.execute(sql`
    DELETE FROM drop_wallet_transactions
    WHERE wallet_id IN (SELECT id FROM drop_wallets WHERE seller_id IN (${SELLER}, ${OTHER}))
  `);
  await db.delete(dropWallets).where(sql`${dropWallets.sellerId} IN (${SELLER}, ${OTHER})`);
  // Release records keep a strict foreign key to their order. (Ledger rows
  // are append-only and reference nothing, so they stay.)
  await db.delete(orderReleases).where(sql`${orderReleases.sellerId} IN (${SELLER}, ${OTHER})`);
  await db.delete(disputes).where(sql`${disputes.sellerId} IN (${SELLER}, ${OTHER})`);
  await db.delete(orders).where(sql`${orders.ownerId} IN (${SELLER}, ${OTHER})`);
  await db.delete(drops).where(sql`${drops.ownerId} IN (${SELLER}, ${OTHER})`);
}

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO users (clerk_id, email, name, stripe_account_id)
    VALUES (${SELLER}, ${`${SELLER}@test.local`}, 'Task 252 seller', 'acct_task252'),
           (${OTHER}, ${`${OTHER}@test.local`}, 'Task 252 other', 'acct_task252_other')
    ON CONFLICT (clerk_id) DO UPDATE SET stripe_account_id = EXCLUDED.stripe_account_id
  `);
  // Seed a real manufacturer as part of the integration fixture: this confirms
  // the wallet/drop fixture coexists with the manufacturer subsystem's rows.
  await db.insert(manufacturers).values({
    businessName: `${RUN} manufacturer`, country: "US", specialty: "apparel",
  });
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: () => undefined }; next(); });
  app.use("/api/disputes", disputesRouter);
  app.use("/api/drop-wallets", walletsRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { fake.reset(); await clearRows(); });
afterAll(async () => {
  server?.close();
  await clearRows();
  await db.delete(manufacturers).where(eq(manufacturers.businessName, `${RUN} manufacturer`));
  await db.delete(users).where(sql`${users.clerkId} IN (${SELLER}, ${OTHER})`);
});

describe("disputes", () => {
  it("lists and reads only the requesting seller's disputes", async () => {
    const mine = await seedDispute();
    const theirs = await seedDispute(OTHER);
    const listed = await call("/api/disputes");
    expect(listed.status).toBe(200);
    expect(listed.body.map((d: any) => d.id)).toContain(mine.id);
    expect(listed.body.map((d: any) => d.id)).not.toContain(theirs.id);
    expect((await call(`/api/disputes/${theirs.id}`)).status).toBe(404);
    expect((await call(`/api/disputes/${mine.id}`)).body.amount).toBe(12.34);
  });

  it("validates and accumulates evidence, while retaining it when Stripe is unavailable", async () => {
    const dispute = await seedDispute();
    expect((await call(`/api/disputes/${dispute.id}/evidence`, { method: "POST", body: { type: "photo" } })).status).toBe(400);
    const first = await call(`/api/disputes/${dispute.id}/evidence`, {
      method: "POST", body: { type: "tracking", description: "  1ZTEST  ", trackingNumber: "1ZNUMBER" },
    });
    expect(first.status).toBe(200);
    fake.failDisputes(true);
    const second = await call(`/api/disputes/${dispute.id}/evidence`, {
      method: "POST", body: { type: "policy", description: "Returns policy" },
    });
    expect(second.status).toBe(200);
    expect(second.body.dispute.evidence).toHaveLength(2);
    expect(second.body.dispute.evidence[0].description).toBe("1ZTEST");
    expect(fake.disputeUpdates[0].params.evidence.shipping_tracking_number).toBe("1ZTEST");
  });

  it("rejects evidence for a final dispute and maps final submission statuses", async () => {
    const final = await seedDispute(SELLER, { status: "won" });
    expect((await call(`/api/disputes/${final.id}/evidence`, { method: "POST", body: { type: "photo", description: "x" } })).status).toBe(400);
    const open = await seedDispute();
    fake.disputeStatus("warning_closed");
    const submitted = await call(`/api/disputes/${open.id}/submit`, { method: "POST" });
    expect(submitted.status).toBe(200);
    expect(submitted.body.dispute.status).toBe("closed");
  });

  it("returns Stripe provider failures on final submit and accept closes a contest", async () => {
    const dispute = await seedDispute();
    fake.failDisputes(true);
    expect((await call(`/api/disputes/${dispute.id}/submit`, { method: "POST" })).status).toBe(502);
    fake.failDisputes(false);
    const accepted = await call(`/api/disputes/${dispute.id}/accept`, { method: "POST" });
    expect(accepted.status).toBe(200);
    expect(accepted.body.dispute.status).toBe("closed");
    expect((await call(`/api/disputes/${dispute.id}/evidence`, { method: "POST", body: { type: "photo", description: "late" } })).status).toBe(400);
  });

  it("does not allow competing acceptance and evidence to leave a final dispute contestable", async () => {
    const dispute = await seedDispute();
    const [accept, evidence] = await Promise.all([
      call(`/api/disputes/${dispute.id}/accept`, { method: "POST" }),
      call(`/api/disputes/${dispute.id}/evidence`, { method: "POST", body: { type: "written_response", description: "response" } }),
    ]);
    expect([accept.status, evidence.status]).toContain(200);
    const [stored] = await db.select().from(disputes).where(eq(disputes.id, dispute.id));
    // Once acceptance has won, a stale evidence write must not reopen the case.
    expect(stored.status).toBe("closed");
  });
});

describe("drop wallet", () => {
  /** A preorder paid through checkout: held by Brandthread, net of 5% (no Stripe fee in this fixture). */
  async function seedHeldOrder(dropId: string, overrides: any = {}) {
    const order = await seedOrder(dropId, SELLER, { stripePaymentIntentId: `pi_${RUN}_${Math.random().toString(36).slice(2)}`, ...overrides });
    await db.transaction((tx) => recordOrderPaid(tx, {
      orderId: order.id,
      sellerId: SELLER,
      dropId,
      chargeModel: "held",
      split: splitOrder({
        subtotalCents: 10_000, discountCents: 0, shippingCents: 0, taxCents: 0,
        grossCents: 10_000, processingFeeCents: 0,
      }),
      charge: { chargeId: `ch_${order.id}`, processingFeeCents: 0, transferId: null, applicationFeeId: null },
      paymentIntentId: order.stripePaymentIntentId,
      occurredAt: new Date(),
    }));
    return order;
  }

  it("creates idempotently, enforces drop ownership, and exposes its wallet", async () => {
    const drop = await seedDrop();
    const attempts = await Promise.all([
      call(`/api/drop-wallets/${drop.id}`, { method: "POST" }),
      call(`/api/drop-wallets/${drop.id}`, { method: "POST" }),
    ]);
    expect(attempts.map(result => result.status).sort()).toEqual([200, 201]);
    expect(new Set(attempts.map(result => result.body.id)).size).toBe(1);
    expect((await call(`/api/drop-wallets/${drop.id}`, { user: OTHER })).status).toBe(404);
    expect((await call(`/api/drop-wallets/${drop.id}`)).body.availableCents).toBe(0);
  });

  it("never lets a seller credit a wallet: preorder payments are deposited automatically", async () => {
    const drop = await seedDrop(); await wallet(drop.id);
    const order = await seedOrder(drop.id);
    const forged = await call(`/api/drop-wallets/${drop.id}/deposit`, { method: "POST", body: { orderId: order.id, amountCents: 10_000 } });
    expect(forged).toMatchObject({ status: 410, body: { code: "DEPOSITS_ARE_AUTOMATIC" } });
    expect((await call(`/api/drop-wallets/${drop.id}`)).body.balanceCents).toBe(0);

    await seedHeldOrder(drop.id);
    const state = await call(`/api/drop-wallets/${drop.id}`);
    expect(state.body).toMatchObject({ balanceCents: 9_500, heldCents: 9_500, availableCents: 9_500 });
    expect(state.body.transactions.filter((t: any) => t.type === "deposit")).toHaveLength(1);
  });

  it("requires tracked, owned, held orders before release", async () => {
    const drop = await seedDrop(); await wallet(drop.id);
    const untracked = await seedHeldOrder(drop.id);
    expect(await call(`/api/drop-wallets/${drop.id}/release-order/${untracked.id}`, { method: "POST" }))
      .toMatchObject({ status: 409, body: { code: "NO_TRACKING" } });
    const foreign = await seedOrder(drop.id, OTHER, { trackingNumber: "foreign" });
    expect((await call(`/api/drop-wallets/${drop.id}/release-order/${foreign.id}`, { method: "POST" })).status).toBe(404);
    const direct = await seedOrder(drop.id, SELLER, { trackingNumber: "1ZDIRECT", chargeModel: "destination", fundsState: "settled_direct" });
    expect(await call(`/api/drop-wallets/${drop.id}/release-order/${direct.id}`, { method: "POST" }))
      .toMatchObject({ status: 409, body: { code: "NOT_HELD" } });
    expect(fake.transfers).toHaveLength(0);
  });

  it("releases once, tracks the order transaction, and concurrent releases never double-transfer", async () => {
    const drop = await seedDrop(); await wallet(drop.id);
    const order = await seedHeldOrder(drop.id, { trackingNumber: "1ZRELEASE" });
    fake.transferDelay(30);
    const responses = await Promise.all([
      call(`/api/drop-wallets/${drop.id}/release-order/${order.id}`, { method: "POST" }),
      call(`/api/drop-wallets/${drop.id}/release-order/${order.id}`, { method: "POST" }),
    ]);
    // One request pays; the other sees the same release still in flight.
    expect(responses.map(r => r.status).sort()).toEqual([200, 202]);
    expect(fake.transfers).toHaveLength(1);
    expect(fake.transfers[0]).toMatchObject({
      amount: 9_500,
      source_transaction: `ch_${order.id}`,
      idempotencyKey: `order-release/${order.id}/1`,
    });
    const state = await call(`/api/drop-wallets/${drop.id}`);
    expect(state.body).toMatchObject({ releasedCents: 9_500, heldCents: 0, reservedCents: 0 });
    expect(state.body.transactions.filter((t: any) => t.type === "release")).toHaveLength(1);
    expect(state.body.releases[0]).toMatchObject({ orderId: order.id, state: "paid", amountCents: 9_500 });
    const again = await call(`/api/drop-wallets/${drop.id}/release-order/${order.id}`, { method: "POST" });
    expect(again).toMatchObject({ status: 200, body: { released: true } });
    expect(fake.transfers).toHaveLength(1);
  });

  it("does not record a release as paid when Stripe's transfer provider fails", async () => {
    const drop = await seedDrop(); await wallet(drop.id);
    const order = await seedHeldOrder(drop.id, { trackingNumber: "1ZFAIL" });
    fake.failTransfers(true);
    const response = await call(`/api/drop-wallets/${drop.id}/release-order/${order.id}`, { method: "POST" });
    expect(response).toMatchObject({ status: 202, body: { released: false, state: "transferring" } });
    const state = await call(`/api/drop-wallets/${drop.id}`);
    expect(state.body).toMatchObject({ releasedCents: 0, heldCents: 9_500, reservedCents: 9_500 });
    expect(state.body.transactions.filter((t: any) => t.type === "release")).toHaveLength(0);
    const [current] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(current.fundsState).toBe("release_pending");
  });

  it("sends label purchases through the in-app label flow", async () => {
    const drop = await seedDrop(); await wallet(drop.id);
    const order = await seedHeldOrder(drop.id);
    const response = await call(`/api/drop-wallets/${drop.id}/pay-shipping/${order.id}`, {
      method: "POST", body: { labelCents: 125, carrier: "UPS", trackingNumber: "1ZSHIP" },
    });
    expect(response).toMatchObject({ status: 410, body: { code: "USE_IN_APP_LABELS" } });
    const [unchanged] = await db.select().from(orders).where(and(eq(orders.id, order.id), eq(orders.ownerId, SELLER)));
    expect(unchanged).toMatchObject({ status: "pending", trackingNumber: null, fundsState: "held" });
  });
});
