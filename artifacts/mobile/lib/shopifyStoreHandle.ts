/**
 * The store name a seller types on the Import from Shopify screen, reduced to
 * the `<handle>` of `<handle>.myshopify.com` — they may paste the admin URL,
 * the full myshopify domain, or just the name.
 */
export function shopifyStoreHandle(input: string): string {
  return input.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^admin\.shopify\.com\/store\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.myshopify\.com$/, '');
}

export function isValidShopifyStoreHandle(handle: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(handle);
}
