/**
 * Minimal Shopify Admin REST API client. Deliberately thin (fetch + a base
 * URL) so tests can mock `fetch` directly rather than a bespoke SDK surface.
 */
import { SHOPIFY_API_VERSION } from "./constants";
import type { ShopifyProduct } from "../shopifyImport";

export type { ShopifyProduct };

export class ShopifyApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

export class ShopifyAdminClient {
  constructor(private shopDomain: string, private accessToken: string) {}

  private baseUrl(path: string): string {
    return `https://${this.shopDomain}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.baseUrl(path), {
      ...init,
      headers: {
        "X-Shopify-Access-Token": this.accessToken,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ShopifyApiError(res.status, `Shopify Admin API ${path} failed: ${res.status} ${body}`);
    }
    return (await res.json()) as T;
  }

  async getShop(): Promise<{ shop: { myshopify_domain: string; name: string } }> {
    return this.request("/shop.json");
  }

  /** Cursor-paginated; caller loops on `nextPageInfo` until it is null. */
  async listProducts(pageInfo?: string): Promise<{ products: ShopifyProduct[]; nextPageInfo: string | null }> {
    const path = pageInfo
      ? `/products.json?limit=50&page_info=${encodeURIComponent(pageInfo)}`
      : "/products.json?limit=50";
    const res = await fetch(this.baseUrl(path), {
      headers: { "X-Shopify-Access-Token": this.accessToken },
    });
    if (!res.ok) {
      throw new ShopifyApiError(res.status, `Shopify Admin API ${path} failed: ${res.status}`);
    }
    const data = (await res.json()) as { products: ShopifyProduct[] };
    const link = res.headers.get("link") ?? "";
    const nextMatch = link.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    return { products: data.products, nextPageInfo: nextMatch ? decodeURIComponent(nextMatch[1]) : null };
  }

  async getProduct(shopifyProductId: string): Promise<{ product: ShopifyProduct }> {
    return this.request(`/products/${shopifyProductId}.json`);
  }

  /**
   * Creates a paid order in the seller's Shopify store so a fulfillment app
   * (Tapstitch, Printful, Printify, …) picks it up. `financial_status: "paid"`
   * plus a note/tag makes it unambiguous this is a Brandthread order, not a
   * duplicate storefront sale.
   */
  async createOrder(payload: Record<string, unknown>): Promise<{ order: { id: number; name: string } }> {
    return this.request("/orders.json", {
      method: "POST",
      body: JSON.stringify({ order: payload }),
    });
  }

  async createWebhook(topic: string, address: string): Promise<{ webhook: { id: number } }> {
    return this.request("/webhooks.json", {
      method: "POST",
      body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
    });
  }
}
