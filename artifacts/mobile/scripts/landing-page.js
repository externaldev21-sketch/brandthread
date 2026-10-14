/**
 * Static marketing landing page for brandthread.app.
 *
 * Pure string rendering, no app code: plain HTML and CSS plus one small inline
 * script that remembers the chosen signup side, runs the hero slideshow, and
 * swaps the "Trending now" row for live items from the public trending
 * endpoint when it has enough of them. The page is complete without that
 * request, so it never renders empty. `scripts/build-web.js` writes the result
 * to `static-build/landing.html` (images to `static-build/landing-assets/`) and
 * `server/serve.js` serves it for signed-out visits to "/" and for "/welcome".
 * The Expo app itself is not touched.
 */

const { PRICING_CSS, PRICING_PATH, renderLandingPricingSection, renderPricingHtml, trialDateScript } = require('./pricing-page');

const CANONICAL_ORIGIN = 'https://brandthread.app';
// Written next to landing.html; server/serve.js serves it at /pricing.
const PRICING_FILE = 'pricing.html';
const LOGO_URL = `${CANONICAL_ORIGIN}/brandthread-logo.png`;
const TITLE = 'Brandthread | Shop, sell & design streetwear';
const DESCRIPTION =
  'Brandthread is where independent labels drop new pieces, sellers run their whole shop, and buyers discover streetwear brands they will actually wear.';

// The app's own onboarding reads this key to resume at the account-creation
// step for the chosen side (app/onboarding.tsx PENDING_FLOW_KEY). Writing it
// lets "Start selling" skip the Buyer/Seller question without changing the app.
const PENDING_FLOW_KEY = 'onboarding_pending_flow';

// Real in-app routes (Expo Router): onboarding creates the account, sign-in
// is for returning users, buyer-search reads ?q=, product links use the
// shareable /store/product/<id> route, the legal pages are public.
const ROUTES = {
  signUp: '/onboarding',
  signIn: '/sign-in',
  search: '/buyer-search',
  product: '/store/product/',
  privacy: '/privacy',
  terms: '/terms',
  guidelines: '/community-guidelines',
  support: 'mailto:support@brandthread.app',
};

// Same-origin in production (build-web.js points the app at brandthread.app).
const TRENDING_ENDPOINT = '/api/v1/public/trending/products?limit=8';

const ASSET_DIR = 'landing-assets';
const ASSET_SOURCES = {
  'look-01.jpg': 'assets/landing/look-01.jpg',
  'look-02.jpg': 'assets/landing/look-02.jpg',
  'look-03.jpg': 'assets/landing/look-03.jpg',
  'look-04.jpg': 'assets/landing/look-04.jpg',
  'look-05.jpg': 'assets/landing/look-05.jpg',
  'look-06.jpg': 'assets/landing/look-06.jpg',
  'look-08.jpg': 'assets/landing/look-08.jpg',
  'look-09.jpg': 'assets/landing/look-09.jpg',
  'look-10.jpg': 'assets/landing/look-10.jpg',
  'seller-dashboard.jpg': 'assets/landing/seller-dashboard.jpg',
  'seller-orders.jpg': 'assets/landing/seller-orders.jpg',
  'seller-store.jpg': 'assets/landing/seller-store.jpg',
};
const LOOK_SIZE = { width: 720, height: 1080 };
const SCREEN_SIZE = { width: 600, height: 1300 };

// The demo catalogue (lib/previewCatalog.ts): same labels, pieces, prices and
// runway photography the app's preview mode shows.
const LOOKS = {
  '01': { brand: 'Atelier Noire', piece: 'Sculpted Wool Coat', priceCents: 48000 },
  '02': { brand: 'Maison Vela', piece: 'Liquid Silver Dress', priceCents: 32500, compareAtCents: 39000 },
  '03': { brand: 'Saint Rue', piece: 'Oversized Tuxedo', priceCents: 56000 },
  '04': { brand: 'Orison', piece: 'Ivory Column Set', priceCents: 41000 },
  '05': { brand: 'Kuro Line', piece: 'Asymmetric Layer Jacket', priceCents: 29500, compareAtCents: 35000 },
  '06': { brand: 'Forme 22', piece: 'Draped Hardware Gown', priceCents: 37500 },
  '08': { brand: 'Noma Archive', piece: 'Reconstructed Trench', priceCents: 52000 },
  '09': { brand: 'Echelon', piece: 'Satin Power Suit', priceCents: 44500, compareAtCents: 51000 },
  '10': { brand: 'Vale Studio', piece: 'Sculpted Silk Gown', priceCents: 69000 },
};
// Three hero slides; desktop shows each as a three-photo spread, phones show
// the first photo of each.
const HERO_SLIDES = [['01', '05', '09'], ['03', '08', '10'], ['06', '02', '04']];
const TRENDING_FALLBACK = ['05', '01', '09', '02', '08', '03', '10', '06', '04'];

// Labels in the demo catalogue, each set as a plain-text wordmark.
const LABELS = [
  { name: 'Atelier Noire', style: 'serif' },
  { name: 'Kuro Line', style: 'wide' },
  { name: 'Maison Vela', style: 'serif-italic' },
  { name: 'Forme 22', style: 'mono' },
  { name: 'Saint Rue', style: 'heavy' },
  { name: 'Orison', style: 'wide' },
  { name: 'Noma Archive', style: 'mono' },
  { name: 'Astrae', style: 'serif' },
  { name: 'Echelon', style: 'heavy' },
  { name: 'Vale Studio', style: 'serif-italic' },
];

// Mirrors lib/sellerPlans.ts (the landing test fails if they drift).
const PLAN_CATALOGUE = require('./plan-catalogue').loadPlanCatalogue();
const SELLER_PLANS = PLAN_CATALOGUE.plans.map((plan) => ({
  id: plan.id,
  name: plan.name,
  priceLabel: formatPrice(plan.priceCents),
  tagline: plan.tagline,
}));

const SELLER_SCREENS = [
  { file: 'seller-dashboard.jpg', title: 'Run your shop', body: 'Sales, orders and visitors for today, on one screen.', alt: 'Seller dashboard showing today’s total sales, a sales chart, orders and visitors' },
  { file: 'seller-orders.jpg', title: 'Ship from your phone', body: 'Every order in one list, with a ship button on each.', alt: 'Seller orders list with paid orders ready to ship' },
  { file: 'seller-store.jpg', title: 'Your store, your link', body: 'A storefront at brandthread.app/u/yourname to share anywhere.', alt: 'A seller’s store profile with follow, share and contact buttons' },
];

const STORE_HOSTS = {
  appStore: ['apps.apple.com', 'itunes.apple.com'],
  playStore: ['play.google.com'],
};

/**
 * Returns a safe https store URL, or null (badge hidden) when the value is
 * missing, malformed, not https, or points at the wrong host.
 */
function resolveStoreUrl(value, kind) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!STORE_HOSTS[kind].includes(url.hostname.toLowerCase())) return null;
  return url.toString();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPrice(cents) {
  const dollars = cents / 100;
  return `$${cents % 100 ? dollars.toFixed(2) : dollars.toFixed(0)}`;
}

function structuredData({ appStoreUrl, playStoreUrl }) {
  const installUrls = [appStoreUrl, playStoreUrl].filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: 'Brandthread',
        url: CANONICAL_ORIGIN,
        logo: LOGO_URL,
        description: DESCRIPTION,
        email: 'support@brandthread.app',
      },
      {
        '@type': 'WebSite',
        name: 'Brandthread',
        url: CANONICAL_ORIGIN,
        description: DESCRIPTION,
        potentialAction: {
          '@type': 'SearchAction',
          target: `${CANONICAL_ORIGIN}${ROUTES.search}?q={search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'MobileApplication',
        name: 'Brandthread',
        applicationCategory: 'ShoppingApplication',
        operatingSystem: 'iOS, Android',
        description: DESCRIPTION,
        url: CANONICAL_ORIGIN,
        ...(installUrls.length ? { installUrl: installUrls.length === 1 ? installUrls[0] : installUrls } : {}),
      },
    ],
  };
}

const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
const SERIF = 'ui-serif,"New York",Georgia,"Times New Roman",serif';
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace';

const CSS = `
:root{--black:#000;--panel:#111;--raise:#1a1a1a;--line:#262626;--line-strong:#3a3a3a;--silver:#c4c4c4;--mute:#8f8f8f;--white:#fff;--radius:24px;--gutter:max(16px,env(safe-area-inset-left))}
*{box-sizing:border-box}
html{background:var(--black);-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--black);color:var(--white);font-family:${SANS};line-height:1.5;-webkit-font-smoothing:antialiased}
img{display:block;max-width:100%}
a{color:inherit}
button{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--white);outline-offset:3px}
[hidden]{display:none!important}
.vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.skip{position:absolute;left:16px;top:-64px;background:var(--white);color:var(--black);padding:10px 16px;border-radius:999px;font-weight:700;text-decoration:none;z-index:10}
.skip:focus{top:max(16px,env(safe-area-inset-top))}
.wrap{width:100%;max-width:1360px;margin:0 auto;padding-left:var(--gutter);padding-right:max(16px,env(safe-area-inset-right))}
.pill,.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 22px;border-radius:999px;font-weight:700;font-size:15px;line-height:1.2;text-decoration:none;white-space:nowrap;border:1px solid var(--white);background:var(--white);color:var(--black)}
.pill:hover{background:var(--silver);border-color:var(--silver)}
.pill.sm{min-height:36px;padding:0 16px;font-size:14px}
.pill.lg{min-height:52px;padding:0 28px;font-size:16px}
.link{font-weight:700;font-size:15px;text-decoration:none;color:var(--white);white-space:nowrap}
.link:hover{text-decoration:underline;text-underline-offset:4px}

/* 1. Hero card */
.hero{padding-top:max(12px,env(safe-area-inset-top))}
.card{position:relative;overflow:hidden;border-radius:var(--radius);background:var(--panel);height:clamp(560px,82svh,760px);isolation:isolate}
.slides{position:absolute;inset:0;margin:0;padding:0;list-style:none;z-index:-1}
.slide{position:absolute;inset:0;display:grid;grid-template-columns:repeat(3,1fr);opacity:0;transition:opacity 1.2s ease;visibility:hidden}
.slide.is-on{opacity:1;visibility:visible}
.slide figure{position:relative;margin:0;overflow:hidden;background:var(--panel)}
.slide img{width:100%;height:100%;object-fit:cover;object-position:50% 18%;filter:brightness(.56)}
.slide figcaption{display:none;position:absolute;right:32px;bottom:30px;text-align:right;font-size:13px;line-height:1.35;color:var(--silver)}
.slide figcaption strong{display:block;color:var(--white);font-weight:700}
.slide figure:last-child figcaption{display:block}
.bar{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:24px 32px}
body>header:not(.hero) .bar{position:static}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:800;font-size:17px;letter-spacing:-.01em}
.brand img{width:32px;height:32px}
.nav{display:flex;align-items:center;gap:20px}
.nav .text{font-size:14px;font-weight:700;text-decoration:none}
.nav .text:hover{text-decoration:underline;text-underline-offset:4px}
.copy{position:absolute;left:32px;right:32px;bottom:80px;max-width:1000px}
h1{margin:0 0 18px;font-size:clamp(40px,7.4vw,108px);line-height:.9;font-weight:900;letter-spacing:-.035em;text-transform:uppercase}
h1 span{display:block;white-space:nowrap}
.lede{margin:0 0 28px;font-size:18px;line-height:1.45;color:var(--white);max-width:30em;text-wrap:pretty}
.hero-actions{display:flex;align-items:center;flex-wrap:wrap;gap:16px 28px}
.dots{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);display:flex;align-items:center;gap:2px}
.dot{width:28px;height:28px;padding:0;border:0;background:none;cursor:pointer;display:grid;place-items:center}
.dot::before{content:"";width:9px;height:9px;border-radius:50%;border:1.5px solid var(--white);box-sizing:border-box}
.dot[aria-current="true"]::before{background:var(--white)}
.pause{width:28px;height:28px;padding:0;margin-left:6px;border:0;background:none;cursor:pointer;display:grid;place-items:center}
.pause::before{content:"";width:8px;height:10px;border-left:3px solid var(--white);border-right:3px solid var(--white);box-sizing:border-box}
.pause[aria-pressed="true"]::before{width:0;height:0;border-style:solid;border-width:6px 0 6px 10px;border-color:transparent transparent transparent var(--white)}

/* 2. Search */
.find{display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:44px;padding-bottom:8px;text-align:center}
.search{position:relative;width:100%;max-width:560px}
.search input{width:100%;height:52px;border-radius:999px;border:1px solid var(--line-strong);background:var(--raise);color:var(--white);font:inherit;font-size:16px;padding:0 56px 0 24px;-webkit-appearance:none;appearance:none}
.search input::placeholder{color:var(--mute)}
.search input:focus{outline:none;border-color:var(--white)}
.search button{position:absolute;right:6px;top:6px;width:40px;height:40px;border-radius:50%;border:0;background:none;cursor:pointer;display:grid;place-items:center}
.search svg{width:20px;height:20px}
.or{margin:0;font-size:14px;font-weight:700;color:var(--silver)}

/* 3. Trending row */
section{padding:72px 0}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:24px}
h2{margin:0;font-size:clamp(28px,3.4vw,44px);line-height:1.05;font-weight:800;letter-spacing:-.03em;text-wrap:balance}
.arrows{display:flex;gap:8px}
.arrow{width:44px;height:44px;border-radius:50%;border:1px solid var(--line-strong);background:var(--black);cursor:pointer;display:grid;place-items:center}
.arrow:hover:not(:disabled){border-color:var(--white)}
.arrow:disabled{cursor:default;color:var(--line-strong)}
.arrow svg{width:18px;height:18px}
.rail{display:grid;grid-auto-flow:column;grid-auto-columns:calc((100% - 48px) / 4);gap:16px;margin:0;padding:0;list-style:none;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain}
.rail::-webkit-scrollbar{display:none}
.rail li{scroll-snap-align:start;min-width:0}
.rail a{display:block;text-decoration:none}
.rail .ph{aspect-ratio:4/5;overflow:hidden;border-radius:12px;background:var(--panel)}
.rail img{width:100%;height:100%;object-fit:cover;object-position:50% 20%;transition:transform .5s ease}
.rail a:hover img{transform:scale(1.03)}
.rail .label{margin:12px 0 2px;font-size:13px;font-weight:700;color:var(--silver);letter-spacing:.02em}
.rail .row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin:0;font-size:15px;line-height:1.35}
.rail .name{font-weight:600;min-width:0}
.rail .price{white-space:nowrap;font-weight:600}
.rail s{margin-left:6px;color:var(--mute);font-weight:400}

/* 4. Label strip */
.labels{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:36px 0}
.labels ul{display:grid;grid-template-columns:repeat(5,1fr);align-items:center;gap:28px 24px;margin:0;padding:0;list-style:none}
.labels li{color:var(--silver);font-size:21px;line-height:1.2;white-space:nowrap;text-align:center}
.w-serif{font-family:${SERIF};font-weight:400;letter-spacing:.02em}
.w-serif-italic{font-family:${SERIF};font-style:italic;font-weight:400}
.w-wide{font-weight:700;text-transform:uppercase;letter-spacing:.22em;font-size:16px!important}
.w-mono{font-family:${MONO};font-weight:400;text-transform:uppercase;letter-spacing:.06em;font-size:16px!important}
.w-heavy{font-weight:900;text-transform:uppercase;letter-spacing:-.03em}

/* 5. For sellers */
.sellers .lead{margin:12px 0 0;max-width:36em;font-size:18px;color:var(--silver);text-wrap:pretty}
.screens{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin:48px 0 0;padding:0;list-style:none}
.screens li{display:flex;flex-direction:column;align-items:center;text-align:center}
.phone{position:relative;width:min(272px,100%);aspect-ratio:600/1300;padding:9px;border-radius:46px;background:var(--black);border:1.5px solid var(--line-strong);box-shadow:0 0 0 5px #161616}
.phone::before{content:"";position:absolute;top:19px;left:50%;transform:translateX(-50%);width:30%;height:22px;border-radius:999px;background:var(--black);z-index:1}
.phone img{width:100%;height:100%;object-fit:cover;object-position:top;border-radius:37px}
.screens h3{margin:28px 0 4px;font-size:22px;line-height:1.2;letter-spacing:-.02em}
.screens p{margin:0;color:var(--silver);font-size:16px;max-width:22em;text-wrap:balance}
.plans{display:grid;grid-template-columns:repeat(3,1fr) auto;align-items:stretch;margin-top:56px;border:1px solid var(--line);border-radius:20px;overflow:hidden}
.plan{padding:22px 24px;border-right:1px solid var(--line)}
.plan h3{margin:0;font-size:15px;font-weight:700;color:var(--silver)}
.plan .amount{margin:4px 0 2px;font-size:30px;font-weight:800;letter-spacing:-.03em;line-height:1.1}
.plan .amount small{font-size:15px;font-weight:600;color:var(--silver);letter-spacing:0}
.plan p{margin:0;font-size:14px;color:var(--mute);text-wrap:balance}
.plans-cta{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:22px 28px;background:var(--panel)}
.plans-cta p{margin:0;font-size:13px;color:var(--mute);white-space:nowrap}

/* 6. Apps + footer */
.apps{text-align:center;border-top:1px solid var(--line)}
.apps h2{margin-bottom:24px}
.badges{display:flex;justify-content:center;flex-wrap:wrap;gap:12px;margin:0;padding:0;list-style:none}
.badge{display:flex;flex-direction:column;justify-content:center;align-items:center;width:172px;height:56px;padding:0 18px;border:1px solid var(--line-strong);border-radius:12px;background:var(--black);text-decoration:none;line-height:1.1;text-align:center}
.badge:hover{border-color:var(--white)}
.badge small{font-size:12px;color:var(--silver)}
.badge strong{font-size:19px;font-weight:700;letter-spacing:-.01em}
footer{border-top:1px solid var(--line);padding:32px 0 calc(32px + env(safe-area-inset-bottom))}
.foot{display:flex;flex-wrap:wrap;gap:16px 32px;align-items:center;justify-content:space-between}
.foot .brand{font-size:15px}
.foot .brand img{width:24px;height:24px}
.foot nav{display:flex;flex-wrap:wrap;gap:4px 24px}
.foot a{color:var(--silver);text-decoration:none;font-size:14px;padding:6px 0}
.foot nav a:hover{color:var(--white);text-decoration:underline}
.foot p{margin:0;color:var(--mute);font-size:14px}

@media (max-width:1000px){
.rail{grid-auto-columns:calc((100% - 32px) / 3)}
.plans{grid-template-columns:repeat(3,1fr)}
.plans-cta{grid-column:1/-1;flex-direction:row;justify-content:space-between;border-top:1px solid var(--line)}
}
@media (max-width:760px){
:root{--radius:20px}
.hero{padding-left:8px;padding-right:8px}
.hero .wrap{padding:0}
.card{height:clamp(560px,78svh,700px)}
.slide{grid-template-columns:1fr}
.slide figure+figure{display:none}
.slide figure:last-child figcaption{display:none}
.slide img{object-position:50% 12%}
.bar{padding:16px 18px}
.nav{gap:16px}
.nav .sellers-link{display:none}
.copy{left:20px;right:20px;bottom:64px}
h1{font-size:clamp(34px,10.2vw,64px);margin-bottom:14px}
.lede{font-size:16px;margin-bottom:22px}
.dots{bottom:14px}
.find{padding-top:28px}
section{padding:56px 0}
.head{margin-bottom:18px}
.rail{grid-auto-columns:68%;gap:12px;margin-right:calc(-1 * var(--gutter));padding-right:var(--gutter);scroll-padding-left:0}
.arrows{display:none}
.labels{padding:28px 0}
.labels ul{grid-template-columns:repeat(2,1fr);gap:22px 12px}
.labels li{font-size:18px}
.screens{grid-template-columns:1fr;gap:48px}
.phone{width:min(248px,72%)}
.plans{grid-template-columns:1fr}
.plan{border-right:0;border-bottom:1px solid var(--line);display:grid;grid-template-columns:1fr auto;column-gap:16px;align-items:baseline}
.plan h3{grid-column:1}
.plan .amount{grid-column:2;grid-row:1/3;margin:0;align-self:center}
.plan p{grid-column:1}
.plans-cta{flex-direction:column;align-items:stretch;text-align:center;border-top:0}
.foot{flex-direction:column;align-items:flex-start}
.foot nav{display:grid;grid-template-columns:1fr 1fr;width:100%;gap:4px 16px}
}
@media (max-width:400px){
.brand span{display:none}
}
@media (prefers-reduced-motion:reduce){
html{scroll-behavior:auto}
*{transition:none!important;animation:none!important}
}
`.trim();

// Pricing section additions (scripts/pricing-page.js). The header link only
// shows where the header has room, so the existing phone header is unchanged.
const LANDING_PRICING_CSS = `
${PRICING_CSS}
.nav a.text.pricing-link{display:none}
@media (min-width:640px){.nav a.text.pricing-link{display:inline}}
.rail .price{display:inline;margin:0}
`.trim();
const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';
const ARROW_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const ARROW_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

function lookSrc(id) {
  return `/${ASSET_DIR}/look-${id}.jpg`;
}

function heroSlide(ids, index) {
  const on = index === 0;
  const figures = ids
    .map((id, i) => {
      const look = LOOKS[id];
      // Only the first photo is the LCP image; the rest load lazily.
      const loading = on && i === 0 ? 'fetchpriority="high"' : 'loading="lazy"';
      return `<figure><img src="${lookSrc(id)}" alt="" width="${LOOK_SIZE.width}" height="${LOOK_SIZE.height}" ${loading} decoding="async" /><figcaption><strong>${escapeHtml(look.brand)}</strong>${escapeHtml(look.piece)}</figcaption></figure>`;
    })
    .join('');
  const label = ids.map((id) => `${LOOKS[id].brand} ${LOOKS[id].piece}`).join(', ');
  return `<li class="slide${on ? ' is-on' : ''}" role="group" aria-roledescription="slide" aria-label="Look ${index + 1} of ${HERO_SLIDES.length}: ${escapeHtml(label)}"${on ? '' : ' aria-hidden="true"'}>${figures}</li>`;
}

function trendingItem(id) {
  const look = LOOKS[id];
  // Demo pieces only exist in the app's preview catalogue, so they open a
  // search for their label rather than a product page.
  const href = `${ROUTES.search}?q=${encodeURIComponent(look.brand)}`;
  const was = look.compareAtCents ? `<s>${formatPrice(look.compareAtCents)}</s>` : '';
  return `<li><a href="${escapeHtml(href)}"><div class="ph"><img src="${lookSrc(id)}" alt="${escapeHtml(`${look.piece} by ${look.brand}`)}" width="${LOOK_SIZE.width}" height="${LOOK_SIZE.height}" loading="lazy" decoding="async" /></div><p class="label">${escapeHtml(look.brand)}</p><p class="row"><span class="name">${escapeHtml(look.piece)}</span><span class="price">${formatPrice(look.priceCents)}${was}</span></p></a></li>`;
}

function badge(url, small, label) {
  return `<li><a class="badge" href="${escapeHtml(url)}" rel="noopener"><small>${small}</small><strong>${label}</strong></a></li>`;
}

// Client-side behaviour. ES5 so it runs on every browser the page targets.
function inlineScript() {
  return `
(function(){
  var links=document.querySelectorAll('a[data-flow]');
  for(var i=0;i<links.length;i++){
    links[i].addEventListener('click',function(){
      try{localStorage.setItem(${JSON.stringify(PENDING_FLOW_KEY)},this.getAttribute('data-flow'));}catch(e){}
    });
  }

  var reduce=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var slides=document.querySelectorAll('.slide'),dots=document.querySelectorAll('.dot'),pause=document.querySelector('.pause');
  var current=0,timer=null,paused=reduce;
  function show(n){
    if(n===current)return;
    slides[current].classList.remove('is-on');slides[current].setAttribute('aria-hidden','true');dots[current].setAttribute('aria-current','false');
    current=n;
    slides[n].classList.add('is-on');slides[n].removeAttribute('aria-hidden');dots[n].setAttribute('aria-current','true');
  }
  function stop(){if(timer){clearInterval(timer);timer=null;}}
  function start(){stop();if(!paused&&!document.hidden&&slides.length>1)timer=setInterval(function(){show((current+1)%slides.length);},6000);}
  for(var d=0;d<dots.length;d++){(function(n){dots[n].addEventListener('click',function(){show(n);start();});})(d);}
  if(pause){
    if(reduce){pause.hidden=true;}
    pause.addEventListener('click',function(){
      paused=!paused;pause.setAttribute('aria-pressed',paused?'true':'false');
      pause.setAttribute('aria-label',paused?'Play slideshow':'Pause slideshow');start();
    });
  }
  document.addEventListener('visibilitychange',start);
  start();

  var rail=document.querySelector('.rail'),prev=document.querySelector('.arrow.prev'),next=document.querySelector('.arrow.next');
  function arrows(){
    if(!rail||!prev)return;
    prev.disabled=rail.scrollLeft<=2;
    next.disabled=rail.scrollLeft+rail.clientWidth>=rail.scrollWidth-2;
  }
  function page(dir){rail.scrollBy({left:dir*rail.clientWidth,behavior:reduce?'auto':'smooth'});}
  if(rail&&prev){
    prev.addEventListener('click',function(){page(-1);});
    next.addEventListener('click',function(){page(1);});
    rail.addEventListener('scroll',arrows,{passive:true});
    window.addEventListener('resize',arrows);
    arrows();
  }

  // Live trending items replace the demo row only when there are enough of
  // them to fill it; any failure keeps the static row.
  function money(c){return '$'+(c%100?(c/100).toFixed(2):String(c/100));}
  function shape(p){
    if(!p||typeof p.id!=='string'||typeof p.name!=='string'||!p.name)return null;
    var img=p.images&&p.images[0];
    if(typeof img!=='string'||!(/^https:\\/\\//.test(img)||/^\\/(?!\\/)/.test(img)))return null;
    var price=null,vs=p.variants||[];
    for(var i=0;i<vs.length;i++){var c=vs[i]&&vs[i].priceCents;if(typeof c==='number'&&c>0&&(price===null||c<price))price=c;}
    if(price===null)return null;
    return {href:${JSON.stringify(ROUTES.product)}+encodeURIComponent(p.id),img:img,name:p.name,label:typeof p.sellerDisplayName==='string'?p.sellerDisplayName:'',price:money(price)};
  }
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function render(items){
    var frag=document.createDocumentFragment();
    for(var i=0;i<items.length;i++){
      var it=items[i],li=el('li'),a=el('a'),ph=el('div','ph'),im=el('img'),row=el('p','row');
      a.href=it.href;im.src=it.img;im.alt=it.label?it.name+' by '+it.label:it.name;im.width=${LOOK_SIZE.width};im.height=${LOOK_SIZE.height};im.loading='lazy';im.decoding='async';
      ph.appendChild(im);a.appendChild(ph);
      if(it.label)a.appendChild(el('p','label',it.label));
      row.appendChild(el('span','name',it.name));row.appendChild(el('span','price',it.price));a.appendChild(row);
      li.appendChild(a);frag.appendChild(li);
    }
    rail.textContent='';rail.appendChild(frag);rail.scrollLeft=0;arrows();
  }
  if(rail&&window.fetch){
    fetch(${JSON.stringify(TRENDING_ENDPOINT)},{credentials:'omit',headers:{accept:'application/json'}})
      .then(function(r){return r.ok?r.json():null;})
      .then(function(data){
        var list=(data&&data.products)||[],items=[];
        for(var i=0;i<list.length;i++){var s=shape(list[i]);if(s)items.push(s);}
        if(items.length>=4)render(items);
      })
      .catch(function(){});
  }
})();
`.trim();
}

function renderLandingHtml({ appStoreUrl = null, playStoreUrl = null, pricing = null } = {}) {
  const appStore = resolveStoreUrl(appStoreUrl, 'appStore');
  const playStore = resolveStoreUrl(playStoreUrl, 'playStore');
  const badges = [
    appStore ? badge(appStore, 'Download on the', 'App Store') : '',
    playStore ? badge(playStore, 'Get it on', 'Google Play') : '',
  ].filter(Boolean);
  const appsBlock = badges.length
    ? `<section class="apps" aria-labelledby="apps-title">
    <div class="wrap">
      <h2 id="apps-title">Get the app.</h2>
      <ul class="badges" aria-label="Download the app">${badges.join('')}</ul>
    </div>
  </section>`
    : '';
  const ld = JSON.stringify(structuredData({ appStoreUrl: appStore, playStoreUrl: playStore })).replace(/</g, '\\u003c');
  const firstHero = lookSrc(HERO_SLIDES[0][0]);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}" />
<meta name="theme-color" content="#000000" />
<meta name="color-scheme" content="dark" />
<link rel="canonical" href="${CANONICAL_ORIGIN}/" />
<link rel="icon" type="image/png" href="/brandthread-logo.png" />
<link rel="preload" href="${firstHero}" as="image" fetchpriority="high" />
<meta name="robots" content="index,follow" />
<meta property="og:site_name" content="Brandthread" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${CANONICAL_ORIGIN}/" />
<meta property="og:title" content="${TITLE}" />
<meta property="og:description" content="${DESCRIPTION}" />
<meta property="og:image" content="${LOGO_URL}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${TITLE}" />
<meta name="twitter:description" content="${DESCRIPTION}" />
<meta name="twitter:image" content="${LOGO_URL}" />
<script type="application/ld+json">${ld}</script>
<style>${CSS}${pricing ? `\n${LANDING_PRICING_CSS}` : ''}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="hero">
  <div class="wrap">
    <div class="card" aria-roledescription="carousel" aria-label="New looks from independent labels">
      <ul class="slides">${HERO_SLIDES.map(heroSlide).join('')}</ul>
      <div class="bar">
        <a class="brand" href="/welcome" aria-label="Brandthread home"><img src="/brandthread-logo.png" alt="" width="32" height="32" /><span>Brandthread</span></a>
        <nav class="nav" aria-label="Account">
          ${pricing ? `<a class="text pricing-link" href="${PRICING_PATH}">Pricing</a>` : ''}
          <a class="text" href="${ROUTES.signIn}">Log in</a>
          <a class="pill sm" href="${ROUTES.signUp}">Create account</a>
          <a class="text sellers-link" href="#sellers">For sellers</a>
        </nav>
      </div>
      <div class="copy">
        <h1><span>Shop the drop.</span> <span>Sell your own.</span></h1>
        <p class="lede">New pieces from independent streetwear labels, and a store of your own when you are ready to sell.</p>
        <div class="hero-actions">
          <a class="pill lg" href="${ROUTES.signUp}" data-flow="buyer">Start shopping</a>
          <a class="link" href="${ROUTES.signUp}" data-flow="seller">Start selling <span aria-hidden="true">&rarr;</span></a>
        </div>
      </div>
      <div class="dots">
        ${HERO_SLIDES.map((_, i) => `<button class="dot" type="button" aria-label="Show look ${i + 1}" aria-current="${i === 0}"></button>`).join('')}
        <button class="pause" type="button" aria-pressed="false" aria-label="Pause slideshow"></button>
      </div>
    </div>
  </div>
</header>
<main id="main">
  <div class="wrap find">
    <form class="search" role="search" action="${ROUTES.search}" method="get">
      <label class="vh" for="q">Search Brandthread</label>
      <input id="q" name="q" type="search" placeholder="Search brands, pieces, drops" autocomplete="off" enterkeyhint="search" required />
      <button type="submit" aria-label="Search">${SEARCH_ICON}</button>
    </form>
    <p class="or">or</p>
    <a class="pill" href="${ROUTES.signUp}" data-flow="seller">Start selling</a>
  </div>

  <section aria-labelledby="trending-title">
    <div class="wrap">
      <div class="head">
        <h2 id="trending-title">Trending now</h2>
        <div class="arrows">
          <button class="arrow prev" type="button" aria-label="Previous items" aria-controls="trending">${ARROW_LEFT}</button>
          <button class="arrow next" type="button" aria-label="Next items" aria-controls="trending">${ARROW_RIGHT}</button>
        </div>
      </div>
      <ul class="rail" id="trending">${TRENDING_FALLBACK.map(trendingItem).join('')}</ul>
    </div>
  </section>

  <div class="labels" role="region" aria-label="Labels">
    <div class="wrap">
      <ul>${LABELS.map((l) => `<li class="w-${l.style}">${escapeHtml(l.name)}</li>`).join('')}</ul>
    </div>
  </div>

  <section class="sellers" id="sellers" aria-labelledby="sellers-title">
    <div class="wrap">
      <h2 id="sellers-title">Your label, run from your phone.</h2>
      <p class="lead">Storefront, orders, payouts and design tools in one app. Every plan starts with a ${pricing ? pricing.trialDays : PLAN_CATALOGUE.trialDays}-day free trial.</p>
      <ul class="screens">
        ${SELLER_SCREENS.map((s) => `<li><div class="phone"><img src="/${ASSET_DIR}/${s.file}" alt="${escapeHtml(s.alt)}" width="${SCREEN_SIZE.width}" height="${SCREEN_SIZE.height}" loading="lazy" decoding="async" /></div><h3>${s.title}</h3><p>${s.body}</p></li>`).join('\n        ')}
      </ul>
      ${pricing ? '' : `<div class="plans">
        ${SELLER_PLANS.map((p) => `<div class="plan"><h3>${p.name}</h3><p class="amount">${p.priceLabel}<small>/mo</small></p><p>${p.tagline}</p></div>`).join('\n        ')}
        <div class="plans-cta"><a class="pill" href="${ROUTES.signUp}" data-flow="seller">Start selling</a><p>5-day free trial</p></div>
      </div>`}
    </div>
  </section>

  ${pricing ? renderLandingPricingSection(pricing) : ''}
  ${appsBlock}
</main>
<footer>
  <div class="wrap foot">
    <a class="brand" href="/welcome" aria-label="Brandthread home"><img src="/brandthread-logo.png" alt="" width="24" height="24" loading="lazy" /><span>Brandthread</span></a>
    <nav aria-label="Legal and support">
      <a href="${ROUTES.privacy}">Privacy</a>
      <a href="${ROUTES.terms}">Terms</a>
      <a href="${ROUTES.guidelines}">Community guidelines</a>
      <a href="${ROUTES.support}">Support</a>${pricing ? `\n      <a href="${PRICING_PATH}">Pricing</a>` : ''}
    </nav>
    <p>&copy; Brandthread</p>
  </div>
</footer>
<script>
${inlineScript()}${pricing ? `\n${trialDateScript(pricing)}` : ''}
</script>
</body>
</html>
`;
}

/**
 * Writes landing.html and its images into the web export. Store URLs come
 * from build-time env; a missing or invalid one hides its badge.
 */
function writeLandingPage(outputDir, projectRoot, env = process.env) {
  const fs = require('fs');
  const path = require('path');
  const assetOut = path.join(outputDir, ASSET_DIR);
  fs.mkdirSync(assetOut, { recursive: true });
  for (const [name, source] of Object.entries(ASSET_SOURCES)) {
    fs.copyFileSync(path.join(projectRoot, source), path.join(assetOut, name));
  }
  // Plan prices, fees and trial terms come from the app/server catalogue.
  // If it cannot be read the landing page ships without pricing (and no
  // /pricing page) rather than with a wrong number.
  let pricing = null;
  try {
    pricing = require('./plan-catalogue').loadPlanCatalogue();
  } catch (err) {
    console.warn(`Pricing skipped: ${err && err.message ? err.message : err}`);
  }
  const html = renderLandingHtml({
    appStoreUrl: env.EXPO_PUBLIC_APP_STORE_URL,
    playStoreUrl: env.EXPO_PUBLIC_PLAY_STORE_URL,
    pricing,
  });
  fs.writeFileSync(path.join(outputDir, 'landing.html'), html);
  const pricingFile = path.join(outputDir, PRICING_FILE);
  if (pricing) {
    fs.writeFileSync(pricingFile, renderPricingHtml(pricing, {
      CANONICAL_ORIGIN, LOGO_URL, BASE_CSS: CSS, ROUTES, PENDING_FLOW_KEY,
    }));
  } else {
    fs.rmSync(pricingFile, { force: true });
  }
  return html;
}

module.exports = {
  writeLandingPage,
  BASE_CSS: CSS,
  LOGO_URL,
  PRICING_FILE,
  ASSET_DIR,
  ASSET_SOURCES,
  CANONICAL_ORIGIN,
  DESCRIPTION,
  HERO_SLIDES,
  PENDING_FLOW_KEY,
  ROUTES,
  SELLER_PLANS,
  TITLE,
  TRENDING_ENDPOINT,
  renderLandingHtml,
  resolveStoreUrl,
};
