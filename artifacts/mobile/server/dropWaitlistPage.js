/**
 * Public brand drop page: https://brandthread.app/@handle/drop
 *
 * A self-contained, crawlable HTML page (not the SPA) rendered by serve.js
 * from GET /api/v1/public/drop-waitlist/:handle. Three states:
 *   upcoming — hero, live countdown, SMS waitlist form
 *   none     — brand has no scheduled drop yet; same form for "their next drop"
 *   live     — the drop is live: a Shop button to /drops/:id instead of the form
 * The form POSTs same-origin to /api/v1/public/drop-waitlist/:handle.
 *
 * Flow reference (Mobbin): H&M "Enabling notifications" — product hero →
 * one field + full-width black "Notify me" → "You're all set" + one button.
 */
const crypto = require('crypto');

const HANDLE_PATH_RE = /^\/@([A-Za-z0-9_]{3,30})\/drop\/?$/;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** JSON safe to embed inside a <script> element. */
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function httpsUrl(value) {
  return typeof value === 'string' && /^https:\/\/[^\s"'<>]+$/.test(value) ? value : null;
}

/** "Sat, Oct 18, 7:00 PM EDT" in the drop's launch timezone. */
function formatLaunch(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const opts = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timeZone || 'UTC' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(date);
  }
}

function countdownParts(iso, now) {
  let ms = Math.max(0, new Date(iso).getTime() - now);
  if (!Number.isFinite(ms)) ms = 0;
  const s = Math.floor(ms / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

const pad = (n) => String(n).padStart(2, '0');

const STYLE = `
*{box-sizing:border-box}
:root{--bg:#0a0a0b;--fg:#f8f8f8;--muted:#a6a6a6;--line:#2c2c2e;--card:#161618;--live:#ff3b30}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;font-size:16px;line-height:1.45}
main{max-width:480px;margin:0 auto;padding:16px 16px 40px}
a{color:var(--fg)}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none;margin:4px 0 16px}
.avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;background:var(--card);border:1px solid var(--line);display:grid;place-items:center;font-weight:700;flex:none}
.brand-name{font-weight:700;font-size:15px;line-height:1.2}
.brand-handle{color:var(--muted);font-size:13px}
.hero{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.hero-empty{display:grid;place-items:center;color:var(--muted);font-weight:700;letter-spacing:.08em;font-size:13px}
h1{font-size:24px;line-height:1.2;margin:20px 0 4px;overflow-wrap:anywhere}
.when{color:var(--muted);margin:0 0 16px;font-size:14px}
.countdown{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0 0 24px}
.unit{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 0 8px;text-align:center}
.num{display:block;font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}
.lbl{display:block;font-size:11px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin-top:2px}
label{display:block;font-weight:600;font-size:14px;margin:0 0 8px}
.phone{display:flex;gap:8px}
input{font:inherit;font-size:16px;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:12px;height:52px;padding:0 14px;min-width:0}
#cc{width:76px;flex:none;text-align:center}
#phone{flex:1}
input:focus,.btn:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
.consent{color:var(--muted);font-size:12px;line-height:1.5;margin:12px 0 0}
.btn{display:flex;align-items:center;justify-content:center;width:100%;height:52px;margin-top:16px;font:inherit;font-weight:700;font-size:16px;color:#0a0a0b;background:var(--fg);border:0;border-radius:12px;text-decoration:none;cursor:pointer}
.btn[disabled]{opacity:.5;cursor:default}
.btn-outline{background:transparent;color:var(--fg);border:1px solid var(--line)}
.error{color:var(--fg);font-weight:600;font-size:14px;margin:12px 0 0}
.live{display:inline-flex;align-items:center;gap:6px;background:var(--live);color:#fff;font-weight:700;font-size:12px;letter-spacing:.06em;border-radius:6px;padding:4px 8px;margin-top:20px}
.live+h1{margin-top:10px}
.done h2{font-size:20px;margin:0 0 6px}
.done p{color:var(--muted);margin:0}
.foot{margin-top:40px;text-align:center}
.foot a{color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.12em;text-decoration:none}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
[hidden]{display:none!important}
.center{min-height:80vh;display:flex;flex-direction:column;justify-content:center;text-align:center}
.center p{color:var(--muted)}
`;

function headTags({ title, description, canonical, image, noindex }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<meta name="theme-color" content="#0a0a0b">',
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    noindex ? '<meta name="robots" content="noindex">' : '',
    canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : '',
    canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}">` : '',
    '<meta property="og:site_name" content="Brandthread">',
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    image ? `<meta property="og:image" content="${escapeHtml(image)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : '',
  ].filter(Boolean).join('\n');
}

/**
 * @param {object} data   API payload { brand, drop, state, waitlistOpen, consentText }
 * @param {object} opts   { nonce, origin, now }
 */
function renderDropWaitlistPage(data, { nonce, origin = 'https://brandthread.app', now = Date.now() } = {}) {
  const brand = data.brand || {};
  const handle = String(brand.handle || '');
  const brandName = String(brand.name || `@${handle}`);
  const drop = data.drop || null;
  const state = data.state === 'live' || data.state === 'upcoming' ? data.state : 'none';
  const canonical = `${origin}/@${handle}/drop`;
  const avatar = httpsUrl(brand.avatarUrl);
  const hero = drop ? httpsUrl(drop.heroImageUrl) : null;
  const launch = drop && drop.releaseAt ? formatLaunch(drop.releaseAt, drop.launchTimezone) : null;

  const title = drop ? `${drop.name} by ${brandName} | Brandthread` : `${brandName}'s next drop | Brandthread`;
  const description = state === 'live'
    ? `${drop.name} by ${brandName} is live now on Brandthread.`
    : state === 'upcoming'
      ? `${launch ? `Drops ${launch}. ` : ''}Get a text from ${brandName} when it goes live.`
      : `Get a text from ${brandName} when their next drop goes live.`;

  const brandHeader = `<a class="brand" href="/u/${encodeURIComponent(handle)}">
${avatar ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="">` : `<span class="avatar" aria-hidden="true">${escapeHtml(brandName.replace(/^@/, '').slice(0, 1).toUpperCase())}</span>`}
<span><span class="brand-name">${escapeHtml(brandName)}</span><br><span class="brand-handle">@${escapeHtml(handle)}</span></span>
</a>`;

  const heroBlock = drop
    ? (hero
      ? `<img class="hero" src="${escapeHtml(hero)}" alt="${escapeHtml(drop.name)}">`
      : `<div class="hero hero-empty" aria-hidden="true">${escapeHtml(brandName.toUpperCase())}</div>`)
    : '';

  let body;
  if (state === 'live') {
    body = `${heroBlock}
<span class="live">LIVE</span>
<h1>${escapeHtml(drop.name)}</h1>
<p class="when">Live now</p>
<a class="btn" href="/drops/${encodeURIComponent(drop.id)}">Shop the drop</a>`;
  } else {
    const parts = state === 'upcoming' && drop.releaseAt ? countdownParts(drop.releaseAt, now) : null;
    const countdown = parts ? `<div class="countdown" id="countdown" role="timer" aria-label="Time until the drop">
<div class="unit"><span class="num" data-u="d">${pad(parts.d)}</span><span class="lbl">Days</span></div>
<div class="unit"><span class="num" data-u="h">${pad(parts.h)}</span><span class="lbl">Hours</span></div>
<div class="unit"><span class="num" data-u="m">${pad(parts.m)}</span><span class="lbl">Mins</span></div>
<div class="unit"><span class="num" data-u="s">${pad(parts.s)}</span><span class="lbl">Secs</span></div>
</div>` : '';
    const heading = state === 'upcoming'
      ? `<h1>${escapeHtml(drop.name)}</h1>${launch ? `<p class="when">Drops ${escapeHtml(launch)}</p>` : ''}`
      : `<h1>${escapeHtml(brandName)}'s next drop</h1><p class="when">Get a text when it goes live.</p>`;
    body = `${heroBlock}
${heading}
${countdown}
<div id="formView">
<form id="join" novalidate>
<label for="phone">Mobile number</label>
<div class="phone">
<input id="cc" name="countryCode" value="+1" inputmode="tel" autocomplete="tel-country-code" maxlength="5" aria-label="Country code">
<input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(555) 555-5555" maxlength="24" required>
</div>
<div class="hp" aria-hidden="true"><input id="company" name="company" tabindex="-1" autocomplete="off"></div>
<p class="consent" id="consent">${escapeHtml(data.consentText || '')}</p>
<p class="error" id="error" role="alert" hidden></p>
<button class="btn" id="submit" type="submit">Notify me</button>
</form>
</div>
<div id="doneView" class="done" hidden>
<h2>You're all set</h2>
<p id="doneText"></p>
<a class="btn btn-outline" href="/u/${encodeURIComponent(handle)}">Visit ${escapeHtml(brandName)}</a>
</div>`;
  }

  const config = {
    endpoint: `/api/v1/public/drop-waitlist/${encodeURIComponent(handle)}`,
    releaseAt: state === 'upcoming' && drop ? drop.releaseAt : null,
    dropName: drop ? drop.name : null,
    brandName,
  };

  const script = state === 'live' ? '' : `<script nonce="${escapeHtml(nonce)}">
(function(){
var C=${scriptJson(config)};
function pad(n){return(n<10?'0':'')+n}
var cd=document.getElementById('countdown');
if(cd&&C.releaseAt){var end=new Date(C.releaseAt).getTime(),reloaded=false;
var tick=function(){var ms=Math.max(0,end-Date.now()),s=Math.floor(ms/1000);
var v={d:Math.floor(s/86400),h:Math.floor(s%86400/3600),m:Math.floor(s%3600/60),s:s%60};
for(var k in v){var el=cd.querySelector('[data-u="'+k+'"]');if(el)el.textContent=pad(v[k])}
if(ms<=0&&!reloaded){reloaded=true;setTimeout(function(){location.reload()},1500)}};
tick();setInterval(tick,1000)}
var form=document.getElementById('join');if(!form)return;
var err=document.getElementById('error'),btn=document.getElementById('submit');
function show(m){err.textContent=m;err.hidden=false}
form.addEventListener('submit',function(e){
e.preventDefault();err.hidden=true;
var phone=document.getElementById('phone').value.trim(),cc=document.getElementById('cc').value.trim();
if(phone.replace(/\\D/g,'').length<6){return show('Enter your mobile number.')}
btn.disabled=true;btn.textContent='Joining…';
fetch(C.endpoint,{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',
body:JSON.stringify({phone:phone,countryCode:cc,consent:true,company:document.getElementById('company').value})})
.then(function(r){return r.json().catch(function(){return{}}).then(function(b){return{ok:r.ok,status:r.status,b:b}})})
.then(function(res){
var b=res.b||{},e=b.error&&typeof b.error==='object'?b.error:{message:b.error,code:b.code};
if(res.status===409&&e.code==='DROP_LIVE'){location.reload();return}
if(!res.ok){btn.disabled=false;btn.textContent='Notify me';return show((typeof e.message==='string'&&e.message)||'Something went wrong. Try again.')}
var who=res.b&&res.b.phone?res.b.phone:'your number';
document.getElementById('doneText').textContent='We\\u2019ll text '+who+' when '+(C.dropName||(C.brandName+'\\u2019s next drop'))+' goes live.';
document.getElementById('formView').hidden=true;document.getElementById('doneView').hidden=false;
})
.catch(function(){btn.disabled=false;btn.textContent='Notify me';show('Check your connection and try again.')});
});
})();
</script>`;

  return `<!doctype html>
<html lang="en"><head>
${headTags({ title, description, canonical, image: hero || avatar || `${origin}/brandthread-logo.png` })}
<style>${STYLE}</style>
</head>
<body><main>
${brandHeader}
${body}
<p class="foot"><a href="/">BRANDTHREAD</a></p>
</main>
${script}
</body></html>`;
}

function renderMessagePage({ title, message, status }) {
  return `<!doctype html>
<html lang="en"><head>
${headTags({ title: `${title} | Brandthread`, description: message, noindex: true })}
<style>${STYLE}</style>
</head>
<body><main class="center" data-status="${status}">
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
<p class="foot"><a href="/">BRANDTHREAD</a></p>
</main></body></html>`;
}

function renderNotFoundPage() {
  return renderMessagePage({ title: "This page isn't available", message: 'The link may be broken, or the brand may have changed its handle.', status: 404 });
}

function renderUnavailablePage() {
  return renderMessagePage({ title: 'Something went wrong', message: 'This page could not load. Try again in a moment.', status: 503 });
}

function contentSecurityPolicy(nonce) {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    'img-src https: data:',
    `script-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Match `/@handle/drop` (case-insensitive handle); returns the handle or null. */
function matchDropWaitlistPath(pathname) {
  const m = HANDLE_PATH_RE.exec(pathname);
  return m ? m[1] : null;
}

const FETCH_TIMEOUT_MS = 3000;

/**
 * Resolve a `/@handle/drop` request to `{ status, html, headers }`.
 * `apiBase` is e.g. https://brandthread.app/api/v1.
 */
async function handleDropWaitlistRequest(handle, { apiBase, origin } = {}) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': contentSecurityPolicy(nonce),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${apiBase}/public/drop-waitlist/${encodeURIComponent(handle)}`, { signal: controller.signal });
  } catch {
    res = null;
  } finally {
    clearTimeout(timer);
  }
  if (res && res.status === 404) return { status: 404, headers, html: renderNotFoundPage() };
  let data = null;
  if (res && res.ok) {
    try { data = await res.json(); } catch { data = null; }
  }
  if (!data || !data.brand) return { status: 503, headers, html: renderUnavailablePage() };
  return { status: 200, headers, html: renderDropWaitlistPage(data, { nonce, origin }) };
}

module.exports = {
  renderDropWaitlistPage,
  renderNotFoundPage,
  renderUnavailablePage,
  matchDropWaitlistPath,
  handleDropWaitlistRequest,
  contentSecurityPolicy,
  formatLaunch,
};
