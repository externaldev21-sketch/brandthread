/**
 * Static marketing landing page for brandthread.app.
 *
 * Pure string rendering, no app code and no network calls: the page is plain
 * HTML and CSS plus one tiny inline script that remembers the chosen signup
 * side. `scripts/build-web.js` writes the result to `static-build/landing.html`
 * and `server/serve.js` serves it for signed-out visits to "/" and for
 * "/welcome". The Expo app itself is not touched.
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

// Real in-app routes (Expo Router): onboarding creates the account, sign-in
// is for returning users, the legal pages are public.
const ROUTES = {
  signUp: '/onboarding',
  signIn: '/sign-in',
  privacy: '/privacy',
  terms: '/terms',
  guidelines: '/community-guidelines',
  support: 'mailto:support@brandthread.app',
};

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

const FONT_FILES = [
  { weight: 400, file: 'Inter_400Regular.ttf' },
  { weight: 600, file: 'Inter_600SemiBold.ttf' },
  { weight: 700, file: 'Inter_700Bold.ttf' },
];

const CSS = `
${FONT_FILES.map(({ weight, file }) => `@font-face{font-family:"Inter";font-style:normal;font-weight:${weight};font-display:swap;src:url("/landing-fonts/${file}") format("truetype")}`).join('\n')}
:root{--black:#000;--ink:#0a0a0a;--panel:#111;--line:#2a2a2a;--silver:#c7c7c7;--mute:#9a9a9a;--white:#fff}
*{box-sizing:border-box}
html{background:var(--black);-webkit-text-size-adjust:100%}
body{margin:0;background:var(--black);color:var(--white);font-family:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:inherit}
:focus-visible{outline:2px solid var(--white);outline-offset:3px}
.skip{position:absolute;left:16px;top:-64px;background:var(--white);color:var(--black);padding:10px 16px;border-radius:8px;font-weight:600;text-decoration:none;z-index:10}
.skip:focus{top:max(16px,env(safe-area-inset-top))}
.wrap{width:100%;max-width:1160px;margin:0 auto;padding-left:max(20px,env(safe-area-inset-left));padding-right:max(20px,env(safe-area-inset-right))}
header{padding-top:env(safe-area-inset-top)}
.bar{display:flex;align-items:center;justify-content:space-between;height:68px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:700;letter-spacing:-.01em;font-size:18px}
.brand img{width:36px;height:36px;display:block}
.nav{display:flex;align-items:center;gap:20px}
.nav a.text{font-size:15px;font-weight:600;color:var(--silver);text-decoration:none}
.nav a.text:hover{color:var(--white)}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 24px;border-radius:12px;font-weight:700;font-size:16px;text-decoration:none;border:1px solid var(--white);cursor:pointer;font-family:inherit}
.btn.solid{background:var(--white);color:var(--black)}
.btn.solid:hover{background:var(--silver);border-color:var(--silver)}
.btn.ghost{background:var(--black);color:var(--white);border-color:var(--line)}
.btn.ghost:hover{border-color:var(--white)}
.btn.small{min-height:40px;padding:0 18px;font-size:14px}
.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center;padding-top:56px;padding-bottom:88px}
h1{font-size:clamp(40px,6.2vw,68px);line-height:1.04;letter-spacing:-.035em;margin:0 0 20px;font-weight:700}
.lede{font-size:clamp(17px,2vw,20px);color:var(--silver);max-width:34em;margin:0 0 32px}
.ctas{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:28px}
.badges{display:flex;flex-wrap:wrap;gap:12px;margin:0;padding:0;list-style:none}
.badge{display:flex;flex-direction:column;justify-content:center;min-height:52px;padding:6px 18px;border:1px solid var(--line);border-radius:12px;background:var(--panel);text-decoration:none;line-height:1.15}
.badge:hover{border-color:var(--white)}
.badge small{font-size:11px;color:var(--mute);font-weight:400}
.badge strong{font-size:17px;font-weight:700}
.stage{display:flex;justify-content:center}
.device{width:min(300px,78%);aspect-ratio:9/18.5;border-radius:44px;padding:10px;background:linear-gradient(145deg,#e8e8e8,#7a7a7a 55%,#d6d6d6);box-shadow:0 30px 80px #1a1a1a}
.screen{height:100%;border-radius:35px;background:radial-gradient(120% 70% at 50% 0,#262626,#050505 70%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:24px}
.screen img{width:55%;height:auto;display:block}
.screen ul{list-style:none;margin:0;padding:0;display:flex;gap:8px}
.screen li{border:1px solid #3a3a3a;border-radius:999px;padding:6px 14px;font-size:13px;font-weight:600;color:var(--silver)}
section{padding:80px 0;border-top:1px solid var(--line)}
h2{font-size:clamp(30px,4.2vw,44px);line-height:1.1;letter-spacing:-.03em;margin:0 0 12px;font-weight:700}
.sub{color:var(--silver);font-size:18px;max-width:38em;margin:0 0 48px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:32px 28px}
.card h3{font-size:24px;letter-spacing:-.02em;margin:0 0 12px}
.card p{margin:0;color:var(--silver);font-size:16px}
.steps{list-style:none;margin:0;padding:0;display:grid;gap:36px}
.steps li{display:grid;grid-template-columns:96px 1fr;gap:24px;align-items:start}
.num{font-size:88px;line-height:.9;font-weight:700;letter-spacing:-.05em;color:var(--white)}
.steps h3{font-size:24px;margin:6px 0 8px;letter-spacing:-.02em}
.steps p{margin:0;color:var(--silver);max-width:36em}
.split{display:grid;grid-template-columns:.8fr 1.2fr;gap:56px;align-items:start}
.final{text-align:center}
.final .sub{margin-left:auto;margin-right:auto}
.final .ctas{justify-content:center;margin-bottom:0}
footer{border-top:1px solid var(--line);padding:40px 0 calc(40px + env(safe-area-inset-bottom))}
.foot{display:flex;flex-wrap:wrap;gap:16px 32px;align-items:center;justify-content:space-between}
.foot nav{display:flex;flex-wrap:wrap;gap:8px 24px}
.foot a{color:var(--silver);text-decoration:none;font-size:15px;padding:6px 0}
.foot a:hover{color:var(--white);text-decoration:underline}
.foot p{margin:0;color:var(--mute);font-size:14px}
@media (max-width:860px){
.hero{grid-template-columns:1fr;gap:40px;padding-top:32px;padding-bottom:64px}
.cards{grid-template-columns:1fr}
.split{grid-template-columns:1fr;gap:32px}
section{padding:64px 0}
.device{width:min(260px,70%)}
}
@media (max-width:480px){
.steps li{grid-template-columns:64px 1fr;gap:16px}
.num{font-size:60px}
.ctas .btn{flex:1 1 100%}
.nav{gap:14px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`.trim();

function badge(url, small, label) {
  return `<li><a class="badge" href="${escapeHtml(url)}" rel="noopener"><small>${small}</small><strong>${label}</strong></a></li>`;
}

function renderLandingHtml({ appStoreUrl = null, playStoreUrl = null } = {}) {
  const appStore = resolveStoreUrl(appStoreUrl, 'appStore');
  const playStore = resolveStoreUrl(playStoreUrl, 'playStore');
  const badges = [
    appStore ? badge(appStore, 'Download on the', 'App Store') : '',
    playStore ? badge(playStore, 'Get it on', 'Google Play') : '',
  ].filter(Boolean);
  const badgeBlock = badges.length ? `<ul class="badges" aria-label="Download the app">${badges.join('')}</ul>` : '';
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
<link rel="preload" href="/landing-fonts/Inter_400Regular.ttf" as="font" type="font/ttf" crossorigin />
<link rel="preload" href="/landing-fonts/Inter_700Bold.ttf" as="font" type="font/ttf" crossorigin />
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
    <nav class="nav" aria-label="Account">
      <a class="text" href="${ROUTES.signIn}">Log in</a>
      <a class="btn solid small" href="${ROUTES.signUp}" data-flow="seller">Start selling</a>
    </nav>
  </div>
</header>
<main id="main">
  <div class="wrap hero">
    <div>
      <h1>Shop, sell and design streetwear.</h1>
      <p class="lede">Brandthread is where independent labels drop new pieces, sellers run their whole shop, and buyers discover streetwear brands they will actually wear.</p>
      <div class="ctas">
        <a class="btn solid" href="${ROUTES.signUp}" data-flow="seller">Start selling</a>
        <a class="btn ghost" href="${ROUTES.signUp}" data-flow="buyer">Start shopping</a>
      </div>
      ${badgeBlock}
    </div>
    <div class="stage" aria-hidden="true">
      <div class="device"><div class="screen"><img src="/brandthread-logo.png" alt="" width="165" height="165" /><ul><li>Shop</li><li>Sell</li><li>Design</li></ul></div></div>
    </div>
  </div>

  <section aria-labelledby="do-title">
    <div class="wrap">
      <h2 id="do-title">One app. Three ways in.</h2>
      <p class="sub">Every account can switch between shopping and selling.</p>
      <div class="cards">
        <article class="card"><h3>Shop</h3><p>Scroll a video-first feed of drops from independent labels, shop the post straight from a video or photo, follow the sellers you like, and check out securely. Save pieces, track orders, and message sellers directly.</p></article>
        <article class="card"><h3>Sell</h3><p>Set up your own storefront in minutes. List products, run inventory, go live, message customers, track orders and payouts, and grow with built-in analytics and marketing tools.</p></article>
        <article class="card"><h3>Design</h3><p>The built-in Design Studio gives sellers AI-assisted mockups, background removal, and a canvas editor to turn an idea into a sellable product, without leaving the app.</p></article>
      </div>
    </div>
  </section>

  <section aria-labelledby="sell-title">
    <div class="wrap split">
      <div>
        <h2 id="sell-title">Sell your label on Brandthread.</h2>
        <p class="sub">Free to browse and buy. Selling plans and premium seller tools are available as subscriptions.</p>
        <a class="btn solid" href="${ROUTES.signUp}" data-flow="seller">Start selling</a>
      </div>
      <ol class="steps">
        <li><span class="num" aria-hidden="true">1</span><div><h3>Open your storefront</h3><p>Create your seller account and set up your shop in minutes.</p></div></li>
        <li><span class="num" aria-hidden="true">2</span><div><h3>List and go live</h3><p>Add products, manage inventory, and show them off in video posts and live streams.</p></div></li>
        <li><span class="num" aria-hidden="true">3</span><div><h3>Ship and get paid</h3><p>Track orders and payouts, message customers, and grow with built-in analytics.</p></div></li>
      </ol>
    </div>
  </section>

  <section class="final" aria-labelledby="final-title">
    <div class="wrap">
      <h2 id="final-title">Discover what is next.</h2>
      <p class="sub">Your data is never sold, and account deletion is always one tap away in Settings.</p>
      <div class="ctas">
        <a class="btn solid" href="${ROUTES.signUp}" data-flow="seller">Start selling</a>
        <a class="btn ghost" href="${ROUTES.signUp}" data-flow="buyer">Start shopping</a>
      </div>
      ${badges.length ? `<div style="margin-top:24px;display:flex;justify-content:center">${badgeBlock}</div>` : ''}
    </div>
  </section>
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
  var links=document.querySelectorAll('a[data-flow]');
  for(var i=0;i<links.length;i++){
    links[i].addEventListener('click',function(){
      try{localStorage.setItem(${JSON.stringify(PENDING_FLOW_KEY)},this.getAttribute('data-flow'));}catch(e){}
    });
  }
})();
</script>
</body>
</html>
`;
}

/**
 * Writes landing.html and the self-hosted Inter faces (the same
 * @expo-google-fonts/inter files the app bundles) into the web export.
 * Store URLs come from build-time env; a missing or invalid one hides its badge.
 */
function writeLandingPage(outputDir, projectRoot, env = process.env) {
  const fs = require('fs');
  const path = require('path');
  const fontDirs = { 400: '400Regular', 600: '600SemiBold', 700: '700Bold' };
  const fontOut = path.join(outputDir, 'landing-fonts');
  fs.mkdirSync(fontOut, { recursive: true });
  for (const { weight, file } of FONT_FILES) {
    const source = path.join(projectRoot, 'node_modules', '@expo-google-fonts', 'inter', fontDirs[weight], file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(fontOut, file));
  }
  const html = renderLandingHtml({
    appStoreUrl: env.EXPO_PUBLIC_APP_STORE_URL,
    playStoreUrl: env.EXPO_PUBLIC_PLAY_STORE_URL,
  });
  fs.writeFileSync(path.join(outputDir, 'landing.html'), html);
  return html;
}

module.exports = {
  writeLandingPage,
  CANONICAL_ORIGIN,
  DESCRIPTION,
  FONT_FILES,
  PENDING_FLOW_KEY,
  ROUTES,
  TITLE,
  renderLandingHtml,
  resolveStoreUrl,
};
