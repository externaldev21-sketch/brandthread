/**
 * Static pre-launch landing page for brandthread.app.
 *
 * Pure string rendering, no app code: plain HTML and CSS plus one small inline
 * script that reveals the launch-waitlist email form inline, posts it to the
 * same-origin waitlist endpoint, starts the app capture only after load and
 * only when motion is welcome, and adds light scroll reveals. The page holds
 * no sign-up, sign-in or app-entry links: before launch the only action is
 * "Notify me at launch". `scripts/build-web.js` writes the result to
 * `static-build/landing.html` (media to `static-build/landing-assets/`) and
 * `server/serve.js` serves it. The Expo app itself is not touched.
 */

const { renderPricingHtml } = require('./pricing-page');
const PRICING_FILE = 'pricing.html';
const CANONICAL_ORIGIN = 'https://brandthread.app';
const LOGO_URL = `${CANONICAL_ORIGIN}/brandthread-logo.png`;
const TITLE = 'Brandthread | Shop, sell & design streetwear';
const DESCRIPTION =
  'Brandthread is launching soon: discover streetwear in Threads, shop independent-brand drops, sell live with real seller tools and earn Thread Cash.';

// Kept for /pricing (pricing-page.js); the landing page itself never writes it.
const PENDING_FLOW_KEY = 'onboarding_pending_flow';

// Public, non-app destinations only. No sign-up, sign-in or in-app routes.
const ROUTES = {
  signUp: '/onboarding',
  signIn: '/sign-in',
  privacy: '/privacy',
  terms: '/terms',
  guidelines: '/community-guidelines',
  support: 'mailto:support@brandthread.app',
};
const LEGAL_LINKS = [
  ['Privacy', ROUTES.privacy],
  ['Terms', ROUTES.terms],
  ['Community guidelines', ROUTES.guidelines],
  ['Support', ROUTES.support],
];

// Same-origin: the server proxies /api to the API server.
const WAITLIST_ENDPOINT = '/api/launch-waitlist';
const WAITLIST_SUCCESS = "You're on the list.";
const WAITLIST_SOURCES = ['instagram', 'landing'];
const QR_FALLBACK_URL = `${CANONICAL_ORIGIN}/welcome`;

const ASSET_DIR = 'landing-assets';
const LANDING_ASSETS = {
  'app-capture.mp4': 'assets/landing/app-capture.mp4',
  'app-capture.webm': 'assets/landing/app-capture.webm',
  'app-capture-poster.jpg': 'assets/landing/app-capture-poster.jpg',
  // Inter, bundled locally from the app's own @expo-google-fonts/inter install.
  'inter-400.ttf': 'node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
  'inter-600.ttf': 'node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
  'inter-700.ttf': 'node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf',
};
const INTER_WEIGHTS = [400, 600, 700];

function fontFaceCss(assetUrls) {
  return INTER_WEIGHTS.map((w) => `@font-face{font-family:Inter;font-style:normal;font-weight:${w};font-display:swap;src:url(${assetUrls[`inter-${w}.ttf`]}) format("truetype")}`).join('\n');
}
const CAPTURE_SIZE = { width: 540, height: 1168 };

const STORE_HOSTS = {
  appStore: ['apps.apple.com', 'itunes.apple.com'],
  playStore: ['play.google.com'],
};

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
  return `<svg class="qr" viewBox="0 0 ${box} ${box}" width="88" height="88" shape-rendering="crispEdges" role="img" aria-label="QR code to open Brandthread on your phone"><rect width="${box}" height="${box}" fill="#ffffff"/><path fill="#000000" d="${d}"/></svg>`;
}

function structuredData() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'Brandthread', url: CANONICAL_ORIGIN, logo: LOGO_URL, description: DESCRIPTION, email: 'support@brandthread.app' },
      { '@type': 'WebSite', name: 'Brandthread', url: CANONICAL_ORIGIN, description: DESCRIPTION },
    ],
  };
}

const PHONE_DEPTH = Array.from({ length: 14 }, (_, i) => {
  const grey = Math.round(0x6a - i * 4).toString(16).padStart(2, '0');
  return `${i + 1}px ${i + 1}px 0 #${grey}${grey}${grey}`;
}).join(',');

// Inter ships with the page (same-origin @font-face, font-display:swap); no
// third-party font request. System fonts cover the swap period.
const FONT_STACK = 'Inter,"Inter var",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

const CSS = `
:root{--black:#000;--ink:#0a0a0a;--panel:#111;--field:#141414;--line:#2a2a2a;--silver:#c7c7c7;--mute:#9a9a9a;--white:#fff}
*{box-sizing:border-box}
html{background:var(--black);-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--black);color:var(--white);font-family:${FONT_STACK};line-height:1.5;-webkit-font-smoothing:antialiased;overflow-x:hidden}
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
.tag{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--silver);border:1px solid var(--line);border-radius:999px;padding:6px 12px;white-space:nowrap}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 24px;border-radius:12px;font-weight:700;font-size:16px;line-height:1.2;text-align:center;text-decoration:none;border:1px solid var(--white);cursor:pointer;font-family:inherit;white-space:nowrap;transition:background-color .15s,border-color .15s}
.btn.solid{background:var(--white);color:var(--black)}
.btn.solid:hover{background:var(--silver);border-color:var(--silver)}
.btn[disabled]{cursor:progress;background:var(--silver);border-color:var(--silver)}
.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center;padding-top:56px;padding-bottom:72px}
.eyebrow{margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--mute)}
h1{font-size:64px;text-wrap:balance;line-height:1.04;letter-spacing:-.035em;margin:0 0 20px;font-weight:700}
h2{font-size:40px;line-height:1.08;letter-spacing:-.03em;margin:0 0 12px;font-weight:700;text-wrap:balance}
h3{font-size:20px;line-height:1.25;letter-spacing:-.01em;margin:0 0 8px;font-weight:700}
.lede{font-size:18px;color:var(--silver);max-width:34em;margin:0 0 32px;text-wrap:pretty}
.waitlist{width:100%;max-width:480px}
.waitlist form{display:flex;gap:10px;width:100%}
.waitlist input{flex:1;min-width:0;height:52px;border-radius:12px;border:1px solid var(--line);background:var(--field);color:var(--white);font:inherit;font-size:16px;padding:0 16px;-webkit-appearance:none;appearance:none}
.waitlist input::placeholder{color:var(--mute)}
.waitlist input:focus{outline:none;border-color:var(--white)}
.waitlist input[aria-invalid="true"]{border-color:var(--white)}
.consent{margin:12px 0 0;font-size:13px;color:var(--mute);max-width:34em}
.consent a{color:var(--silver)}
.status{margin:12px 0 0;font-size:15px;font-weight:600;min-height:0}
.status:empty{display:none}
.status.ok{color:var(--white)}
.status.err{color:var(--silver)}
.qr-block{display:flex;align-items:center;gap:16px;margin-top:40px}
.qr-block .qr{display:block;width:88px;height:88px;border-radius:10px;flex:none}
.qr-block p{margin:0;font-size:15px;font-weight:600;color:var(--silver)}
.stage{display:flex;justify-content:center;padding:12px 24px 24px 0}
.device{width:min(300px,78%);aspect-ratio:9/18.5;border-radius:44px;padding:10px;background:linear-gradient(145deg,#e8e8e8,#7a7a7a 55%,#d6d6d6);transform:rotate(7deg);box-shadow:${PHONE_DEPTH}}
.screen{height:100%;border-radius:35px;overflow:hidden;background:var(--black);-webkit-mask-image:-webkit-radial-gradient(white,black)}
.screen video{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
.section{padding-bottom:80px}
.section-head{max-width:40em;margin-bottom:32px}
.section-head p{margin:0;color:var(--silver);font-size:17px}
.pillars{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.pillars li{border:1px solid var(--line);border-radius:20px;background:var(--panel);padding:24px}
.pillars svg{width:26px;height:26px;color:var(--white);display:block;margin-bottom:20px}
.pillars p{margin:0;color:var(--silver);font-size:15px}
.closer{border:1px solid var(--line);border-radius:24px;background:var(--panel);padding:48px 40px;display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center}
.closer p.sub{margin:0;color:var(--silver);font-size:17px}
.reveal{transition:opacity .6s ease,transform .6s ease}
.js .reveal.pre{opacity:0;transform:translateY(16px)}
footer{border-top:1px solid var(--line);padding:40px 0 calc(40px + env(safe-area-inset-bottom))}
.foot{display:flex;flex-wrap:wrap;gap:16px 32px;align-items:center;justify-content:space-between}
.foot nav{display:flex;flex-wrap:wrap;gap:8px 24px}
.foot a{color:var(--silver);text-decoration:none;font-size:14px;padding:6px 0}
.foot a:hover{color:var(--white);text-decoration:underline}
.foot p{margin:0;color:var(--mute);font-size:14px}
@media (max-width:1000px){
.links{display:none}
.pillars{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:860px){
h1{font-size:48px}
h2{font-size:32px}
.hero{grid-template-columns:1fr;gap:48px;padding-top:32px;padding-bottom:56px}
.stage{padding:0}
.device{width:min(260px,70%);transform:none;box-shadow:none}
.closer{grid-template-columns:1fr;padding:32px 20px}
.section{padding-bottom:64px}
}
@media (max-width:760px){
.qr-block{display:none}
}
@media (max-width:480px){
h1{font-size:40px}
h2{font-size:28px}
.lede{font-size:17px}
.waitlist form{flex-direction:column}
.waitlist input{flex:none;width:100%}
.waitlist .btn{width:100%}
.pillars{grid-template-columns:1fr}
.pillars li{padding:20px}
.tag{letter-spacing:.08em;padding:6px 10px}
.foot nav{display:grid;grid-template-columns:1fr 1fr;width:100%;gap:4px 16px}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}.js .reveal.pre{opacity:1;transform:none}}
`.trim();

const GLYPHS = {
  threads: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  drop: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  live: '<circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v5M17.5 9.5v5"/>',
};
const PILLARS = [
  { glyph: 'threads', title: 'Threads', body: 'Swipe through fashion videos and photo posts. Discover pieces through the people and independent labels behind them.' },
  { glyph: 'drop', title: 'Independent drops', body: 'New releases straight from independent brands, shipped by the brand itself.' },
  { glyph: 'live', title: 'Seller tools and live selling', body: 'List products, launch drops, go live and get paid. Manage your store and orders in one place.' },
  { glyph: 'cash', title: 'Thread Cash', body: 'Earn Thread Cash rewards and apply them as a discount at checkout. Your card covers the rest.' },
];

function glyph(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[name]}</svg>`;
}

function defaultAssetUrls() {
  return Object.fromEntries(Object.keys(LANDING_ASSETS).map((name) => [name, `/${ASSET_DIR}/${name}`]));
}

/** One "Notify me at launch" button that reveals an inline email form. */
function waitlistBlock(id) {
  return `<div class="waitlist" data-waitlist>
        <button class="btn solid" type="button" data-reveal aria-expanded="false" aria-controls="${id}-form">Notify me at launch</button>
        <form id="${id}-form" hidden novalidate>
          <label class="vh" for="${id}-email">Email address</label>
          <input id="${id}-email" type="email" placeholder="you@email.com" autocomplete="email" inputmode="email" required aria-describedby="${id}-consent ${id}-status" />
          <button class="btn solid" type="submit">Notify me</button>
        </form>
        <p class="consent" id="${id}-consent" hidden>By submitting, you agree Brandthread may email you once about our launch. See our <a href="${ROUTES.privacy}">Privacy policy</a>.</p>
        <p class="status" id="${id}-status" role="status" aria-live="polite"></p>
      </div>`;
}

function renderLandingHtml({ assetUrls = defaultAssetUrls() } = {}) {
  const ld = JSON.stringify(structuredData()).replace(/</g, '\\u003c');
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
<link rel="preload" href="${assetUrls['inter-400.ttf']}" as="font" type="font/ttf" crossorigin />
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
<style>${fontFaceCss(assetUrls)}
${CSS}</style>
<script>document.documentElement.className+=' js';</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header>
  <div class="wrap bar">
    <a class="brand" href="#main" aria-label="Brandthread, back to top"><img src="/brandthread-logo.png" alt="" width="36" height="36" /><span>Brandthread</span></a>
    <nav class="links" aria-label="On this page">
      <a href="#features">What's inside</a>
      <a href="#notify">Get notified</a>
    </nav>
    <div class="nav"><span class="tag">Launching soon</span></div>
  </div>
</header>
<main id="main">
  <div class="wrap hero">
    <div>
      <p class="eyebrow">Pre-launch</p>
      <h1>Shop, sell and design streetwear.</h1>
      <p class="lede">Discover fashion on Threads. Shop independent drops. Build your store and sell live. Earn Thread Cash rewards. One app, launching soon.</p>
      ${waitlistBlock('hero')}
      <div class="qr-block">
        ${qrSvg(QR_FALLBACK_URL)}
        <p>Open this page on your phone</p>
      </div>
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

  <section class="wrap section" id="features" aria-labelledby="features-title">
    <div class="section-head reveal">
      <h2 id="features-title">Four ways in. One thread.</h2>
      <p>Built for the people who wear it, make it and sell it.</p>
    </div>
    <ul class="pillars">
      ${PILLARS.map((p) => `<li class="reveal">${glyph(p.glyph)}<h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.body)}</p></li>`).join('\n      ')}
    </ul>
  </section>

  <section class="wrap section" id="notify" aria-labelledby="notify-title">
    <div class="closer reveal">
      <div>
        <h2 id="notify-title">Be first through the door.</h2>
        <p class="sub">One email when Brandthread goes live. Nothing else.</p>
      </div>
      ${waitlistBlock('closer')}
    </div>
  </section>
</main>
<footer>
  <div class="wrap foot">
    <p>&copy; Brandthread</p>
    <nav aria-label="Legal and support">
      ${LEGAL_LINKS.map(([label, href]) => `<a href="${href}">${label}</a>`).join('\n      ')}
    </nav>
  </div>
</footer>
<script>
(function(){
  var ENDPOINT=${JSON.stringify(WAITLIST_ENDPOINT)};
  var SUCCESS=${JSON.stringify(WAITLIST_SUCCESS)};
  var ua=navigator.userAgent||'';
  var ref=(location.search||'')+' '+(document.referrer||'');
  var SOURCE=/Instagram/i.test(ua)||/utm_source=ig|utm_source=instagram|instagram\\.com/i.test(ref)?'instagram':'landing';
  var EMAIL=/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  var MESSAGES={400:'That email does not look right. Check it and try again.',429:'Too many tries. Wait a moment, then try again.'};
  var FALLBACK='Something went wrong on our side. Please try again.';

  var blocks=document.querySelectorAll('[data-waitlist]');
  for(var i=0;i<blocks.length;i++)wire(blocks[i]);
  function wire(block){
    var reveal=block.querySelector('[data-reveal]');
    var form=block.querySelector('form');
    var input=form.querySelector('input');
    var submit=form.querySelector('button[type="submit"]');
    var consent=block.querySelector('.consent');
    var status=block.querySelector('.status');
    function say(text,kind){status.textContent=text;status.className='status'+(kind?' '+kind:'');}
    reveal.addEventListener('click',function(){
      reveal.hidden=true;reveal.setAttribute('aria-expanded','true');
      form.hidden=false;consent.hidden=false;input.focus();
    });
    form.addEventListener('submit',function(e){
      e.preventDefault();
      if(submit.disabled)return;
      var email=input.value.trim();
      if(!EMAIL.test(email)){input.setAttribute('aria-invalid','true');say('Enter a valid email address.','err');input.focus();return;}
      input.removeAttribute('aria-invalid');
      submit.disabled=true;input.readOnly=true;submit.textContent='Sending';say('');
      fetch(ENDPOINT,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({email:email,source:SOURCE})})
        .then(function(r){
          if(r.ok){form.hidden=true;consent.hidden=true;say(SUCCESS,'ok');return;}
          if(r.status===400)input.setAttribute('aria-invalid','true');
          fail(MESSAGES[r.status]||FALLBACK);
        })
        .catch(function(){fail(FALLBACK);});
    });
    function fail(text){submit.disabled=false;input.readOnly=false;submit.textContent='Try again';say(text,'err');input.focus();}
  }

  // Poster first: the capture loads only after the page has loaded, and never
  // when the visitor prefers reduced motion.
  var video=document.querySelector('video[data-capture]');
  var motion=window.matchMedia?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
  var loaded=false;
  function syncVideo(){
    if(!video||!loaded)return;
    if(motion&&motion.matches){video.pause();return;}
    video.preload='auto';
    var p=video.play();
    if(p&&p.catch)p.catch(function(){});
  }
  function onLoad(){loaded=true;setTimeout(syncVideo,600);}
  if(document.readyState==='complete')onLoad();else window.addEventListener('load',onLoad);
  if(motion){
    if(motion.addEventListener)motion.addEventListener('change',syncVideo);
    else if(motion.addListener)motion.addListener(syncVideo);
  }

  // Light scroll reveals; content stays visible without IntersectionObserver.
  var items=document.querySelectorAll('.reveal');
  if('IntersectionObserver' in window&&!(motion&&motion.matches)){
    var io=new IntersectionObserver(function(entries){
      for(var k=0;k<entries.length;k++){if(entries[k].isIntersecting){entries[k].target.classList.remove('pre');io.unobserve(entries[k].target);}}
    },{rootMargin:'0px 0px -10% 0px'});
    for(var j=0;j<items.length;j++){items[j].classList.add('pre');io.observe(items[j]);}
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
  void env;
  const html = renderLandingHtml({ assetUrls });
  fs.writeFileSync(path.join(outputDir, 'landing.html'), html);
  fs.writeFileSync(path.join(outputDir, PRICING_FILE), renderPricingHtml(require('./plan-catalogue').loadPlanCatalogue(), {
    CANONICAL_ORIGIN, LOGO_URL, BASE_CSS: CSS, ROUTES, PENDING_FLOW_KEY,
  }));
  return html;
}

module.exports = {
  BASE_CSS: CSS,
  LOGO_URL,
  PRICING_FILE,
  writeLandingPage,
  ASSET_DIR,
  INTER_WEIGHTS,
  CANONICAL_ORIGIN,
  DESCRIPTION,
  LANDING_ASSETS,
  PENDING_FLOW_KEY,
  QR_FALLBACK_URL,
  ROUTES,
  LEGAL_LINKS,
  WAITLIST_ENDPOINT,
  WAITLIST_SOURCES,
  WAITLIST_SUCCESS,
  TITLE,
  qrSvg,
  renderLandingHtml,
  resolveStoreUrl,
};
