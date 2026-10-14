/**
 * Static marketing landing page for brandthread.app.
 *
 * Pure string rendering, no app code: plain HTML and CSS plus one small inline
 * script that remembers the chosen signup side (and the typed email), starts
 * the app capture unless the visitor prefers reduced motion, and fills in the
 * live marketplace numbers from the public stats endpoint (the row stays
 * hidden if that request fails). `scripts/build-web.js` writes the result to
 * `static-build/landing.html`, its images and video to
 * `static-build/landing-assets/`, and `server/serve.js` serves it for
 * signed-out visits to "/" and for "/welcome". The Expo app itself is not
 * touched, apart from onboarding reading the prefilled email.
 */

const CANONICAL_ORIGIN = 'https://brandthread.app';
const LOGO_URL = `${CANONICAL_ORIGIN}/brandthread-logo.png`;
const TITLE = 'Brandthread | Shop, sell & design streetwear';
const DESCRIPTION =
  'Brandthread is where independent labels drop new pieces, sellers run their whole shop, and buyers discover streetwear brands they will actually wear.';

// The app's own onboarding reads this key to resume at the account-creation
// step for the chosen side (app/onboarding.tsx PENDING_FLOW_KEY). Writing it
// lets "Start selling" skip the Buyer/Seller question without changing the app.
const PENDING_FLOW_KEY = 'onboarding_pending_flow';
// Read once by app/onboarding.tsx to prefill the sign-up email. Handed over in
// storage rather than the URL so addresses never land in server logs.
const PREFILL_EMAIL_KEY = 'onboarding_prefill_email';

// Real in-app routes (Expo Router): onboarding creates the account, sign-in
// is for returning users, discover and buyer-search are open to guests, the
// legal pages are public.
const ROUTES = {
  signUp: '/onboarding',
  signIn: '/sign-in',
  shop: '/discover',
  pricing: '/plans',
  search: '/buyer-search',
  privacy: '/privacy',
  terms: '/terms',
  guidelines: '/community-guidelines',
  support: 'mailto:support@brandthread.app',
};

// Same-origin in production (build-web.js points the app at brandthread.app).
const STATS_ENDPOINT = '/api/v1/public/stats';
// Where the QR code points when no App Store URL is configured.
const QR_FALLBACK_URL = `${CANONICAL_ORIGIN}/welcome`;

const ASSET_DIR = 'landing-assets';
// Logical name -> source file (relative to the mobile project). Published
// with a content hash in the file name because static files are served
// `immutable` for a year.
const LANDING_ASSETS = {
  'app-capture.mp4': 'assets/landing/app-capture.mp4',
  'app-capture.webm': 'assets/landing/app-capture.webm',
  'app-capture-poster.jpg': 'assets/landing/app-capture-poster.jpg',
};
const CAPTURE_SIZE = { width: 540, height: 1168 };

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

/**
 * QR code as one SVG path (black modules on white, 2-module quiet zone),
 * computed at build time with the `qrcode` package: no network, no script.
 */
function qrSvg(text) {
  const QRCode = require('qrcode');
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = modules.size;
  const quiet = 2;
  let d = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules.get(y, x)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  const box = size + quiet * 2;
  return `<svg class="qr" viewBox="0 0 ${box} ${box}" width="88" height="88" shape-rendering="crispEdges" role="img" aria-label="QR code to download the Brandthread app"><rect width="${box}" height="${box}" fill="#ffffff"/><path fill="#000000" d="${d}"/></svg>`;
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

// The phone's edge, drawn as stacked solid offsets (a slab, not a glow).
const PHONE_DEPTH = Array.from({ length: 14 }, (_, i) => {
  const grey = Math.round(0x6a - i * 4).toString(16).padStart(2, '0');
  return `${i + 1}px ${i + 1}px 0 #${grey}${grey}${grey}`;
}).join(',');

const CSS = `
:root{--black:#000;--ink:#0a0a0a;--panel:#111;--field:#141414;--line:#2a2a2a;--silver:#c7c7c7;--mute:#9a9a9a;--white:#fff}
*{box-sizing:border-box}
html{background:var(--black);-webkit-text-size-adjust:100%}
body{margin:0;background:var(--black);color:var(--white);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:inherit}
:focus-visible{outline:2px solid var(--white);outline-offset:3px}
[hidden]{display:none!important}
.vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.skip{position:absolute;left:16px;top:-64px;background:var(--white);color:var(--black);padding:10px 16px;border-radius:8px;font-weight:600;text-decoration:none;z-index:10}
.skip:focus{top:max(16px,env(safe-area-inset-top))}
.wrap{width:100%;max-width:1160px;margin:0 auto;padding-left:max(20px,env(safe-area-inset-left));padding-right:max(20px,env(safe-area-inset-right))}
header{padding-top:env(safe-area-inset-top);border-bottom:1px solid var(--line)}
.bar{display:flex;align-items:center;gap:32px;height:68px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:700;letter-spacing:-.01em;font-size:18px;flex:none}
.brand img{width:36px;height:36px;display:block}
.links{display:flex;gap:24px}
.links a{font-size:15px;font-weight:600;color:var(--silver);text-decoration:none}
.links a:hover{color:var(--white)}
.nav{display:flex;align-items:center;gap:12px;margin-left:auto}
.search{position:relative;width:200px}
.search input{width:100%;height:36px;border-radius:999px;border:1px solid var(--line);background:var(--field);color:var(--white);font:inherit;font-size:14px;padding:0 14px 0 36px;-webkit-appearance:none;appearance:none}
.search input::placeholder{color:var(--mute)}
.search input:focus{outline:none;border-color:var(--white)}
.search svg{position:absolute;left:12px;top:10px;width:16px;height:16px;color:var(--mute);pointer-events:none}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 24px;border-radius:12px;font-weight:700;font-size:16px;line-height:1.2;text-align:center;text-decoration:none;border:1px solid var(--white);cursor:pointer;font-family:inherit;white-space:nowrap}
.btn.solid{background:var(--white);color:var(--black)}
.btn.solid:hover{background:var(--silver);border-color:var(--silver)}
.btn.ghost{background:var(--black);color:var(--white);border-color:var(--line)}
.btn.ghost:hover{border-color:var(--white)}
.btn.small{min-height:36px;padding:0 16px;font-size:14px;border-radius:999px}
.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center;padding-top:56px;padding-bottom:72px}
h1{font-size:64px;text-wrap:balance;line-height:1.04;letter-spacing:-.035em;margin:0 0 20px;font-weight:700}
.lede{font-size:18px;color:var(--silver);max-width:34em;margin:0 0 32px;text-wrap:pretty}
.signup{display:flex;gap:10px;width:100%;max-width:480px}
.signup input{flex:1;min-width:0;height:52px;border-radius:12px;border:1px solid var(--line);background:var(--field);color:var(--white);font:inherit;font-size:16px;padding:0 16px;-webkit-appearance:none;appearance:none}
.signup input::placeholder{color:var(--mute)}
.signup input:focus{outline:none;border-color:var(--white)}
.sell-link{display:inline-block;margin-top:14px;font-size:15px;font-weight:600;color:var(--silver);text-decoration:none}
.sell-link:hover{color:var(--white);text-decoration:underline;text-underline-offset:4px}
.qr-block{display:flex;align-items:center;gap:16px;margin-top:40px}
.qr-block .qr{display:block;width:88px;height:88px;border-radius:10px;flex:none}
.qr-block p{margin:0;font-size:16px;font-weight:600}
.stage{display:flex;justify-content:center;padding:12px 24px 24px 0}
.device{width:min(300px,78%);aspect-ratio:9/18.5;border-radius:44px;padding:10px;background:linear-gradient(145deg,#e8e8e8,#7a7a7a 55%,#d6d6d6);transform:rotate(7deg);box-shadow:${PHONE_DEPTH}}
.screen{height:100%;border-radius:35px;overflow:hidden;background:var(--black);-webkit-mask-image:-webkit-radial-gradient(white,black)}
.screen video{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
.panel{border:1px solid var(--line);border-radius:24px;background:var(--panel);padding:28px 40px;margin-bottom:80px}
.trust{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,auto);justify-content:space-between;gap:16px 24px}
.trust li{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;color:var(--silver)}
.trust svg{width:22px;height:22px;flex:none;color:var(--white)}
.numbers{border-top:1px solid var(--line);margin-top:28px;padding-top:24px;text-align:center}
.numbers > p{margin:0 0 20px;font-size:14px;color:var(--mute)}
.numbers dl{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:0}
.numbers dl div{display:flex;flex-direction:column-reverse}
.numbers dt{font-size:14px;color:var(--silver)}
.numbers dd{margin:0;font-size:44px;line-height:1.1;font-weight:700;letter-spacing:-.03em}
.badges{display:none;flex-wrap:wrap;gap:12px;margin:24px 0 0;padding:0;list-style:none}
.badge{display:flex;flex-direction:column;align-items:center;justify-content:center;width:160px;min-height:52px;padding:8px 16px;text-align:center;border:1px solid var(--line);border-radius:12px;background:var(--panel);text-decoration:none;line-height:1.15}
.badge:hover{border-color:var(--white)}
.badge small{font-size:12px;color:var(--mute);font-weight:400}
.badge strong{font-size:16px;font-weight:700}
footer{border-top:1px solid var(--line);padding:40px 0 calc(40px + env(safe-area-inset-bottom))}
.foot{display:flex;flex-wrap:wrap;gap:16px 32px;align-items:center;justify-content:space-between}
.foot nav{display:flex;flex-wrap:wrap;gap:8px 24px}
.foot a{color:var(--silver);text-decoration:none;font-size:14px;padding:6px 0}
.foot a:hover{color:var(--white);text-decoration:underline}
.foot p{margin:0;color:var(--mute);font-size:14px}
@media (max-width:1000px){
.links,.search{display:none}
}
@media (max-width:860px){
h1{font-size:48px}
.hero{grid-template-columns:1fr;gap:48px;padding-top:32px;padding-bottom:56px}
.stage{padding:0}
.device{width:min(260px,70%);transform:none;box-shadow:none}
.trust{grid-template-columns:repeat(2,minmax(0,1fr))}
.panel{padding:24px 20px;margin-bottom:64px}
}
@media (max-width:760px){
/* A QR code can't be scanned from the phone showing it: badges instead. */
.qr-block{display:none}
.badges{display:flex}
}
@media (max-width:480px){
h1{font-size:40px}
.signup{flex-direction:column}
.signup input{flex:none;width:100%}
.signup .btn{width:100%}
.nav{gap:8px}
.brand span{display:none}
.trust{grid-template-columns:1fr}
.numbers dl{grid-template-columns:1fr;gap:20px}
.numbers dd{font-size:40px}
.foot nav{display:grid;grid-template-columns:1fr 1fr;width:100%;gap:4px 16px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`.trim();

const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';

// Plain monochrome line glyphs (no brand marks).
const GLYPHS = {
  wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h12A1.5 1.5 0 0 1 19 6.5V8"/><rect x="3" y="8" width="18" height="11" rx="2.5"/><circle cx="16.5" cy="13.5" r="1.2"/>',
  split: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12h8.5"/><path d="M12 12 6 18"/>',
  returns: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5"/><path d="M12 12v9"/>',
};
const TRUST_ITEMS = [
  { glyph: 'wallet', label: 'Apple Pay' },
  { glyph: 'split', label: 'Klarna & Afterpay where offered' },
  { glyph: 'returns', label: 'Free returns where offered' },
  { glyph: 'box', label: 'Ships from the brand' },
];
const STAT_LABELS = [
  ['brands', 'Brands'],
  ['piecesListed', 'Pieces listed'],
  ['ordersShipped', 'Orders shipped'],
];

function glyph(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[name]}</svg>`;
}

function badge(url, small, label) {
  return `<li><a class="badge" href="${escapeHtml(url)}" rel="noopener"><small>${small}</small><strong>${label}</strong></a></li>`;
}

function defaultAssetUrls() {
  return Object.fromEntries(Object.keys(LANDING_ASSETS).map((name) => [name, `/${ASSET_DIR}/${name}`]));
}

function renderLandingHtml({ appStoreUrl = null, playStoreUrl = null, assetUrls = defaultAssetUrls() } = {}) {
  const appStore = resolveStoreUrl(appStoreUrl, 'appStore');
  const playStore = resolveStoreUrl(playStoreUrl, 'playStore');
  const badges = [
    appStore ? badge(appStore, 'Download on the', 'App Store') : '',
    playStore ? badge(playStore, 'Get it on', 'Google Play') : '',
  ].filter(Boolean);
  const badgeBlock = badges.length ? `<ul class="badges" aria-label="Download the app">${badges.join('')}</ul>` : '';
  const qrTarget = appStore || QR_FALLBACK_URL;
  const ld = JSON.stringify(structuredData({ appStoreUrl: appStore, playStoreUrl: playStore })).replace(/</g, '\\u003c');

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
<link rel="preload" href="${assetUrls['app-capture-poster.jpg']}" as="image" fetchpriority="high" />
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
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header>
  <div class="wrap bar">
    <a class="brand" href="/welcome" aria-label="Brandthread home"><img src="/brandthread-logo.png" alt="" width="36" height="36" /><span>Brandthread</span></a>
    <nav class="links" aria-label="Main">
      <a href="${ROUTES.shop}">Shop</a>
      <a href="${ROUTES.signUp}" data-flow="seller">Sell</a>
      <a href="${ROUTES.pricing}">Pricing</a>
    </nav>
    <div class="nav">
      <form class="search" role="search" action="${ROUTES.search}" method="get">
        <label class="vh" for="q">Search Brandthread</label>
        ${SEARCH_ICON}
        <input id="q" name="q" type="search" placeholder="Search" autocomplete="off" enterkeyhint="search" />
      </form>
      <a class="btn ghost small" href="${ROUTES.signIn}">Log in</a>
      <a class="btn solid small" href="${ROUTES.signUp}">Sign up</a>
    </div>
  </div>
</header>
<main id="main">
  <div class="wrap hero">
    <div>
      <h1>Shop, sell and design streetwear.</h1>
      <p class="lede">Brandthread is where independent labels drop new pieces, sellers run their whole shop, and buyers discover streetwear brands they will actually wear.</p>
      <form class="signup" action="${ROUTES.signUp}" method="get" data-flow="buyer">
        <label class="vh" for="signup-email">Email address</label>
        <input id="signup-email" type="email" placeholder="you@email.com" autocomplete="email" inputmode="email" required />
        <button class="btn solid" type="submit">Get started</button>
      </form>
      <a class="sell-link" href="${ROUTES.signUp}" data-flow="seller">Start selling <span aria-hidden="true">&rarr;</span></a>
      <div class="qr-block">
        ${qrSvg(qrTarget)}
        <p>Download the Brandthread app</p>
      </div>
      ${badgeBlock}
    </div>
    <div class="stage">
      <div class="device">
        <div class="screen">
          <video muted loop playsinline preload="none" poster="${assetUrls['app-capture-poster.jpg']}" width="${CAPTURE_SIZE.width}" height="${CAPTURE_SIZE.height}" aria-label="The Brandthread app: swiping the Threads feed, opening a product and adding it to the bag" data-capture>
            <source src="${assetUrls['app-capture.mp4']}" type="video/mp4" />
            <source src="${assetUrls['app-capture.webm']}" type="video/webm" />
          </video>
        </div>
      </div>
    </div>
  </div>

  <div class="wrap">
    <section class="panel" aria-label="Why shop on Brandthread">
      <ul class="trust">
        ${TRUST_ITEMS.map((t) => `<li>${glyph(t.glyph)}<span>${escapeHtml(t.label)}</span></li>`).join('\n        ')}
      </ul>
      <div class="numbers" data-stats hidden>
        <p>Live on Brandthread right now</p>
        <dl>
          ${STAT_LABELS.map(([key, label]) => `<div><dt>${label}</dt><dd data-stat="${key}"></dd></div>`).join('\n          ')}
        </dl>
      </div>
    </section>
  </div>
</main>
<footer>
  <div class="wrap foot">
    <p>&copy; Brandthread</p>
    <nav aria-label="Legal and support">
      <a href="${ROUTES.privacy}">Privacy</a>
      <a href="${ROUTES.terms}">Terms</a>
      <a href="${ROUTES.guidelines}">Community guidelines</a>
      <a href="${ROUTES.support}">Support</a>
    </nav>
  </div>
</footer>
<script>
(function(){
  function remember(key,value){try{localStorage.setItem(key,value);}catch(e){}}
  var links=document.querySelectorAll('a[data-flow]');
  for(var i=0;i<links.length;i++){
    links[i].addEventListener('click',function(){remember(${JSON.stringify(PENDING_FLOW_KEY)},this.getAttribute('data-flow'));});
  }

  // The email rides to onboarding in storage, never in the URL.
  var form=document.querySelector('form.signup');
  if(form){
    form.addEventListener('submit',function(e){
      e.preventDefault();
      var email=form.querySelector('input').value.trim();
      remember(${JSON.stringify(PENDING_FLOW_KEY)},form.getAttribute('data-flow'));
      if(email)remember(${JSON.stringify(PREFILL_EMAIL_KEY)},email);
      location.href=form.getAttribute('action');
    });
  }

  // The capture plays only when motion is welcome; otherwise its poster (a
  // still of the same app screen) stays.
  var video=document.querySelector('video[data-capture]');
  var motion=window.matchMedia?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
  function syncVideo(){
    if(!video)return;
    if(motion&&motion.matches){video.pause();return;}
    video.preload='auto';
    var p=video.play();
    if(p&&p.catch)p.catch(function(){});
  }
  syncVideo();
  if(motion){
    if(motion.addEventListener)motion.addEventListener('change',syncVideo);
    else if(motion.addListener)motion.addListener(syncVideo);
  }

  // Real counts only. Anything missing, zero or malformed keeps the row hidden.
  var stats=document.querySelector('[data-stats]');
  if(stats&&window.fetch){
    fetch(${JSON.stringify(STATS_ENDPOINT)},{credentials:'omit',headers:{accept:'application/json'}})
      .then(function(r){return r.ok?r.json():null;})
      .then(function(data){
        if(!data)return;
        var cells=stats.querySelectorAll('[data-stat]');
        for(var i=0;i<cells.length;i++){
          var n=data[cells[i].getAttribute('data-stat')];
          if(typeof n!=='number'||!isFinite(n)||n<1||Math.floor(n)!==n)return;
        }
        for(var j=0;j<cells.length;j++){
          cells[j].textContent=data[cells[j].getAttribute('data-stat')].toLocaleString('en-US');
        }
        stats.hidden=false;
      })
      .catch(function(){});
  }
})();
</script>
</body>
</html>
`;
}

/**
 * Writes landing.html and its media into the web export, each media file
 * under a content-hashed name. Store URLs come from build-time env; a
 * missing or invalid one hides its badge and the QR falls back to /welcome.
 */
function writeLandingPage(outputDir, projectRoot, env = process.env) {
  const crypto = require('crypto');
  const fs = require('fs');
  const path = require('path');
  const assetOut = path.join(outputDir, ASSET_DIR);
  fs.mkdirSync(assetOut, { recursive: true });
  const assetUrls = {};
  for (const [name, source] of Object.entries(LANDING_ASSETS)) {
    const body = fs.readFileSync(path.join(projectRoot, source));
    const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 10);
    const ext = path.extname(name);
    const hashed = `${name.slice(0, -ext.length)}.${hash}${ext}`;
    fs.writeFileSync(path.join(assetOut, hashed), body);
    assetUrls[name] = `/${ASSET_DIR}/${hashed}`;
  }
  const html = renderLandingHtml({
    appStoreUrl: env.EXPO_PUBLIC_APP_STORE_URL,
    playStoreUrl: env.EXPO_PUBLIC_PLAY_STORE_URL,
    assetUrls,
  });
  fs.writeFileSync(path.join(outputDir, 'landing.html'), html);
  return html;
}

module.exports = {
  writeLandingPage,
  ASSET_DIR,
  CANONICAL_ORIGIN,
  DESCRIPTION,
  LANDING_ASSETS,
  PENDING_FLOW_KEY,
  PREFILL_EMAIL_KEY,
  QR_FALLBACK_URL,
  ROUTES,
  STATS_ENDPOINT,
  TITLE,
  qrSvg,
  renderLandingHtml,
  resolveStoreUrl,
};
