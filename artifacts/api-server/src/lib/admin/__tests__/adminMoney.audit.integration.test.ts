/**
 * Audit regressions for lib/admin against a real database:
 *  - releasing a hold placed during the new-account payout window, after the
 *    window ended, must not leave the 7-day delay on for good;
 *  - an order with several disputes counts once in the seller risk rates;
 *  - ad campaign revenue is net of the pro-rata refunds already paid back.
 */
import crypto from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { adCampaigns, db, disputes, orders, payoutControls, users } from "@workspace/db";
import {
  NEW_ACCOUNT_PAYOUT_DELAY_DAYS, applyNewAccountPayoutDelay, holdPayouts, releasePayouts,
} from "../payoutControls";
import { sellerRefundChargebackRates } from "../launchMetrics";
import { computeRevenueBreakdown } from "../revenue";

const sfx = crypto.randomBytes(5).toString("hex");
const SELLER = `audit-admin-seller-${sfx}`;
const RISK_SELLER = `audit-admin-risk-${sfx}`;
const AD_SELLER = `audit-admin-ads-${sfx}`;
const ACCT = `acct_audit_${sfx}`;
const DAY = 86_400_000;
const actor = { clerkId: `audit-admin-${sfx}`, email: null };
const orderIds: string[] = [];

afterAll(async () => {
  if (orderIds.length) {
    await db.delete(disputes).where(inArray(disputes.orderId, orderIds));
    await db.delete(orders).where(inArray(orders.id, orderIds));
  }
  await db.delete(adCampaigns).where(eq(adCampaigns.sellerId, AD_SELLER));
  await db.delete(payoutControls).where(eq(payoutControls.partyId, SELLER));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, RISK_SELLER, AD_SELLER]));
});

describe("payout hold released after the new-account window", () => {
  it("drops the delay to Stripe's minimum instead of restoring the new-account 7 days", async () => {
    await db.insert(users).values({ clerkId: SELLER, email: `${SELLER}@example.test`, name: "Seller", accountType: "seller", stripeAccountId: ACCT });
    const schedule: Record<string, unknown> = { interval: "daily", delay_days: 2 };
    const updates: Array<Record<string, unknown>> = [];
    const client = {
      accounts: {
        retrieve: async () => ({ id: ACCT, settings: { payouts: { schedule: { ...schedule } } } }),
        update: async (_id: string, params: any) => {
          const next = params.settings.payouts.schedule;
          updates.push(next);
          Object.assign(schedule, next);
          return {};
        },
      },
      balance: { retrieve: async () => ({ available: [], pending: [] }) },
    } as any;

    const created = new Date(Date.now() - 40 * DAY);
    await applyNewAccountPayoutDelay({ partyType: "seller", partyId: SELLER, stripeAccountId: ACCT, client, now: created });
    expect(schedule.delay_days).toBe(NEW_ACCOUNT_PAYOUT_DELAY_DAYS);

    // Held on day 5, inside the 30-day review window.
    await holdPayouts({ partyType: "seller", partyId: SELLER, reason: "Suspicious", actor, client });
    expect(schedule.interval).toBe("manual");

    // Released on day 40: the window is over, so no new-account delay may come back.
    const released = await releasePayouts({ partyType: "seller", partyId: SELLER, reason: "", actor, client });
    expect(released.state).toBe("released");
    expect(updates[updates.length - 1]).toMatchObject({ interval: "daily", delay_days: "minimum" });
  });
});

describe("seller refund / chargeback rates", () => {
  it("counts an order with an inquiry and a chargeback once", async () => {
    await db.insert(users).values({ clerkId: RISK_SELLER, email: `${RISK_SELLER}@example.test`, name: "Risk", accountType: "seller" });
    const paidAt = new Date("2002-06-10T12:00:00Z");
    const rows = await db.insert(orders).values([0, 1, 2].map((n) => ({
      ownerId: RISK_SELLER, orderNumber: `AUD-${sfx}-${n}`, status: "shipped", totalCents: 5_000, subtotalCents: 5_000,
      paidAt, refundedCents: n === 0 ? 5_000 : 0,
    }))).returning({ id: orders.id });
    orderIds.push(...rows.map((r) => r.id));
    await db.insert(disputes).values([
      { stripeDisputeId: `du_inq_${sfx}`, orderId: rows[0]!.id, sellerId: RISK_SELLER, status: "warning_closed" },
      { stripeDisputeId: `du_cb_${sfx}`, orderId: rows[0]!.id, sellerId: RISK_SELLER },
    ]);

    const rates = await sellerRefundChargebackRates({ from: new Date("2002-06-01T00:00:00Z"), to: new Date("2002-07-01T00:00:00Z") });
    const mine = rates.find((r) => r.clerkId === RISK_SELLER);
    expect(mine).toMatchObject({ orders: 3, refundedOrders: 1, chargebacks: 2 });
    expect(mine!.refundRate).toBeCloseTo(1 / 3);
  });
});

describe("revenue breakdown", () => {
  it("counts an ad campaign net of the undelivered budget refunded to the seller", async () => {
    await db.insert(adCampaigns).values({
      sellerId: AD_SELLER, status: "completed", budgetCents: 10_000, paidAmountCents: 10_000, spentCents: 2_000,
      refundedCents: 8_000, refundStatus: "succeeded", paymentRail: "stripe", paidAt: new Date("2099-12-31T12:00:00Z"),
    });
    const r = await computeRevenueBreakdown(1, new Date("2100-01-01T00:00:00Z"));
    expect(r.lines.find((l) => l.id === "promotions")).toMatchObject({ cents: 2_000, count: 1 });
  });
});
