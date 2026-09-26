// Shopify Admin API version pinned explicitly; bump deliberately.
export const SHOPIFY_API_VERSION = "2024-10";

// (A) Product transfer — read-only, never authorizes order writes.
export const SHOPIFY_IMPORT_SCOPES = ["read_products", "read_inventory"] as const;

// (B) Fulfillment via Shopify — superset of the import scopes plus order
// visibility/writes and fulfillment tracking. Re-authorizing with this list
// upgrades an existing connection in place; Shopify only prompts the
// merchant for the newly-added scopes.
export const SHOPIFY_FULFILLMENT_SCOPES = [
  "read_products",
  "read_inventory",
  "read_orders",
  "write_orders",
  "read_fulfillments",
] as const;

export type ShopifyConnectPurpose = "import" | "fulfillment";

export function scopesForPurpose(purpose: ShopifyConnectPurpose): readonly string[] {
  return purpose === "fulfillment" ? SHOPIFY_FULFILLMENT_SCOPES : SHOPIFY_IMPORT_SCOPES;
}

/** True once the connection's granted scopes cover everything (B) needs. */
export function hasFulfillmentScopes(grantedScopes: string): boolean {
  const granted = new Set(grantedScopes.split(",").map((s) => s.trim()).filter(Boolean));
  return SHOPIFY_FULFILLMENT_SCOPES.every((scope) => granted.has(scope));
}

export function normalizeShopDomain(input: string): string {
  const trimmed = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return trimmed.endsWith(".myshopify.com") ? trimmed : `${trimmed}.myshopify.com`;
}

export function isValidShopDomain(domain: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain);
}
