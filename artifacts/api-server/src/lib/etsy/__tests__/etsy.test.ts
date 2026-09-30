import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import {
  buildEtsyAuthorizeUrl, codeChallengeFor, decryptEtsySecret, encryptEtsySecret, etsyConfig, newCodeVerifier,
} from "../config";
import { EtsyApiError, HttpEtsyApi, fetchAllActiveListings, type EtsyApi, type EtsyListing } from "../client";
import { mapEtsyListings } from "../mapper";

const cfg = { apiKey: "KEY", sharedSecret: "SECRET", redirectUri: "https://api.example.com/api/product-import/etsy/callback" };

describe("etsyConfig", () => {
  const key = crypto.randomBytes(32).toString("base64");
  it("is null unless every value is present", () => {
    expect(etsyConfig({})).toBeNull();
    expect(etsyConfig({ ETSY_API_KEY: "k", ETSY_SHARED_SECRET: "s", ETSY_REDIRECT_URI: "https://x" } as any)).toBeNull();
    expect(etsyConfig({ ETSY_API_KEY: "k", ETSY_SHARED_SECRET: "s", ETSY_REDIRECT_URI: "https://x", ETSY_TOKEN_ENCRYPTION_KEY: key } as any)).toEqual({ apiKey: "k", sharedSecret: "s", redirectUri: "https://x" });
  });
  it("falls back to the Shopify token key and rejects wrong-length keys", () => {
    const base = { ETSY_API_KEY: "k", ETSY_SHARED_SECRET: "s", ETSY_REDIRECT_URI: "https://x" };
    expect(etsyConfig({ ...base, SHOPIFY_TOKEN_ENCRYPTION_KEY: key } as any)).not.toBeNull();
    expect(etsyConfig({ ...base, ETSY_TOKEN_ENCRYPTION_KEY: "c2hvcnQ=" } as any)).toBeNull();
  });
});

describe("PKCE + token encryption", () => {
  it("builds an S256 authorize URL with the read scopes", () => {
    const verifier = newCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const url = new URL(buildEtsyAuthorizeUrl(cfg, "state123", verifier));
    expect(url.origin + url.pathname).toBe("https://www.etsy.com/oauth/connect");
    expect(url.searchParams.get("scope")).toBe("listings_r shops_r");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(codeChallengeFor(verifier));
    expect(url.searchParams.get("client_id")).toBe("KEY");
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    // RFC 7636 appendix B vector
    expect(codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("round-trips tokens and never stores plaintext", () => {
    process.env.ETSY_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    try {
      const enc = encryptEtsySecret("12345.token-value");
      expect(enc).not.toContain("token-value");
      expect(decryptEtsySecret(enc)).toBe("12345.token-value");
    } finally { delete process.env.ETSY_TOKEN_ENCRYPTION_KEY; }
  });
});

function res(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("HttpEtsyApi", () => {
  it("backs off on 429 honouring Retry-After, then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(res(429, {}, { "retry-after": "2" }))
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200, { count: 1, results: [{ listing_id: 1 }] }));
    const sleeps: number[] = [];
    const api = new HttpEtsyApi(cfg, fetchImpl as any, async (ms) => { sleeps.push(ms); });
    const page = await api.getActiveListings("tok", "99", { limit: 100, offset: 0 });
    expect(page.results).toHaveLength(1);
    expect(sleeps).toEqual([2000, 2000]);
    const [url, init] = fetchImpl.mock.calls[2];
    expect(String(url)).toContain("/shops/99/listings?state=active&limit=100&offset=0&includes=Images%2CInventory");
    expect((init as any).headers).toMatchObject({ authorization: "Bearer tok", "x-api-key": "KEY:SECRET" });
  });

  it("gives up after max attempts and surfaces the status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(429));
    const api = new HttpEtsyApi(cfg, fetchImpl as any, async () => undefined, 3);
    await expect(api.getActiveListings("t", "1", { limit: 10, offset: 0 })).rejects.toMatchObject({ status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("exchanges a code with the PKCE verifier and no client secret", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { access_token: "1.a", refresh_token: "r", expires_in: 3600 }));
    const tokens = await new HttpEtsyApi(cfg, fetchImpl as any).exchangeCode({ code: "c", codeVerifier: "v" });
    expect(tokens).toEqual({ accessToken: "1.a", refreshToken: "r", expiresInSeconds: 3600 });
    const body = String((fetchImpl.mock.calls[0][1] as any).body);
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code_verifier=v");
    expect(body).not.toContain("SECRET");
  });

  it("paginates through all listings via fetchAllActiveListings", async () => {
    const all: EtsyListing[] = Array.from({ length: 250 }, (_, i) => ({ listing_id: i + 1, title: `L${i}` }));
    const api: EtsyApi = {
      exchangeCode: vi.fn(), refresh: vi.fn(), getMyShop: vi.fn(),
      getActiveListings: async (_t, _s, { limit, offset }) => ({ count: all.length, results: all.slice(offset, offset + limit) }),
    };
    const out = await fetchAllActiveListings(api, "t", "s", 2000, 100);
    expect(out.listings).toHaveLength(250);
    expect(out.truncated).toBe(false);
    const capped = await fetchAllActiveListings(api, "t", "s", 120, 100);
    expect(capped.listings).toHaveLength(120);
    expect(capped.truncated).toBe(true);
  });

  it("throws EtsyApiError for non-retryable failures", async () => {
    const api = new HttpEtsyApi(cfg, vi.fn().mockResolvedValue(res(401)) as any, async () => undefined);
    await expect(api.getMyShop("t")).rejects.toBeInstanceOf(EtsyApiError);
  });
});

describe("mapEtsyListings", () => {
  const money = (amount: number, currency = "USD") => ({ amount, divisor: 100, currency_code: currency });
  it("maps a simple listing", () => {
    const { products, issues } = mapEtsyListings([{
      listing_id: 7, title: "Linen Scarf", description: "Soft", price: money(3400), quantity: 9, sku: ["SC-1"], tags: ["linen", "Linen", "scarf"],
      images: [{ url_fullxfull: "https://i.etsystatic.com/2.jpg", rank: 2 }, { url_fullxfull: "https://i.etsystatic.com/1.jpg", rank: 1 }],
    }]);
    expect(issues).toEqual([]);
    expect(products[0]).toMatchObject({ externalKey: "listing:7", name: "Linen Scarf", tags: ["linen", "scarf"] });
    expect(products[0].images).toEqual(["https://i.etsystatic.com/1.jpg", "https://i.etsystatic.com/2.jpg"]);
    expect(products[0].variants).toEqual([expect.objectContaining({ sku: "SC-1", priceCents: 3400, stock: 9 })]);
  });

  it("maps inventory products with per-offering price/quantity and property values, skipping deleted/disabled", () => {
    const { products } = mapEtsyListings([{
      listing_id: 8, title: "Tote", price: money(2000), quantity: 99,
      inventory: {
        products: [
          { sku: "T-S-N", property_values: [{ property_name: "Size", values: ["Small"] }, { property_name: "Primary color", values: ["Natural"] }], offerings: [{ price: money(2500), quantity: 3, is_enabled: true }] },
          { sku: "T-L-N", property_values: [{ property_name: "Size", values: ["Large"] }, { property_name: "Primary color", values: ["Natural"] }], offerings: [{ price: money(3000), quantity: 0, is_enabled: true }] },
          { sku: "T-X", is_deleted: true, offerings: [{ price: money(1), quantity: 1 }] },
          { sku: "T-OFF", property_values: [{ property_name: "Size", values: ["XL"] }], offerings: [{ price: money(1), quantity: 1, is_enabled: false }] },
        ],
      },
    }]);
    expect(products[0].variants.map((v) => [v.sku, v.size, v.color, v.priceCents, v.stock])).toEqual([
      ["T-S-N", "Small", "Natural", 2500, 3], ["T-L-N", "Large", "Natural", 3000, 0],
    ]);
  });

  it("flags untitled or unpriced listings and non-USD currency", () => {
    const { products, issues } = mapEtsyListings([
      { listing_id: 1, title: "" },
      { listing_id: 2, title: "No price" },
      { listing_id: 3, title: "Euro", price: money(1000, "EUR"), quantity: 1 },
    ]);
    expect(products.map((p) => p.name)).toEqual(["Euro"]);
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(2);
    expect(issues.some((i) => /EUR/.test(i.message))).toBe(true);
  });
});
