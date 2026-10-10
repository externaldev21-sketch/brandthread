import crypto from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  STORE_SITE_THEMES, normalizeButtonStyle, normalizeStoreHandle, normalizeStoreSiteFont, normalizeStoreSiteTheme,
  resolveStoreSiteThemeKey, storeSiteTheme,
} from "../storeSiteDesign";
import {
  SHARE_SCRIPT_HASH, STORE_SITE_CSP, renderStoreSite, renderStoreSiteProduct, storeSiteBuyHref, type StoreSiteModel,
} from "../storeSitePage";
import { OG_HEIGHT, OG_WIDTH, isFetchableImageUrl, ogNameLines, renderStoreSiteOg } from "../storeSiteOg";

const base = (over: Partial<StoreSiteModel> = {}): StoreSiteModel => ({
  handle: "maison",
  displayName: "Maison <Noir>",
  bio: "Small-batch knitwear",
  logoUrl: "https://cdn.test/logo.png",
  bannerUrl: null,
  theme: storeSiteTheme("black"),
  buttonStyle: "rounded",
  font: "system",
  socials: [{ key: "instagram", href: "https://www.instagram.com/maison" }, { key: "evil", href: "javascript:1" }],
  products: [
    { id: "p1", name: "Wool crew", href: "/@maison/p/p1", image: "https://cdn.test/1.jpg", priceLabel: "$120.00" },
    { id: "p2", name: "No photo", href: "/@maison/p/p2", image: "http://insecure.test/2.jpg", priceLabel: "" },
  ],
  links: [{ href: "/@maison/go/l1", title: "Drop waitlist" }],
  canonicalUrl: "https://brandthread.app/@maison",
  ogImageUrl: "https://brandthread.app/@maison/og.png?v=abc",
  ...over,
});

describe("store website design choices", () => {
  it("offers 6–8 curated themes, black first", () => {
    expect(STORE_SITE_THEMES.length).toBeGreaterThanOrEqual(6);
    expect(STORE_SITE_THEMES.length).toBeLessThanOrEqual(8);
    expect(STORE_SITE_THEMES[0].key).toBe("black");
    expect(new Set(STORE_SITE_THEMES.map((t) => t.key)).size).toBe(STORE_SITE_THEMES.length);
    for (const t of STORE_SITE_THEMES) for (const c of [t.bg, t.fg, t.muted, t.line, t.buttonBg, t.buttonFg]) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });
  it("keeps older link-in-bio pages looking the same", () => {
    expect(resolveStoreSiteThemeKey("mono")).toBe("white");
    expect(resolveStoreSiteThemeKey("dark")).toBe("black");
    expect(resolveStoreSiteThemeKey(undefined)).toBe("black");
    expect(resolveStoreSiteThemeKey("neon")).toBe("black");
    expect(resolveStoreSiteThemeKey("silver")).toBe("silver");
  });
  it("validates writes", () => {
    expect(normalizeStoreSiteTheme("navy")).toBe("navy");
    expect(normalizeStoreSiteTheme("hotpink")).toBeNull();
    expect(normalizeButtonStyle("square")).toBe("square");
    expect(normalizeButtonStyle("pill")).toBeNull();
    expect(normalizeStoreSiteFont("serif")).toBe("serif");
    expect(normalizeStoreSiteFont("comic")).toBeNull();
    expect(normalizeStoreSiteFont("toString")).toBeNull();
  });
  it("normalises handles to the username rules", () => {
    expect(normalizeStoreHandle("@Maison_Noir")).toBe("maison_noir");
    expect(normalizeStoreHandle("ab")).toBeNull();
    expect(normalizeStoreHandle("maison.noir")).toBeNull();
    expect(normalizeStoreHandle("../etc")).toBeNull();
    expect(normalizeStoreHandle(42)).toBeNull();
  });
});

describe("renderStoreSite", () => {
  it("renders logo, name, bio, socials, 3:4 product grid, links and the footer — escaped", () => {
    const html = renderStoreSite(base());
    expect(html).toContain("<title>Maison &lt;Noir&gt;</title>");
    expect(html).not.toContain("<Noir>");
    expect(html).toContain('src="https://cdn.test/logo.png"');
    expect(html).toContain("Small-batch knitwear");
    expect(html).toContain('aria-label="Instagram"');
    expect(html).not.toContain("javascript:1");
    expect(html).toContain("aspect-ratio:3/4");
    expect(html).toContain('href="/@maison/p/p1"');
    expect(html).toContain("$120.00");
    expect(html).not.toContain("insecure.test"); // only https images
    expect(html).toContain('href="/@maison/go/l1"');
    expect(html).toContain("Drop waitlist");
    expect(html).toContain("Powered by <a");
  });
  it("has a link preview: og title, description, card image and canonical /@handle", () => {
    const html = renderStoreSite(base());
    expect(html).toContain('<link rel="canonical" href="https://brandthread.app/@maison">');
    expect(html).toContain('property="og:url" content="https://brandthread.app/@maison"');
    expect(html).toContain('property="og:image" content="https://brandthread.app/@maison/og.png?v=abc"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('property="og:description" content="Small-batch knitwear"');
  });
  it("shows nothing it doesn't have (no grid, links, bio or banner placeholders)", () => {
    const html = renderStoreSite(base({ bio: "", products: [], links: [], socials: [], logoUrl: null }));
    expect(html).not.toContain('class="grid"');
    expect(html).not.toContain('class="links"');
    expect(html).not.toContain('class="bio"');
    expect(html).not.toContain('class="banner"');
    expect(html).toContain('class="logo ph"'); // initial in place of a missing logo
    expect(html).toContain("Shop Maison &lt;Noir&gt; on Brandthread");
  });
  it("applies the banner, theme, button corners and font", () => {
    const html = renderStoreSite(base({ bannerUrl: "https://cdn.test/b.jpg", theme: storeSiteTheme("bone"), buttonStyle: "square", font: "serif" }));
    expect(html).toContain('class="banner" src="https://cdn.test/b.jpg"');
    expect(html).toContain("background:#F2EFE9");
    expect(html).toMatch(/\.btn\{[^}]*border-radius:0;/);
    expect(html).toContain('"New York",ui-serif');
    expect(renderStoreSite(base())).toMatch(/\.btn\{[^}]*border-radius:12px;/);
  });
  it("allows its one inline script by hash and nothing else", () => {
    const html = renderStoreSite(base());
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(1);
    const hash = `'sha256-${crypto.createHash("sha256").update(scripts[0]).digest("base64")}'`;
    expect(hash).toBe(SHARE_SCRIPT_HASH);
    expect(STORE_SITE_CSP).toContain(`script-src ${SHARE_SCRIPT_HASH}`);
    expect(STORE_SITE_CSP).toContain("default-src 'none'");
  });
});

describe("product page", () => {
  const product = (images: string[]) => renderStoreSiteProduct({
    site: { handle: "maison", displayName: "Maison", logoUrl: null, theme: storeSiteTheme("white"), buttonStyle: "rounded", font: "system", canonicalUrl: "https://brandthread.app/@maison" },
    product: { name: "Wool crew", description: "Merino, made in Porto", images, priceLabel: "$120.00" },
    buyHref: "https://brandthread.app/store/product/p1?utm_source=brandthread_site",
    canonicalUrl: "https://brandthread.app/@maison/p/p1",
  });
  it("shows photos, name, price, Buy and a way back to the store", () => {
    const html = product(["https://cdn.test/1.jpg", "https://cdn.test/2.jpg"]);
    expect(html).toContain('alt="Wool crew 1 of 2"');
    expect(html).toContain("$120.00");
    expect(html).toContain('class="btn buy" href="https://brandthread.app/store/product/p1?utm_source=brandthread_site"');
    expect(html).toContain('href="https://brandthread.app/@maison"');
    expect(html).toContain('property="og:image" content="https://cdn.test/1.jpg"');
    expect(html).toContain("Merino, made in Porto");
  });
  it("still renders without photos", () => {
    expect(product([])).toContain('<span class="img" aria-hidden="true">');
  });
  it("Buy opens the app on Android when installed, web checkout everywhere else", () => {
    const web = "https://brandthread.app/store/product/p1?utm_source=x";
    const android = storeSiteBuyHref("Mozilla/5.0 (Linux; Android 14; Pixel 8)", web, "p1");
    expect(android).toMatch(/^intent:\/\/store\/product\/p1#Intent;scheme=brandthread;package=com\.brandthread\.mobile;/);
    expect(android).toContain(`S.browser_fallback_url=${encodeURIComponent(web)}`);
    expect(storeSiteBuyHref("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", web, "p1")).toBe(web);
    expect(storeSiteBuyHref(undefined, web, "p1")).toBe(web);
  });
});

describe("link preview card", () => {
  it("only fetches public https image hosts", () => {
    expect(isFetchableImageUrl("https://storage.googleapis.com/b/o.jpg")).toBe(true);
    for (const bad of ["http://cdn.test/a.jpg", "https://127.0.0.1/a.jpg", "https://[::1]/a.jpg", "https://localhost/a.jpg",
      "https://metadata.internal/x", "https://169.254.169.254/latest", "https://user:pw@cdn.test/a.jpg", "https://cdn.test:8443/a.jpg", "not a url"]) {
      expect(isFetchableImageUrl(bad), bad).toBe(false);
    }
  });
  it("wraps long names onto two lines", () => {
    expect(ogNameLines("Maison")).toEqual(["Maison"]);
    expect(ogNameLines("The Very Long Brand Name Studio Collective")).toHaveLength(2);
    expect(ogNameLines("Supercalifragilisticexpialidocious")[0].length).toBeLessThanOrEqual(16);
  });
  it("renders a 1200×630 PNG with the logo and product photos", async () => {
    const tile = await sharp({ create: { width: 300, height: 400, channels: 3, background: "#888888" } }).png().toBuffer();
    const fetched: string[] = [];
    const png = await renderStoreSiteOg({
      handle: "maison", displayName: "Maison", logoUrl: "https://cdn.test/logo.png",
      productImages: ["https://cdn.test/1.jpg", "https://cdn.test/2.jpg", "https://cdn.test/3.jpg", "https://cdn.test/4.jpg"],
      theme: storeSiteTheme("black"), displayUrl: "brandthread.app/@maison",
    }, async (u) => { fetched.push(u); return tile; });
    const meta = await sharp(png).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", OG_WIDTH, OG_HEIGHT]);
    expect(fetched).toHaveLength(4); // logo + first three products
  });
  it("still renders when every image fails to load", async () => {
    const png = await renderStoreSiteOg({
      handle: "maison", displayName: "", logoUrl: "https://cdn.test/logo.png", productImages: ["https://cdn.test/1.jpg"],
      theme: storeSiteTheme("white"), displayUrl: "brandthread.app/@maison",
    }, async () => null);
    expect((await sharp(png).metadata()).width).toBe(OG_WIDTH);
  });
});
