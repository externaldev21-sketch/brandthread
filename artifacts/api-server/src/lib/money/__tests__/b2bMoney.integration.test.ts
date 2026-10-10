/**
 * Revenue P1 1/7 — B2B money, end to end against real Postgres, the real
 * routes and signed webhooks, with the in-memory Stripe:
 *  - BT-452 fee covers card processing (card vs ACH vs wallet math)
 *  - BT-454 ACH for big bulk cards, async success / failure webhooks
 *  - BT-453 wallet-funded bulk keeps the 5% (see also moneyFlows)
 *  - BT-460 refunds (full/partial, idempotent, permissions, wallet), cancel requests
 *  - BT-459 chargeback lost → transfer reversal (cards and freelancer jobs)
 *  - BT-461 quote accept → exactly one payable order card
 * Every scenario ends with a balanced ledger.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("./fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../push")>()),
  sendPushToUser: async () => {},
}));
vi.mock("../../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
}));
vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

import {
  db, disputes, dropWallets, freelancerJobs, freelancers, manufacturerActivityEvents, manufacturerMessages,
  manufacturerThreads, manufacturers, sampleOrderRefunds, sampleOrders, sellerQuoteRequests, users,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  ACH_MIN_BULK_CENTS, b2bFees, b2bProcessingEstimateCents, manufacturerNetCents,
} from "@workspace/manufacturer-flow";
import { fake } from "./fakeStripe";
import {
  call, expectLedgerBalanced, expectWalletMatchesLedger, held, pay, seedBulkOrder, seedBuyer, seedDrop, seedProduct,
  seedSeller, startApp, uid, walletFor,
} from "./moneyHarness";
import { destinationApplicationFeeCents } from "../fees";
import { commissionToReturnCents } from "../../b2b/refunds";
import { chargebackPostings } from "../../b2b/disputes";
import { normalizePostings } from "../ledger";
import sampleOrdersRouter from "../../../routes/sample-orders";
import sellerHubRouter from "../../../routes/seller-hub";
import adminRouter from "../../../routes/admin";
import webhooksRouter from "../../../routes/webhooks";

let app: { base: string; close: () => Promise<void> };
const originalKey = process.env.STRIPE_SECRET_KEY;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_for_money_tests";
  app = await startApp((server) => {
    if (process.env.DEBUG_TEST_LOGS) {
      server.use((req, _res, next) => { (req as any).log = { error: console.error, warn: console.warn, info: () => {} }; next(); });
    }
    server.use("/api/webhooks", webhooksRouter);
    server.use("/api/sample-orders", sampleOrdersRouter);
    server.use("/api/seller-hub", sellerHubRouter);
    server.use("/api/admin", adminRouter);
  });
});
afterAll(async () => {
  process.env.STRIPE_SECRET_KEY = originalKey;
  await expectLedgerBalanced();
  await app?.close();
});
beforeEach(() => fake.reset());

const returnUrl = (id: string) => `brandthread://sample-detail?id=${id}&paymentReturn=1`;

async function seedFactory() {
  const clerkId = uid("b2b-factory");
  await db.insert(users).values({ clerkId, email: `${clerkId}@money-tests.invalid`, name: "Factory owner", role: "seller" });
  const [mfr] = await db.insert(manufacturers).values({ verificationStatus: "verified",
    clerkId,
    businessName: `Factory ${clerkId}`,
    country: "PT",
    specialty: "Knitwear",
    status: "active",
    stripeAccountId: `acct_${clerkId.replace(/-/g, "_")}`,
    paymentSetup: true,
  }).returning();
  return mfr;
}

async function seedCard(sellerId: string, manufacturerId: string, priceCents: number, orderType: "sample" | "bulk" = "sample") {
  const [order] = await db.insert(sampleOrders).values({
    manufacturerId, sellerId, clientRequestId: uid("card"), orderType, issuedBy: "manufacturer",
    title: `${orderType} run`, quantity: orderType === "bulk" ? 500 : 2, priceCents,
    platformFeeCents: Math.round(priceCents * 0.05), status: "pending_payment",
  }).returning();
  return order;
}

async function deliver(type: string, object: Record<string, unknown>, id = `evt_${uid("b2b").replace(/-/g, "_")}`) {
  const signed = fake.signedEvent({ id, object: "event", type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
  const response = await fetch(`${app.base}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signed.header },
    body: signed.payload,
  });
  expect(response.status).toBe(200);
  return id;
}

async function reload(orderId: string) {
  const [order] = await db.select().from(sampleOrders).where(eq(sampleOrders.id, orderId));
  return order;
}

async function ledgerFor(sampleOrderId: string) {
  const result = await db.execute(sql`
    SELECT p.account, SUM(p.amount_cents)::int AS total
    FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.transaction_id
    WHERE t.sample_order_id = ${sampleOrderId}::uuid GROUP BY p.account
  `);
  return Object.fromEntries((result.rows as Array<{ account: string; total: number }>).map((r) => [r.account, r.total]));
}

/** Opens Checkout through the route and pays it through signed webhooks. */
async function payByCard(order: typeof sampleOrders.$inferSelect, method: "card" | "us_bank_account" = "card") {
  const opened = await call(app.base, "POST", `/api/sample-orders/${order.id}/checkout-session`, order.sellerId, { returnUrl: returnUrl(order.id) });
  expect(opened.status).toBe(201);
  const created = fake.state.checkoutSessionCreates.at(-1)!;
  const paymentIntent = `pi_${uid("b2bpi").replace(/-/g, "_")}`;
  fake.state.chargeMethods.set(paymentIntent, method);
  const session = {
    id: opened.body.sessionId,
    object: "checkout.session",
    payment_intent: paymentIntent,
    payment_status: "paid",
    payment_method_types: created.params.payment_method_types,
    metadata: { sampleOrderId: order.id, sellerId: order.sellerId },
  };
  if (method === "us_bank_account") {
    await deliver("checkout.session.completed", { ...session, payment_status: "unpaid", status: "complete" });
    await deliver("checkout.session.async_payment_succeeded", session);
  } else {
    await deliver("checkout.session.completed", session);
  }
  return { paymentIntent, session, created };
}

describe("BT-452 / BT-454 fee math", () => {
  it("passes card processing through with the same estimate retail uses", () => {
    for (const price of [100, 8_500, 99_999, 1_000_000, 50_000_000]) {
      const retail = destinationApplicationFeeCents({ merchandiseCents: price, preTaxTotalCents: price });
      const card = b2bFees({ priceCents: price, method: "card" });
      expect(card).toMatchObject({
        platformFeeCents: retail.platformFeeCents,
        processingFeeEstimateCents: retail.processingFeeEstimateCents,
        applicationFeeCents: retail.applicationFeeCents,
        manufacturerNetCents: price - retail.applicationFeeCents,
        chargeCents: price,
      });
    }
    expect(b2bFees({ priceCents: 8_500, method: "card" })).toMatchObject({ platformFeeCents: 425, processingFeeEstimateCents: 277, applicationFeeCents: 702, manufacturerNetCents: 7_798 });
  });

  it("charges ACH at 0.8% capped at $5 and takes no processing on wallet payments", () => {
    expect(b2bProcessingEstimateCents(10_000, "us_bank_account")).toBe(80);
    expect(b2bProcessingEstimateCents(2_000_000, "us_bank_account")).toBe(500);
    expect(b2bFees({ priceCents: 2_000_000, method: "us_bank_account" })).toMatchObject({ platformFeeCents: 100_000, processingFeeEstimateCents: 500, manufacturerNetCents: 1_899_500 });
    expect(b2bFees({ priceCents: 6_000, method: "drop_wallet" })).toMatchObject({ platformFeeCents: 300, processingFeeEstimateCents: 0, applicationFeeCents: 300, manufacturerNetCents: 5_700 });
  });

  it("supports the alternative fee modes with one switch", () => {
    expect(b2bFees({ priceCents: 10_000, method: "card", mode: "platform_absorbs" })).toMatchObject({ applicationFeeCents: 500, manufacturerNetCents: 9_500 });
    const surcharge = b2bFees({ priceCents: 10_000, method: "card", mode: "seller_surcharge" });
    expect(surcharge.manufacturerNetCents).toBe(9_500);
    expect(surcharge.chargeCents).toBe(10_000 + surcharge.sellerSurchargeCents);
    // The surcharge covers Stripe's fee on the grossed-up total.
    expect(surcharge.sellerSurchargeCents).toBe(b2bProcessingEstimateCents(10_000 + 320, "card"));
    expect(surcharge.sellerSurchargeCents).toBe(329);
  });

  it("shows the manufacturer what they receive, including legacy and refunded cards", () => {
    expect(manufacturerNetCents({ priceCents: 8_500 })).toBe(7_798);
    expect(manufacturerNetCents({ priceCents: 10_000, status: "processing", platformFeeCents: 500 })).toBe(9_500);
    expect(manufacturerNetCents({ priceCents: 10_000, status: "processing", platformFeeCents: 500, walletId: "w" })).toBe(10_000);
    expect(manufacturerNetCents({ priceCents: 10_000, manufacturerNetCents: 9_380, refundedCents: 2_000, platformFeeRefundedCents: 100 })).toBe(7_480);
  });
});

describe("BT-452 card checkout and settlement", () => {
  it("adds processing to the application fee, offers card only on samples, and books the split", async () => {
    const seller = await seedSeller("b2b-card");
    const factory = await seedFactory();
    const order = await seedCard(seller, factory.id, 8_500);
    const { created } = await payByCard(order);
    expect(created.params.payment_method_types).toEqual(["card"]);
    expect(created.params.payment_intent_data.application_fee_amount).toBe(702);
    const paid = await reload(order.id);
    expect(paid).toMatchObject({
      status: "payment_received", paymentMethodType: "card",
      platformFeeCents: 425, processingFeeEstimateCents: 277, manufacturerNetCents: 7_798,
    });
    expect(await ledgerFor(order.id)).toMatchObject({
      seller_card_payments: -8_500, manufacturer_paid: 7_798, platform_revenue: 425, stripe_processing_fees: 277,
    });
    // The manufacturer's API shows the net.
    expect(manufacturerNetCents(paid)).toBe(7_798);
  });
});

describe("BT-454 ACH for big bulk cards", () => {
  it("offers us_bank_account on bulk >= $1,000 and settles only when the debit succeeds", async () => {
    const seller = await seedSeller("b2b-ach");
    const factory = await seedFactory();
    const order = await seedCard(seller, factory.id, 150_000, "bulk");
    expect(order.priceCents).toBeGreaterThanOrEqual(ACH_MIN_BULK_CENTS);
    const opened = await call(app.base, "POST", `/api/sample-orders/${order.id}/checkout-session`, seller, { returnUrl: returnUrl(order.id) });
    expect(opened.status).toBe(201);
    const created = fake.state.checkoutSessionCreates.at(-1)!;
    expect(created.params.payment_method_types).toEqual(["card", "us_bank_account"]);
    expect(created.params.payment_intent_data.application_fee_amount).toBe(7_500 + 4_380);

    const paymentIntent = `pi_${uid("ach").replace(/-/g, "_")}`;
    fake.state.chargeMethods.set(paymentIntent, "us_bank_account");
    const session = {
      id: opened.body.sessionId, object: "checkout.session", payment_intent: paymentIntent,
      payment_method_types: ["card", "us_bank_account"], metadata: { sampleOrderId: order.id, sellerId: seller },
    };
    // Completed but unpaid: the debit is processing. Not paid.
    await deliver("checkout.session.completed", { ...session, payment_status: "unpaid", status: "complete" });
    let current = await reload(order.id);
    expect(current).toMatchObject({ status: "pending_payment", paymentMethodType: "us_bank_account" });
    const processing = await db.select().from(manufacturerActivityEvents).where(eq(manufacturerActivityEvents.sampleOrderId, order.id));
    expect(processing.map((e) => e.type)).toEqual(["payment_processing"]);
    expect(await ledgerFor(order.id)).toEqual({});

    // The debit clears.
    const succeeded = await deliver("checkout.session.async_payment_succeeded", { ...session, payment_status: "paid", status: "complete" });
    current = await reload(order.id);
    expect(current).toMatchObject({
      status: "payment_received", paymentMethodType: "us_bank_account",
      platformFeeCents: 7_500, processingFeeEstimateCents: 500, manufacturerNetCents: 142_000,
    });
    // The card-estimate excess goes back to the manufacturer, once.
    expect(fake.state.feeRefunds).toEqual([expect.objectContaining({ fee: `fee_${paymentIntent}`, amount: 11_880 - 8_000 })]);
    await deliver("checkout.session.async_payment_succeeded", { ...session, payment_status: "paid", status: "complete" }, `${succeeded}_retry`);
    expect(fake.state.feeRefunds).toHaveLength(1);
    expect(await ledgerFor(order.id)).toMatchObject({
      seller_card_payments: -150_000, manufacturer_paid: 142_000, platform_revenue: 7_500, stripe_processing_fees: 500,
    });
  });

  it("keeps samples card-only", async () => {
    const seller = await seedSeller("b2b-sample-only");
    const factory = await seedFactory();
    const order = await seedCard(seller, factory.id, 200_000, "sample");
    await call(app.base, "POST", `/api/sample-orders/${order.id}/checkout-session`, seller, { returnUrl: returnUrl(order.id) });
    expect(fake.state.checkoutSessionCreates.at(-1)!.params.payment_method_types).toEqual(["card"]);
  });

  it("marks a bounced debit failed and lets the seller pay again", async () => {
    const seller = await seedSeller("b2b-ach-fail");
    const factory = await seedFactory();
    const order = await seedCard(seller, factory.id, 250_000, "bulk");
    const opened = await call(app.base, "POST", `/api/sample-orders/${order.id}/checkout-session`, seller, { returnUrl: returnUrl(order.id) });
    const session = {
      id: opened.body.sessionId, object: "checkout.session", payment_intent: `pi_${uid("achf").replace(/-/g, "_")}`,
      payment_method_types: ["card", "us_bank_account"], metadata: { sampleOrderId: order.id, sellerId: seller },
    };
    await deliver("checkout.session.completed", { ...session, payment_status: "unpaid", status: "complete" });
    await deliver("checkout.session.async_payment_failed", { ...session, payment_status: "unpaid", status: "complete" });
    const failed = await reload(order.id);
    expect(failed.status).toBe("pending_payment");
    expect(failed.stripeCheckoutSessionId).toBeNull();
    expect(failed.paymentFailedAt).not.toBeNull();
    expect(failed.checkoutSessionVersion).toBe(order.checkoutSessionVersion + 1);
    expect(await ledgerFor(order.id)).toEqual({});
    // A new Checkout opens for the retry.
    const retry = await call(app.base, "POST", `/api/sample-orders/${order.id}/checkout-session`, seller, { returnUrl: returnUrl(order.id) });
    expect(retry.status).toBe(201);
    expect(retry.body.sessionId).not.toBe(session.id);
  });
});

describe("BT-460 refunds and cancel requests", () => {
  it("lets only the manufacturer refund; partial refunds return commission proportionally and replay safely", async () => {
    const seller = await seedSeller("b2b-refund");
    const factory = await seedFactory();
    const order = await seedCard(seller, factory.id, 10_000);
    const { paymentIntent } = await payByCard(order);

    expect((await call(app.base, "POST", `/api/sample-orders/${order.id}/refund`, seller, { amountCents: 2_000 })).status).toBe(403);
    expect((await call(app.base, "POST", `/api/sample-orders/${order.id}/refund`, uid("stranger"), { amountCents: 2_000 })).status).toBe(403);

    const partial = await call(app.base, "POST", `/api/sample-orders/${order.id}/refund`, factory.clerkId!, { amountCents: 2_000, reason: "Two pieces short", idempotencyKey: "short-2" });
    expect(partial.status).toBe(200);
    expect(partial.body.refund).toMatchObject({ amountCents: 2_000, state: "succeeded", platformFeeRefundedCents: 100 });
    expect(partial.body.order).toMatchObject({ status: "payment_received", refundedCents: 2_000, platformFeeRefundedCents: 100 });
    expect(fake.state.refunds).toEqual([expect.objectContaining({ charge: `ch_${paymentIntent}`, amount: 2_000, reverse_transfer: true, refund_application_fee: false })]);
    expect(fake.state.feeRefunds).toEqual([expect.objectContaining({ fee: `fee_${paymentIntent}`, amount: 100 })]);

    const replay = await call(app.base, "POST", `/api/sample-orders/${order.id}/refund`, factory.clerkId!, { amountCents: 2_000, idempotencyKey: "short-2" });
    expect(replay.body.replayed).toBe(true);
    expect(fake.state.refunds).toHaveLength(1);

    expect((await call(app.base, "POST", `/api/sample-orders/${order.id}/refund`, factory.clerkId!, { amountCents: 9_000 })).status).toBe(400);

    // Stripe's own refund webhook for this refund changes nothing.
    await deliver("charge.refunded", { id: `ch_${paymentIntent}`, object: "charge", payment_intent: paymentIntent, amount_refunded: 2_000 });
    expect((await reload(order.id)).status).toBe("payment_received");

    const rest = await call(app.base, "POST", `/api/sample-orders/${order.id}/refund`, factory.clerkId!, {});
    expect(rest.status).toBe(200);
    expect(rest.body.order).toMatchObject({ status: "refunded", refundedCents: 10_000, platformFeeRefundedCents: 500 });
    expect(fake.state.feeRefunds.at(-1)).toMatchObject({ amount: 400 });
    await deliver("charge.refunded", { id: `ch_${paymentIntent}`, object: "charge", payment_intent: paymentIntent, amount_refunded: 10_000 });
    expect((await reload(order.id)).status).toBe("refunded");
    // Seller got everything back; Brandthread keeps only the processing it paid Stripe.
    // Stripe keeps its processing on refunds; under pass-through that stays the manufacturer's cost.
    expect(await ledgerFor(order.id)).toMatchObject({ seller_card_payments: 0, platform_revenue: 0, manufacturer_paid: -320, stripe_processing_fees: 320 });
    expect((await call(app.base, "POST", `/api/sample-orders/${order.id}/refund`, factory.clerkId!, { amountCents: 1 })).status).toBe(409);
  });

  it("releases the reservation when Stripe rejects the refund", async () => {
    const seller = await seedSeller("b2b-refund-fail");
    const factory = await seedFactory();
    const order = await seedCard(seller, factory.id, 5_000);
    await payByCard(order);
    fake.state.failNextRefund = "definitive";
    const failed = await call(app.base, "POST", `/api/sample-orders/${order.id}/refund`, factory.clerkId!, { idempotencyKey: "x" });
    expect(failed.status).toBe(502);
    expect(await reload(order.id)).toMatchObject({ refundedCents: 0, platformFeeRefundedCents: 0, status: "payment_received" });
    // The same client key keeps its answer…
    expect((await call(app.base, "POST", `/api/sample-orders/${order.id}/refund`, factory.clerkId!, { idempotencyKey: "x" })).body.code).toBe("REFUND_FAILED");
    // …while a refund without a key (derived key) can simply be tried again.
    fake.state.failNextRefund = "definitive";
    expect((await call(app.base, "POST", `/api/sample-orders/${order.id}/refund`, factory.clerkId!, {})).status).toBe(502);
    const ok = await call(app.base, "POST", `/api/sample-orders/${order.id}/refund`, factory.clerkId!, {});
    expect(ok.status).toBe(200);
    expect(ok.body.order.status).toBe("refunded");
  });

  it("lets an admin refund through the admin API and nobody else", async () => {
    const seller = await seedSeller("b2b-admin-refund");
    const factory = await seedFactory();
    const order = await seedCard(seller, factory.id, 4_000);
    await payByCard(order);
    const admin = uid("b2b-admin");
    await db.insert(users).values({ clerkId: admin, email: `${admin}@money-tests.invalid`, name: "Admin", role: "admin" });
    expect((await call(app.base, "POST", `/api/admin/sample-orders/${order.id}/refund`, seller, {})).status).toBe(403);
    const refunded = await call(app.base, "POST", `/api/admin/sample-orders/${order.id}/refund`, admin, { amountCents: 1_000, reason: "Support goodwill" });
    expect(refunded.status).toBe(200);
    expect(refunded.body.order).toMatchObject({ refundedCents: 1_000 });
    const [row] = await db.select().from(sampleOrderRefunds).where(eq(sampleOrderRefunds.sampleOrderId, order.id));
    expect(row).toMatchObject({ initiatedByRole: "admin", initiatedBy: admin, state: "succeeded" });
  });

  it("seller asks to cancel before production; manufacturer approves and the seller is refunded in full", async () => {
    const seller = await seedSeller("b2b-cancel");
    const factory = await seedFactory();
    const order = await seedCard(seller, factory.id, 6_000);
    await payByCard(order);
    expect((await call(app.base, "POST", `/api/sample-orders/${order.id}/cancel-request/approve`, factory.clerkId!, {})).status).toBe(409);
    const asked = await call(app.base, "POST", `/api/sample-orders/${order.id}/cancel-request`, seller, { reason: "Changed the colorway" });
    expect(asked.status).toBe(201);
    expect(asked.body.cancelRequestState).toBe("requested");
    expect((await call(app.base, "POST", `/api/sample-orders/${order.id}/cancel-request/approve`, seller, {})).status).toBe(403);
    const approved = await call(app.base, "POST", `/api/sample-orders/${order.id}/cancel-request/approve`, factory.clerkId!, {});
    expect(approved.status).toBe(200);
    expect(approved.body.order).toMatchObject({ status: "refunded", cancelRequestState: "approved", refundedCents: 6_000 });
    const again = await call(app.base, "POST", `/api/sample-orders/${order.id}/cancel-request/approve`, factory.clerkId!, {});
    expect(again.body.replayed).toBe(true);
    expect(fake.state.refunds).toHaveLength(1);
  });

  it("refuses a cancel request once production started, and records a decline", async () => {
    const seller = await seedSeller("b2b-cancel-late");
    const factory = await seedFactory();
    const order = await seedCard(seller, factory.id, 6_000);
    await payByCard(order);
    const asked = await call(app.base, "POST", `/api/sample-orders/${order.id}/cancel-request`, seller, {});
    expect(asked.status).toBe(201);
    const declined = await call(app.base, "POST", `/api/sample-orders/${order.id}/cancel-request/decline`, factory.clerkId!, { reason: "Fabric already cut" });
    expect(declined.body.cancelRequestState).toBe("declined");
    expect((await call(app.base, "POST", `/api/sample-orders/${order.id}/cancel-request`, seller, {})).status).toBe(409);
    await db.update(sampleOrders).set({ status: "processing", cancelRequestState: "none" }).where(eq(sampleOrders.id, order.id));
    const late = await call(app.base, "POST", `/api/sample-orders/${order.id}/cancel-request`, seller, {});
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("PRODUCTION_STARTED");
  });

  it("refunds a wallet-paid bulk order back into the drop wallet (manufacturer share reversed, 5% returned)", async () => {
    const seller = await seedSeller("b2b-wallet-refund");
    const drop = await seedDrop(seller);
    const product = await seedProduct(seller, { priceCents: 12_000, dropId: drop.id });
    await pay({ sellerId: seller, buyerId: await seedBuyer("b2b-w"), chargeModel: "held", dropId: drop.id, items: [{ ...product, quantity: 1 }], stripeFeeCents: 378 });
    const heldBefore = await held(seller, { dropId: drop.id });
    const factory = await seedFactory();
    const bulk = await seedBulkOrder(seller, factory.id, 6_000);
    const wallet = await walletFor(drop.id);
    expect((await call(app.base, "POST", `/api/sample-orders/${bulk.id}/pay-from-wallet`, seller, { walletId: wallet.id })).status).toBe(200);
    expect(fake.state.transfers.at(-1)).toMatchObject({ amount: 5_700 });
    expect(await reload(bulk.id)).toMatchObject({ manufacturerNetCents: 5_700, platformFeeCents: 300, paymentMethodType: "drop_wallet" });
    expect(await ledgerFor(bulk.id)).toMatchObject({ seller_held: -6_000, manufacturer_paid: 5_700, platform_revenue: 300 });

    const refunded = await call(app.base, "POST", `/api/sample-orders/${bulk.id}/refund`, factory.clerkId!, {});
    expect(refunded.status).toBe(200);
    expect(fake.state.reversals.at(-1)).toMatchObject({ amount: 5_700 });
    expect(refunded.body.order.status).toBe("refunded");
    expect(await held(seller, { dropId: drop.id })).toBe(heldBefore);
    await expectWalletMatchesLedger(drop.id, seller);
    // transfer.reversed for this refund is a no-op.
    const transferId = (await reload(bulk.id)).stripeTransferId!;
    await deliver("transfer.reversed", { id: transferId, object: "transfer", amount: 5_700, amount_reversed: 5_700, metadata: { sampleOrderId: bulk.id } });
    expect((await reload(bulk.id)).status).toBe("refunded");
    const [after] = await db.select().from(dropWallets).where(eq(dropWallets.id, wallet.id));
    expect(after.releasedCents).toBe(0);
  });

  it("keeps the commission policy switchable", () => {
    const order = { status: "processing", priceCents: 10_000, refundedCents: 0, platformFeeRefundedCents: 0, walletId: null, manufacturerNetCents: 9_380, platformFeeCents: 500 };
    expect(commissionToReturnCents(order, 10_000, "proportional")).toBe(500);
    expect(commissionToReturnCents(order, 10_000, "before_production_only")).toBe(0);
    expect(commissionToReturnCents({ ...order, status: "payment_received" }, 10_000, "before_production_only")).toBe(500);
    expect(commissionToReturnCents(order, 3_000, "never")).toBe(0);
  });
});

describe("BT-459 chargeback clawback", () => {
  it("reverses the manufacturer's transfer when a card dispute is lost, once", async () => {
    const seller = await seedSeller("b2b-cb");
    const factory = await seedFactory();
    const order = await seedCard(seller, factory.id, 20_000, "bulk");
    const { paymentIntent } = await payByCard(order);
    const dispute = { id: `dp_${uid("cb").replace(/-/g, "_")}`, object: "dispute", amount: 20_000, currency: "usd", reason: "product_not_received", status: "needs_response", payment_intent: paymentIntent, charge: `ch_${paymentIntent}` };
    await deliver("charge.dispute.created", dispute);
    expect((await reload(order.id)).status).toBe("payment_review");
    const [row] = await db.select().from(disputes).where(eq(disputes.stripeDisputeId, dispute.id));
    expect(row).toMatchObject({ sampleOrderId: order.id, sellerId: "unknown", amountCents: 20_000 });

    const lost = { ...dispute, status: "lost", balance_transactions: [{ fee: 1_500 }] };
    const closedId = await deliver("charge.dispute.closed", lost);
    const net = 20_000 - 1_000 - 610;
    expect(fake.state.reversals).toEqual([expect.objectContaining({ transfer: `tr_dest_${paymentIntent}`, amount: net })]);
    await deliver("charge.dispute.closed", lost, `${closedId}_again`);
    expect(fake.state.reversals).toHaveLength(1);
    const [closed] = await db.select().from(disputes).where(eq(disputes.stripeDisputeId, dispute.id));
    expect(closed).toMatchObject({ status: "lost", clawbackCents: net });
    expect(await ledgerFor(order.id)).toMatchObject({
      seller_card_payments: 0, manufacturer_paid: 0, b2b_dispute_fees: 1_500,
      platform_revenue: 1_000 - (20_000 + 1_500 - net),
    });
    const admin = uid("b2b-admin-list");
    await db.insert(users).values({ clerkId: admin, email: `${admin}@money-tests.invalid`, name: "Admin", role: "admin" });
    const list = await call(app.base, "GET", "/api/admin/disputes?status=all&limit=100", admin);
    expect(list.body.items.find((d: any) => d.stripeDisputeId === dispute.id)).toMatchObject({ sampleOrderId: order.id, clawbackCents: net });
  });

  it("freezes an unpaid freelancer payout on dispute, unfreezes on win, and claws back a paid-out job on loss", async () => {
    const hirer = await seedSeller("b2b-hirer");
    const freelancerUser = await seedSeller("b2b-freelancer");
    const [freelancer] = await db.insert(freelancers).values({ userId: freelancerUser, serviceType: "graphic_design", stripeAccountId: "acct_freelancer_b2b" }).returning();
    const piHeld = `pi_${uid("job").replace(/-/g, "_")}`;
    const [heldJob] = await db.insert(freelancerJobs).values({
      freelancerId: freelancer.id, sellerId: hirer, title: "Logo", agreedPriceCents: 40_000, status: "in_progress",
      paymentStatus: "paid", stripePaymentIntentId: piHeld, platformFeeCents: 2_000, freelancerPayoutCents: 38_000,
    }).returning();
    const d1 = { id: `dp_${uid("job").replace(/-/g, "_")}`, object: "dispute", amount: 40_000, currency: "usd", reason: "fraudulent", status: "needs_response", payment_intent: piHeld, charge: `ch_${piHeld}` };
    await deliver("charge.dispute.created", d1);
    expect((await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, heldJob.id)))[0].paymentStatus).toBe("disputed");
    await deliver("charge.dispute.closed", { ...d1, status: "won" });
    expect((await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, heldJob.id)))[0].paymentStatus).toBe("paid");

    const piPaid = `pi_${uid("job2").replace(/-/g, "_")}`;
    const [paidJob] = await db.insert(freelancerJobs).values({
      freelancerId: freelancer.id, sellerId: hirer, title: "Lookbook", agreedPriceCents: 30_000, status: "completed",
      paymentStatus: "paid", stripePaymentIntentId: piPaid, stripeTransferId: "tr_job_paid_out", platformFeeCents: 1_500, freelancerPayoutCents: 28_500,
    }).returning();
    const d2 = { id: `dp_${uid("job2").replace(/-/g, "_")}`, object: "dispute", amount: 30_000, currency: "usd", reason: "fraudulent", status: "needs_response", payment_intent: piPaid, charge: `ch_${piPaid}` };
    await deliver("charge.dispute.created", d2);
    await deliver("charge.dispute.closed", { ...d2, status: "lost", balance_transactions: [{ fee: 1_500 }] });
    expect(fake.state.reversals).toEqual([expect.objectContaining({ transfer: "tr_job_paid_out", amount: 28_500 })]);
    expect((await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, paidJob.id)))[0].paymentStatus).toBe("charged_back");
    const [row] = await db.select().from(disputes).where(eq(disputes.stripeDisputeId, d2.id));
    expect(row).toMatchObject({ freelancerJobId: paidJob.id, clawbackCents: 28_500 });

    // A lost dispute on a job never paid out is covered by the held escrow.
    const piEscrow = `pi_${uid("job3").replace(/-/g, "_")}`;
    const [escrowJob] = await db.insert(freelancerJobs).values({
      freelancerId: freelancer.id, sellerId: hirer, title: "Banner", agreedPriceCents: 10_000, status: "accepted",
      paymentStatus: "paid", stripePaymentIntentId: piEscrow, platformFeeCents: 500, freelancerPayoutCents: 9_500,
    }).returning();
    const d3 = { id: `dp_${uid("job3").replace(/-/g, "_")}`, object: "dispute", amount: 10_000, currency: "usd", reason: "fraudulent", status: "lost", payment_intent: piEscrow, charge: `ch_${piEscrow}` };
    await deliver("charge.dispute.created", { ...d3, status: "needs_response" });
    await deliver("charge.dispute.closed", d3);
    expect(fake.state.reversals).toHaveLength(1);
    expect((await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, escrowJob.id)))[0].paymentStatus).toBe("charged_back");
  });

  it("builds balanced chargeback postings", () => {
    const legs = chargebackPostings({ kind: "freelancer_job", payerId: "s", payeeId: "f", disputedCents: 10_000, disputeFeeCents: 1_500, recoveredCents: 0, escrowCoveredCents: 10_000 });
    expect(normalizePostings(legs).reduce((sum, p) => sum + p.amountCents, 0)).toBe(0);
    expect(legs.find((p) => p.account === "platform_revenue")!.amountCents).toBe(-1_500);
  });
});

describe("BT-461 accepted quote → payable order card", () => {
  it("creates one card at the quoted price in a new thread, however often accept is sent", async () => {
    const seller = await seedSeller("b2b-quote");
    const factory = await seedFactory();
    const [quote] = await db.insert(sellerQuoteRequests).values({
      sellerId: seller, manufacturerId: factory.id, type: "quote", productName: "Heavyweight hoodie",
      quantity: 200, status: "quoted", quotedPriceCents: 1_250, quotedTurnaround: "30 days",
    }).returning();
    const accepted = await call(app.base, "PATCH", `/api/seller-hub/quote-requests/${quote.id}`, seller, { status: "accepted" });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("accepted");
    expect(accepted.body.orderCard).toMatchObject({ status: "created", priceCents: 250_000 });
    const again = await call(app.base, "PATCH", `/api/seller-hub/quote-requests/${quote.id}`, seller, { status: "accepted" });
    expect(again.status).toBe(200);
    expect(again.body.orderCard).toMatchObject({ status: "existing", orderId: accepted.body.orderCard.orderId, threadId: accepted.body.orderCard.threadId });

    const cards = await db.select().from(sampleOrders).where(eq(sampleOrders.quoteRequestId, quote.id));
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ orderType: "bulk", quantity: 200, priceCents: 250_000, status: "pending_payment", issuedBy: "manufacturer", sellerId: seller });
    const [thread] = await db.select().from(manufacturerThreads).where(eq(manufacturerThreads.id, accepted.body.orderCard.threadId));
    expect(thread).toMatchObject({ manufacturerId: factory.id, buyerClerkId: seller });
    const messages = await db.select().from(manufacturerMessages).where(eq(manufacturerMessages.threadId, thread.id));
    expect(messages.filter((m) => m.messageType === "bulk_card")).toHaveLength(1);
    // The card is payable like any other (ACH offered: >= $1,000).
    const opened = await call(app.base, "POST", `/api/sample-orders/${cards[0].id}/checkout-session`, seller, { returnUrl: returnUrl(cards[0].id) });
    expect(opened.status).toBe(201);
  });

  it("reuses the existing conversation and leaves the accept intact when a card can't be made", async () => {
    const seller = await seedSeller("b2b-quote-2");
    const factory = await seedFactory();
    const [existingThread] = await db.insert(manufacturerThreads).values({ manufacturerId: factory.id, buyerClerkId: seller, buyerName: "Studio", subject: "Hello" }).returning();
    const [sample] = await db.insert(sellerQuoteRequests).values({
      sellerId: seller, manufacturerId: factory.id, type: "sample", productName: "Tee sample", quantity: 3, status: "quoted", quotedPriceCents: 4_000,
    }).returning();
    const accepted = await call(app.base, "PATCH", `/api/seller-hub/quote-requests/${sample.id}`, seller, { status: "accepted" });
    expect(accepted.body.orderCard).toMatchObject({ status: "created", threadId: existingThread.id, priceCents: 12_000 });
    expect((await db.select().from(sampleOrders).where(eq(sampleOrders.quoteRequestId, sample.id)))[0].orderType).toBe("sample");

    const [huge] = await db.insert(sellerQuoteRequests).values({
      sellerId: seller, manufacturerId: factory.id, type: "quote", productName: "Huge", quantity: 100_000, status: "quoted", quotedPriceCents: 1_000,
    }).returning();
    const tooBig = await call(app.base, "PATCH", `/api/seller-hub/quote-requests/${huge.id}`, seller, { status: "accepted" });
    expect(tooBig.status).toBe(200);
    expect(tooBig.body).toMatchObject({ status: "accepted", orderCard: { status: "skipped", reason: "invalid_card" } });
  });
});
