/**
 * Generic fulfillment-partner adapter interface — NOT wired into any route.
 * Prepared so a direct Tapstitch integration can be dropped in without
 * touching the Shopify bridge, if/when Tapstitch grants API/partner access
 * (see docs/integrations/shopify-tapstitch.md for the outreach email draft).
 * Gated by FULFILLMENT_PARTNER_ADAPTERS_ENABLED, default OFF.
 */

export const FULFILLMENT_PARTNER_ADAPTERS_ENABLED =
  process.env.FULFILLMENT_PARTNER_ADAPTERS_ENABLED === "true";

export type FulfillmentOrderLineItem = {
  sku: string;
  quantity: number;
};

export type FulfillmentOrderRequest = {
  brandthreadOrderId: string;
  orderNumber: string;
  lineItems: FulfillmentOrderLineItem[];
  shippingAddress: {
    name?: string;
    street: string;
    line2?: string | null;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  customerEmail?: string | null;
};

export type FulfillmentOrderResult = {
  partnerOrderId: string;
  partnerOrderReference?: string;
};

export type FulfillmentTrackingEvent = {
  brandthreadOrderId: string;
  carrier: string;
  trackingNumber: string;
};

/**
 * Any print-on-demand/dropshipping partner (Tapstitch, Printful, Printify, …)
 * that can create a paid order and report tracking implements this. The
 * Shopify bridge (lib/shopify/orderForwarding.ts + routes/webhooks-shopify.ts)
 * is functionally a `ShopifyAdapter` today, just not yet refactored behind
 * this interface — it's the one live, working path. A `TapstitchAdapter`
 * would only be built once a direct API exists to call.
 */
export interface FulfillmentPartnerAdapter {
  readonly partnerKey: string;
  createOrder(order: FulfillmentOrderRequest): Promise<FulfillmentOrderResult>;
  /** Optional: some partners push tracking via their own webhook instead. */
  pollTracking?(partnerOrderId: string): Promise<FulfillmentTrackingEvent | null>;
}
