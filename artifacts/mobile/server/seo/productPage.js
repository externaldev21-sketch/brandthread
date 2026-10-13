/**
 * Server-rendered SEO for product pages (/store/product/:id) — what Google
 * Shopping and other crawlers read before (or without) running the app.
 *
 * Injects into the SPA shell:
 *  - title / description / canonical / robots (seller noindex honoured)
 *  - Open Graph `product` card + product:price:* tags
 *  - schema.org Product JSON-LD (Offer or AggregateOffer from real prices
 *    and stock)
 *  - a <noscript> body with the name, brand, price and image, so crawlers
 *    that don't execute JS still see the product. Browsers with JS never
 *    render <noscript>, so the app boots exactly as before — no flash.
 *
 * Data: GET /api/v1/public/seo/products/:id. Returns null when the API can't
 * be reached so serve.js falls back to the existing share-preview card.
 */
const {
  CANONICAL_ORIGIN, OG_IMAGE_FALLBACK, centsToDecimal, escapeHtml, fetchApi, formatUsd,
  httpUrlOrNull, jsonLdScript, socialMetaTags, stripGenericHead,
} = require('./shared');

const PRODUCT_PATH = /^\/store\/product\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

const AVAILABILITY = {
  InStock: { schema: 'https://schema.org/InStock', og: 'in stock', label: null },
  OutOfStock: { schema: 'https://schema.org/OutOfStock', og: 'out of stock', label: 'Sold out' },
  PreOrder: { schema: 'https://schema.org/PreOrder', og: 'preorder', label: 'Pre-order' },
};

function matchProductPath(pathname) {
  const m = PRODUCT_PATH.exec(pathname);
  return m ? m[1].toLowerCase() : null;
}

function productJsonLd(product, canonicalUrl) {
  const availability = AVAILABILITY[product.availability] || AVAILABILITY.OutOfStock;
  const images = (product.images || []).map(httpUrlOrNull).filter(Boolean);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    url: canonicalUrl,
    sku: product.sku,
    productID: product.id,
  };
  if (product.longDescription || product.description) ld.description = product.longDescription || product.description;
  if (images.length) ld.image = images;
  if (product.category) ld.category = product.category;
  if (product.brand) ld.brand = { '@type': 'Brand', name: product.brand };

  const price = product.price;
  if (price && Number.isSafeInteger(price.lowCents)) {
    const seller = product.brand
      ? {
        '@type': 'Organization',
        name: product.brand,
        ...(product.storeSlug ? { url: `${CANONICAL_ORIGIN}/store/${encodeURIComponent(product.storeSlug)}` } : {}),
      }
      : undefined;
    const common = {
      priceCurrency: product.currency || 'USD',
      availability: availability.schema,
      url: canonicalUrl,
      ...(seller ? { seller } : {}),
    };
    ld.offers = price.highCents > price.lowCents
      ? {
        '@type': 'AggregateOffer',
        lowPrice: centsToDecimal(price.lowCents),
        highPrice: centsToDecimal(price.highCents),
        offerCount: price.offerCount,
        ...common,
      }
      : { '@type': 'Offer', price: centsToDecimal(price.lowCents), ...common };
  }
  return ld;
}

function priceLabel(price) {
  if (!price || !Number.isSafeInteger(price.lowCents)) return null;
  const low = formatUsd(price.lowCents);
  return price.highCents > price.lowCents ? `From ${low}` : low;
}

function noscriptBody(product, image) {
  const price = priceLabel(product.price);
  const status = (AVAILABILITY[product.availability] || {}).label;
  const muted = 'color:#8E8E93;margin:4px 0 0;font-size:15px';
  return [
    '<noscript><main style="background:#0A0A0B;color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:16px">',
    image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" style="width:100%;height:auto;display:block;background:#1C1C1E" />` : '',
    product.brand ? `<p style="${muted}">${escapeHtml(product.brand)}</p>` : '',
    `<h1 style="font-size:22px;font-weight:600;margin:4px 0 0">${escapeHtml(product.name)}</h1>`,
    price ? `<p style="margin:8px 0 0;font-size:17px">${escapeHtml(price)}${status ? ` · ${escapeHtml(status)}` : ''}</p>` : '',
    product.longDescription ? `<p style="${muted};line-height:1.5">${escapeHtml(product.longDescription)}</p>` : '',
    '</main></noscript>',
  ].join('');
}

/**
 * `{ html, status }` for a product path, or null (not a product path / API
 * unreachable). 404 + noindex when the product isn't public.
 */
async function renderProductSeoPage(pathname, shellHtml) {
  const id = matchProductPath(pathname);
  if (!id) return null;
  const { status, data, error } = await fetchApi(`/public/seo/products/${encodeURIComponent(id)}`);
  // Only the SEO endpoint's own "not public" answer means 404 — a generic
  // route-not-found (e.g. an API deploy without this endpoint) falls back.
  if (status === 404 && error && error.notPublic === true) {
    return { status: 404, html: shellHtml.replace('</head>', '<meta name="robots" content="noindex" /></head>') };
  }
  if (!data || typeof data.name !== 'string') return null;

  const canonicalUrl = `${CANONICAL_ORIGIN}/store/product/${id}`;
  const image = httpUrlOrNull(data.socialImageUrl) || (data.images || []).map(httpUrlOrNull).find(Boolean) || null;
  const price = priceLabel(data.price);
  const availability = AVAILABILITY[data.availability] || AVAILABILITY.OutOfStock;
  const description = data.description || `Shop ${data.name}${data.brand ? ` by ${data.brand}` : ''} on Brandthread.`;

  const head = [
    socialMetaTags({
      canonicalUrl,
      title: data.title || data.name,
      description,
      image: image || OG_IMAGE_FALLBACK,
      type: 'product',
      robots: data.noIndex ? 'noindex' : 'index,follow',
    }),
    data.price && Number.isSafeInteger(data.price.lowCents)
      ? `<meta property="product:price:amount" content="${centsToDecimal(data.price.lowCents)}" /><meta property="product:price:currency" content="${escapeHtml(data.currency || 'USD')}" />`
      : '',
    `<meta property="product:availability" content="${availability.og}" />`,
    data.brand ? `<meta property="product:brand" content="${escapeHtml(data.brand)}" />` : '',
    price ? `<meta name="twitter:label1" content="Price" /><meta name="twitter:data1" content="${escapeHtml(price)}" />` : '',
    jsonLdScript(productJsonLd(data, canonicalUrl)),
  ].join('');

  const html = stripGenericHead(shellHtml)
    .replace('</head>', `${head}</head>`)
    .replace(/<body\b[^>]*>/i, (open) => `${open}${noscriptBody(data, image)}`);
  return { status: 200, html };
}

module.exports = { matchProductPath, productJsonLd, renderProductSeoPage };
