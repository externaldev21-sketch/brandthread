import { describe, expect, it } from "vitest";
import {
  capApplicationFee, checkoutFeeBasis, loyaltyAppliedCents, loyaltyTopupDue, sellerFundedDiscountCents,
} from "../loyaltyFunding";
import { splitOrder } from "../fees";

describe("loyalty discount math (BT-066)", () => {
  it("attributes Stripe's discount to Thread Cash first, then loyalty, then the seller's code", () => {
    // Combined coupon: 500 Thread Cash + 1,000 loyalty + 700 seller code.
    const loyalty = loyaltyAppliedCents({ stripeDiscountCents: 2_200, threadCashAppliedCents: 500, loyaltyDiscountCents: 1_000 });
    expect(loyalty).toBe(1_000);
    expect(sellerFundedDiscountCents({
      stripeDiscountCents: 2_200, threadCashAppliedCents: 500, loyaltyAppliedCents: loyalty, subtotalCents: 10_000,
    })).toBe(700);
  });

  it("never attributes more loyalty than Stripe actually discounted", () => {
    expect(loyaltyAppliedCents({ stripeDiscountCents: 600, threadCashAppliedCents: 0, loyaltyDiscountCents: 1_000 })).toBe(600);
    expect(loyaltyAppliedCents({ stripeDiscountCents: 300, threadCashAppliedCents: 500, loyaltyDiscountCents: 1_000 })).toBe(0);
  });

  it("caps the seller-funded discount at the subtotal and never goes negative", () => {
    expect(sellerFundedDiscountCents({ stripeDiscountCents: 9_000, threadCashAppliedCents: 0, loyaltyAppliedCents: 0, subtotalCents: 5_000 })).toBe(5_000);
    expect(sellerFundedDiscountCents({ stripeDiscountCents: 100, threadCashAppliedCents: 0, loyaltyAppliedCents: 500, subtotalCents: 5_000 })).toBe(0);
  });

  it("keeps the fee basis on the full price when only loyalty is redeemed", () => {
    expect(checkoutFeeBasis({ subtotalCents: 5_000, totalBeforeDiscountsCents: 5_500, sellerDiscountCents: 0 }))
      .toEqual({ merchandiseCents: 5_000, preTaxTotalCents: 5_500 });
    expect(checkoutFeeBasis({ subtotalCents: 5_000, totalBeforeDiscountsCents: 5_500, sellerDiscountCents: 700 }))
      .toEqual({ merchandiseCents: 4_300, preTaxTotalCents: 4_800 });
  });

  it("seller payout: net of the card charge plus the top-up equals an undiscounted sale", () => {
    // 5,000 item, 1,000 loyalty: buyer pays 4,000 by card; 5% fee on the full 5,000.
    const loyalty = 1_000;
    const discounted = splitOrder({
      subtotalCents: 5_000, discountCents: 0, shippingCents: 0, taxCents: 0, grossCents: 4_000, processingFeeCents: 146,
    });
    const full = splitOrder({
      subtotalCents: 5_000, discountCents: 0, shippingCents: 0, taxCents: 0, grossCents: 5_000, processingFeeCents: 146,
    });
    expect(discounted.platformFeeCents).toBe(250);
    expect(discounted.sellerNetCents + loyalty).toBe(full.sellerNetCents);
  });

  it("caps a destination application fee at what the buyer is charged", () => {
    expect(capApplicationFee({ application_fee_amount: 900 }, 600)).toEqual({ application_fee_amount: 600 });
    expect(capApplicationFee({ application_fee_amount: 300 }, 600)).toEqual({ application_fee_amount: 300 });
    expect(capApplicationFee({ metadata: {} }, 0)).toEqual({ metadata: {} });
  });
});

describe("loyaltyTopupDue", () => {
  const base = { chargeModel: "transfer", fundsState: "held", status: "shipped", loyaltyAppliedCents: 1_000, stripeLoyaltyTransferId: null };
  it("waits for a held/transfer order's own payout, and is immediate for destination charges", () => {
    expect(loyaltyTopupDue(base)).toBe(false);
    expect(loyaltyTopupDue({ ...base, fundsState: "released" })).toBe(true);
    expect(loyaltyTopupDue({ ...base, chargeModel: "held", fundsState: "released" })).toBe(true);
    expect(loyaltyTopupDue({ ...base, chargeModel: "destination", fundsState: "settled_direct" })).toBe(true);
  });
  it("never tops up twice, refunded orders, or orders without loyalty", () => {
    expect(loyaltyTopupDue({ ...base, fundsState: "released", stripeLoyaltyTransferId: "tr_1" })).toBe(false);
    expect(loyaltyTopupDue({ ...base, fundsState: "refunded" })).toBe(false);
    expect(loyaltyTopupDue({ ...base, fundsState: "released", status: "cancelled" })).toBe(false);
    expect(loyaltyTopupDue({ ...base, fundsState: "released", loyaltyAppliedCents: 0 })).toBe(false);
    expect(loyaltyTopupDue({ ...base, chargeModel: null, fundsState: "released" })).toBe(false);
  });
});
