import { describe, expect, it } from "vitest";
import {
  LABEL_REQUIRES_PAID_ORDER, labelEligibility, labelEligibilityFromRow,
} from "../labelEligibility";

describe("labelEligibility (BT-055)", () => {
  it.each(["held", "transfer", "destination"])("allows a Stripe-paid %s order", (chargeModel) => {
    expect(labelEligibility({ stripePaymentIntentId: "pi_123", chargeModel })).toEqual({ ok: true });
  });

  it("refuses a manual order with no PaymentIntent and no charge model", () => {
    const result = labelEligibility({ stripePaymentIntentId: null, chargeModel: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe(LABEL_REQUIRES_PAID_ORDER);
      expect(result.message).toMatch(/only available for orders paid through Brandthread checkout/);
    }
  });

  it("refuses a PaymentIntent with an unknown or missing charge model", () => {
    expect(labelEligibility({ stripePaymentIntentId: "pi_1", chargeModel: null }).ok).toBe(false);
    expect(labelEligibility({ stripePaymentIntentId: "pi_1", chargeModel: "manual" }).ok).toBe(false);
  });

  it("refuses a known charge model without a PaymentIntent (blank counts as missing)", () => {
    expect(labelEligibility({ stripePaymentIntentId: "", chargeModel: "transfer" }).ok).toBe(false);
    expect(labelEligibility({ stripePaymentIntentId: "   ", chargeModel: "held" }).ok).toBe(false);
    expect(labelEligibility({ chargeModel: "destination" }).ok).toBe(false);
  });

  it("reads raw snake_case order rows", () => {
    expect(labelEligibilityFromRow({ stripe_payment_intent_id: "pi_9", charge_model: "held" })).toEqual({ ok: true });
    expect(labelEligibilityFromRow({ stripe_payment_intent_id: null, charge_model: null }).ok).toBe(false);
  });
});
