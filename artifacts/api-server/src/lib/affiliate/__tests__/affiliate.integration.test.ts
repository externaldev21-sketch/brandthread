/**
 * Affiliate program against real Postgres + the fake Stripe: attribution on a
 * real paid order (link and code), self-referral, refund reversal and
 * clawback, payout run idempotency (no double pay), seller/creator isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("../../money/__tests__/fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", () => ({
  normalizePushEventCategory: () => "orders",
  sendPushToUser: async () => {},
  stableNotificationId: (...parts: string[]) => parts.join(":"),
}));
vi.mock("../../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
  sendOrderShippingEmail: async () => true,
  sendReturnStatusEmail: async () => true,
}));
vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.headers["x-test-user"];
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));
vi.mock("../../../middlewares/requireRole", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../middlewares/requireRole")>();
  return {
    ...actual,
    teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

import {
  db, affiliateCommissionEvents, affiliateCommissions, affiliateCreators, affiliatePayouts, discountCodes, orders, users,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { fake } from "../../money/__tests__/fakeStripe";
import { call, pay, seedBuyer, seedProduct, seedSeller, startApp, uid } from "../../money/__tests__/moneyHarness";
import { refundOrder } from "../../money/refunds";
import sellerAffiliateRouter from "../../../routes/seller-affiliate";
import affiliateCreatorRouter from "../../../routes/affiliate-creator";
import affiliatePublicRouter from "../../../routes/affiliate-public";
import { attributeOrder, promoteEligibleCommissions, reconcileReversals } from "../service";
import { runAffiliatePayouts, runCreatorPayout } from "../payouts";

let app: { base: string; close: () => Promise<void> };
beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/public/affiliate", affiliatePublicRouter);
    server.use("/api/affiliate", affiliateCreatorRouter);
    server.use("/api/seller/affiliate", sellerAffiliateRouter);
  });
});
afterAll(async () => { await app?.close(); });
beforeEach(() => fake.reset());

const okStripe = () => ({
  ...fake.stripe,
  accounts: { retrieve: async () => ({ payouts_enabled: true, capabilities: { transfers: "active" } }) },
}) as any;

async function seedCreator(tag: string, connected = true) {
  const id = await seedBuyer(`creator-${tag}`);
  await db.update(users).set({
    username: `cr${uid("u").replace(/[^a-z0-9]/g, "").slice(-14)}`,
    stripeAccountId: connected ? `acct_${id.replace(/-/g, "_")}` : null,
  }).where(eq(users.clerkId, id));
  const [u] = await db.select().from(users).where(eq(users.clerkId, id));
  return { id, username: u.username! };
}

/** Program on + creator invited and active, through the real routes. */
async function setupProgram(seller: string, creator: { id: string; username: string }, program: Record<string, unknown> = {}) {
  const put = await call(app.base, "PUT", "/api/seller/affiliate/program", seller, {
    enabled: true, commissionPercent: 10, buyerDiscountPercent: 5, windowDays: 30, holdDays: 30, minPayoutCents: 1000, ...program,
  });
  expect(put.status).toBe(200);
  const invite = await call(app.base, "POST", "/api/seller/affiliate/creators/invite", seller, { username: creator.username });
  expect(invite.status).toBe(201);
  const accept = await call(app.base, "POST", `/api/affiliate/invites/${invite.body.id}/accept`, creator.id, {});
  expect(accept.status).toBe(200);
  const [row] = await db.select().from(affiliateCreators).where(eq(affiliateCreators.id, invite.body.id));
  return row;
}

async function commissionFor(orderId: string) {
  const [c] = await db.select().from(affiliateCommissions).where(eq(affiliateCommissions.orderId, orderId));
  return c;
}

describe("program setup and the checkout code (reuses discount_codes)", () => {
  it("mints a normal discount code for the creator, live only while active", async () => {
    const seller = await seedSeller("setup");
    const creator = await seedCreator("setup");
    const aff = await setupProgram(seller, creator);
    const [dc] = await db.select().from(discountCodes).where(eq(discountCodes.id, aff.discountCodeId!));
    expect(dc).toMatchObject({ sellerId: seller, code: aff.code, type: "percentage", active: true });
    expect(Number(dc.value)).toBe(5);

    await call(app.base, "PATCH", `/api/seller/affiliate/creators/${aff.id}`, seller, { status: "paused" });
    const [paused] = await db.select().from(discountCodes).where(eq(discountCodes.id, aff.discountCodeId!));
    expect(paused.active).toBe(false);

    await call(app.base, "PUT", "/api/seller/affiliate/program", seller, { enabled: false });
    await call(app.base, "PATCH", `/api/seller/affiliate/creators/${aff.id}`, seller, { status: "active" });
    const [off] = await db.select().from(discountCodes).where(eq(discountCodes.id, aff.discountCodeId!));
    expect(off.active).toBe(false);
  });

  it("validates settings and refuses inviting yourself or unknown users", async () => {
    const seller = await seedSeller("validate");
    expect((await call(app.base, "PUT", "/api/seller/affiliate/program", seller, { commissionPercent: 90 })).status).toBe(400);
    expect((await call(app.base, "PUT", "/api/seller/affiliate/program", seller, { windowDays: 0 })).status).toBe(400);
    await call(app.base, "PUT", "/api/seller/affiliate/program", seller, { enabled: true });
    expect((await call(app.base, "POST", "/api/seller/affiliate/creators/invite", seller, { username: "nobody-here-xyz" })).status).toBe(404);
  });
});

describe("attribution on a paid order", () => {
  it("records a pending commission via the click link, in integer cents excluding tax and shipping", async () => {
    const seller = await seedSeller("link");
    const buyer = await seedBuyer("link");
    const creator = await seedCreator("link");
    const aff = await setupProgram(seller, creator);

    const click = await call(app.base, "POST", "/api/public/affiliate/click", "", { code: aff.code, visitorId: "visitor-abc-12345" });
    expect(click.status).toBe(200);
    expect(click.body).toMatchObject({ valid: true, sellerId: seller, windowDays: 30 });
    await call(app.base, "POST", "/api/public/affiliate/click", "", { code: aff.code, visitorId: "visitor-abc-12345" });
    const attach = await call(app.base, "POST", "/api/affiliate/attach", buyer, { code: aff.code });
    expect(attach.body.attributed).toBe(true);

    const product = await seedProduct(seller, { priceCents: 1999 });
    const { order } = await pay({
      sellerId: seller, buyerId: buyer, chargeModel: "destination",
      items: [{ ...product, quantity: 1 }], shippingCents: 700, taxCents: 300,
    });
    const c = await commissionFor(order.id);
    expect(c).toMatchObject({
      creatorId: creator.id, sellerId: seller, source: "link", baseCents: 1999, commissionBps: 1000,
      amountCents: 199, reversedCents: 0, paidCents: 0, status: "pending",
    });
    const events = await db.select().from(affiliateCommissionEvents).where(eq(affiliateCommissionEvents.commissionId, c.id));
    expect(events.map((e) => e.kind)).toEqual(["accrued"]);

    const overview = await call(app.base, "GET", "/api/seller/affiliate", seller);
    const row = overview.body.creators.find((x: any) => x.id === aff.id);
    expect(row.stats).toMatchObject({ clicks: 1, orders: 1, revenueCents: 1999, pendingCents: 199, payableCents: 0, paidCents: 0 });
  });

  it("uses the creator override rate and counts a checkout code (discount code id)", async () => {
    const seller = await seedSeller("code");
    const buyer = await seedBuyer("code");
    const creator = await seedCreator("code");
    const aff = await setupProgram(seller, creator);
    await call(app.base, "PATCH", `/api/seller/affiliate/creators/${aff.id}`, seller, { commissionPercent: 15 });
    const product = await seedProduct(seller, { priceCents: 10_000 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] });
    expect(await commissionFor(order.id)).toBeUndefined(); // no code, no link: untouched

    const made = await db.transaction((tx) => attributeOrder(tx, {
      orderId: order.id, sellerId: seller, buyerId: buyer, subtotalCents: 10_000, sellerDiscountCents: 500,
      discountCodeId: aff.discountCodeId, paidAt: new Date(),
    }));
    expect(made).toMatchObject({ source: "code", baseCents: 9_500, commissionBps: 1500, amountCents: 1425 });
    // idempotent: a replay creates nothing new
    expect(await db.transaction((tx) => attributeOrder(tx, {
      orderId: order.id, sellerId: seller, buyerId: buyer, subtotalCents: 10_000, sellerDiscountCents: 500,
      discountCodeId: aff.discountCodeId, paidAt: new Date(),
    }))).toBeNull();
  });

  it("does not touch orders without an affiliate, and ignores an expired window", async () => {
    const seller = await seedSeller("plain");
    const buyer = await seedBuyer("plain");
    const creator = await seedCreator("plain");
    const aff = await setupProgram(seller, creator);
    await call(app.base, "POST", "/api/affiliate/attach", buyer, { code: aff.code });
    await db.execute(sql`UPDATE affiliate_attributions SET clicked_at = now() - interval '45 days' WHERE buyer_id = ${buyer}`);
    const product = await seedProduct(seller, { priceCents: 4000 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] });
    expect(await commissionFor(order.id)).toBeUndefined();
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o.status).toBe("pending");
  });

  it("blocks self-referral: creator buying through their own link, and attaching their own code", async () => {
    const seller = await seedSeller("self");
    const creator = await seedCreator("self");
    const aff = await setupProgram(seller, creator);
    const attach = await call(app.base, "POST", "/api/affiliate/attach", creator.id, { code: aff.code });
    expect(attach.body).toMatchObject({ attributed: false, reason: "self" });
    // even a stored attribution row is ignored at order time
    await db.execute(sql`INSERT INTO affiliate_attributions (affiliate_id, seller_id, creator_id, buyer_id, clicked_at, expires_at)
      VALUES (${aff.id}::uuid, ${seller}, ${creator.id}, ${creator.id}, now(), now() + interval '30 days')`);
    const product = await seedProduct(seller, { priceCents: 4000 });
    const { order } = await pay({ sellerId: seller, buyerId: creator.id, chargeModel: "destination", items: [{ ...product, quantity: 1 }] });
    expect(await commissionFor(order.id)).toBeUndefined();
  });

  it("does not track when the program is off", async () => {
    const seller = await seedSeller("off");
    const buyer = await seedBuyer("off");
    const creator = await seedCreator("off");
    const aff = await setupProgram(seller, creator);
    await call(app.base, "POST", "/api/affiliate/attach", buyer, { code: aff.code });
    await call(app.base, "PUT", "/api/seller/affiliate/program", seller, { enabled: false });
    const product = await seedProduct(seller, { priceCents: 4000 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] });
    expect(await commissionFor(order.id)).toBeUndefined();
    const click = await call(app.base, "POST", "/api/public/affiliate/click", "", { code: aff.code });
    expect(click.status).toBe(404);
  });
});

describe("refund reversal", () => {
  async function paidWithCommission(tag: string) {
    const seller = await seedSeller(tag);
    const buyer = await seedBuyer(tag);
    const creator = await seedCreator(tag);
    const aff = await setupProgram(seller, creator);
    await call(app.base, "POST", "/api/affiliate/attach", buyer, { code: aff.code });
    const product = await seedProduct(seller, { priceCents: 5000 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 2 }] });
    return { seller, buyer, creator, aff, order, commission: await commissionFor(order.id) };
  }

  it("reverses proportionally on a partial refund and fully on the rest", async () => {
    const { seller, order, commission } = await paidWithCommission("refund");
    expect(commission.amountCents).toBe(1000);
    await refundOrder({ orderId: order.id, amountCents: 2500, reason: "return_approved", initiatedBy: seller, idempotencyKey: `aff-p/${order.id}` });
    let c = await commissionFor(order.id);
    expect(c.reversedCents).toBe(250); // kept floor(1000 * 7500 / 10000) = 750
    expect(c.status).toBe("pending");
    await refundOrder({ orderId: order.id, reason: "seller_cancelled", initiatedBy: seller, idempotencyKey: `aff-r/${order.id}` });
    c = await commissionFor(order.id);
    expect(c).toMatchObject({ reversedCents: 1000, status: "reversed" });
    const kinds = (await db.select().from(affiliateCommissionEvents).where(eq(affiliateCommissionEvents.commissionId, c.id))).map((e) => e.kind);
    expect(kinds).toEqual(["accrued", "reversed", "reversed"]);
  });

  it("the sweep reverses a cancelled order that bypassed the refund path", async () => {
    const { order } = await paidWithCommission("sweep");
    await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, order.id));
    expect(await reconcileReversals()).toBeGreaterThanOrEqual(1);
    expect((await commissionFor(order.id)).status).toBe("reversed");
  });
});

describe("payouts (mocked Stripe)", () => {
  async function payableCommission(tag: string, opts: { priceCents?: number; program?: Record<string, unknown>; connected?: boolean } = {}) {
    const seller = await seedSeller(tag);
    const buyer = await seedBuyer(tag);
    const creator = await seedCreator(tag, opts.connected ?? true);
    const aff = await setupProgram(seller, creator, opts.program);
    await call(app.base, "POST", "/api/affiliate/attach", buyer, { code: aff.code });
    const product = await seedProduct(seller, { priceCents: opts.priceCents ?? 20_000 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] });
    return { seller, buyer, creator, aff, order };
  }
  const deliver = (orderId: string, daysAgo: number) =>
    db.update(orders).set({ status: "delivered", deliveredAt: new Date(Date.now() - daysAgo * 86_400_000) }).where(eq(orders.id, orderId));
  const run = (extra: Record<string, unknown> = {}) => runAffiliatePayouts({ stripe: okStripe(), enabled: true, ...extra });

  it("stays pending inside the return window, becomes payable after it", async () => {
    const { order } = await payableCommission("window");
    await deliver(order.id, 5);
    await run();
    expect((await commissionFor(order.id)).status).toBe("pending");
    expect(fake.state.transfers).toHaveLength(0);
    // the delivery date is fixed in real life; rewind it to simulate time passing
    await deliver(order.id, 31);
    await db.update(affiliateCommissions).set({ eligibleAt: null }).where(eq(affiliateCommissions.orderId, order.id));
    await promoteEligibleCommissions();
    expect((await commissionFor(order.id)).status).toBe("payable");
  });

  it("pays once with an idempotency key and never double pays on re-runs", async () => {
    const { order, creator, seller } = await payableCommission("pay");
    await deliver(order.id, 40);
    const first = await run();
    expect(first.paid).toBeGreaterThanOrEqual(1);
    const transfers = fake.state.transfers.filter((t) => t.metadata?.creatorId === creator.id);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ amount: 2000, currency: "usd", destination: `acct_${creator.id.replace(/-/g, "_")}` });
    expect(transfers[0].idempotencyKey).toMatch(/^affiliate-payout\/[0-9a-f-]+\/1$/);
    let c = await commissionFor(order.id);
    expect(c).toMatchObject({ status: "paid", paidCents: 2000, payoutId: null });

    await run(); await run();
    expect(fake.state.transfers.filter((t) => t.metadata?.creatorId === creator.id)).toHaveLength(1);
    const payouts = await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.sellerId, seller));
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({ state: "paid", amountCents: 2000 });
    c = await commissionFor(order.id);
    expect(c.paidCents).toBe(2000);
  });

  it("a lost response leaves the payout open and the retry reuses the same key (one transfer)", async () => {
    const { order, creator, seller } = await payableCommission("lost");
    await deliver(order.id, 40);
    fake.state.loseNextTransferResponse = true;
    const first = await run();
    expect(first.unconfirmed).toBe(1);
    const [open] = await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.sellerId, seller));
    expect(open.state).toBe("processing");
    // concurrent run right away does nothing
    await run();
    expect(fake.state.transfers.filter((t) => t.metadata?.creatorId === creator.id)).toHaveLength(1);
    // later run re-drives with the SAME key
    await run({ now: new Date(Date.now() + 5 * 60_000) });
    expect(fake.state.transfers.filter((t) => t.metadata?.creatorId === creator.id)).toHaveLength(1);
    const [done] = await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.sellerId, seller));
    expect(done).toMatchObject({ state: "paid", attempt: 1 });
    expect((await commissionFor(order.id)).paidCents).toBe(2000);
  });

  it("records a definitive failure, then retries with a new key later", async () => {
    const { order, creator, seller } = await payableCommission("fail");
    await deliver(order.id, 40);
    fake.state.failNextTransfer = "definitive";
    const first = await run();
    expect(first.failed).toBeGreaterThanOrEqual(1);
    let [p] = await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.sellerId, seller));
    expect(p).toMatchObject({ state: "failed", attempt: 1 });
    expect(p.failureCode).toBeTruthy();
    expect(fake.state.transfers.filter((t) => t.metadata?.creatorId === creator.id)).toHaveLength(0);
    await run(); // backoff not elapsed
    expect(fake.state.transfers.filter((t) => t.metadata?.creatorId === creator.id)).toHaveLength(0);
    await run({ now: new Date(Date.now() + 3 * 3_600_000) });
    const sent = fake.state.transfers.filter((t) => t.metadata?.creatorId === creator.id);
    expect(sent).toHaveLength(1);
    expect(sent[0].idempotencyKey).toMatch(/\/2$/);
    [p] = await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.sellerId, seller));
    expect(p).toMatchObject({ state: "paid", attempt: 2 });
    expect((await commissionFor(order.id)).status).toBe("paid");
  });

  it("holds below the minimum, and skips creators without a ready Connect account", async () => {
    const small = await payableCommission("min", { priceCents: 5_000, program: { minPayoutCents: 5_000 } });
    await deliver(small.order.id, 40);
    const noAcct = await payableCommission("noacct", { connected: false });
    await deliver(noAcct.order.id, 40);
    await run();
    expect(fake.state.transfers.filter((t) => [small.creator.id, noAcct.creator.id].includes(t.metadata?.creatorId))).toHaveLength(0);
    expect((await commissionFor(small.order.id)).status).toBe("payable");
    expect((await commissionFor(noAcct.order.id)).status).toBe("payable");
  });

  it("tracks but never pays when Stripe is unavailable or payouts are off", async () => {
    const { order, seller, creator } = await payableCommission("nokey");
    await deliver(order.id, 40);
    const res = await runAffiliatePayouts({ stripe: null, enabled: true });
    expect(res.available).toBe(false);
    expect((await commissionFor(order.id)).status).toBe("payable");
    expect(await runCreatorPayout({ sellerId: seller, creatorId: creator.id, stripe: okStripe(), enabled: false })).toEqual({ status: "skipped", reason: "unavailable" });
    const overview = await call(app.base, "GET", "/api/affiliate/payout-account", creator.id);
    expect(overview.body.available).toBe(false);
  });

  it("nets a clawback (refund after payout) against the next payout", async () => {
    const seller = await seedSeller("claw");
    const buyer = await seedBuyer("claw");
    const creator = await seedCreator("claw");
    const aff = await setupProgram(seller, creator, { minPayoutCents: 500 });
    await call(app.base, "POST", "/api/affiliate/attach", buyer, { code: aff.code });
    const product = await seedProduct(seller, { priceCents: 10_000 });
    const a = (await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] })).order;
    await deliver(a.id, 40);
    await run();
    expect((await commissionFor(a.id)).paidCents).toBe(1000);

    await refundOrder({ orderId: a.id, amountCents: 5_000, reason: "return_approved", initiatedBy: seller, idempotencyKey: `claw/${a.id}` });
    const c = await commissionFor(a.id);
    expect(c.reversedCents).toBe(500);

    // a second paid order: its payout is reduced by the 500 already overpaid
    await call(app.base, "POST", "/api/affiliate/attach", buyer, { code: aff.code });
    const b = (await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] })).order;
    await deliver(b.id, 40);
    await run();
    const sent = fake.state.transfers.filter((t) => t.metadata?.creatorId === creator.id);
    expect(sent).toHaveLength(2);
    expect(sent[1].amount).toBe(500);
    expect(await commissionFor(a.id)).toMatchObject({ paidCents: 500 });
    expect(await commissionFor(b.id)).toMatchObject({ paidCents: 1000, status: "paid" });
  });
});

describe("isolation and auth", () => {
  it("requires sign-in on creator and seller routes", async () => {
    expect((await call(app.base, "GET", "/api/affiliate/overview", "")).status).toBe(401);
    expect((await call(app.base, "GET", "/api/seller/affiliate", "")).status).toBe(401);
  });

  it("one seller cannot see or change another seller's creators", async () => {
    const sellerA = await seedSeller("iso-a");
    const sellerB = await seedSeller("iso-b");
    const creator = await seedCreator("iso");
    const aff = await setupProgram(sellerA, creator);
    const listB = await call(app.base, "GET", "/api/seller/affiliate", sellerB);
    expect(listB.body.creators).toEqual([]);
    expect((await call(app.base, "PATCH", `/api/seller/affiliate/creators/${aff.id}`, sellerB, { status: "paused" })).status).toBe(404);
    expect((await call(app.base, "DELETE", `/api/seller/affiliate/creators/${aff.id}`, sellerB)).status).toBe(404);
    const [still] = await db.select().from(affiliateCreators).where(eq(affiliateCreators.id, aff.id));
    expect(still.status).toBe("active");
  });

  it("a creator only sees their own brands and payouts, and cannot answer someone else's invite", async () => {
    const seller = await seedSeller("iso2");
    const c1 = await seedCreator("iso2a");
    const c2 = await seedCreator("iso2b");
    const aff = await setupProgram(seller, c1);
    const mine = await call(app.base, "GET", "/api/affiliate/overview", c1.id);
    expect(mine.body.brands).toHaveLength(1);
    expect((await call(app.base, "GET", "/api/affiliate/overview", c2.id)).body.brands).toHaveLength(0);
    const inv = await call(app.base, "POST", "/api/seller/affiliate/creators/invite", seller, { username: c2.username });
    expect((await call(app.base, "POST", `/api/affiliate/invites/${inv.body.id}/accept`, c1.id, {})).status).toBe(404);
    expect(aff.creatorId).toBe(c1.id);
  });

  it("applying: pending until the seller approves, auto-approve skips the wait, own brand refused", async () => {
    const seller = await seedSeller("apply");
    const creator = await seedCreator("apply");
    await call(app.base, "PUT", "/api/seller/affiliate/program", seller, { enabled: true });
    expect((await call(app.base, "POST", `/api/affiliate/brands/${seller}/apply`, seller, {})).status).toBe(400);
    const applied = await call(app.base, "POST", `/api/affiliate/brands/${seller}/apply`, creator.id, {});
    expect(applied.body.status).toBe("pending");
    expect((await call(app.base, "POST", "/api/public/affiliate/click", "", { code: applied.body.code })).status).toBe(404);
    const approved = await call(app.base, "POST", `/api/seller/affiliate/creators/${applied.body.id}/approve`, seller, {});
    expect(approved.body.status).toBe("active");
    expect((await call(app.base, "POST", "/api/public/affiliate/click", "", { code: applied.body.code })).status).toBe(200);

    const other = await seedCreator("apply2");
    await call(app.base, "PUT", "/api/seller/affiliate/program", seller, { autoApprove: true });
    expect((await call(app.base, "POST", `/api/affiliate/brands/${seller}/apply`, other.id, {})).body.status).toBe("active");
  });
});
