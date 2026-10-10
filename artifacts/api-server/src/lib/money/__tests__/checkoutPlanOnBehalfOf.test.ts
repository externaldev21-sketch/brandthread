import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => {
  const table = new Proxy({}, { get: (_t, key) => String(key) });
  return { db: {}, drops: table, follows: table, products: table, productLaunches: table };
});

const { onBehalfOfEnabled, paymentIntentMoney } = await import("../checkoutPlan");

const base = {
  sellerStripeAccountId: "acct_seller",
  merchandiseCents: 5_000,
  preTaxTotalCents: 5_500,
};

afterEach(() => {
  delete process.env.STRIPE_ON_BEHALF_OF;
  delete process.env.PAYOUT_MODE;
});

describe("onBehalfOfEnabled (BT-061)", () => {
  it("is off by default and on only for 1/true", () => {
    expect(onBehalfOfEnabled({})).toBe(false);
    expect(onBehalfOfEnabled({ STRIPE_ON_BEHALF_OF: "0" })).toBe(false);
    expect(onBehalfOfEnabled({ STRIPE_ON_BEHALF_OF: "1" })).toBe(true);
    expect(onBehalfOfEnabled({ STRIPE_ON_BEHALF_OF: "TRUE" })).toBe(true);
  });
});

describe("paymentIntentMoney with STRIPE_ON_BEHALF_OF", () => {
  it("destination charges carry no on_behalf_of by default", () => {
    process.env.PAYOUT_MODE = "immediate";
    const money = paymentIntentMoney({ ...base, plan: { chargeModel: "destination", dropId: null } });
    expect(money.chargeModel).toBe("destination");
    expect(money.paymentIntentData).not.toHaveProperty("on_behalf_of");
    expect(money.paymentIntentData).toMatchObject({ transfer_data: { destination: "acct_seller" } });
  });

  it("destination charges settle on the seller's account when the flag is on", () => {
    process.env.PAYOUT_MODE = "immediate";
    process.env.STRIPE_ON_BEHALF_OF = "1";
    const money = paymentIntentMoney({ ...base, plan: { chargeModel: "destination", dropId: null } });
    expect(money.paymentIntentData).toMatchObject({
      on_behalf_of: "acct_seller",
      transfer_data: { destination: "acct_seller" },
      application_fee_amount: money.platformFeeCents + money.processingFeeEstimateCents,
    });
  });

  it("the flag never changes hold-mode (transfer) or preorder (held) charges", () => {
    process.env.STRIPE_ON_BEHALF_OF = "1";
    const transfer = paymentIntentMoney({ ...base, plan: { chargeModel: "destination", dropId: null } });
    expect(transfer.chargeModel).toBe("transfer");
    expect(transfer.paymentIntentData).not.toHaveProperty("on_behalf_of");
    const held = paymentIntentMoney({ ...base, plan: { chargeModel: "held", dropId: "drop_1" } });
    expect(held.paymentIntentData).not.toHaveProperty("on_behalf_of");
  });
});
