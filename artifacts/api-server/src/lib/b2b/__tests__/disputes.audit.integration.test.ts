/**
 * Audit B04: a B2B dispute row is stored with the mapped status
 * (warning_closed / charge_refunded → "closed"), so a late, out-of-order
 * open-status event must not reopen it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("../../money/__tests__/fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});

import { db, disputes, freelancerJobs, freelancers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fake } from "../../money/__tests__/fakeStripe";
import { seedSeller, uid } from "../../money/__tests__/moneyHarness";
import { processB2bDisputeEvent } from "../disputes";

beforeEach(() => fake.reset());

const notify = async () => undefined;

describe("processB2bDisputeEvent status finality", () => {
  it("a late warning_under_review update never reopens an inquiry that already closed", async () => {
    const hirer = await seedSeller("b2b-audit-hirer");
    const freelancerUser = await seedSeller("b2b-audit-fl");
    const [freelancer] = await db.insert(freelancers)
      .values({ userId: freelancerUser, serviceType: "graphic_design", stripeAccountId: "acct_audit_fl" }).returning();
    const pi = `pi_${uid("audit").replace(/-/g, "_")}`;
    await db.insert(freelancerJobs).values({
      freelancerId: freelancer.id, sellerId: hirer, title: "Logo", agreedPriceCents: 10_000, status: "in_progress",
      paymentStatus: "paid", stripePaymentIntentId: pi, platformFeeCents: 500, freelancerPayoutCents: 9_500,
    });
    const base = {
      id: `dp_${uid("audit").replace(/-/g, "_")}`, object: "dispute", amount: 10_000, currency: "usd",
      reason: "general", payment_intent: pi, charge: `ch_${pi}`,
    };
    const event = (id: string, type: string, status: string, created: number) =>
      ({ id, type, created, data: { object: { ...base, status } } });

    expect(await processB2bDisputeEvent(event(`evt_${uid("a")}`, "charge.dispute.created", "warning_needs_response", 1000), notify))
      .toBe("freelancer_job");
    await processB2bDisputeEvent(event(`evt_${uid("b")}`, "charge.dispute.closed", "warning_closed", 3000), notify);
    let [row] = await db.select().from(disputes).where(eq(disputes.stripeDisputeId, base.id));
    expect(row.status).toBe("closed");

    // Stripe delivered the earlier "updated" event late.
    await processB2bDisputeEvent(event(`evt_${uid("c")}`, "charge.dispute.updated", "warning_under_review", 2000), notify);
    [row] = await db.select().from(disputes).where(eq(disputes.stripeDisputeId, base.id));
    expect(row.status).toBe("closed");
  });
});
