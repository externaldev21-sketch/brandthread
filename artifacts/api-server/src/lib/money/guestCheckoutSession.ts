/**
 * Guest hosted Checkout (routes/guest-checkout.ts): the pure parts, so they
 * can be unit tested without Stripe or a database.
 *
 * BT-256: the app has already collected and the server has validated the
 * guest's shipping address, so the Stripe page must not ask for it again.
 *  - no shipping_address_collection;
 *  - the address goes on a Stripe Customer made for this checkout
 *    (guestCustomerParams). Checkout's automatic tax uses a Customer's
 *    shipping address, so tax stays on the real destination, as it was when
 *    Stripe collected the address itself;
 *  - and on the PaymentIntent (payment_intent_data.shipping), so the charge,
 *    the receipt and Radar see where the order ships.
 * The order webhook already falls back to the stored address
 * (checkout_sessions.shipping_address) when the session has no
 * shipping_details, so orders keep their address.
 *
 * BT-255: a guest's discount code becomes a one-time Stripe coupon, exactly
 * like the signed-in hosted flow (routes/buyer.ts).
 */
import type Stripe from "stripe";

export type GuestShipping = {
  name: string;
  street: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
};

function stripeAddress(shipping: GuestShipping): Stripe.AddressParam & { line1: string } {
  return {
    line1: shipping.street,
    ...(shipping.line2 ? { line2: shipping.line2 } : {}),
    city: shipping.city,
    state: shipping.state,
    postal_code: shipping.zip,
    country: shipping.country,
  };
}

/** The Customer that carries the guest's address into Checkout (tax + prefill). */
export function guestCustomerParams(input: {
  email: string;
  phone: string;
  shipping: GuestShipping;
  checkoutId: string;
}): Stripe.CustomerCreateParams {
  return {
    email: input.email,
    name: input.shipping.name,
    phone: input.phone,
    shipping: {
      name: input.shipping.name,
      phone: input.shipping.phone,
      address: stripeAddress(input.shipping),
    },
    metadata: { guest: "true", csRef: input.checkoutId },
  };
}

export function buildGuestCheckoutSessionParams(input: {
  lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
  sellerStripeAccountId: string;
  shipping: GuestShipping;
  successUrl: string;
  cancelUrl: string;
  email: string;
  /** The guest's Stripe Customer (guestCustomerParams); null falls back to customer_email. */
  customerId: string | null;
  checkoutId: string;
  dropId: string | null;
  /** One-time coupon for the guest's discount code, if any. */
  couponId: string | null;
  /** paymentIntentMoney(...).paymentIntentData */
  paymentIntentData: Record<string, unknown>;
}): Stripe.Checkout.SessionCreateParams {
  const metadata = (input.paymentIntentData.metadata ?? {}) as Record<string, string>;
  return {
    mode: "payment",
    line_items: input.lineItems,
    automatic_tax: {
      enabled: true,
      liability: { type: "account", account: input.sellerStripeAccountId },
    },
    ...(input.customerId ? { customer: input.customerId } : { customer_email: input.email }),
    ...(input.couponId ? { discounts: [{ coupon: input.couponId }] } : {}),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: { csRef: input.checkoutId, guest: "true", ...(input.dropId ? { dropId: input.dropId } : {}) },
    payment_intent_data: {
      ...(input.paymentIntentData as Stripe.Checkout.SessionCreateParams.PaymentIntentData),
      shipping: {
        name: input.shipping.name,
        phone: input.shipping.phone,
        address: stripeAddress(input.shipping),
      },
      metadata: { ...metadata, ...(input.dropId ? { dropId: input.dropId } : {}) },
    },
  };
}

/**
 * Discount-code money for one guest checkout, same rule as the signed-in
 * hosted flow: the code's amount, plus the shipping when it is a free
 * shipping code, never more than subtotal + shipping.
 */
export function guestDiscountCents(input: {
  appliedAmountCents: number;
  freeShipping: boolean;
  subtotalCents: number;
  shippingCents: number;
}): number {
  const shippingPart = input.freeShipping ? input.shippingCents : 0;
  return Math.max(0, Math.min(input.appliedAmountCents + shippingPart, input.subtotalCents + input.shippingCents));
}
