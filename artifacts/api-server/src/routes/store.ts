import dns from "dns/promises";
import { Router } from "express";
import {
  db, storefronts, storefrontVersions, storefrontCustomDomains,
  products, productVariants,
} from "@workspace/db";
import { eq, and, desc, isNull, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { getWebOrigin } from "../lib/webOrigin";
import crypto from "crypto";

const router = Router();

// ─── HMAC-signed share-preview tokens ────────────────────────────────────────
// Tokens are self-contained (payload + signature) so they survive server
// restarts, crash-recoveries, and multi-instance deployments without any
// shared state or database table.
//
// SESSION_SECRET is REQUIRED — no fallback. Both endpoints return 503 when
// the secret is absent so the feature fails closed rather than using a known key.
const _sessionSecret = process.env.SESSION_SECRET;
const _signingKey: Buffer | null = _sessionSecret
  ? crypto.createHmac("sha256", _sessionSecret).update("store-preview-v1").digest()
  : null; // null → feature unavailable; 503 returned at each endpoint

/**
 * Create an HMAC-signed, self-contained preview token.
 * Because the payload + signature are encoded in the token itself (no server
 * state), tokens survive server restarts and multi-instance deployments.
 *
 * @param ownerId  The seller's Clerk user ID.
 * @param ttlMs    Token lifetime in milliseconds. Defaults to 24 hours.
 * @param nonce    Optional entropy for distinct tokens issued in the same millisecond.
 * @param purpose  Separates short-lived private previews from public share links.
 */
function createShareToken(
  ownerId: string,
  ttlMs = 24 * 60 * 60 * 1000,
  issuedAt = Date.now(),
  nonce?: string,
  purpose: "private" | "share" = "private",
): string {
  if (!_signingKey) throw new Error("SESSION_SECRET not configured");
  const payload = Buffer.from(JSON.stringify({
    ownerId,
    issuedAt,
    expiresAt: issuedAt + ttlMs,
    purpose,
    ...(nonce ? { nonce } : {}),
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", _signingKey).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function hashShareToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

function isCurrentShareToken(token: string, currentHash: string | null): boolean {
  if (!currentHash) return false;
  const tokenHash = Buffer.from(hashShareToken(token));
  const storedHash = Buffer.from(currentHash);
  return tokenHash.length === storedHash.length && crypto.timingSafeEqual(tokenHash, storedHash);
}

function verifyShareToken(token: string): {
  ownerId: string;
  issuedAt: number;
  expiresAt: number;
  purpose?: "private" | "share";
} | null {
  if (!_signingKey) return null; // feature unavailable — fail closed
  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) return null;
  const payload = token.slice(0, lastDot);
  const sig     = token.slice(lastDot + 1);
  // Compute expected signature and compare with constant-time equality
  const expected = crypto.createHmac("sha256", _signingKey).update(payload).digest("base64url");
  const sigBuf  = Buffer.from(sig);
  const expBuf  = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// ─── Output-encoding helpers ──────────────────────────────────────────────────

/** Escape user-controlled text for safe insertion into HTML element content */
function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape user-controlled text for safe insertion into HTML attribute values (within double-quotes) */
function escapeAttr(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Allow only hex colors (#rgb, #rrggbb, #rrggbbaa) in CSS property values */
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
function safeCssColor(val: unknown, fallback: string): string {
  const s = String(val ?? "").trim();
  return HEX_COLOR_RE.test(s) ? s : fallback;
}

/** Allow only safe characters in font-family CSS values (no semicolons, braces, parens, slashes) */
const SAFE_FONT_RE = /^[A-Za-z0-9 ,\-_'"]+$/;
function safeFontFamily(val: unknown, fallback: string): string {
  const s = String(val ?? "").trim();
  return SAFE_FONT_RE.test(s) && s.length <= 200 ? s : fallback;
}

const THREAD_THEME_LIGHT = {
  themeId: "thread",
  primaryColor: "#111111",
  secondaryColor: "#6B6B6B",
  accentColor: "#2B2B2B",
  backgroundColor: "#F7F7F5",
  textColor: "#111111",
  fontFamily: "Cormorant Garamond, Georgia, serif",
  borderRadius: 0,
};

const THREAD_THEME_DARK = {
  themeId: "thread",
  primaryColor: "#F5F5F3",
  secondaryColor: "#A7A7A3",
  accentColor: "#D7D7D2",
  backgroundColor: "#0B0B0B",
  textColor: "#F5F5F3",
  fontFamily: "Cormorant Garamond, Georgia, serif",
  borderRadius: 0,
};

const THREAD_THEME_SECTIONS = [
  {
    id: "thread-hero",
    type: "hero_image",
    title: "Hero Image",
    enabled: true,
    settings: {
      heading: "The new uniform.",
      description: "Considered pieces for everyday movement.",
      buttonLabel: "Shop the collection",
      fullWidth: true,
      sectionHeight: "tall",
    },
  },
  {
    id: "thread-products",
    type: "product_grid",
    title: "Product Grid",
    enabled: true,
    settings: {
      heading: "Current collection",
      description: "The pieces in rotation.",
      columns: 2,
      quickAdd: false,
    },
  },
  {
    id: "thread-story",
    type: "brand_story",
    title: "Brand Story",
    enabled: true,
    settings: {
      heading: "Designed with intention.",
      description: "Fewer pieces, better made, and meant to be worn often.",
    },
  },
  {
    id: "thread-newsletter",
    type: "newsletter",
    title: "Newsletter",
    enabled: true,
    settings: {
      heading: "Stay close.",
      description: "New releases, studio notes, and first access.",
      buttonLabel: "Join the list",
    },
  },
];

function normalizeThreadTheme(value: unknown): Record<string, unknown> {
  const theme = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  if (theme.themeId !== "thread") return theme;
  const dark = String(theme.backgroundColor ?? "").toUpperCase() === "#0B0B0B";
  return dark ? THREAD_THEME_DARK : THREAD_THEME_LIGHT;
}

function formatUsdCents(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

/**
 * Real, in-stock products for a seller's storefront — the same catalog rows
 * the seller manages elsewhere in the app. Used to replace the numbered
 * placeholder squares that used to stand in for a product grid.
 */
async function getStoreProducts(ownerId: string, limit = 8): Promise<Array<{
  id: string; name: string; image: string | null; priceCents: number; variantId: string; inStock: boolean;
}>> {
  type ProductRow = { id: string; name: string; images: unknown };
  type VariantRow = { id: string; productId: string; priceCents: number; stock: number };

  const rows: ProductRow[] = await db
    .select({ id: products.id, name: products.name, images: products.images })
    .from(products)
    .where(and(eq(products.ownerId, ownerId), eq(products.status, "active"), isNull(products.deletedAt)))
    .orderBy(desc(products.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const variantRows: VariantRow[] = await db
    .select({
      id: productVariants.id, productId: productVariants.productId,
      priceCents: productVariants.priceCents, stock: productVariants.stock,
    })
    .from(productVariants)
    .where(inArray(productVariants.productId, rows.map((r: ProductRow) => r.id)));
  return rows
    .map((p: ProductRow) => {
      const variants = variantRows.filter((v: VariantRow) => v.productId === p.id);
      if (variants.length === 0) return null;
      const inStockVariant = variants.find((v: VariantRow) => v.stock > 0) ?? variants[0];
      const images = Array.isArray(p.images) ? (p.images as string[]) : [];
      return {
        id: p.id,
        name: p.name,
        image: images.length > 0 ? images[0] : null,
        priceCents: inStockVariant.priceCents,
        variantId: inStockVariant.id,
        inStock: variants.some((v: VariantRow) => v.stock > 0),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
}

// Helper — build self-contained HTML for a storefront (shared by /preview,
// /preview/:token, and the public /site/:slug route). `isPreview` only
// changes the banner shown at the top of the page; the rendering, catalog,
// cart, and checkout wiring are identical to what a real customer sees.
async function buildPreviewHtml(ownerId: string, opts?: { isPreview?: boolean; sf?: any }): Promise<string> {
  const isPreview = opts?.isPreview ?? true;
  const sf = opts?.sf ?? await getOrCreateStorefront(ownerId);
  const storeProducts = await getStoreProducts(ownerId);
  const theme    = (sf.theme    as any) ?? {};
  const branding = (sf.branding as any) ?? {};
  const seo      = (sf.seo     as any) ?? {};
  const sections: any[] = Array.isArray(sf.sections) ? sf.sections : [];

  // CSS values — validated to hex colors and safe font names only
  const primary   = safeCssColor(theme.primaryColor,   THREAD_THEME_LIGHT.primaryColor);
  const secondary = safeCssColor(theme.secondaryColor, THREAD_THEME_LIGHT.secondaryColor);
  const bg        = safeCssColor(theme.backgroundColor,THREAD_THEME_LIGHT.backgroundColor);
  const txt       = safeCssColor(theme.textColor,      THREAD_THEME_LIGHT.textColor);
  const font      = safeFontFamily(theme.fontFamily,   THREAD_THEME_LIGHT.fontFamily);

  // Text content — HTML-escaped before interpolation
  const title   = escapeHtml(sf.title ?? "My Store");
  const tagline = escapeHtml(branding.tagline ?? "");

  const sectionHtml = sections.map((s: any) => {
    const h = escapeHtml(s.settings?.heading ?? s.title ?? "");
    const d = escapeHtml(s.settings?.description ?? s.content ?? "");
    const t = String(s.type ?? "");
    if (t.startsWith("hero")) {
      const btnLabel = escapeHtml(s.settings?.buttonLabel ?? "Shop Now");
      const rawImage = String(s.settings?.imageUri ?? "");
      const image = /^https?:\/\//i.test(rawImage)
        ? `<img class="hero-image" src="${escapeAttr(rawImage)}" alt="">`
        : `<div class="hero-image hero-placeholder" aria-hidden="true"></div>`;
      return `<section class="hero">
        ${image}
        <div class="hero-copy">
          <p class="eyebrow">Brandthread / Collection</p>
          <h1>${h || title}</h1>
          <p>${d}</p>
          <a class="text-link" href="#">${btnLabel}<span aria-hidden="true">→</span></a>
        </div>
      </section>`;
    }
    if (t === "announcement") {
      const banner = escapeHtml(s.settings?.heading ?? s.settings?.text ?? "Free shipping on orders over $150");
      return `<div class="announcement">${banner}</div>`;
    }
    if (t === "product_grid" || t === "featured_collection" || t === "collection_grid_tags") {
      const cards = storeProducts.length > 0
        ? storeProducts.map((p) => {
            const img = p.image && /^https?:\/\//i.test(p.image)
              ? `<img src="${escapeAttr(p.image)}" alt="${escapeAttr(p.name)}">`
              : `<div class="product-image-placeholder" aria-hidden="true"></div>`;
            return `<article class="product-card">
              <div class="product-image">${img}</div>
              <div class="product-meta"><span>${escapeHtml(p.name)}</span><span>${formatUsdCents(p.priceCents)}</span></div>
              <button type="button" class="add-to-cart-btn" ${p.inStock ? "" : "disabled"}
                data-product-id="${escapeAttr(p.id)}" data-variant-id="${escapeAttr(p.variantId)}"
                data-name="${escapeAttr(p.name)}" data-price="${p.priceCents}" data-image="${escapeAttr(p.image ?? "")}">
                ${p.inStock ? "Add to cart" : "Sold out"}
              </button>
            </article>`;
          }).join("")
        : `<p class="empty-catalog">No products published yet.</p>`;
      return `<section class="collection">
        <div class="section-heading"><h2>${h || "Current collection"}</h2><p>${d}</p></div>
        <div class="product-grid">${cards}</div>
      </section>`;
    }
    if (t === "brand_story") {
      return `<section class="story"><p class="eyebrow">The label</p><h2>${h}</h2><p>${d}</p></section>`;
    }
    if (t === "newsletter") {
      return `<section class="newsletter"><h2>${h}</h2><p>${d}</p><form><input aria-label="Email address" placeholder="Email address"><button type="button">${escapeHtml(s.settings?.buttonLabel ?? "Join")}</button></form></section>`;
    }
    if (t === "faq") {
      const faqs: Array<{ q?: string; a?: string }> = Array.isArray(s.settings?.faqs) ? s.settings.faqs : [];
      return `<section class="faq-section">
        <div class="section-heading"><h2>${h || "Questions"}</h2></div>
        ${faqs.map((f) => `<details class="faq-item"><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`).join("")}
      </section>`;
    }
    if (t === "customer_reviews") {
      const reviews: Array<{ author?: string; text?: string; rating?: number }> = Array.isArray(s.settings?.reviews) ? s.settings.reviews : [];
      return `<section class="reviews-section">
        <div class="section-heading"><h2>${h || "What people say"}</h2></div>
        <div class="reviews-grid">
          ${reviews.map((r) => `<blockquote class="review-card">
            <p>"${escapeHtml(r.text)}"</p>
            <cite>${escapeHtml(r.author)} · ${"★".repeat(Math.max(0, Math.min(5, r.rating ?? 5)))}</cite>
          </blockquote>`).join("")}
        </div>
      </section>`;
    }
    if (t === "social_links") {
      const links: Array<{ platform?: string; url?: string }> = Array.isArray(s.settings?.socialLinks) ? s.settings.socialLinks : [];
      return `<section class="social-links-section">
        ${h ? `<h2>${h}</h2>` : ""}
        <div class="social-links-row">
          ${links.filter((l) => l.url).map((l) => `<a href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.platform ?? "Link")}</a>`).join("")}
        </div>
      </section>`;
    }
    if (t === "contact_form") {
      const email = escapeAttr(s.settings?.contactEmail ?? "");
      return `<section class="contact-section">
        <div class="section-heading"><h2>${h || "Get in touch"}</h2><p>${d}</p></div>
        ${email
          ? `<a class="text-link" href="mailto:${email}">Email us<span aria-hidden="true">→</span></a>`
          : `<p class="empty-catalog">Contact form is not set up yet.</p>`}
      </section>`;
    }
    if (t === "footer" || t === "spacer") {
      // The page's global <footer> already renders below; a "footer" block in
      // the section list is a builder-side placeholder and needs no markup of
      // its own here, same as a spacer.
      return "";
    }
    return `<section class="standard-section">
      <h2>${h}</h2>
      <p>${d}</p>
    </section>`;
  }).join("\n");

  // SEO fields go into attributes / <title> — escape accordingly
  const metaTitle = escapeHtml(seo.metaTitle ?? sf.title ?? "My Store");
  const metaDesc  = escapeAttr(seo.metaDescription ?? branding.tagline ?? "");
  const year      = new Date().getFullYear(); // safe integer
  const origin       = getWebOrigin();
  const pageUrl       = isPreview ? `${origin}/api/store/preview` : `${origin}/api/store/site/${escapeAttr(String(sf.slug ?? ""))}`;
  const checkoutUrl   = `${origin}/api/guest/checkout/session`;
  const storeIdSafe   = escapeAttr(String(sf.id ?? ""));
  const bannerText    = isPreview ? "Private Preview link · Not yet published" : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${metaTitle}</title>
<meta name="description" content="${metaDesc}">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{background:${bg};color:${txt};font-family:Raleway,Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding-bottom:64px;}
nav{display:flex;align-items:center;justify-content:space-between;padding:22px clamp(20px,4vw,64px);background:${bg}f2;border-bottom:1px solid ${secondary};position:sticky;top:0;z-index:10;}
.logo{font:500 clamp(1.1rem,2vw,1.5rem)/1 ${font};color:${txt};letter-spacing:.08em;}
.nav-links{display:flex;gap:clamp(14px,3vw,36px);}
.nav-links a,.text-link{color:${txt};text-decoration:none;font-size:.72rem;text-transform:uppercase;letter-spacing:.14em;}
.preview-banner{background:${txt};padding:8px 24px;text-align:center;font-size:.65rem;color:${bg};letter-spacing:.14em;text-transform:uppercase;}
.hero{position:relative;min-height:min(82vh,820px);display:flex;align-items:flex-end;overflow:hidden;background:${primary};}
.hero-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:grayscale(1);opacity:.78;}
.hero-placeholder{background:linear-gradient(130deg,${primary},${secondary});}
.hero-copy{position:relative;z-index:1;width:min(760px,100%);padding:clamp(40px,8vw,110px) clamp(20px,7vw,96px);color:${bg};}
.eyebrow{font-size:.65rem;text-transform:uppercase;letter-spacing:.2em;margin-bottom:20px;opacity:.75;}
.hero h1{font:400 clamp(3.3rem,10vw,8.5rem)/.83 ${font};letter-spacing:-.04em;max-width:7ch;margin-bottom:26px;}
.hero-copy>p:not(.eyebrow){max-width:36rem;font-size:clamp(.9rem,1.4vw,1.1rem);line-height:1.6;margin-bottom:34px;}
.text-link{display:inline-flex;gap:14px;padding-bottom:7px;border-bottom:1px solid currentColor;color:${bg};}
.collection,.standard-section{padding:clamp(64px,10vw,140px) clamp(20px,4vw,64px);}
.section-heading{display:flex;justify-content:space-between;align-items:end;gap:24px;margin-bottom:40px;}
.section-heading h2,.story h2,.newsletter h2,.standard-section h2{font:400 clamp(2.3rem,6vw,5rem)/.95 ${font};letter-spacing:-.03em;}
.section-heading p,.standard-section p{max-width:28rem;color:${secondary};line-height:1.6;}
.product-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:clamp(1px,1vw,16px);}
.product-card{min-width:0;}
.product-image{aspect-ratio:4/5;background:${primary};color:${bg};display:flex;align-items:flex-end;padding:14px;filter:grayscale(1);}
.product-image span{font-size:.65rem;letter-spacing:.14em;}
.product-meta{display:flex;justify-content:space-between;padding:12px 0 28px;font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid ${secondary};}
.story{padding:clamp(100px,16vw,220px) clamp(20px,12vw,180px);text-align:center;border-top:1px solid ${secondary};}
.story>p:last-child{max-width:44rem;margin:28px auto 0;color:${secondary};font-size:clamp(1rem,2vw,1.35rem);line-height:1.8;}
.newsletter{margin:0 clamp(20px,4vw,64px);padding:clamp(64px,10vw,120px) 0;border-top:1px solid ${secondary};border-bottom:1px solid ${secondary};}
.newsletter p{margin:16px 0 34px;color:${secondary};}
.newsletter form{display:flex;max-width:560px;border-bottom:1px solid ${txt};}
.newsletter input{flex:1;background:transparent;border:0;padding:14px 0;color:${txt};font:inherit;outline:0;}
.newsletter button{background:transparent;border:0;color:${txt};text-transform:uppercase;letter-spacing:.12em;font-size:.68rem;}
.announcement{background:${txt};color:${bg};padding:10px 24px;text-align:center;font-size:.68rem;text-transform:uppercase;letter-spacing:.12em;}
.product-image img{width:100%;height:100%;object-fit:cover;filter:grayscale(1);}
.product-image-placeholder{width:100%;height:100%;background:${primary};}
.add-to-cart-btn{width:100%;margin-bottom:28px;padding:10px;background:transparent;border:1px solid ${txt};color:${txt};font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;cursor:pointer;}
.add-to-cart-btn:disabled{opacity:.4;cursor:not-allowed;}
.add-to-cart-btn.added{background:${txt};color:${bg};}
.empty-catalog{color:${secondary};padding:24px 0;}
.faq-section,.reviews-section,.social-links-section,.contact-section{padding:clamp(48px,8vw,100px) clamp(20px,4vw,64px);border-top:1px solid ${secondary};}
.faq-item{padding:18px 0;border-bottom:1px solid ${secondary};}
.faq-item summary{cursor:pointer;font-weight:600;}
.faq-item p{margin-top:10px;color:${secondary};line-height:1.6;}
.reviews-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;margin-top:24px;}
.review-card{border:1px solid ${secondary};padding:20px;}
.review-card cite{display:block;margin-top:12px;font-style:normal;font-size:.72rem;letter-spacing:.05em;color:${secondary};}
.social-links-row{display:flex;flex-wrap:wrap;gap:20px;margin-top:16px;}
.social-links-row a{color:${txt};text-decoration:none;text-transform:uppercase;font-size:.72rem;letter-spacing:.1em;border-bottom:1px solid currentColor;}
footer{padding:64px 24px;text-align:center;opacity:.6;font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;}
.cart-bar{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 24px;background:${txt};color:${bg};font-size:.75rem;letter-spacing:.05em;}
.cart-bar button{background:${bg};color:${txt};border:0;padding:8px 18px;text-transform:uppercase;font-size:.68rem;letter-spacing:.1em;cursor:pointer;}
.checkout-overlay{position:fixed;inset:0;z-index:30;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;}
.checkout-panel{position:relative;width:min(420px,100%);max-height:90vh;overflow:auto;background:${bg};color:${txt};padding:28px;}
.checkout-close{position:absolute;top:14px;right:14px;background:transparent;border:0;font-size:1.4rem;color:${txt};cursor:pointer;}
.checkout-panel h3{font:400 1.6rem/1 ${font};margin-bottom:18px;}
.checkout-panel form{display:flex;flex-direction:column;gap:10px;}
.checkout-panel input{padding:11px;border:1px solid ${secondary};background:transparent;color:${txt};font:inherit;}
.checkout-panel button[type=submit]{margin-top:8px;padding:13px;background:${txt};color:${bg};border:0;text-transform:uppercase;letter-spacing:.1em;font-size:.75rem;cursor:pointer;}
.checkout-panel button[type=submit]:disabled{opacity:.5;cursor:not-allowed;}
.checkout-error{color:#c0392b;font-size:.8rem;margin-bottom:10px;}
@media(max-width:640px){.nav-links a:nth-child(n+3){display:none}.product-grid{gap:1px}.section-heading{display:block}.section-heading p{margin-top:14px}}
</style>
</head>
<body>
${bannerText ? `<div class="preview-banner">${bannerText}</div>` : ""}
<nav>
  <span class="logo">${title}</span>
  <div class="nav-links"><a href="#">Shop</a><a href="#">Collections</a><a href="#">About</a><a href="#">Contact</a></div>
</nav>
${sectionHtml || `<section class="story">
  <p class="eyebrow">Thread Theme by Brandthread</p>
  <h1>${title}</h1>
  <p>${tagline || "Your storefront is ready. Publish to go live."}</p>
</section>`}
<footer>© ${year} ${title}. Powered by Brandthread.</footer>

<div id="bt-cart-bar" class="cart-bar" style="display:none">
  <span id="bt-cart-count">0 items</span>
  <span id="bt-cart-subtotal"></span>
  <button type="button" id="bt-cart-checkout-btn">Checkout</button>
</div>
<div id="bt-checkout-overlay" class="checkout-overlay" style="display:none">
  <div class="checkout-panel">
    <button type="button" id="bt-checkout-close" class="checkout-close" aria-label="Close">&times;</button>
    <h3>Checkout</h3>
    <div id="bt-checkout-error" class="checkout-error"></div>
    <form id="bt-checkout-form">
      <input name="contactEmail" type="email" placeholder="Email" required>
      <input name="contactPhone" type="tel" placeholder="Phone" required>
      <input name="name" placeholder="Full name" required>
      <input name="street" placeholder="Street address" required>
      <input name="city" placeholder="City" required>
      <input name="state" placeholder="State / province" required>
      <input name="zip" placeholder="ZIP / postal code" required>
      <input name="country" placeholder="Country code (e.g. US)" maxlength="2" value="US" required>
      <button type="submit" id="bt-checkout-submit">Pay now</button>
    </form>
  </div>
</div>
<script>
(function () {
  var CART_KEY = "bt_cart_${storeIdSafe}";
  var CHECKOUT_URL = ${JSON.stringify(checkoutUrl)};
  var PAGE_URL = ${JSON.stringify(pageUrl)};

  function readCart() {
    try {
      var raw = window.localStorage.getItem(CART_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function writeCart(items) {
    try { window.localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (e) {}
  }
  function renderCartBar() {
    var items = readCart();
    var bar = document.getElementById("bt-cart-bar");
    var count = items.reduce(function (n, it) { return n + it.quantity; }, 0);
    var subtotal = items.reduce(function (n, it) { return n + it.priceCents * it.quantity; }, 0);
    if (count === 0) { bar.style.display = "none"; return; }
    bar.style.display = "flex";
    document.getElementById("bt-cart-count").textContent = count + (count === 1 ? " item" : " items");
    document.getElementById("bt-cart-subtotal").textContent = "$" + (subtotal / 100).toFixed(2);
  }
  function addToCart(btn) {
    var items = readCart();
    var productId = btn.getAttribute("data-product-id");
    var variantId = btn.getAttribute("data-variant-id");
    var existing = items.find(function (it) { return it.variantId === variantId; });
    if (existing) {
      existing.quantity += 1;
    } else {
      items.push({
        productId: productId, variantId: variantId,
        name: btn.getAttribute("data-name"),
        priceCents: parseInt(btn.getAttribute("data-price"), 10) || 0,
        quantity: 1,
      });
    }
    writeCart(items);
    renderCartBar();
    btn.classList.add("added");
    var original = btn.textContent;
    btn.textContent = "Added";
    setTimeout(function () { btn.textContent = original; btn.classList.remove("added"); }, 1200);
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".add-to-cart-btn");
    if (btn && !btn.disabled) addToCart(btn);
  });

  var overlay = document.getElementById("bt-checkout-overlay");
  document.getElementById("bt-cart-checkout-btn").addEventListener("click", function () {
    overlay.style.display = "flex";
  });
  document.getElementById("bt-checkout-close").addEventListener("click", function () {
    overlay.style.display = "none";
  });

  document.getElementById("bt-checkout-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var items = readCart();
    if (items.length === 0) return;
    var form = e.target;
    var errorEl = document.getElementById("bt-checkout-error");
    var submitBtn = document.getElementById("bt-checkout-submit");
    errorEl.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Processing…";
    var idempotencyKey = "web-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    var payload = {
      items: items.map(function (it) { return { productId: it.productId, variantId: it.variantId, quantity: it.quantity }; }),
      successUrl: PAGE_URL + "?checkout=success",
      cancelUrl: PAGE_URL + "?checkout=cancelled",
      contactEmail: form.contactEmail.value,
      contactPhone: form.contactPhone.value,
      shippingAddress: {
        name: form.name.value,
        street: form.street.value,
        city: form.city.value,
        state: form.state.value,
        zip: form.zip.value,
        country: form.country.value,
        phone: form.contactPhone.value,
      },
      clientIdempotencyKey: idempotencyKey,
    };
    fetch(CHECKOUT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (result) {
      if (!result.ok || !result.data || !result.data.url) {
        throw new Error((result.data && result.data.error) || "Could not start checkout.");
      }
      writeCart([]);
      window.location.href = result.data.url;
    }).catch(function (err) {
      errorEl.textContent = err.message || "Could not start checkout. Please try again.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Pay now";
    });
  });

  renderCartBar();
})();
</script>
</body>
</html>`;
}

const EXPIRED_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Preview Expired</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}body{background:#07070f;color:#f4f4ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;}
.card{max-width:360px;}.icon{font-size:3rem;margin-bottom:16px;}.title{font-size:1.4rem;font-weight:700;margin-bottom:8px;}.sub{opacity:0.55;font-size:0.9rem;line-height:1.6;}</style>
</head><body><div class="card"><div class="icon">⏰</div><p class="title">Preview link expired</p><p class="sub">This preview link was only valid for 24 hours. Ask the seller to share a fresh link.</p></div></body></html>`;

// GET /api/store/preview/:token — public shareable preview (no auth required)
router.get("/preview/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const entry = verifyShareToken(token);

  if (!entry || entry.expiresAt < Date.now()) {
    res.set("Content-Type", "text/html");
    res.status(410).send(EXPIRED_PAGE);
    return;
  }

  // Public share links must be the one current link saved for this storefront.
  // Short-lived private preview tokens are intentionally independent of that
  // state: the authenticated WebView flow issues them for a five-minute preview.
  // Tokens from before purpose tagging fail closed, because their kind cannot be
  // determined safely.
  if (entry.purpose !== "private" && entry.purpose !== "share") {
    res.set("Content-Type", "text/html");
    res.status(410).send(EXPIRED_PAGE);
    return;
  }
  if (entry.purpose === "share") {
    // Check revocation: a token is invalid if it was issued at or before the
    // revocation watermark (revokedAt >= issuedAt).  Using >= means a token
    // issued in the exact same millisecond as a revocation is also rejected.
    const [sf] = await db
      .select({
        sharePreviewRevokedAt: storefronts.sharePreviewRevokedAt,
        sharePreviewTokenHash: storefronts.sharePreviewTokenHash,
      })
      .from(storefronts)
      .where(eq(storefronts.ownerId, entry.ownerId))
      .limit(1);
    if (
      !isCurrentShareToken(token, sf?.sharePreviewTokenHash ?? null)
      || (sf?.sharePreviewRevokedAt && sf.sharePreviewRevokedAt.getTime() >= entry.issuedAt)
    ) {
      res.set("Content-Type", "text/html");
      res.status(410).send(EXPIRED_PAGE);
      return;
    }
  }

  const html = await buildPreviewHtml(entry.ownerId);
  res.set("Content-Type", "text/html");
  res.send(html);
});

const NOT_FOUND_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Store not found</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}body{background:#07070f;color:#f4f4ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;}
.card{max-width:360px;}.title{font-size:1.4rem;font-weight:700;margin-bottom:8px;}.sub{opacity:0.55;font-size:0.9rem;line-height:1.6;}</style>
</head><body><div class="card"><p class="title">This store isn't available</p><p class="sub">It may be unpublished or the link is incorrect.</p></div></body></html>`;

// GET /api/store/site/:slug — the actual published storefront, publicly
// reachable with no auth: this is what a customer's browser hits, rendering
// straight from the storefront's saved sections/theme/branding with real
// products, a real cart, and checkout through the same guest-checkout
// endpoint the rest of the app uses. Registered before requireAuth below so
// it is genuinely public.
router.get("/site/:slug", async (req, res): Promise<void> => {
  const { slug } = req.params;
  const [sf] = await db
    .select()
    .from(storefronts)
    .where(eq(storefronts.slug, slug))
    .limit(1);
  if (!sf || sf.status !== "published") {
    res.set("Content-Type", "text/html");
    res.status(404).send(NOT_FOUND_PAGE);
    return;
  }
  const html = await buildPreviewHtml(sf.ownerId, { isPreview: false, sf });
  res.set("Content-Type", "text/html");
  res.send(html);
});

router.use(requireAuth);

// ─── Helper — get or create storefront for a seller ──────────────────────────
async function getOrCreateStorefront(ownerId: string) {
  const existing = await db
    .select()
    .from(storefronts)
    .where(eq(storefronts.ownerId, ownerId))
    .limit(1);

  if (existing[0]) return existing[0];

  // Auto-generate a slug from ownerId
  const slug = `store-${crypto.randomBytes(4).toString("hex")}`;
  const [created] = await db
    .insert(storefronts)
    .values({
      ownerId,
      slug,
      title: "My Store",
      theme: THREAD_THEME_LIGHT,
      sections: THREAD_THEME_SECTIONS,
      branding: { tagline: "", logoUrl: "", targetAudience: "" },
    })
    .returning();
  return created;
}

// GET /api/store — get the seller's storefront
router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);
  // Keep the revocation watermark explicit in the response so clients can
  // refresh preview-link status whenever the seller returns to the screen.
  res.json({
    ...sf,
    sharePreviewRevokedAt: sf.sharePreviewRevokedAt?.toISOString() ?? null,
  });
});

// PUT /api/store — save the storefront
router.put("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);

  const allowedFields = [
    "title", "subtitle", "description", "theme", "branding",
    "sections", "seo", "socialLinks", "analyticsCode",
  ];
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowedFields) {
    if (key in req.body) {
      // camelCase → snake_case mapping for DB columns
      const dbKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
      update[dbKey] = key === "theme"
        ? normalizeThreadTheme(req.body[key])
        : req.body[key];
    }
  }

  const [updated] = await db
    .update(storefronts)
    .set(update as any)
    .where(eq(storefronts.id, sf.id))
    .returning();

  res.json(updated);
});

// POST /api/store/publish — publish the storefront
router.post("/publish", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);

  const [updated] = await db
    .update(storefronts)
    .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(storefronts.id, sf.id))
    .returning();

  res.json(updated);
});

// POST /api/store/unpublish — unpublish the storefront
router.post("/unpublish", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);

  const [updated] = await db
    .update(storefronts)
    .set({ status: "draft", updatedAt: new Date() })
    .where(eq(storefronts.id, sf.id))
    .returning();

  res.json(updated);
});

// GET /api/store/versions — list saved versions
router.get("/versions", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);

  const versions = await db
    .select()
    .from(storefrontVersions)
    .where(eq(storefrontVersions.storefrontId, sf.id))
    .orderBy(desc(storefrontVersions.createdAt))
    .limit(20);

  res.json(versions);
});

// POST /api/store/versions — save a named version
// Body: { label?: string, snapshot?: Record<string,unknown> }
// When the client supplies a `snapshot` it is stored verbatim (preferred: the
// client captures the pre-mutation local state before the server storefront is
// updated, so the explicit payload is always more accurate than re-reading the
// server row).  When `snapshot` is absent the server falls back to the current
// DB row so callers that don't need a specific pre-mutation snapshot still work.
router.post("/versions", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { label = "Version", snapshot } = req.body;
  const sf = await getOrCreateStorefront(ownerId);

  const [version] = await db
    .insert(storefrontVersions)
    .values({
      storefrontId: sf.id,
      label,
      snapshot: (snapshot ?? sf) as Record<string, unknown>,
      createdBy: ownerId,
    })
    .returning();

  res.json(version);
});

// POST /api/store/versions/:id/restore — restore a saved version
//
// Supports two snapshot schemas written by different code paths:
//
//  1. Legacy full-storefront (old implicit saves — uses current DB row as the
//     snapshot):  snap.theme present, snap.branding uses DB column shape
//     ({ tagline, logoUrl, targetAudience }).
//
//  2. Mobile compact (new explicit-payload saves): snap.themeSettings carries
//     { themeId, ... }, snap.branding carries StoreBranding
//     ({ colors, typography, ... }).
//
// Only DB columns that are actually present in the snapshot are updated;
// absent fields are left at their current values, not overwritten with null.
router.post("/versions/:id/restore", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;
  const sf = await getOrCreateStorefront(ownerId);

  const [version] = await db
    .select()
    .from(storefrontVersions)
    .where(and(eq(storefrontVersions.id, id), eq(storefrontVersions.storefrontId, sf.id)))
    .limit(1);

  if (!version) { res.status(404).json({ error: "Version not found" }); return; }

  const snap = version.snapshot as any;

  // Build an update object from only the fields present in this snapshot so
  // absent fields are not overwritten with undefined/null.
  const update: Record<string, unknown> = { updatedAt: new Date() };

  if ("sections"      in snap) update.sections     = snap.sections;
  if ("title"         in snap) update.title        = snap.title;
  if ("subtitle"      in snap) update.subtitle     = snap.subtitle;
  if ("description"   in snap) update.description  = snap.description;
  if ("seo"           in snap) update.seo          = snap.seo;
  if ("socialLinks"   in snap) update.social_links  = snap.socialLinks;
  if ("analyticsCode" in snap) update.analytics_code = snap.analyticsCode;

  // branding: both schemas may carry it, but with different shapes.
  // Store whatever the snapshot says — the mobile client reads it back verbatim.
  if ("branding" in snap) update.branding = snap.branding;

  // theme: legacy schema has snap.theme directly (DB column shape).
  // Mobile compact schema has snap.themeSettings.themeId + snap.branding.colors.
  // Merge both into the DB theme column, preserving any existing fields not
  // captured in the snapshot.
  if ("theme" in snap) {
    update.theme = snap.theme;
  } else if (snap.themeSettings || snap.branding?.colors) {
    const existing = (sf.theme as Record<string, unknown> | null) ?? {};
    const derived: Record<string, unknown> = { ...existing };
    if (snap.themeSettings?.themeId)               derived.themeId         = snap.themeSettings.themeId;
    if (snap.branding?.colors?.primary)            derived.primaryColor    = snap.branding.colors.primary;
    if (snap.branding?.colors?.secondary)          derived.secondaryColor  = snap.branding.colors.secondary;
    if (snap.branding?.colors?.accent)             derived.accentColor     = snap.branding.colors.accent;
    if (snap.branding?.colors?.background)         derived.backgroundColor = snap.branding.colors.background;
    if (snap.branding?.colors?.text)               derived.textColor       = snap.branding.colors.text;
    if (snap.branding?.typography?.headingFont)    derived.fontFamily      = snap.branding.typography.headingFont;
    update.theme = derived;
  }

  const [restored] = await db
    .update(storefronts)
    .set(update as any)
    .where(eq(storefronts.id, sf.id))
    .returning();

  res.json(restored);
});

// GET /api/store/domains — list custom domains
router.get("/domains", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);

  const domains = await db
    .select()
    .from(storefrontCustomDomains)
    .where(eq(storefrontCustomDomains.storefrontId, sf.id));

  res.json(domains);
});

// POST /api/store/domains — add a custom domain
router.post("/domains", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const { domain } = req.body;
  if (!domain) { res.status(400).json({ error: "domain required" }); return; }
  const sf = await getOrCreateStorefront(ownerId);

  const verifyToken = `brandthread-verify-${crypto.randomBytes(12).toString("hex")}`;

  const [record] = await db
    .insert(storefrontCustomDomains)
    .values({ storefrontId: sf.id, domain, verifyToken })
    .returning();

  res.json({ ...record, verificationInstructions: `Add a TXT record: _brandthread-verify.${domain} → ${verifyToken}` });
});

// POST /api/store/domains/:id/verify — attempt DNS verification
router.post("/domains/:id/verify", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;
  const sf = await getOrCreateStorefront(ownerId);

  // Verify ownership before proceeding
  const [existing] = await db
    .select()
    .from(storefrontCustomDomains)
    .where(and(eq(storefrontCustomDomains.id, id), eq(storefrontCustomDomains.storefrontId, sf.id)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Domain not found" }); return; }

  // Real DNS TXT lookup — verify the seller has actually added the record
  let dnsVerified = false;
  try {
    const records = await dns.resolveTxt(`_brandthread-verify.${existing.domain}`);
    const flat = records.flat();
    dnsVerified = flat.includes(existing.verifyToken ?? "");
  } catch {
    // DNS not configured or lookup failed
  }

  if (!dnsVerified) {
    res.status(400).json({
      error: "DNS record not found",
      hint: `Add TXT record: _brandthread-verify.${existing.domain} → ${existing.verifyToken}`,
      note: "DNS changes can take up to 48 hours to propagate",
    }); return;
  }

  const [updated] = await db
    .update(storefrontCustomDomains)
    .set({ verified: true })
    .where(and(eq(storefrontCustomDomains.id, id), eq(storefrontCustomDomains.storefrontId, sf.id)))
    .returning();

  res.json(updated);
});

// DELETE /api/store/domains/:id — remove a custom domain
router.delete("/domains/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;
  const sf = await getOrCreateStorefront(ownerId);

  // Constrain delete to the authenticated seller's storefront
  await db
    .delete(storefrontCustomDomains)
    .where(and(eq(storefrontCustomDomains.id, id), eq(storefrontCustomDomains.storefrontId, sf.id)));

  res.json({ ok: true });
});

// GET /api/store/preview-token — generate a 5-min HMAC-signed token for the
// preview WebView. Using the same HMAC approach as share-preview means these
// tokens are self-contained: they survive server restarts and multi-instance
// deployments with zero shared state or database round-trips.
//
// The token is verified by the same verifyShareToken() function used for
// 24-hour share links — TTL enforcement is purely the expiresAt field inside
// the signed payload, so a 5-min token is simply one with a shorter TTL.
router.get("/preview-token", (req, res): void => {
  if (!_signingKey) {
    res.status(503).json({ error: "Preview unavailable: SESSION_SECRET not configured" });
    return;
  }
  const ownerId = (req as any).clerkUserId as string;
  const TTL_MS  = 5 * 60 * 1000; // 5 minutes
  const token   = createShareToken(ownerId, TTL_MS);
  res.json({ token, ttlSeconds: 300 });
});

// GET /api/store/preview — self-contained HTML for WebView preview
router.get("/preview", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const html = await buildPreviewHtml(ownerId);
  res.set("Content-Type", "text/html");
  res.send(html);
});

// POST /api/store/share-preview — generate a 24-hour shareable preview URL
router.post("/share-preview", async (req, res): Promise<void> => {
  if (!_signingKey) {
    res.status(503).json({ error: "Preview sharing unavailable: SESSION_SECRET not configured" });
    return;
  }
  const ownerId = (req as any).clerkUserId as string;

  // Read the revocation watermark so the new token is always issued strictly
  // after it. Also replace the stored fingerprint: only this latest public
  // link is valid, even if prior links have not expired yet.
  //
  // DO NOT clear sharePreviewRevokedAt: old (revoked) tokens must remain
  // rejected permanently, even after a fresh link is shared.
  // Invariant: revoke → old URL rejected → new URL accepted → old URL STILL rejected.
  const sf = await getOrCreateStorefront(ownerId);
  const revokedAtMs = sf.sharePreviewRevokedAt?.getTime() ?? 0;
  const TTL_MS = 24 * 60 * 60 * 1000;
  // Advance issuedAt past the watermark if necessary so new tokens always pass >= check.
  const issuedAt = Math.max(Date.now(), revokedAtMs + 1);
  const token = createShareToken(
    ownerId,
    TTL_MS,
    issuedAt,
    crypto.randomBytes(16).toString("base64url"),
    "share",
  );
  const expiresAt = issuedAt + TTL_MS;
  await db
    .update(storefronts)
    .set({
      sharePreviewTokenHash: hashShareToken(token),
      updatedAt: new Date(),
    })
    .where(eq(storefronts.id, sf.id));
  const origin = getWebOrigin();
  const url = `${origin}/api/store/preview/${token}`;
  res.json({ token, url, expiresAt: new Date(expiresAt).toISOString(), ttlSeconds: 86400 });
});

// DELETE /api/store/share-preview — revoke the seller's current preview link
// Clearing the stored fingerprint immediately invalidates the latest token. The
// timestamp watermark also keeps any legacy token invalid after revocation.
router.delete("/share-preview", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const sf = await getOrCreateStorefront(ownerId);
  await db
    .update(storefronts)
    .set({
      sharePreviewRevokedAt: new Date(),
      sharePreviewTokenHash: null,
      updatedAt: new Date(),
    })
    .where(eq(storefronts.id, sf.id));
  res.json({ ok: true, revokedAt: new Date().toISOString() });
});

// GET /api/store/public/:slug — public storefront (no auth)
router.get("/public/:slug", async (req, res): Promise<void> => {
  const { slug } = req.params;
  const [sf] = await db
    .select()
    .from(storefronts)
    .where(eq(storefronts.slug, slug))
    .limit(1);
  if (!sf || sf.status !== "published") { res.status(404).json({ error: "Store not found" }); return; }
  res.json(sf);
});

export default router;
