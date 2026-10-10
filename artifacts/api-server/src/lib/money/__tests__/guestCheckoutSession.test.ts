import { describe, expect, it } from "vitest";
import {
  buildGuestCheckoutSessionParams, guestCustomerParams, guestDiscountCents, type GuestShipping,
} from "../guestCheckoutSession";

const shipping: GuestShipping = {
  name: "Ada Guest",
  street: "1 Market St",
  line2: "Apt 4",
  city: "San Francisco",
  state: "CA",
  zip: "94105",
  country: "US",
  phone: "+1 415 555 0100",
};

function params(overrides: Partial<Parameters<typeof buildGuestCheckoutSessionParams>[0]> = {}) {
  return buildGuestCheckoutSessionParams({
    lineItems: [{ price_data: { currency: "usd", unit_amount: 2_500, product_data: { name: "Tee" } }, quantity: 1 }],
    sellerStripeAccountId: "acct_seller",
    shipping,
    successUrl: "https://brandthread.test/checkout-return?session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "https://brandthread.test/checkout-return?cancelled=1",
    email: "ada@test.local",
    customerId: "cus_guest",
    checkoutId: "chk_1",
    dropId: null,
    couponId: null,
    paymentIntentData: { metadata: { chargeModel: "transfer" } },
    ...overrides,
  });
}

describe("guest hosted Checkout session (BT-256)", () => {
  it("does not ask for the address again", () => {
    expect(params()).not.toHaveProperty("shipping_address_collection");
  });

  it("puts the validated address on the PaymentIntent", () => {
    expect(params().payment_intent_data?.shipping).toEqual({
      name: "Ada Guest",
      phone: "+1 415 555 0100",
      address: { line1: "1 Market St", line2: "Apt 4", city: "San Francisco", state: "CA", postal_code: "94105", country: "US" },
    });
  });

  it("uses the guest's Customer so tax follows the shipping address", () => {
    const session = params();
    expect(session.customer).toBe("cus_guest");
    expect(session).not.toHaveProperty("customer_email");
    expect(session.automatic_tax).toEqual({ enabled: true, liability: { type: "account", account: "acct_seller" } });
    const customer = guestCustomerParams({ email: "ada@test.local", phone: "+1 415 555 0100", shipping, checkoutId: "chk_1" });
    expect((customer.shipping as { address?: unknown }).address).toMatchObject({ line1: "1 Market St", postal_code: "94105", country: "US" });
    expect(customer.metadata).toEqual({ guest: "true", csRef: "chk_1" });
  });

  it("falls back to customer_email without a Customer", () => {
    const session = params({ customerId: null });
    expect(session.customer_email).toBe("ada@test.local");
    expect(session).not.toHaveProperty("customer");
  });

  it("keeps the charge plan and the checkout reference", () => {
    const session = params({ dropId: "drop_1", paymentIntentData: { transfer_group: "drop_drop_1", metadata: { chargeModel: "held", dropId: "drop_1" } } });
    expect(session.metadata).toEqual({ csRef: "chk_1", guest: "true", dropId: "drop_1" });
    expect(session.payment_intent_data).toMatchObject({ transfer_group: "drop_drop_1", metadata: { chargeModel: "held", dropId: "drop_1" } });
  });
});

describe("guest discount codes (BT-255)", () => {
  it("adds the code's coupon to the session", () => {
    expect(params({ couponId: "coupon_1" }).discounts).toEqual([{ coupon: "coupon_1" }]);
    expect(params()).not.toHaveProperty("discounts");
  });

  it("prices the code the way the signed-in flow does", () => {
    expect(guestDiscountCents({ appliedAmountCents: 500, freeShipping: false, subtotalCents: 2_500, shippingCents: 600 })).toBe(500);
    expect(guestDiscountCents({ appliedAmountCents: 0, freeShipping: true, subtotalCents: 2_500, shippingCents: 600 })).toBe(600);
    expect(guestDiscountCents({ appliedAmountCents: 9_000, freeShipping: true, subtotalCents: 2_500, shippingCents: 600 })).toBe(3_100);
  });
});
