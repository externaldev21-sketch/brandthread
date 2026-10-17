/**
 * Placeholder — Tapstitch has no public developer API today (confirmed:
 * it only integrates with store platforms — Shopify, WooCommerce, Etsy, Wix,
 * TikTok Shop). This adapter exists so a direct integration has a home the
 * moment Tapstitch grants API/partner access. Until then createOrder() fails
 * with a typed, actionable `FulfillmentPartnerUnavailableError` instead of a
 * generic error. Never registered or called unless
 * FULFILLMENT_PARTNER_ADAPTERS_ENABLED=true AND TAPSTITCH_API_KEY is set —
 * neither is true by default. The live Tapstitch path is the Shopify bridge
 * (lib/shopify/orderForwarding.ts); see docs/integrations/shopify-tapstitch.md.
 */
import {
  FulfillmentPartnerUnavailableError,
  type FulfillmentPartnerAdapter,
  type FulfillmentOrderRequest,
  type FulfillmentOrderResult,
} from "./types";

export const TAPSTITCH_API_KEY_ENV = "TAPSTITCH_API_KEY";

export class TapstitchAdapter implements FulfillmentPartnerAdapter {
  readonly partnerKey = "tapstitch";

  constructor(private apiKey: string | undefined) {}

  async createOrder(_order: FulfillmentOrderRequest): Promise<FulfillmentOrderResult> {
    if (!this.apiKey) {
      throw new FulfillmentPartnerUnavailableError(
        this.partnerKey,
        "not_configured",
        `Tapstitch fulfillment isn't configured — set ${TAPSTITCH_API_KEY_ENV} on the API server. ` +
          "Until Tapstitch offers a direct API, connect your Shopify store in Settings → Fulfillment connections " +
          "and Tapstitch's Shopify app will fulfill your Brandthread orders.",
      );
    }
    throw new FulfillmentPartnerUnavailableError(
      this.partnerKey,
      "no_public_api",
      "Tapstitch doesn't offer a direct order API yet, so orders can't be sent to it from Brandthread directly. " +
        "Connect your Shopify store in Settings → Fulfillment connections and Tapstitch's Shopify app will " +
        "fulfill your Brandthread orders.",
    );
  }
}

/**
 * Returns the Tapstitch adapter only when partner adapters are enabled
 * (FULFILLMENT_PARTNER_ADAPTERS_ENABLED=true); otherwise null. The key is read
 * from TAPSTITCH_API_KEY — never hardcoded.
 */
export function createTapstitchAdapterFromEnv(env: NodeJS.ProcessEnv = process.env): TapstitchAdapter | null {
  if (env.FULFILLMENT_PARTNER_ADAPTERS_ENABLED !== "true") return null;
  return new TapstitchAdapter(env[TAPSTITCH_API_KEY_ENV] || undefined);
}
