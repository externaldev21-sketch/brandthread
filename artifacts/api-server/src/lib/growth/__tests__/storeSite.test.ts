import crypto from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  STORE_SITE_THEMES, normalizeButtonStyle, normalizeStoreHandle, normalizeStoreSiteFont, normalizeStoreSiteTheme,
  resolveStoreSiteThemeKey, storeSiteTheme,
} from "../storeSiteDesign";
import {
  CHECKOUT_SCRIPT_HASH, DONE_SCRIPT_HASH, SHARE_SCRIPT_HASH, STORE_DONE_CSP, STORE_SITE_CSP, renderStoreCheckout, renderStoreCheckoutDone,
  renderStoreSite, storeCheckoutCsp, type StoreCheckoutModel, type StoreSiteBlock, type StoreSiteModel,
} from "../storeSitePage";
import { OG_HEIGHT, OG_WIDTH, isFetchableImageUrl, ogNameLines, renderStoreSiteOg } from "../storeSiteOg";

const block = (over: Partial<StoreSiteBlock> = {}): StoreSiteBlock => ({
  href: "/@maison/c/p1", kind: "premade", style: "callout", image: "https://cdn.test/1.jpg", title: "Wool crew",
  subtitle: "Merino, made in Porto", priceLabel: "$120", compareAtLabel: "", shipByLabel: "", buttonText: "Buy now",
  unavailableLabel: null, ...over,
});

const base = (over: Partial<StoreSiteModel> = {}): StoreSiteModel => ({
  handle: "maison",
  displayName: "Maison <Noir>",
  bio: "Small-batch knitwear",
  logoUrl: "https://cdn.test/logo.png",
  theme: storeSiteTheme("black"),
  socials: [{ key: "instagram", href: "https://www.instagram.com/maison" }, { key: "evil", href: "javascript:1" }],
  blocks: [
    block(),
    block({ href: "/@maison/c/p2", kind: "preorder", title: "Field jacket", image: "http://insecure.test/2.jpg", priceLabel: "$240", compareAtLabel: "$300", shipByLabel: "Ships by Nov 20", buttonText: "Pre-order", subtitle: "" }),
  ],
  canonicalUrl: "https://brandthread.app/@maison",
  ogImageUrl: "https://brandthread.app/@maison/og.png?v=abc",
  ...over,
});

const inlineScripts = (html: string) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const sha = (src: string) => `'sha256-${crypto.createHash("sha256").update(src).digest("base64")}'`;

describe("store design presets", () => {
  it("offers a few black / white / silver presets, black first", () => {
    expect(STORE_SITE_THEMES.map((t) => t.key)).toEqual(["black", "white", "silver", "graphite", "onyx"]);
    for (const t of STORE_SITE_THEMES) {
      for (const c of [t.bg, t.fg, t.muted, t.line, t.card, t.buttonBg, t.buttonFg]) {
        expect(c).toMatch(/^#[0-9A-F]{6}$/);
        // Greys only: equal red, green and blue (within a hair for Apple's system greys).
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
        expect(Math.max(r, g, b) - Math.min(r, g, b), `${t.key} ${c}`).toBeLessThanOrEqual(10);
      }
    }
  });
  it("shows older themes as the nearest preset", () => {
    expect(resolveStoreSiteThemeKey("mono")).toBe("white");
    expect(resolveStoreSiteThemeKey("dark")).toBe("black");
    expect(resolveStoreSiteThemeKey("bone")).toBe("white");
    expect(resolveStoreSiteThemeKey("navy")).toBe("black");
    expect(resolveStoreSiteThemeKey("oxblood")).toBe("black");
    expect(resolveStoreSiteThemeKey(undefined)).toBe("black");
    expect(resolveStoreSiteThemeKey("neon")).toBe("black");
    expect(resolveStoreSiteThemeKey("silver")).toBe("silver");
  });
  it("validates writes", () => {
    expect(normalizeStoreSiteTheme("onyx")).toBe("onyx");
    expect(normalizeStoreSiteTheme("navy")).toBeNull();
    expect(normalizeStoreSiteTheme("hotpink")).toBeNull();
    expect(normalizeButtonStyle("square")).toBe("square");
    expect(normalizeButtonStyle("pill")).toBeNull();
    expect(normalizeStoreSiteFont("serif")).toBe("serif");
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

describe("renderStoreSite (Stan layout)", () => {
  it("renders photo, name, bio, socials, then product blocks — escaped", () => {
    const html = renderStoreSite(base());
    expect(html).toContain("<title>Maison &lt;Noir&gt;</title>");
    expect(html).not.toContain("<Noir>");
    expect(html).toContain('class="logo" src="https://cdn.test/logo.png"');
    expect(html).toContain("Small-batch knitwear");
    expect(html).toContain('aria-label="Instagram"');
    expect(html).not.toContain("javascript:1");
    expect(html).toContain('<a class="blk co" href="/@maison/c/p1">');
    expect(html).toContain("Merino, made in Porto");
    expect(html).toContain('<span class="pr">$120</span>');
    expect(html).toContain('<span class="btn cta">Buy now</span>');
    expect(html).not.toContain("insecure.test"); // only https images
    expect(html).toContain("Powered by <a");
    // Profile comes before the blocks.
    expect(html.indexOf('class="hero"')).toBeLessThan(html.indexOf('class="blocks"'));
  });
  it("pre-order cards show the ship date, the original price and Pre-order", () => {
    const html = renderStoreSite(base());
    expect(html).toContain('<span class="pr">$240<s>$300</s></span>');
    expect(html).toContain('<span class="sb">Ships by Nov 20</span>');
    expect(html).toContain('<span class="btn cta">Pre-order</span>');
  });
  it("Button style is one compact row in the accent colour", () => {
    const html = renderStoreSite(base({ blocks: [block({ style: "button", kind: "preorder", shipByLabel: "Ships by Nov 20" })] }));
    expect(html).toContain('<a class="blk bt" href="/@maison/c/p1">');
    expect(html).toContain('<span class="ln">$120 · Ships by Nov 20</span>');
    expect(html).not.toContain('class="btn cta"');
    expect(html).toMatch(/\.bt\{[^}]*background:#FFFFFF;color:#000000/);
  });
  it("sold-out blocks stay on the page but can't be tapped", () => {
    const html = renderStoreSite(base({ blocks: [block({ unavailableLabel: "Sold out" })] }));
    expect(html).toContain('<div class="blk co off" aria-disabled="true">');
    expect(html).toContain('<span class="btn cta">Sold out</span>');
    expect(html).not.toContain('href="/@maison/c/p1"');
  });
  it("has nothing Linktree-ish: no product grid, link buttons or banner", () => {
    const html = renderStoreSite(base());
    for (const gone of ['class="grid"', 'class="links"', 'class="banner"', "aspect-ratio:3/4", "/go/"]) expect(html).not.toContain(gone);
  });
  it("has a link preview: og title, description, card image and canonical /@handle", () => {
    const html = renderStoreSite(base());
    expect(html).toContain('<link rel="canonical" href="https://brandthread.app/@maison">');
    expect(html).toContain('property="og:image" content="https://brandthread.app/@maison/og.png?v=abc"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('property="og:description" content="Small-batch knitwear"');
  });
  it("shows nothing it doesn't have", () => {
    const html = renderStoreSite(base({ bio: "", blocks: [], socials: [], logoUrl: null }));
    expect(html).not.toContain('class="blocks"');
    expect(html).not.toContain('class="bio"');
    expect(html).not.toContain('class="socs"');
    expect(html).toContain('class="logo ph"'); // initial in place of a missing photo
    expect(html).toContain("Shop Maison &lt;Noir&gt; on Brandthread");
  });
  it("applies the preset's background and accent, always in the system font", () => {
    const html = renderStoreSite(base({ theme: storeSiteTheme("silver") }));
    expect(html).toContain("background:#D1D1D6");
    expect(html).toMatch(/\.btn\{[^}]*background:#000000;color:#FFFFFF/);
    expect(html).toContain("-apple-system");
    expect(html).not.toContain("ui-serif");
  });
  it("allows its one inline script by hash and nothing else", () => {
    const scripts = inlineScripts(renderStoreSite(base()));
    expect(scripts).toHaveLength(1);
    expect(sha(scripts[0])).toBe(SHARE_SCRIPT_HASH);
    expect(STORE_SITE_CSP).toContain(`script-src ${SHARE_SCRIPT_HASH};`);
    expect(STORE_SITE_CSP).toContain("default-src 'none'");
  });
});

describe("checkout page (on the store)", () => {
  const checkout = (over: Partial<StoreCheckoutModel> = {}) => renderStoreCheckout({
    site: { handle: "maison", displayName: "Maison", logoUrl: null, theme: storeSiteTheme("black"), canonicalUrl: "https://brandthread.app/@maison" },
    storePath: "/@maison",
    productId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    kind: "premade",
    title: "Wool crew",
    image: "https://cdn.test/1.jpg",
    description: "Merino, made in Porto",
    priceLabel: "$120",
    compareAtLabel: "",
    shipByLabel: "",
    variants: [{ id: "v1", label: "", priceLabel: "$120", soldOut: false }],
    unavailableLabel: null,
    stripePublishableKey: "pk_test_abcdefghijkl",
    donePath: "/@maison/c/0f8fad5b-d9cb-469f-a165-70867728950e/done",
    canonicalUrl: "https://brandthread.app/@maison/c/0f8fad5b-d9cb-469f-a165-70867728950e",
    ...over,
  });
  it("shows image, title, price, description, a back arrow to the store and the buyer's details", () => {
    const html = checkout();
    expect(html).toContain('class="hero" src="https://cdn.test/1.jpg"');
    expect(html).toContain("<h1>Wool crew</h1>");
    expect(html).toContain("$120");
    expect(html).toContain("Merino, made in Porto");
    expect(html).toContain('href="/@maison" aria-label="Back to Maison"');
    for (const name of ["name", "email", "phone", "street", "line2", "city", "state", "zip", "country"]) expect(html).toContain(`name="${name}"`);
    expect(html).toContain('<input type="hidden" name="variant" value="v1">');
    expect(html).toContain("Continue to payment");
    expect(html).toContain('data-pk="pk_test_abcdefghijkl"');
    expect(html).toContain('<div id="pay" hidden></div>');
  });
  it("embedded payment loads Stripe.js and allows only Stripe's origins", () => {
    const html = checkout();
    expect(html).toContain('<script src="https://js.stripe.com/v3/" async></script>');
    const csp = storeCheckoutCsp(true);
    expect(csp).toContain(`script-src ${CHECKOUT_SCRIPT_HASH} https://js.stripe.com;`);
    expect(csp).toContain("frame-src https://js.stripe.com https://checkout.stripe.com");
    expect(csp).toContain("connect-src 'self' https://api.stripe.com");
    expect(csp).toContain("form-action 'self'");
    expect(sha(inlineScripts(html)[0])).toBe(CHECKOUT_SCRIPT_HASH);
  });
  it("without a publishable key it uses Stripe's hosted page and loads nothing from Stripe", () => {
    const html = checkout({ stripePublishableKey: null });
    expect(html).not.toContain("js.stripe.com");
    expect(html).toContain('data-pk=""');
    expect(storeCheckoutCsp(false)).not.toContain("stripe.com");
  });
  it("a pre-order shows its ship date", () => {
    const html = checkout({ kind: "preorder", shipByLabel: "Ships by Nov 20" });
    expect(html).toContain('<p class="sb">Ships by Nov 20</p>');
    expect(html).toContain("Continue to pre-order");
  });
  it("offers options when there's more than one, sold-out ones disabled", () => {
    const html = checkout({ variants: [
      { id: "v1", label: "S", priceLabel: "$120", soldOut: true },
      { id: "v2", label: "M", priceLabel: "$120", soldOut: false },
    ] });
    expect(html).toContain('<option value="v1" disabled>S · Sold out</option>');
    expect(html).toContain('<option value="v2" selected>M</option>');
  });
  it("sold out: no form", () => {
    const html = checkout({ variants: [{ id: "v1", label: "", priceLabel: "$120", soldOut: true }] });
    expect(html).not.toContain('<form id="co"');
    expect(html).toContain("Sold out");
  });
  it("the checkout script posts a guest checkout for the picked option and mounts embedded payment", () => {
    const script = inlineScripts(checkout())[0];
    expect(script).toContain("'/api/guest/checkout/session'");
    expect(script).toContain("body.uiMode='embedded'");
    expect(script).toContain("initEmbeddedCheckout");
    expect(script).toContain("{CHECKOUT_SESSION_ID}");
  });
});

describe("confirmation page", () => {
  it("thanks the buyer, shows what they bought and links back to the store", () => {
    const html = renderStoreCheckoutDone({
      site: { handle: "maison", displayName: "Maison", logoUrl: null, theme: storeSiteTheme("white"), canonicalUrl: "https://brandthread.app/@maison" },
      storePath: "/@maison", title: "Field jacket", image: null, shipByLabel: "Ships by Nov 20",
    });
    expect(html).toContain("Thank you!");
    expect(html).toContain("Field jacket");
    expect(html).toContain("Ships by Nov 20");
    expect(html).toContain('<a class="btn" href="/@maison">Back to Maison</a>');
    expect(html).toContain('name="robots" content="noindex"');
    expect(sha(inlineScripts(html)[0])).toBe(DONE_SCRIPT_HASH);
    expect(STORE_DONE_CSP).toContain(`script-src ${DONE_SCRIPT_HASH}`);
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
