/**
 * brandthread.app/new — public, crawlable "New this week" page.
 *
 * Layout follows SSENSE's shop grid (Mobbin reference in the PR): a thin
 * uppercase text bar, a numbered section header ("012 NEW THIS WEEK"),
 * then a three-column grid of image, brand, name and price with uppercase
 * text pagination — reskinned to Brandthread's black / white / silver with
 * the system font. Fully server-rendered (no app JS); every card links to
 * the product page in the app.
 *
 * Data: GET /api/v1/public/new-this-week (products first published in the
 * last 7 days from sellers in good standing). An empty week says so — no
 * filler products.
 */
const {
  CANONICAL_ORIGIN, OG_IMAGE_FALLBACK, createTtlCache, escapeHtml, fetchApi, formatUsd,
  httpUrlOrNull, jsonLdScript, socialMetaTags,
} = require('./shared');

const PAGE_SIZE = 48;
const MAX_PAGE = 10; // matches the API's 480-item cap
const TITLE = 'New this week | Brandthread';
const DESCRIPTION = 'The newest pieces from independent brands on Brandthread, listed in the last 7 days.';
const cache = createTtlCache(60 * 1000, 20);

function parsePage(searchParams) {
  const raw = searchParams ? searchParams.get('page') : null;
  if (raw === null || raw === '') return 1;
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_PAGE ? n : null;
}

function pageUrl(page) {
  return page <= 1 ? `${CANONICAL_ORIGIN}/new` : `${CANONICAL_ORIGIN}/new?page=${page}`;
}

function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const STYLES = `
:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;background:#0A0A0B;color:#FFFFFF}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.bar{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;padding-top:max(14px,env(safe-area-inset-top));font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.bar a{padding:6px 0}
.head{padding:28px 16px 4px;display:flex;align-items:baseline;gap:10px;text-transform:uppercase}
.head .count{font-size:11px;letter-spacing:.06em;color:#8E8E93;font-variant-numeric:tabular-nums}
.head h1{margin:0;font-size:15px;font-weight:500;letter-spacing:.04em}
.range{padding:0 16px 18px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8E8E93}
.grid{list-style:none;margin:0;padding:0 16px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:8px;row-gap:28px}
@media (min-width:900px){.grid{grid-template-columns:repeat(4,minmax(0,1fr));column-gap:16px}}
.card{display:block;min-width:0}
.img{position:relative;aspect-ratio:3/4;background:#1C1C1E;overflow:hidden}
.img img{width:100%;height:100%;object-fit:cover;display:block}
.img .so{position:absolute;left:0;bottom:0;padding:3px 6px;background:#0A0A0B;color:#FFFFFF;font-size:11px;letter-spacing:.04em;text-transform:uppercase}
.meta{padding-top:8px;font-size:12px;line-height:1.35}
.meta p{margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand{color:#FFFFFF}
.name{color:#8E8E93}
.price{color:#FFFFFF}
.price s{color:#8E8E93;margin-left:6px}
.empty{padding:8px 16px 48px;font-size:15px;color:#8E8E93}
.pager{display:flex;justify-content:space-between;padding:36px 16px;padding-bottom:max(36px,env(safe-area-inset-bottom));font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.pager span{color:#48484A}
`;

function cardHtml(item) {
  const image = httpUrlOrNull(item.imageUrl);
  const price = formatUsd(item.priceCents);
  const was = item.compareAtPriceCents ? formatUsd(item.compareAtPriceCents) : null;
  const href = `/store/product/${encodeURIComponent(item.id)}`;
  return [
    '<li>',
    `<a class="card" href="${escapeHtml(href)}">`,
    '<div class="img">',
    image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async" />` : '',
    item.soldOut ? '<span class="so">Sold out</span>' : '',
    '</div>',
    '<div class="meta">',
    item.brand ? `<p class="brand">${escapeHtml(item.brand)}</p>` : '',
    `<p class="name">${escapeHtml(item.name)}</p>`,
    price
      ? `<p class="price">${item.hasPriceRange ? 'From ' : ''}${escapeHtml(price)}${was ? `<s>${escapeHtml(was)}</s>` : ''}</p>`
      : '',
    '</div>',
    '</a>',
    '</li>',
  ].join('');
}

function itemListJsonLd(data, page) {
  const offset = (page - 1) * PAGE_SIZE;
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'New this week',
    description: DESCRIPTION,
    url: pageUrl(page),
    isPartOf: { '@type': 'WebSite', name: 'Brandthread', url: CANONICAL_ORIGIN },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: data.total,
      itemListOrder: 'https://schema.org/ItemListOrderDescending',
      itemListElement: data.items.map((item, index) => ({
        '@type': 'ListItem',
        position: offset + index + 1,
        url: `${CANONICAL_ORIGIN}/store/product/${item.id}`,
        name: item.name,
      })),
    },
  };
}

function documentHtml({ head, body }) {
  return [
    '<!doctype html><html lang="en"><head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />',
    '<meta name="theme-color" content="#0A0A0B" />',
    '<link rel="icon" href="/favicon.ico" />',
    head,
    `<style>${STYLES}</style>`,
    '</head><body>',
    body,
    '</body></html>',
  ].join('');
}

function renderNewThisWeekHtml(data, page) {
  const items = Array.isArray(data.items) ? data.items : [];
  const total = Number.isSafeInteger(data.total) ? data.total : items.length;
  const lastPage = Math.max(1, Math.min(MAX_PAGE, Math.ceil(total / PAGE_SIZE)));
  const firstImage = items.map((i) => httpUrlOrNull(i.imageUrl)).find(Boolean);
  const head = [
    socialMetaTags({
      canonicalUrl: pageUrl(page),
      title: page > 1 ? `New this week — page ${page} | Brandthread` : TITLE,
      description: DESCRIPTION,
      image: firstImage || OG_IMAGE_FALLBACK,
      // An empty week has nothing worth indexing; the page still renders.
      robots: items.length ? 'index,follow' : 'noindex,follow',
    }),
    page > 1 ? `<link rel="prev" href="${escapeHtml(pageUrl(page - 1))}" />` : '',
    page < lastPage ? `<link rel="next" href="${escapeHtml(pageUrl(page + 1))}" />` : '',
    jsonLdScript(itemListJsonLd({ ...data, items, total }, page)),
  ].join('');

  const count = String(Math.min(total, 999)).padStart(3, '0');
  const range = data.windowStart && data.windowEnd ? `${shortDate(data.windowStart)} – ${shortDate(data.windowEnd)}` : '';
  const body = [
    '<header class="bar"><a href="/">Brandthread</a><a href="/discover">Shop</a></header>',
    '<main>',
    `<div class="head"><span class="count">${count}</span><h1>New this week</h1></div>`,
    range ? `<p class="range">${escapeHtml(range)}</p>` : '',
    items.length
      ? `<ul class="grid">${items.map(cardHtml).join('')}</ul>`
      : '<p class="empty">No new pieces this week.</p>',
    items.length && lastPage > 1
      ? `<nav class="pager" aria-label="Pages">${page > 1 ? `<a href="${escapeHtml(page - 1 === 1 ? '/new' : `/new?page=${page - 1}`)}">Previous</a>` : '<span>Previous</span>'}<span>${page} / ${lastPage}</span>${page < lastPage ? `<a href="/new?page=${page + 1}">Next</a>` : '<span>Next</span>'}</nav>`
      : '',
    '</main>',
  ].join('');
  return documentHtml({ head, body });
}

function renderUnavailableHtml() {
  return documentHtml({
    head: `<title>${escapeHtml(TITLE)}</title><meta name="robots" content="noindex" />`,
    body: '<header class="bar"><a href="/">Brandthread</a><a href="/discover">Shop</a></header><main><div class="head"><h1>New this week</h1></div><p class="empty">This page couldn’t load. Try again in a moment.</p></main>',
  });
}

/** `{ status, html, headers }` for /new. */
async function renderNewThisWeekPage(searchParams) {
  const page = parsePage(searchParams);
  if (page === null) {
    return { status: 301, html: '', headers: { location: '/new' } };
  }
  const data = await cache.get(`p${page}`, async () => {
    const res = await fetchApi(`/public/new-this-week?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`);
    return res.data && Array.isArray(res.data.items) ? res.data : null;
  });
  if (!data) {
    return { status: 503, html: renderUnavailableHtml(), headers: { 'retry-after': '60', 'cache-control': 'no-store' } };
  }
  return {
    status: 200,
    html: renderNewThisWeekHtml(data, page),
    headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=900' },
  };
}

module.exports = { PAGE_SIZE, parsePage, renderNewThisWeekHtml, renderNewThisWeekPage, _cache: cache };
