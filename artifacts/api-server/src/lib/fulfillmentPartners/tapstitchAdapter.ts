/**
 * Placeholder — Tapstitch has no public developer API today (confirmed:
 * it only integrates with store platforms — Shopify, WooCommerce, Etsy, Wix,
 * TikTok Shop). This adapter exists so a direct integration has a home the
 * moment Tapstitch grants API/partner access; until then it always throws.
 * Never registered or called unless FULFILLMENT_PARTNER_ADAPTERS_ENABLED=true
 * AND a real Tapstitch API key is configured — neither is true by default.
 */
import type { FulfillmentPartnerAdapter, FulfillmentOrderRequest, FulfillmentOrderResult } from "./types";

export class TapstitchAdapter implements FulfillmentPartnerAdapter {
  readonly partnerKey = "tapstitch";

  constructor(private apiKey: string) {
    if (!apiKey) {
      throw new Error("TapstitchAdapter requires an API key — none exists yet; see docs/integrations/shopify-tapstitch.md");
    }
  }

  async createOrder(_order: FulfillmentOrderRequest): Promise<FulfillmentOrderResult> {
    throw new Error(
      "Tapstitch has no public API yet. Sellers fulfill through Tapstitch's Shopify app via the Shopify bridge " +
      "(lib/shopify/orderForwarding.ts) — this adapter is a placeholder for if/when Tapstitch grants API access.",
    );
  }
}
