import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { renderProductSeoPage, productJsonLd } = require("./seo/productPage.js");
const { renderNewThisWeekHtml, renderNewThisWeekPage, parsePage, _cache: newCache } = require("./seo/newThisWeek.js");
const crawl = require("./seo/crawl.js");
const { appBannerMeta, withAppBanner } = require("./seo/appBanner.js");
const { jsonLdScript, formatUsd } = require("./seo/shared.js");
const { renderSharePreview } = require("./sharePreview.js");

const SHELL = `<!doctype html><html><head><title>Brandthread</title><link rel="canonical" href="https://brandthread.app/" /><meta name="description" content="generic" /><meta name="robots" content="index,follow" /><meta property="og:title" content="generic" /><meta name="twitter:card" content="summary" /><script type="application/ld+json">{"@type":"WebSite"}</script></head><body><div id="root"></div></body></html>`;
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function mockFetch(handler: (url: string) => { status?: number; body?: unknown } | Error) {
  const fn = vi.fn(async (url: string) => {
    const out = handler(String(url));
    if (out instanceof Error) throw out;
    const status = out.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => out.body };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const PRODUCT = {
  id: ID,
  name: 'Aurora "Hoodie" </script><script>alert(1)</script>',
  title: "Aurora Hoodie – Nova Goods",
  description: "Soft heavyweight hoodie.",
  longDescription: "Soft heavyweight hoodie.",
  images: ["https://cdn.test/a.jpg", "https://cdn.test/b.jpg"],
  socialImageUrl: null,
  brand: "Nova Goods",
  storeSlug: "novagoods",
  category: "apparel",
  sku: ID,
  noIndex: false,
  currency: "USD",
  price: { lowCents: 4500, highCents: 4500, compareAtCents: null, offerCount: 1 },
  availability: "InStock",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  newCache.clear();
  crawl._caches.cache.clear();
  crawl._caches.wellKnownCache.clear();
});

describe("product SEO page", () => {
  it("injects schema.org Product JSON-LD, OG product tags and a noscript body", async () => {
    const fetchMock = mockFetch(() => ({ body: PRODUCT }));
    const result = await renderProductSeoPage(`/store/product/${ID}`, SHELL);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/public/seo/products/${ID}`);
    expect(result.status).toBe(200);
    const html: string = result.html;
    // generic shell head removed exactly once
    expect(html).not.toContain('content="generic"');
    expect(html).not.toContain('"@type":"WebSite"');
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).toContain(`<link rel="canonical" href="https://brandthread.app/store/product/${ID}" />`);
    expect(html).toContain('<meta property="og:type" content="product" />');
    expect(html).toContain('<meta property="product:price:amount" content="45.00" />');
    expect(html).toContain('<meta property="product:price:currency" content="USD" />');
    expect(html).toContain('<meta name="robots" content="index,follow" />');
    expect(html).toContain('og:image" content="https://cdn.test/a.jpg"');

    const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(ldMatch).not.toBeNull();
    const ld = JSON.parse(ldMatch![1]);
    expect(ld).toMatchObject({
      "@type": "Product",
      name: PRODUCT.name,
      sku: ID,
      image: PRODUCT.images,
      brand: { "@type": "Brand", name: "Nova Goods" },
      offers: {
        "@type": "Offer",
        price: "45.00",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: `https://brandthread.app/store/product/${ID}`,
        seller: { "@type": "Organization", name: "Nova Goods", url: "https://brandthread.app/store/novagoods" },
      },
    });
    // the hostile name never closes the JSON-LD script
    expect(ldMatch![1]).not.toContain("</script");
    expect(html.match(/<script>alert/g)).toBeNull();

    expect(html).toMatch(/<body><noscript><main[^>]*>/);
    expect(html).toContain("&lt;/script&gt;");
    expect(html).toContain("<p");
    expect(html).toContain("$45");
    expect(html).toContain('<div id="root"></div>');
  });

  it("uses AggregateOffer for a price range and maps sold-out / pre-order availability", () => {
    const range = productJsonLd({ ...PRODUCT, price: { lowCents: 4500, highCents: 5200, compareAtCents: null, offerCount: 3 }, availability: "OutOfStock" }, "https://x/p");
    expect(range.offers).toMatchObject({ "@type": "AggregateOffer", lowPrice: "45.00", highPrice: "52.00", offerCount: 3, availability: "https://schema.org/OutOfStock" });
    const pre = productJsonLd({ ...PRODUCT, availability: "PreOrder" }, "https://x/p");
    expect(pre.offers.availability).toBe("https://schema.org/PreOrder");
    const noPrice = productJsonLd({ ...PRODUCT, price: null, brand: null }, "https://x/p");
    expect(noPrice.offers).toBeUndefined();
    expect(noPrice.brand).toBeUndefined();
  });

  it("honours the seller's SEO overrides: social image and noindex", async () => {
    mockFetch(() => ({ body: { ...PRODUCT, noIndex: true, socialImageUrl: "https://cdn.test/social.jpg" } }));
    const { html } = await renderProductSeoPage(`/store/product/${ID}`, SHELL);
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).toContain('og:image" content="https://cdn.test/social.jpg"');
  });

  it("404s with noindex for a non-public product and returns null when the API is unreachable", async () => {
    mockFetch(() => ({ status: 404, body: { code: "NOT_FOUND", notPublic: true } }));
    const gone = await renderProductSeoPage(`/store/product/${ID}`, SHELL);
    expect(gone.status).toBe(404);
    expect(gone.html).toContain('name="robots" content="noindex"');
    // A route-not-found from an API without this endpoint is not a verdict.
    mockFetch(() => ({ status: 404, body: { code: "NOT_FOUND" } }));
    expect(await renderProductSeoPage(`/store/product/${ID}`, SHELL)).toBeNull();
    mockFetch(() => new Error("down"));
    expect(await renderProductSeoPage(`/store/product/${ID}`, SHELL)).toBeNull();
    expect(await renderProductSeoPage("/store/product/not-a-uuid", SHELL)).toBeNull();
    expect(await renderProductSeoPage("/store/novagoods", SHELL)).toBeNull();
  });
});

describe("JSON-LD and money helpers", () => {
  it("escapes every character that could break out of the script element", () => {
    const tag = jsonLdScript({ a: "</script><!-- &  " });
    expect(tag).not.toMatch(/<\/script>.*<\/script>/);
    expect(tag.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "")).not.toContain("<");
    expect(JSON.parse(tag.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""))).toEqual({ a: "</script><!-- &  " });
  });

  it("formats integer cents without floats", () => {
    expect(formatUsd(4500)).toBe("$45");
    expect(formatUsd(4550)).toBe("$45.50");
    expect(formatUsd(123456705)).toBe("$1,234,567.05");
    expect(formatUsd(null)).toBeNull();
  });
});

describe("/new — New this week", () => {
  const DATA = {
    windowStart: "2026-10-06T12:00:00.000Z",
    windowEnd: "2026-10-13T12:00:00.000Z",
    total: 2,
    offset: 0,
    nextOffset: null,
    items: [
      { id: ID, name: "Aurora <Hoodie>", brand: "Nova Goods", imageUrl: "https://cdn.test/a.jpg", priceCents: 4500, compareAtPriceCents: 6000, hasPriceRange: false, currency: "USD", soldOut: false, publishedAt: "2026-10-12T00:00:00.000Z", path: `/store/product/${ID}` },
      { id: "11111111-2222-4333-8444-555555555555", name: "Cargo", brand: null, imageUrl: "/objects/private.jpg", priceCents: 9000, compareAtPriceCents: null, hasPriceRange: true, currency: "USD", soldOut: true, publishedAt: "2026-10-11T00:00:00.000Z", path: "/store/product/x" },
    ],
  };

  it("renders a grid of product cards linking to product pages with ItemList JSON-LD", () => {
    const html: string = renderNewThisWeekHtml(DATA, 1);
    expect(html).toContain("<title>New this week | Brandthread</title>");
    expect(html).toContain('<link rel="canonical" href="https://brandthread.app/new" />');
    expect(html).toContain('<meta name="robots" content="index,follow" />');
    expect(html).toContain('og:image" content="https://cdn.test/a.jpg"');
    expect(html).toContain(`href="/store/product/${ID}"`);
    expect(html).toContain("Aurora &lt;Hoodie&gt;");
    expect(html).toContain('<p class="brand">Nova Goods</p>');
    expect(html).toContain("$45<s>$60</s>");
    expect(html).toContain("From $90");
    expect(html).toContain('<span class="so">Sold out</span>');
    expect(html).not.toContain("/objects/private.jpg");
    expect(html).toContain('<span class="count">002</span><h1>New this week</h1>');
    expect(html).toContain("Oct 6 – Oct 13");
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    expect(ld["@type"]).toBe("CollectionPage");
    expect(ld.mainEntity.itemListElement[0]).toEqual({ "@type": "ListItem", position: 1, url: `https://brandthread.app/store/product/${ID}`, name: "Aurora <Hoodie>" });
  });

  it("shows an honest empty state (noindex) when nothing was listed this week", () => {
    const html: string = renderNewThisWeekHtml({ ...DATA, total: 0, items: [] }, 1);
    expect(html).toContain("No new pieces this week.");
    expect(html).toContain('<span class="count">000</span>');
    expect(html).toContain('<meta name="robots" content="noindex,follow" />');
    expect(html).not.toContain('class="grid"');
  });

  it("paginates with prev/next links", () => {
    const html: string = renderNewThisWeekHtml({ ...DATA, total: 100 }, 2);
    expect(html).toContain('<link rel="canonical" href="https://brandthread.app/new?page=2" />');
    expect(html).toContain('<link rel="prev" href="https://brandthread.app/new" />');
    expect(html).toContain('<link rel="next" href="https://brandthread.app/new?page=3" />');
    expect(html).toContain("2 / 3");
    expect(parsePage(new URLSearchParams(""))).toBe(1);
    expect(parsePage(new URLSearchParams("page=3"))).toBe(3);
    expect(parsePage(new URLSearchParams("page=0"))).toBeNull();
    expect(parsePage(new URLSearchParams("page=abc"))).toBeNull();
    expect(parsePage(new URLSearchParams("page=11"))).toBeNull();
  });

  it("fetches the public endpoint, caches it, and degrades to a 503 page when the API is down", async () => {
    const fetchMock = mockFetch(() => ({ body: DATA }));
    const page = await renderNewThisWeekPage(new URLSearchParams("page=2"));
    expect(page.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/public/new-this-week?limit=48&offset=48");
    await renderNewThisWeekPage(new URLSearchParams("page=2"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    newCache.clear();
    mockFetch(() => new Error("down"));
    const down = await renderNewThisWeekPage(new URLSearchParams(""));
    expect(down.status).toBe(503);
    expect(down.html).toContain('content="noindex"');
    expect((await renderNewThisWeekPage(new URLSearchParams("page=x"))).status).toBe(301);
  });
});

describe("robots.txt, sitemaps and .well-known", () => {
  it("robots allows public pages, blocks the API and private app areas, and names the sitemap", async () => {
    const r = await crawl.renderCrawlFile("/robots.txt", "/nonexistent");
    expect(r.body).toContain("User-agent: *\nAllow: /");
    for (const p of ["/api/", "/settings", "/orders", "/buyer-checkout", "/onboarding"]) expect(r.body).toContain(`Disallow: ${p}\n`);
    expect(r.body).not.toMatch(/Disallow: \/(new|store|drops|u|p)(\/|\n)/);
    expect(r.body).toContain("Sitemap: https://brandthread.app/sitemap.xml");
  });

  it("serves a sitemap index pointing at pages, products, stores and drops", async () => {
    const r = await crawl.renderCrawlFile("/sitemap.xml", "/nonexistent");
    expect(r.contentType).toContain("xml");
    for (const n of ["pages", "products", "stores", "drops"]) {
      expect(r.body).toContain(`<loc>https://brandthread.app/sitemap-${n}.xml</loc>`);
    }
    const pages = await crawl.renderCrawlFile("/sitemap-pages.xml", "/nonexistent");
    expect(pages.body).toContain("<loc>https://brandthread.app/new</loc>");
  });

  it("renders per-kind sitemaps from the public API with escaped URLs, and 503s when it is down", async () => {
    const fetchMock = mockFetch(() => ({ body: { kind: "stores", entries: [{ path: "/store/a&b", lastModified: "2026-10-01T00:00:00.000Z" }, { path: "https://evil.test/x", lastModified: "x" }] } }));
    const r = await crawl.renderCrawlFile("/sitemap-stores.xml", "/nonexistent");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/public/seo/sitemap/stores");
    expect(r.status).toBe(200);
    expect(r.body).toContain("<loc>https://brandthread.app/store/a&amp;b</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod>");
    expect(r.body).not.toContain("evil.test");
    crawl._caches.cache.clear();
    mockFetch(() => ({ status: 500, body: {} }));
    expect((await crawl.renderCrawlFile("/sitemap-products.xml", "/nonexistent")).status).toBe(503);
    expect(await crawl.renderCrawlFile("/sitemap-users.xml", "/nonexistent")).toBeNull();
  });

  it("proxies the AASA file from the API mirror and 502s when unreachable", async () => {
    const fetchMock = mockFetch(() => ({ body: { applinks: { apps: [], details: [] }, appclips: { apps: ["T.clip"] } } }));
    const r = await crawl.renderWellKnown("/.well-known/apple-app-site-association");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/public/well-known/apple-app-site-association");
    expect(r.status).toBe(200);
    expect(r.contentType).toBe("application/json");
    expect(JSON.parse(r.body).appclips.apps).toEqual(["T.clip"]);
    crawl._caches.wellKnownCache.clear();
    mockFetch(() => new Error("down"));
    expect((await crawl.renderWellKnown("/.well-known/assetlinks.json")).status).toBe(502);
    expect(await crawl.renderWellKnown("/.well-known/other")).toBeNull();
  });
});

describe("Smart App Banner / App Clip card", () => {
  it("is off unless APPLE_APP_STORE_ID is set", () => {
    expect(appBannerMeta(`/store/product/${ID}`, {})).toBe("");
    expect(appBannerMeta(`/store/product/${ID}`, { APPLE_APP_STORE_ID: "not-a-number" })).toBe("");
  });

  it("adds the plain banner, or the App Clip card when APP_CLIP_BUNDLE_ID is set, on product/store/drop pages only", () => {
    const env = { APPLE_APP_STORE_ID: "1234567890" };
    expect(appBannerMeta(`/store/product/${ID}`, env)).toBe(
      `<meta name="apple-itunes-app" content="app-id=1234567890, app-argument=https://brandthread.app/store/product/${ID}" />`,
    );
    const clipEnv = { ...env, APP_CLIP_BUNDLE_ID: "com.brandthread.mobile.Clip" };
    expect(appBannerMeta("/drops/d1", clipEnv)).toContain("app-clip-bundle-id=com.brandthread.mobile.Clip, app-clip-display=card");
    expect(appBannerMeta("/store/novagoods", clipEnv)).toContain("app-id=1234567890");
    for (const p of ["/settings", "/buyer-checkout", "/u/jordan", "/new"]) expect(appBannerMeta(p, clipEnv)).toBe("");
    const html = withAppBanner(SHELL, "/drops/d1", clipEnv);
    expect(html.match(/apple-itunes-app/g)).toHaveLength(1);
    expect(withAppBanner(html, "/drops/d1", clipEnv)).toBe(html);
  });
});

describe("new share-preview matchers", () => {
  it("renders the referral invite card with the inviter's public name and never counts a click", async () => {
    const fetchMock = mockFetch(() => ({ body: { code: "K7M2QP", inviterName: "Jordan", inviteeRewardCents: 1000 } }));
    const r = await renderSharePreview("/invite/k7m2qp", SHELL);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/public/invites/K7M2QP/share-preview");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("/referrals/invite");
    expect(r.html).toContain("Jordan invited you to Brandthread");
    expect(r.html).toContain("Join with this link and get $10 Thread Cash.");
    expect(r.html).toContain("og:image");
  });

  it("falls back to a generic invite title for private inviters and 404s unknown codes", async () => {
    mockFetch(() => ({ body: { code: "K7M2QP", inviterName: null, inviteeRewardCents: 1000 } }));
    expect((await renderSharePreview("/invite/K7M2QP", SHELL)).html).toContain("You’re invited to Brandthread");
    mockFetch(() => ({ status: 404, body: {} }));
    expect((await renderSharePreview("/invite/K7M2QP", SHELL)).status).toBe(404);
  });

  it("renders a generic community invite card without any lookup", async () => {
    const fetchMock = mockFetch(() => ({ body: {} }));
    const r = await renderSharePreview("/community-join", SHELL);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.html).toContain("Join a community on Brandthread");
  });

  it("uses the drop's hero image before the first product photo", async () => {
    mockFetch(() => ({ body: { name: "Fall", heroImageUrl: "https://cdn.test/hero.jpg", products: [{ images: ["https://cdn.test/p.jpg"] }] } }));
    expect((await renderSharePreview("/drops/d1", SHELL)).html).toContain('og:image" content="https://cdn.test/hero.jpg"');
    mockFetch(() => ({ body: { name: "Fall", heroImageUrl: null, products: [{ images: ["https://cdn.test/p.jpg"] }] } }));
    expect((await renderSharePreview("/drops/d1", SHELL)).html).toContain('og:image" content="https://cdn.test/p.jpg"');
  });
});
