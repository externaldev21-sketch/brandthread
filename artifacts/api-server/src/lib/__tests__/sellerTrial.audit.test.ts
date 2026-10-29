/**
 * Audit: a reused-card trial whose Stripe cancel fails must be retried on the
 * next subscription event, not silently marked "already_recorded".
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, sellerTrialClaims } from "@workspace/db";

vi.mock("../../routes/notifications-feed", () => ({ publishNotification: async () => undefined }));

const { checkStripeTrial, recordTrialClaim } = await import("../sellerTrial");

const suffix = crypto.randomBytes(5).toString("hex");
const firstSeller = `trial-audit-a-${suffix}`;
const secondSeller = `trial-audit-b-${suffix}`;
const fingerprint = `fp_audit_${suffix}`;

afterAll(async () => {
  await db.delete(sellerTrialClaims).where(inArray(sellerTrialClaims.clerkId, [firstSeller, secondSeller]));
});

describe("checkStripeTrial with a failing cancel", () => {
  it("retries the cancel on the next event instead of reporting already_recorded", async () => {
    await recordTrialClaim({
      clerkId: firstSeller, provider: "stripe", subscriptionRef: `sub_audit_a_${suffix}`, cardFingerprint: fingerprint,
    });

    let failNext = true;
    const cancelled: string[] = [];
    const stripe = {
      paymentMethods: { retrieve: async () => ({ card: { fingerprint } }) },
      subscriptions: {
        cancel: async (id: string) => {
          if (failNext) { failNext = false; throw new Error("Stripe timeout"); }
          cancelled.push(id);
          return { id, status: "canceled" };
        },
      },
    };
    const sub = { id: `sub_audit_b_${suffix}`, status: "trialing", default_payment_method: "pm_x", metadata: {} };

    await expect(checkStripeTrial(stripe, sub, secondSeller)).rejects.toThrow("Stripe timeout");
    // The next event for the same subscription must still cancel it.
    expect(await checkStripeTrial(stripe, sub, secondSeller)).toBe("card_reused");
    expect(cancelled).toEqual([sub.id]);
    // Once cancelled and recorded, a replay is a no-op.
    expect(await checkStripeTrial(stripe, sub, secondSeller)).toBe("already_recorded");
    expect(cancelled).toHaveLength(1);
  });
});
