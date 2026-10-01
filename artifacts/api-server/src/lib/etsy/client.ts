/**
 * Etsy Open API v3 client behind an interface so tests use a fake and never
 * hit the network. The HTTP implementation paginates, refreshes nothing by
 * itself (token refresh is the caller's job) and backs off on 429 / 5xx.
 * https://developer.etsy.com/documentation/reference
 */
import { ETSY_API_BASE, type EtsyConfig } from "./config";

export type EtsyMoney = { amount: number; divisor: number; currency_code: string };
export type EtsyImage = { url_fullxfull?: string; url_570xN?: string; rank?: number };
export type EtsyPropertyValue = { property_id?: number; property_name?: string; scale_name?: string | null; values?: string[] };
export type EtsyOffering = { price?: EtsyMoney; quantity?: number; is_enabled?: boolean; is_deleted?: boolean };
export type EtsyInventoryProduct = {
  product_id?: number; sku?: string; is_deleted?: boolean;
  property_values?: EtsyPropertyValue[]; offerings?: EtsyOffering[];
};
export type EtsyListing = {
  listing_id: number;
  title?: string;
  description?: string;
  state?: string;
  price?: EtsyMoney;
  quantity?: number;
  sku?: string[];
  tags?: string[];
  images?: EtsyImage[];
  has_variations?: boolean;
  inventory?: { products?: EtsyInventoryProduct[] };
};

export type EtsyTokens = { accessToken: string; refreshToken: string; expiresInSeconds: number };
export type EtsyListingsPage = { count: number; results: EtsyListing[] };

export interface EtsyApi {
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<EtsyTokens>;
  refresh(refreshToken: string): Promise<EtsyTokens>;
  /** Resolves the authenticated user's (first) shop. */
  getMyShop(accessToken: string): Promise<{ userId: string; shopId: string; shopName: string }>;
  /** One page of ACTIVE listings with images + inventory included. */
  getActiveListings(accessToken: string, shopId: string, page: { limit: number; offset: number }): Promise<EtsyListingsPage>;
}

export class EtsyApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "EtsyApiError"; }
}

type Fetch = typeof fetch;
type Sleep = (ms: number) => Promise<void>;

export class HttpEtsyApi implements EtsyApi {
  constructor(
    private cfg: EtsyConfig,
    private fetchImpl: Fetch = fetch,
    private sleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    private maxAttempts = 5,
  ) {}

  private headers(accessToken?: string): Record<string, string> {
    // Etsy requires the keystring; newer apps also need ":shared_secret" appended.
    return {
      "x-api-key": `${this.cfg.apiKey}:${this.cfg.sharedSecret}`,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    };
  }

  /** fetch with Retry-After aware backoff on 429 and exponential backoff on 5xx. */
  async request(url: string, init: RequestInit): Promise<Response> {
    let delay = 1000;
    for (let attempt = 1; ; attempt++) {
      const res = await this.fetchImpl(url, init);
      if (res.status !== 429 && res.status < 500) return res;
      if (attempt >= this.maxAttempts) return res;
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : delay;
      await this.sleep(wait);
      delay = Math.min(delay * 2, 16_000);
    }
  }

  private async json<T>(res: Response): Promise<T> {
    if (!res.ok) throw new EtsyApiError(res.status, `Etsy responded ${res.status}`);
    return (await res.json()) as T;
  }

  private async tokenRequest(body: URLSearchParams): Promise<EtsyTokens> {
    const res = await this.request(`${ETSY_API_BASE}/public/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...this.headers() },
      body,
    });
    const data = await this.json<{ access_token: string; refresh_token: string; expires_in: number }>(res);
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresInSeconds: data.expires_in };
  }

  exchangeCode({ code, codeVerifier }: { code: string; codeVerifier: string }) {
    return this.tokenRequest(new URLSearchParams({
      grant_type: "authorization_code", client_id: this.cfg.apiKey, redirect_uri: this.cfg.redirectUri,
      code, code_verifier: codeVerifier,
    }));
  }

  refresh(refreshToken: string) {
    return this.tokenRequest(new URLSearchParams({ grant_type: "refresh_token", client_id: this.cfg.apiKey, refresh_token: refreshToken }));
  }

  async getMyShop(accessToken: string) {
    const me = await this.json<{ user_id: number; shop_id?: number | null }>(
      await this.request(`${ETSY_API_BASE}/application/users/me`, { headers: this.headers(accessToken) }));
    if (!me.shop_id) throw new EtsyApiError(404, "This Etsy account has no shop.");
    const shop = await this.json<{ shop_name?: string }>(
      await this.request(`${ETSY_API_BASE}/application/shops/${me.shop_id}`, { headers: this.headers(accessToken) }));
    return { userId: String(me.user_id), shopId: String(me.shop_id), shopName: shop.shop_name ?? "" };
  }

  async getActiveListings(accessToken: string, shopId: string, page: { limit: number; offset: number }) {
    const url = new URL(`${ETSY_API_BASE}/application/shops/${encodeURIComponent(shopId)}/listings`);
    url.searchParams.set("state", "active");
    url.searchParams.set("limit", String(page.limit));
    url.searchParams.set("offset", String(page.offset));
    url.searchParams.set("includes", "Images,Inventory");
    const data = await this.json<{ count: number; results: EtsyListing[] }>(
      await this.request(url.toString(), { headers: this.headers(accessToken) }));
    return { count: data.count ?? 0, results: data.results ?? [] };
  }
}

/** Reads every active listing, page by page, up to `max`. */
export async function fetchAllActiveListings(
  api: EtsyApi, accessToken: string, shopId: string, max = 2000, pageSize = 100,
): Promise<{ listings: EtsyListing[]; total: number; truncated: boolean }> {
  const listings: EtsyListing[] = [];
  let total = 0;
  for (let offset = 0; offset < max; offset += pageSize) {
    const page = await api.getActiveListings(accessToken, shopId, { limit: Math.min(pageSize, max - offset), offset });
    total = page.count;
    listings.push(...page.results);
    if (!page.results.length || listings.length >= page.count) break;
  }
  return { listings: listings.slice(0, max), total, truncated: total > max };
}

// Swappable for tests (routes resolve the client through this).
let override: EtsyApi | null = null;
export function setEtsyApiForTests(api: EtsyApi | null) { override = api; }
export function getEtsyApi(cfg: EtsyConfig): EtsyApi { return override ?? new HttpEtsyApi(cfg); }
