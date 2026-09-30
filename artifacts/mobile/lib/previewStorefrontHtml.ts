/**
 * Local, client-side-built storefront HTML for `?bt_preview=seller&demo=1`
 * on the Store Preview screen (lib/devPreview.ts's isPreviewDemoMode()).
 *
 * The real storefront page comes from GET /api/store/preview, which
 * requires a real signed-in session server-side (see
 * artifacts/api-server/src/routes/store.ts: router.use(requireAuth) runs
 * before that route is registered). A dev/web preview session has no such
 * session by design, so that call can never succeed here — demo mode
 * showing "Your store is empty" (the auth-failure fallback) is therefore
 * always wrong, not a fluke: there's no route to a real response. Every
 * other demo-gated screen in Design Studio/Seller tonight (previewCatalog,
 * previewActivity, previewSellerProducts, …) solves this the same way —
 * local, seeded fixture data that never depends on a network call — and
 * this file is that pattern for the storefront itself: a self-contained
 * HTML document, built entirely client-side from getPreviewSellerProducts(),
 * so the iframe always has something real (if fake) to show in demo mode,
 * independent of auth, host, or network state.
 *
 * No "demo"/"preview" labeling anywhere in the document itself — Dev's
 * hard rule is no preview/demo wording ever visible on screen; `&demo=1`
 * already communicates that contextually to whoever chose to add it to
 * the URL, and a real customer never sees this page at all.
 *
 * Colors are black/white/silver only, matching the app's own monochrome
 * palette (lib/theme.ts's SILVER-equivalent token, TEXT_SECONDARY /
 * '#C0C0C0', and its matching translucent border wash) — no new
 * hardcoded greys. Inter is loaded from Google Fonts since this document
 * is a fully separate HTML page (an iframe's srcDoc) that doesn't share
 * the host app's bundled font loading.
 */
import { getPreviewSellerProducts } from './previewSellerProducts';

// Matches lib/theme.ts's TEXT_SECONDARY ('#C0C0C0') and BORDER
// ('rgba(192,192,192,0.28)') — the app's one permitted grey, silver, kept
// here as its own literal since this generated document can't import RN
// style tokens directly.
const SILVER = '#C0C0C0';
const SILVER_BORDER = 'rgba(192,192,192,0.28)';
const SILVER_WASH = 'rgba(192,192,192,0.12)';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Builds the same self-contained HTML document GET /api/store/preview
 *  returns, using local seeded demo products instead of a network call. */
export function buildPreviewStorefrontHtml(): string {
  const products = getPreviewSellerProducts();
  const title = 'Thread & Co.';
  // The store name already appears once, in the nav — the hero is a
  // tagline/banner line, not a second copy of the name.
  const heroLine = 'New arrivals, handmade in small batches.';

  const cards = products.map((p) => {
    const img = p.media[0]?.uri;
    const image = img
      ? `<img src="${img.replace(/"/g, '&quot;')}" alt="${escapeHtml(p.name)}">`
      : `<div class="product-image-placeholder" aria-hidden="true"></div>`;
    const inStock = (p.inventory?.availableStock ?? 0) > 0;
    return `<article class="product-card">
      <div class="product-image">${image}</div>
      <div class="product-meta"><span>${escapeHtml(p.name)}</span><span>${formatUsd(p.pricing.priceCents)}</span></div>
      <button type="button" class="add-to-cart-btn" ${inStock ? '' : 'disabled'}>${inStock ? 'Add to cart' : 'Sold out'}</button>
    </article>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#FFFFFF;color:#000000;font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding-bottom:64px;}
nav{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid ${SILVER_BORDER};position:sticky;top:0;background:#FFFFFF;z-index:10;}
.logo{font:600 1.1rem/1 'Inter',sans-serif;letter-spacing:-0.01em;color:#000000;}
.hero{padding:48px 24px 32px;}
.hero p{font:500 1.05rem/1.4 'Inter',sans-serif;color:#000000;}
.collection{padding:8px 24px 48px;}
.product-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px;margin-top:16px;}
.product-card{border:1px solid ${SILVER_BORDER};border-radius:10px;overflow:hidden;display:flex;flex-direction:column;}
.product-image{aspect-ratio:1;background:${SILVER_WASH};overflow:hidden;}
.product-image img{width:100%;height:100%;object-fit:cover;display:block;}
.product-image-placeholder{width:100%;height:100%;background:${SILVER_WASH};}
.product-meta{display:flex;flex-direction:column;gap:2px;padding:10px 12px 4px;font-size:.85rem;font-weight:600;}
.product-meta span:last-child{font-weight:500;color:${SILVER};}
.add-to-cart-btn{margin:8px 12px 12px;padding:8px;border-radius:6px;border:1px solid #000000;background:#000000;color:#FFFFFF;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;}
.add-to-cart-btn:disabled{background:#FFFFFF;color:${SILVER};border-color:${SILVER_BORDER};}
</style>
</head>
<body>
<nav><span class="logo">${title}</span></nav>
<section class="hero">
  <p>${heroLine}</p>
</section>
<section class="collection">
  <div class="product-grid">${cards}</div>
</section>
</body>
</html>`;
}
