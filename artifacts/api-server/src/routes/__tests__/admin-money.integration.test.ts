/**
 * Admin money tools (Revenue P1 4/7), real Postgres + real routers + an
 * in-memory Stripe (lib/money/__tests__/fakeStripe). Covers: the admin gate on
 * every new endpoint, revenue lines / deductions / net take, MRR, the Thread
 * Cash dashboard and kill switches (and that the claim/redeem paths obey
 * them), audited + idempotent refunds, dispute evidence and submission,
 * payout hold/release (+ the seller-side guard), the new-account payout
 * delay and its step-down job, the payout review list, and the risk queue.
 * No real Stripe call is ever made.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test-key";
});

vi.mock("../../lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("../../lib/money/__tests__/fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/push")>()),
  sendPushToUser: async () => true,
}));
vi.mock("../../lib/brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
  sendOrderShippingEmail: async () => true,
  sendReturnStatusEmail: async () => true,
}));
vi.mock("../../middlewares/requireAuth", async (orig) => ({
  ...(await orig<typeof import("../../middlewares/requireAuth")>()),
  requireAuth: (req: any, res: any, next: () => void) => {
    const who = req.headers["x-test-user"];
    if (!who) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = who;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../middlewares/requireRole")>()),
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { and, eq, sql } from "drizzle-orm";
import {
  adminAuditLog, aiCreditPurchases, db, disputeEvents, disputes, freelancerJobs, freelancers, orders, payoutControls,
  sellerSubscriptionEntitlements, threadCashEntries, threadCashStreaks, users,
} from "@workspace/db";
import { fake } from "../../lib/money/__tests__/fakeStripe";
import { call, pay, seedBuyer, seedProduct, seedSeller, startApp, uid } from "../../lib/money/__tests__/moneyHarness";
import adminRouter from "../admin";
import threadCashRouter from "../thread-cash";
import financeRouter from "../finance";
import {
  NEW_ACCOUNT_PAYOUT_DELAY_DAYS, applyNewAccountPayoutDelay, clearBalanceCache, stepDownExpiredPayoutDelays,
} from "../../lib/admin/payoutControls";
import { estimateCardFeeCents } from "../../lib/admin/revenue";

const ADMIN = uid("adm-money-admin");
const NOT_ADMIN = uid("adm-money-user");

let app: { base: string; close: () => Promise<void> };
const accountUpdates: Array<{ id: string; params: any }> = [];
const disputeUpdates: Array<{ id: string; params: any }> = [];
let balanceCalls = 0;
const schedules = new Map<string, any>();

async function audits(targetId: string, action?: string) {
  // Scoped to this run's admin: the audit log is append-only, so earlier runs' rows stay.
  const rows = await db.select().from(adminAuditLog).where(and(eq(adminAuditLog.targetId, targetId), eq(adminAuditLog.actorClerkId, ADMIN)));
  return action ? rows.filter((r) => r.action === action) : rows;
}

beforeAll(async () => {
  // Extend the fake Stripe with what the admin tools call.
  const s = fake.stripe as any;
  s.accounts.retrieve = async (id: string) => ({ id, settings: { payouts: { schedule: schedules.get(id) ?? { interval: "daily", delay_days: 2 } } } });
  s.accounts.update = async (id: string, params: any) => {
    accountUpdates.push({ id, params });
    const next = { ...(schedules.get(id) ?? { interval: "daily", delay_days: 2 }), ...params.settings?.payouts?.schedule };
    schedules.set(id, next);
    return { id, settings: { payouts: { schedule: next } } };
  };
  s.disputes = { update: async (id: string, params: any) => { disputeUpdates.push({ id, params }); return { id, status: params.submit ? "under_review" : "needs_response" }; } };
  const origBalance = s.balance.retrieve;
  s.balance.retrieve = async (...args: any[]) => { balanceCalls += 1; return origBalance(...args); };

  await db.insert(users).values([
    { clerkId: ADMIN, email: `${ADMIN}@example.test`, name: "Admin", role: "admin" },
    { clerkId: NOT_ADMIN, email: `${NOT_ADMIN}@example.test`, name: "Member", role: "buyer" },
  ]);
  app = await startApp((server) => {
    server.use("/api/admin", adminRouter);
    server.use("/api/thread-cash", threadCashRouter);
    server.use("/api/finance", financeRouter);
  });
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM feature_flags WHERE key IN ('threadCashRewardsPaused', 'threadCashCheckoutPaused')`);
  await app?.close();
});

beforeEach(() => { fake.reset(); });

const get = (user: string, path: string) => call(app.base, "GET", `/api${path}`, user);
const post = (user: string, path: string, body?: unknown) => call(app.base, "POST", `/api${path}`, user, body ?? {});

describe("admin gate on every new endpoint", () => {
  it("refuses non-admins with 403", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    const checks: Array<[string, string, unknown?]> = [
      ["GET", "/admin/mrr"], ["GET", "/admin/thread-cash/summary"], ["GET", "/admin/risk"], ["GET", "/admin/payouts/review"],
      ["GET", `/admin/disputes/${id}`], ["GET", "/admin/orders?risk=highest"],
      ["POST", "/admin/thread-cash/pause", { kind: "rewards", paused: true }],
      ["POST", `/admin/orders/${id}/refund`, { reason: "not_delivered", idempotencyKey: "abcdefgh1" }],
      ["POST", `/admin/disputes/${id}/evidence`, { type: "other", description: "x" }],
      ["POST", `/admin/disputes/${id}/submit`],
      ["POST", `/admin/payouts/seller/${NOT_ADMIN}/hold`, { reason: "x" }],
      ["POST", `/admin/payouts/seller/${NOT_ADMIN}/release`],
    ];
    for (const [method, path, body] of checks) {
      const r = await call(app.base, method, `/api${path}`, NOT_ADMIN, method === "POST" ? body ?? {} : undefined);
      expect(r.status, `${method} ${path}`).toBe(403);
    }
    const flags = await db.execute(sql`SELECT enabled FROM feature_flags WHERE key = 'threadCashRewardsPaused'`);
    expect((flags as any).rows[0]?.enabled ?? false).toBe(false);
  });
});

describe("revenue: every line, each deduction, net take", () => {
  it("adds B2B, freelancer, AI credit, subscription and Thread Cash lines to /admin/revenue", async () => {
    const before = (await get(ADMIN, "/admin/revenue?days=30")).body;
    expect(before).toMatchObject({ gmvCents: expect.any(Number), platformFeesCents: expect.any(Number) }); // existing fields kept

    const seller = await seedSeller("rev");
    const buyer = await seedBuyer("rev");
    const [mfr] = (await db.execute(sql`INSERT INTO manufacturers (business_name, country, specialty, status) VALUES ('Rev Mfg', 'US', 'tees', 'active') RETURNING id`) as any).rows;
    await db.execute(sql`INSERT INTO sample_orders (manufacturer_id, seller_id, order_type, title, price_cents, platform_fee_cents, stripe_charge_id)
      VALUES (${mfr.id}, ${seller}, 'sample', 'S', 10000, 500, 'ch_rev_sample'), (${mfr.id}, ${seller}, 'bulk', 'B', 200000, 6000, 'ch_rev_bulk')`);
    const [fl] = await db.insert(freelancers).values({ userId: uid("fl"), serviceType: "design" } as any).returning();
    await db.insert(freelancerJobs).values({ freelancerId: fl!.id, sellerId: seller, title: "Logo", agreedPriceCents: 20000, paymentStatus: "paid", platformFeeCents: 2000 });
    await db.insert(aiCreditPurchases).values({ clerkUserId: seller, packId: "p100", credits: 100, amountCents: 999, status: "paid", paidAt: new Date() });
    await db.update(users).set({ subscriptionId: "sub_rev", subscriptionStatus: "active", subscriptionPlanId: "growth" }).where(eq(users.clerkId, seller));
    await db.insert(sellerSubscriptionEntitlements).values({ clerkUserId: buyer, provider: "revenuecat", planId: "pro", status: "active", expiresAt: new Date(Date.now() + 20 * 86_400_000) });
    await db.insert(threadCashEntries).values([
      { buyerId: buyer, amountCents: 10, source: "daily_checkin", referenceId: uid("d") },
      { buyerId: buyer, amountCents: 100, source: "streak_bonus", referenceId: uid("d") },
    ]);
    const product = await seedProduct(seller, { priceCents: 5_000 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }], stripeFeeCents: 200 });
    await db.update(orders).set({ threadCashAppliedCents: 300 }).where(eq(orders.id, order.id));
    const [dispute] = await db.insert(disputes).values({ stripeDisputeId: uid("dp"), sellerId: seller, orderId: order.id, amountCents: 5000 }).returning();
    await db.insert(disputeEvents).values({ disputeId: dispute!.id, stripeEventId: uid("evt"), kind: "created", payload: { feeCents: 1500 } });

    const after = (await get(ADMIN, "/admin/revenue?days=30")).body;
    const line = (r: any, id: string) => r.lines.find((l: any) => l.id === id).cents;
    const ded = (r: any, id: string) => r.deductions.find((l: any) => l.id === id).cents;
    expect(line(after, "sample_fees") - line(before, "sample_fees")).toBe(500);
    expect(line(after, "bulk_fees") - line(before, "bulk_fees")).toBe(6000);
    expect(line(after, "freelance_fees") - line(before, "freelance_fees")).toBe(2000);
    expect(line(after, "ai_credits") - line(before, "ai_credits")).toBe(999);
    expect(line(after, "subscriptions") - line(before, "subscriptions")).toBe(7900 + 19900);
    expect(ded(after, "thread_cash_rewards") - ded(before, "thread_cash_rewards")).toBe(110);
    expect(ded(after, "thread_cash_redeemed") - ded(before, "thread_cash_redeemed")).toBe(300);
    expect(ded(after, "dispute_fees") - ded(before, "dispute_fees")).toBe(1500);
    expect(ded(after, "store_fees") - ded(before, "store_fees")).toBe(Math.round(19900 * 0.15));
    const gross = after.lines.reduce((s: number, l: any) => s + l.cents, 0);
    expect(after.grossPlatformRevenueCents).toBe(gross);
    expect(after.netTakeCents).toBe(gross - after.deductions.reduce((s: number, d: any) => s + d.cents, 0));
    expect(after.subscriptions.byProvider.native.mrrCents - before.subscriptions.byProvider.native.mrrCents).toBe(19900);

    const mrr = (await get(ADMIN, "/admin/mrr?days=30")).body;
    expect(mrr.byTier.find((t: any) => t.planId === "growth").active).toBeGreaterThanOrEqual(1);
    expect(mrr.mrrCents).toBe(mrr.byTier.reduce((s: number, t: any) => s + t.mrrCents, 0));
  });

  it("estimates Stripe card fees as 2.9% + 30¢ per charge", () => {
    expect(estimateCardFeeCents(10_000, 1)).toBe(320);
    expect(estimateCardFeeCents(0, 0)).toBe(0);
  });
});

describe("Thread Cash dashboard and kill switches", () => {
  it("summarises the ledger and pauses rewards/checkout with an audit row, which the app paths obey", async () => {
    const buyer = await seedBuyer("tc");
    await db.insert(threadCashEntries).values([
      { buyerId: buyer, amountCents: 500, source: "referral", referenceId: uid("r") },
      { buyerId: buyer, amountCents: -40, source: "expiry", referenceId: uid("x") },
    ]);
    const sum = (await get(ADMIN, "/admin/thread-cash/summary?days=7")).body;
    expect(sum.issuedCents).toBeGreaterThanOrEqual(500);
    expect(sum.expiredCents).toBeGreaterThanOrEqual(40);
    expect(sum.topEarners.some((t: any) => t.clerkId === buyer)).toBe(true);
    expect(sum.pause).toMatchObject({ rewards: { paused: false }, checkout: { paused: false } });

    expect((await post(ADMIN, "/admin/thread-cash/pause", { kind: "nope", paused: true })).status).toBe(400);
    const on = await post(ADMIN, "/admin/thread-cash/pause", { kind: "rewards", paused: true });
    expect(on.body).toMatchObject({ ok: true, paused: true, changed: true });
    const again = await post(ADMIN, "/admin/thread-cash/pause", { kind: "rewards", paused: true });
    expect(again.body.changed).toBe(false);
    expect(await audits("rewards", "thread_cash.pause")).toHaveLength(1);

    const claim = await post(buyer, "/thread-cash/daily/claim", { timezone: "UTC", activeSeconds: 600 });
    expect(claim.status).toBe(200);
    expect(claim.body).toMatchObject({ ok: true, awarded: false, code: "THREAD_CASH_REWARDS_PAUSED", earnedCents: 0 });
    const checkIn = await post(buyer, "/thread-cash/check-in", { timezone: "UTC" });
    expect(checkIn.body.code).toBe("THREAD_CASH_REWARDS_PAUSED");

    await post(ADMIN, "/admin/thread-cash/pause", { kind: "checkout", paused: true });
    const redeem = await post(buyer, "/thread-cash/redeem", { amountCents: 100, idempotencyKey: uid("k") });
    expect(redeem.status).toBe(403);
    expect(redeem.body.code).toBe("THREAD_CASH_CHECKOUT_PAUSED");

    await post(ADMIN, "/admin/thread-cash/pause", { kind: "rewards", paused: false });
    await post(ADMIN, "/admin/thread-cash/pause", { kind: "checkout", paused: false });
    expect(await audits("rewards", "thread_cash.resume")).toHaveLength(1);
    const unpaused = await post(buyer, "/thread-cash/daily/claim", { timezone: "UTC", activeSeconds: 600 });
    expect(unpaused.body.code).not.toBe("THREAD_CASH_REWARDS_PAUSED");
  });
});

describe("refunds", () => {
  it("refunds through lib/money/refunds, is idempotent per key and audited once", async () => {
    const seller = await seedSeller("refund");
    const buyer = await seedBuyer("refund");
    const product = await seedProduct(seller, { priceCents: 6_000 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] });

    const detail = (await get(ADMIN, `/admin/orders/${order.id}`)).body;
    expect(detail.refundableCents).toBe(6_000);

    expect((await post(ADMIN, `/admin/orders/${order.id}/refund`, { reason: "bad", idempotencyKey: "key-12345678" })).status).toBe(400);
    expect((await post(ADMIN, `/admin/orders/${order.id}/refund`, { reason: "not_delivered" })).status).toBe(400);

    const first = await post(ADMIN, `/admin/orders/${order.id}/refund`, { amountCents: 2_000, reason: "requested_by_buyer", note: "Wrong size", idempotencyKey: "key-12345678" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, amountCents: 2_000, duplicate: false });
    const second = await post(ADMIN, `/admin/orders/${order.id}/refund`, { amountCents: 2_000, reason: "requested_by_buyer", idempotencyKey: "key-12345678" });
    expect(second.body).toMatchObject({ ok: true, duplicate: true });
    expect(fake.state.refunds).toHaveLength(1);
    expect(fake.state.refunds[0]).toMatchObject({ amount: 2_000 });
    const logged = await audits(order.id, "order.refund");
    expect(logged).toHaveLength(1);
    expect(logged[0]!.summary).toContain("Wrong size");

    const over = await post(ADMIN, `/admin/orders/${order.id}/refund`, { amountCents: 9_000, reason: "requested_by_buyer", idempotencyKey: "key-87654321" });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe("REFUND_EXCEEDS_REMAINING");
  });
});

describe("dispute evidence", () => {
  it("drafts evidence, then submits once (second submit is a no-op)", async () => {
    const seller = await seedSeller("disp");
    const [d] = await db.insert(disputes).values({ stripeDisputeId: uid("dp"), sellerId: seller, amountCents: 4_000, evidenceDueBy: new Date(Date.now() + 86_400_000) }).returning();
    expect((await post(ADMIN, `/admin/disputes/${d!.id}/submit`)).status).toBe(400); // nothing to send yet
    const add = await post(ADMIN, `/admin/disputes/${d!.id}/evidence`, { type: "written_response", description: "Delivered, signed for." });
    expect(add.status).toBe(201);
    expect(disputeUpdates.at(-1)).toMatchObject({ id: d!.stripeDisputeId, params: { submit: false } });

    const detail = (await get(ADMIN, `/admin/disputes/${d!.id}`)).body;
    expect(detail.evidence).toHaveLength(1);
    expect(detail.canAddEvidence).toBe(true);

    const sent = await post(ADMIN, `/admin/disputes/${d!.id}/submit`);
    expect(sent.body).toMatchObject({ ok: true, duplicate: false, status: "under_review" });
    const before = disputeUpdates.length;
    const again = await post(ADMIN, `/admin/disputes/${d!.id}/submit`);
    expect(again.body).toMatchObject({ ok: true, duplicate: true });
    expect(disputeUpdates.length).toBe(before);
    expect(await audits(d!.id, "dispute.submit")).toHaveLength(1);
    expect(await audits(d!.id, "dispute.evidence_add")).toHaveLength(1);
    expect((await post(ADMIN, `/admin/disputes/${d!.id}/evidence`, { type: "other", description: "late" })).status).toBe(409);
  });
});

describe("payout holds, new-account delay and review", () => {
  it("holds (manual schedule), blocks seller payouts, and releases to the previous schedule — idempotently", async () => {
    const seller = await seedSeller("hold");
    const [u] = await db.select({ acct: users.stripeAccountId }).from(users).where(eq(users.clerkId, seller));
    const acct = u!.acct!;
    schedules.set(acct, { interval: "weekly", weekly_anchor: "friday", delay_days: 2 });

    expect((await post(ADMIN, `/admin/payouts/seller/${seller}/hold`, {})).status).toBe(400); // reason required
    const hold = await post(ADMIN, `/admin/payouts/seller/${seller}/hold`, { reason: "Chargebacks" });
    expect(hold.body).toMatchObject({ ok: true, duplicate: false, state: "held" });
    expect(schedules.get(acct).interval).toBe("manual");
    const updatesAfterHold = accountUpdates.length;
    expect((await post(ADMIN, `/admin/payouts/seller/${seller}/hold`, { reason: "again" })).body.duplicate).toBe(true);
    expect(accountUpdates.length).toBe(updatesAfterHold);

    const sched = await call(app.base, "PATCH", "/api/finance/payout-schedule", seller, { interval: "daily" });
    expect(sched.status).toBe(409);
    expect(sched.body.code).toBe("PAYOUTS_ON_HOLD");
    const payout = await post(seller, "/finance/payout", { amount: 100, currency: "usd", idempotencyKey: "payout-key-123456" });
    expect(payout.status).toBe(409);

    const review = (await get(ADMIN, "/admin/payouts/review?state=held")).body;
    expect(review.items.some((i: any) => i.partyId === seller && i.state === "held")).toBe(true);

    const release = await post(ADMIN, `/admin/payouts/seller/${seller}/release`, {});
    expect(release.body).toMatchObject({ ok: true, duplicate: false, state: "released" });
    expect(schedules.get(acct)).toMatchObject({ interval: "weekly", weekly_anchor: "friday", delay_days: 2 });
    expect((await post(ADMIN, `/admin/payouts/seller/${seller}/release`, {})).body.duplicate).toBe(true);
    expect(await audits(seller, "payouts.hold")).toHaveLength(1);
    expect(await audits(seller, "payouts.release")).toHaveLength(1);
    expect((await post(ADMIN, `/admin/payouts/seller/no-such-user/hold`, { reason: "x" })).status).toBe(404);
  });

  it("gives new accounts a 7-day delay that the job lifts after 30 days; review list caches balances", async () => {
    const seller = await seedSeller("new");
    const acct = `acct_new_${seller.replace(/-/g, "_")}`;
    const created = new Date(Date.now() - 31 * 86_400_000);
    expect(await applyNewAccountPayoutDelay({ partyType: "seller", partyId: seller, stripeAccountId: acct, now: created })).toBe(true);
    expect(schedules.get(acct).delay_days).toBe(NEW_ACCOUNT_PAYOUT_DELAY_DAYS);

    clearBalanceCache();
    const calls = balanceCalls;
    const list = (await get(ADMIN, "/admin/payouts/review")).body;
    const row = list.items.find((i: any) => i.partyId === seller);
    expect(row).toMatchObject({ state: "new_account_delay", delayDays: 7, balance: { availableCents: 0, pendingCents: 0 } });
    await get(ADMIN, "/admin/payouts/review");
    const usedForSeller = balanceCalls - calls;
    expect(usedForSeller).toBe(list.items.filter((i: any) => i.balance).length); // second load served from cache

    expect(await stepDownExpiredPayoutDelays()).toBeGreaterThanOrEqual(1);
    expect(schedules.get(acct).delay_days).toBe("minimum");
    const [ctl] = await db.select().from(payoutControls).where(and(eq(payoutControls.partyType, "seller"), eq(payoutControls.partyId, seller)));
    expect(ctl!.state).toBe("released");
  });

  it("never fails onboarding when Stripe refuses the delay", async () => {
    const seller = await seedSeller("refuse");
    const failing = { accounts: { update: async () => { throw new Error("nope"); } }, balance: fake.stripe.balance } as any;
    expect(await applyNewAccountPayoutDelay({ partyType: "seller", partyId: seller, stripeAccountId: "acct_x", client: failing, log: { warn() {} } })).toBe(false);
    const [ctl] = await db.select().from(payoutControls).where(eq(payoutControls.partyId, seller));
    expect(ctl).toMatchObject({ state: "new_account_delay", delayDays: null });
  });
});

describe("risk queue", () => {
  it("lists Radar-flagged orders, fast new sellers and Thread Cash farming; filters /admin/orders by risk", async () => {
    const seller = await seedSeller("risk");
    const buyer = await seedBuyer("risk");
    const product = await seedProduct(seller, { priceCents: 60_000 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 2 }] });
    await db.update(orders).set({ riskLevel: "highest", riskScore: 88, riskFlags: [{ code: "radar", label: "Radar: highest", severity: "high" }] }).where(eq(orders.id, order.id));
    const device = uid("device");
    const farmers = [await seedBuyer("f1"), await seedBuyer("f2"), await seedBuyer("f3")];
    await db.insert(threadCashStreaks).values(farmers.map((f) => ({ buyerId: f, lastDeviceId: device })));

    const risk = (await get(ADMIN, "/admin/risk")).body;
    expect(risk.orders.find((o: any) => o.id === order.id)).toMatchObject({ riskLevel: "highest", riskScore: 88 });
    expect(risk.newSellers.find((s: any) => s.clerkId === seller)).toMatchObject({ orders: 1, riskyOrders: 1 });
    expect(risk.threadCash.sharedDevices.find((d: any) => d.deviceId === device)?.accounts).toBe(3);

    const highest = (await get(ADMIN, "/admin/orders?risk=highest&limit=100")).body;
    expect(highest.items.every((o: any) => o.riskLevel === "highest")).toBe(true);
    expect(highest.items.some((o: any) => o.id === order.id)).toBe(true);
    expect((await get(ADMIN, "/admin/orders?risk=bogus")).status).toBe(400);
  });
});


