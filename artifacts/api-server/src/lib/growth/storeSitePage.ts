/**
 * The seller's store at brandthread.app/@handle — pure, server-rendered HTML,
 * laid out like a Stan Store: one mobile column with the round profile photo,
 * name, short bio and social icons, then a stack of product blocks. Tapping a
 * block opens its checkout page on the store (/@handle/c/:productId), which
 * takes the buyer's details and payment without leaving the store.
 *
 * No web fonts and no frameworks. Inline scripts are allowed by hash in the
 * CSP; the checkout page also loads Stripe.js when embedded payment is on.
 */
import crypto from "node:crypto";
import { esc } from "./bioPage";
import { SOCIAL_KEYS } from "./bioValidation";
import type { StoreSiteTheme } from "./storeSiteDesign";
import type { BlockKind, BlockStyle } from "./storeBlocks";

export const SYSTEM_FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif';

/** One product block as the store page shows it. */
export type StoreSiteBlock = {
  /** Checkout page on this store. */
  href: string;
  kind: BlockKind;
  style: BlockStyle;
  image: string | null;
  title: string;
  subtitle: string;
  priceLabel: string;
  /** Original price, struck through. */
  compareAtLabel: string;
  /** "Ships by Nov 20" for a pre-order. */
  shipByLabel: string;
  buttonText: string;
  /** Sold out / pre-orders closed: shown, not tappable. */
  unavailableLabel: string | null;
};

export type StoreSiteModel = {
  handle: string;
  displayName: string;
  bio: string;
  logoUrl: string | null;
  theme: StoreSiteTheme;
  socials: { key: string; href: string }[];
  blocks: StoreSiteBlock[];
  /** Absolute https://brandthread.app/@handle. */
  canonicalUrl: string;
  /** Absolute URL of the generated link-preview card. */
  ogImageUrl: string | null;
};

type SiteHeader = Pick<StoreSiteModel, "handle" | "displayName" | "logoUrl" | "theme" | "canonicalUrl">;

export type StoreCheckoutModel = {
  site: SiteHeader;
  /** /@handle — where the back arrow goes. */
  storePath: string;
  productId: string;
  kind: BlockKind;
  title: string;
  image: string | null;
  description: string;
  priceLabel: string;
  compareAtLabel: string;
  shipByLabel: string;
  /** Variants the buyer can pick (one = no picker). */
  variants: { id: string; label: string; priceLabel: string; soldOut: boolean }[];
  unavailableLabel: string | null;
  /** Stripe publishable key: payment is embedded on the page. Null = Stripe's hosted page. */
  stripePublishableKey: string | null;
  /** Path of the confirmation page (no query). */
  donePath: string;
  canonicalUrl: string;
};

export type StoreCheckoutDoneModel = {
  site: SiteHeader;
  storePath: string;
  title: string;
  image: string | null;
  shipByLabel: string;
};

const SHARE_SCRIPT =
  "document.getElementById('share').addEventListener('click',function(){var u=this.getAttribute('data-url');" +
  "if(navigator.share){navigator.share({url:u}).catch(function(){});return}" +
  "if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){var t=document.getElementById('toast');t.hidden=false;setTimeout(function(){t.hidden=true},1600)})}})";

/**
 * Checkout: creates a guest checkout for the picked variant, then mounts
 * Stripe's embedded payment form under the details (Apple Pay / card) — or,
 * without a publishable key, continues on Stripe's hosted page. Config comes
 * from data- attributes so the script itself never changes (CSP hash).
 */
const CHECKOUT_SCRIPT = `(function(){
var f=document.getElementById('co');if(!f)return;
var err=document.getElementById('err'),go=document.getElementById('go'),label=go.textContent,pk=f.getAttribute('data-pk');
function fail(m){if(!m||/[a-z][A-Z]/.test(m))m='Something went wrong. Check your details and try again.';err.textContent=m;err.hidden=false;go.disabled=false;go.textContent=label}
function key(){return window.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2)}
f.addEventListener('submit',function(e){
e.preventDefault();err.hidden=true;go.disabled=true;go.textContent='Loading…';
function v(n){var el=f.elements[n];return el?String(el.value).trim():''}
var q=new URLSearchParams(location.search),done=location.origin+f.getAttribute('data-done');
var body={items:[{productId:f.getAttribute('data-product'),variantId:v('variant'),quantity:1}],
successUrl:done+'?session_id={CHECKOUT_SESSION_ID}',cancelUrl:location.href,contactEmail:v('email'),contactPhone:v('phone'),
shippingAddress:{name:v('name'),street:v('street'),line2:v('line2')||null,city:v('city'),state:v('state'),zip:v('zip'),country:v('country'),phone:v('phone')},
clientIdempotencyKey:'site_'+key(),
attribution:{source:q.get('utm_source')||'brandthread_site',medium:q.get('utm_medium')||'link_in_bio',campaign:q.get('utm_campaign')||undefined,code:q.get('bt_lc')||q.get('l')||undefined}};
if(pk)body.uiMode='embedded';
fetch('/api/guest/checkout/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
.then(function(r){return r.json().catch(function(){return{}}).then(function(j){return{ok:r.ok,j:j}})})
.then(function(x){var j=x.j||{};
if(!x.ok)return fail(j.error);
try{sessionStorage.setItem('bt_gat_'+j.sessionId,j.guestAccessToken)}catch(_){}
if(pk&&j.clientSecret&&window.Stripe){return Stripe(pk).initEmbeddedCheckout({fetchClientSecret:function(){return Promise.resolve(j.clientSecret)}}).then(function(c){
f.hidden=true;var p=document.getElementById('pay');p.hidden=false;c.mount('#pay');p.scrollIntoView({block:'start'})})}
if(j.url){location.href=j.url;return}
fail();
}).catch(function(){fail()});
});
})();`;

/** Confirmation: shows the order number once the order exists (guest token kept from checkout). */
const DONE_SCRIPT = `(function(){
var el=document.getElementById('num');if(!el)return;
var id=new URLSearchParams(location.search).get('session_id'),t=null,n=0;if(!id)return;
try{t=sessionStorage.getItem('bt_gat_'+id)}catch(_){}if(!t)return;
function poll(){fetch('/api/guest/checkout/session/'+encodeURIComponent(id)+'/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({guestAccessToken:t})})
.then(function(r){return r.ok?r.json():null}).then(function(j){if(!j)return;
if(j.orderNumber){el.textContent='Order #'+j.orderNumber;el.hidden=false;return}
if(++n<8)setTimeout(poll,2000)}).catch(function(){})}
poll();
})();`;

const hash = (src: string) => `'sha256-${crypto.createHash("sha256").update(src).digest("base64")}'`;

/** CSP source for the inline share script. */
export const SHARE_SCRIPT_HASH = hash(SHARE_SCRIPT);
export const CHECKOUT_SCRIPT_HASH = hash(CHECKOUT_SCRIPT);
export const DONE_SCRIPT_HASH = hash(DONE_SCRIPT);

const BASE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; frame-ancestors 'none'";

export const STORE_SITE_CSP = `${BASE_CSP}; script-src ${SHARE_SCRIPT_HASH}; form-action 'none'`;
export const STORE_DONE_CSP = `${BASE_CSP}; script-src ${DONE_SCRIPT_HASH}; connect-src 'self'; form-action 'none'`;

/** Checkout page CSP; Stripe's origins only when payment is embedded. */
export function storeCheckoutCsp(embedded: boolean): string {
  const stripe = embedded ? " https://js.stripe.com" : "";
  return `${BASE_CSP}; script-src ${CHECKOUT_SCRIPT_HASH}${stripe}; connect-src 'self'${embedded ? " https://api.stripe.com https://checkout.stripe.com" : ""}${embedded ? "; frame-src https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com" : ""}; form-action 'self'`;
}

const ICONS: Record<string, string> = {
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>',
  tiktok: '<path d="M9 12a4 4 0 1 0 4 4V3a5 5 0 0 0 5 5"/>',
  youtube: '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/>',
  x: '<line x1="4" y1="4" x2="20" y2="20"/><line x1="20" y1="4" x2="4" y2="20"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  website: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  email: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
};
const SOCIAL_LABEL: Record<string, string> = {
  instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", x: "X", facebook: "Facebook", website: "Website", email: "Email",
};
const SHARE_ICON = '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>';
const BACK_ICON = '<polyline points="15 18 9 12 15 6"/>';

/** Countries the checkout offers; the seller's shipping zones decide what's actually shippable. */
export const CHECKOUT_COUNTRIES: readonly [string, string][] = [
  ["US", "United States"], ["CA", "Canada"], ["GB", "United Kingdom"], ["AU", "Australia"], ["NZ", "New Zealand"],
  ["IE", "Ireland"], ["DE", "Germany"], ["FR", "France"], ["ES", "Spain"], ["IT", "Italy"], ["NL", "Netherlands"],
  ["SE", "Sweden"], ["DK", "Denmark"], ["NO", "Norway"], ["JP", "Japan"], ["MX", "Mexico"],
];

const https = (u: string | null | undefined): u is string => typeof u === "string" && /^https:\/\//i.test(u);
const svg = (paths: string, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

function baseCss(theme: StoreSiteTheme): string {
  return `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:${theme.bg};color:${theme.fg};font-family:${SYSTEM_FONT};-webkit-font-smoothing:antialiased;min-height:100vh}
main{width:min(100%,480px);margin:0 auto;padding:0 16px calc(32px + env(safe-area-inset-bottom));position:relative}
a{color:inherit}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid ${theme.fg};outline-offset:2px}
ul{list-style:none;margin:0;padding:0}
.top{display:flex;justify-content:space-between;align-items:center;height:56px;margin-top:env(safe-area-inset-top)}
.ib{display:grid;place-items:center;width:44px;height:44px;border:0;background:none;color:${theme.fg};cursor:pointer;text-decoration:none;padding:0}
.btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:50px;padding:14px 20px;border:0;border-radius:12px;background:${theme.buttonBg};color:${theme.buttonFg};text-decoration:none;font:600 16px ${SYSTEM_FONT};text-align:center;cursor:pointer;overflow-wrap:anywhere}
.btn:active{opacity:.8}.btn:disabled{opacity:.5;cursor:default}
.pr{font-variant-numeric:tabular-nums}
.pr s{color:${theme.muted};font-weight:400;margin-left:6px}
footer{margin-top:40px;text-align:center;font-size:13px;color:${theme.muted}}
footer a{text-decoration:none;font-weight:600;color:${theme.fg}}
.toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:${theme.fg};color:${theme.bg};padding:10px 16px;border-radius:12px;font-size:15px;font-weight:600}`;
}

function head(opts: { title: string; desc: string; canonical: string; theme: StoreSiteTheme; ogImage: string | null; ogType: string; css: string; noindex?: boolean; extra?: string }): string {
  const t = esc(opts.title);
  const d = esc(opts.desc.slice(0, 200));
  const img = opts.ogImage
    ? `<meta property="og:image" content="${esc(opts.ogImage)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(opts.ogImage)}">`
    : `<meta name="twitter:card" content="summary">`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${t}</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${esc(opts.canonical)}">
<meta property="og:type" content="${esc(opts.ogType)}"><meta property="og:site_name" content="Brandthread">
<meta property="og:title" content="${t}"><meta property="og:description" content="${d}"><meta property="og:url" content="${esc(opts.canonical)}">
<meta name="twitter:title" content="${t}"><meta name="twitter:description" content="${d}">
${img}
<meta name="theme-color" content="${opts.theme.bg}">
${opts.noindex ? '<meta name="robots" content="noindex">' : ""}${opts.extra ?? ""}
<style>${opts.css}</style></head>`;
}

const footer = `<footer>Powered by <a href="https://brandthread.app" rel="noopener">Brandthread</a></footer>`;

const nameOf = (s: Pick<StoreSiteModel, "displayName" | "handle">) => s.displayName.trim() || `@${s.handle}`;

function priceHtml(price: string, compareAt: string): string {
  if (!price) return "";
  return `<span class="pr">${esc(price)}${compareAt ? `<s>${esc(compareAt)}</s>` : ""}</span>`;
}

function blockHtml(b: StoreSiteBlock, i: number): string {
  const img = (cls: string, size: number) => https(b.image)
    ? `<img class="${cls}" src="${esc(b.image)}" alt=""${i < 3 ? "" : ' loading="lazy"'} width="${size}" height="${size}">`
    : `<span class="${cls}" aria-hidden="true"></span>`;
  const meta = [b.shipByLabel].filter(Boolean).map((m) => `<span class="sb">${esc(m)}</span>`).join("");
  const off = !!b.unavailableLabel;
  const tag = off ? "div" : "a";
  const href = off ? ' aria-disabled="true"' : ` href="${esc(b.href)}"`;
  if (b.style === "button") {
    const line = [b.priceLabel, b.shipByLabel, b.unavailableLabel].filter(Boolean).join(" · ");
    return `<li><${tag} class="blk bt${off ? " off" : ""}"${href}>${img("th sm", 48)}<span class="tx"><span class="tt">${esc(b.title)}</span>${line ? `<span class="ln">${esc(line)}</span>` : ""}</span></${tag}></li>`;
  }
  return `<li><${tag} class="blk co${off ? " off" : ""}"${href}><span class="row">${img("th", 88)}<span class="tx"><span class="tt">${esc(b.title)}</span>${b.subtitle ? `<span class="st">${esc(b.subtitle)}</span>` : ""}${priceHtml(b.priceLabel, b.compareAtLabel)}${meta}</span></span><span class="btn cta">${esc(b.unavailableLabel ?? b.buttonText)}</span></${tag}></li>`;
}

export function renderStoreSite(m: StoreSiteModel): string {
  const { theme } = m;
  const name = nameOf(m);
  const desc = m.bio.trim() || `Shop ${name} on Brandthread`;
  const initial = esc((name.replace(/^@/, "").trim()[0] ?? "B").toUpperCase());

  const css = `${baseCss(theme)}
.top{justify-content:flex-end}
.hero{text-align:center}
.logo{display:block;width:104px;height:104px;border-radius:50%;object-fit:cover;margin:0 auto 14px;background:${theme.card}}
.ph{display:grid;place-items:center;font-size:40px;font-weight:700;color:${theme.fg}}
h1{font-size:24px;line-height:1.2;margin:0 0 6px;font-weight:700;overflow-wrap:anywhere}
.bio{margin:0 auto;max-width:36ch;color:${theme.muted};font-size:15px;line-height:1.45;overflow-wrap:anywhere}
.socs{display:flex;gap:4px;justify-content:center;flex-wrap:wrap;margin-top:10px}
.soc{display:grid;place-items:center;width:44px;height:44px;color:${theme.fg};text-decoration:none}
.blocks{display:grid;gap:12px;margin-top:24px}
.blk{display:block;text-decoration:none;color:${theme.fg};border-radius:16px}
.co{background:${theme.card};padding:12px}
.row{display:flex;gap:14px;align-items:flex-start}
.th{flex:0 0 auto;display:block;width:88px;height:88px;border-radius:12px;object-fit:cover;background:${theme.line}}
.tx{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.tt{font-size:16px;font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.st{font-size:14px;line-height:1.35;color:${theme.muted};display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.co .pr{font-size:15px;font-weight:600;margin-top:2px}
.sb{font-size:13px;color:${theme.muted}}
.cta{margin-top:12px;min-height:46px;padding:12px 16px}
.bt{display:flex;align-items:center;gap:12px;min-height:64px;padding:8px 16px 8px 8px;background:${theme.buttonBg};color:${theme.buttonFg}}
.th.sm{width:48px;height:48px;border-radius:10px;background:${theme.card}}
.bt .ln{font-size:13px;opacity:.75}
.off{opacity:.55}.co.off .cta{background:${theme.line};color:${theme.fg}}
a.blk:active{opacity:.85}`;

  const logo = https(m.logoUrl)
    ? `<img class="logo" src="${esc(m.logoUrl)}" alt="${esc(name)}" width="104" height="104" fetchpriority="high">`
    : `<div class="logo ph" aria-hidden="true">${initial}</div>`;
  const socials = m.socials.filter((s) => (SOCIAL_KEYS as readonly string[]).includes(s.key) && ICONS[s.key]).map((s) =>
    `<a class="soc" href="${esc(s.href)}" rel="noopener nofollow me" aria-label="${esc(SOCIAL_LABEL[s.key] ?? s.key)}">${svg(ICONS[s.key])}</a>`).join("");
  const blocks = m.blocks.length
    ? `<section aria-label="Products"><ul class="blocks">${m.blocks.map(blockHtml).join("")}</ul></section>`
    : "";

  return `${head({ title: name, desc, canonical: m.canonicalUrl, theme, ogImage: m.ogImageUrl, ogType: "profile", css })}
<body><main>
<div class="top"><button class="ib" id="share" type="button" data-url="${esc(m.canonicalUrl)}" aria-label="Share">${svg(SHARE_ICON, 22)}</button></div>
<header class="hero">${logo}<h1>${esc(name)}</h1>${m.bio.trim() ? `<p class="bio">${esc(m.bio.trim())}</p>` : ""}${socials ? `<nav class="socs" aria-label="Social links">${socials}</nav>` : ""}</header>
${blocks}
${footer}
</main><div class="toast" id="toast" role="status" hidden>Link copied</div>
<script>${SHARE_SCRIPT}</script></body></html>`;
}

function checkoutCss(theme: StoreSiteTheme): string {
  return `${baseCss(theme)}
.hero{display:block;width:100%;height:auto;aspect-ratio:1/1;object-fit:cover;border-radius:16px;background:${theme.card}}
h1{font-size:24px;line-height:1.25;margin:20px 0 6px;font-weight:700;overflow-wrap:anywhere}
.co-pr{font-size:20px;font-weight:600;margin:0}
.sb{margin:6px 0 0;font-size:15px;color:${theme.muted}}
.desc{margin:16px 0 0;color:${theme.muted};font-size:15px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
form{margin-top:24px;display:grid;gap:12px}
h2{font-size:17px;font-weight:600;margin:12px 0 0}
label{display:grid;gap:6px;font-size:13px;color:${theme.muted}}
input,select{width:100%;min-height:48px;padding:12px 14px;border:1px solid ${theme.line};border-radius:12px;background:${theme.card};color:${theme.fg};font:16px ${SYSTEM_FONT};-webkit-appearance:none;appearance:none}
select{background-image:linear-gradient(45deg,transparent 50%,${theme.muted} 50%),linear-gradient(135deg,${theme.muted} 50%,transparent 50%);background-position:calc(100% - 20px) 21px,calc(100% - 15px) 21px;background-size:5px 5px;background-repeat:no-repeat;padding-right:36px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.err{margin:0;color:${theme.fg};font-size:15px;font-weight:600}
.go{margin-top:8px}
#pay{margin-top:24px;min-height:200px}`;
}

const field = (name: string, label: string, attrs: string) =>
  `<label>${esc(label)}<input name="${name}" ${attrs}></label>`;

export function renderStoreCheckout(m: StoreCheckoutModel): string {
  const { theme } = m.site;
  const storeName = nameOf(m.site);
  const available = m.variants.filter((v) => !v.soldOut);
  const embedded = !!m.stripePublishableKey;
  const unavailable = m.unavailableLabel ?? (available.length ? null : "Sold out");
  const picker = m.variants.length > 1
    ? `<label>Option<select name="variant" required>${m.variants.map((v) => `<option value="${esc(v.id)}"${v.soldOut ? " disabled" : ""}${v.id === available[0]?.id ? " selected" : ""}>${esc(v.label || "Default")}${m.variants.some((x) => x.priceLabel !== m.variants[0].priceLabel) ? ` · ${esc(v.priceLabel)}` : ""}${v.soldOut ? " · Sold out" : ""}</option>`).join("")}</select></label>`
    : `<input type="hidden" name="variant" value="${esc(available[0]?.id ?? m.variants[0]?.id ?? "")}">`;
  const countries = CHECKOUT_COUNTRIES.map(([code, label]) => `<option value="${code}">${esc(label)}</option>`).join("");
  const form = unavailable
    ? `<p class="sb" role="status">${esc(unavailable)}</p>`
    : `<form id="co" data-product="${esc(m.productId)}" data-done="${esc(m.donePath)}" data-pk="${esc(m.stripePublishableKey ?? "")}">
${picker}
${field("name", "Full name", 'autocomplete="name" required maxlength="120"')}
${field("email", "Email", 'type="email" autocomplete="email" inputmode="email" required maxlength="200"')}
${field("phone", "Phone", 'type="tel" autocomplete="tel" inputmode="tel" required maxlength="32"')}
<h2>Shipping address</h2>
${field("street", "Address", 'autocomplete="address-line1" required maxlength="160"')}
${field("line2", "Apt, suite (optional)", 'autocomplete="address-line2" maxlength="160"')}
${field("city", "City", 'autocomplete="address-level2" required maxlength="160"')}
<div class="two">${field("state", "State", 'autocomplete="address-level1" required maxlength="160"')}${field("zip", "ZIP code", 'autocomplete="postal-code" required maxlength="20"')}</div>
<label>Country<select name="country" autocomplete="country" required>${countries}</select></label>
<p class="err" id="err" role="alert" hidden></p>
<button class="btn go" id="go" type="submit">${m.kind === "preorder" ? "Continue to pre-order" : "Continue to payment"}</button>
</form>
<div id="pay" hidden></div>`;
  const image = https(m.image)
    ? `<img class="hero" src="${esc(m.image)}" alt="${esc(m.title)}" width="600" height="600" fetchpriority="high">`
    : "";
  return `${head({
    title: `${m.title} · ${storeName}`, desc: m.description || `${m.title} from ${storeName}`, canonical: m.canonicalUrl, theme,
    ogImage: null, ogType: "product", css: checkoutCss(theme),
    extra: embedded ? '<script src="https://js.stripe.com/v3/" async></script>' : "",
  })}
<body><main>
<div class="top"><a class="ib" href="${esc(m.storePath)}" aria-label="Back to ${esc(storeName)}">${svg(BACK_ICON, 26)}</a></div>
${image}
<h1>${esc(m.title)}</h1>
${m.priceLabel ? `<p class="co-pr">${priceHtml(m.priceLabel, m.compareAtLabel)}</p>` : ""}
${m.shipByLabel ? `<p class="sb">${esc(m.shipByLabel)}</p>` : ""}
${m.description ? `<p class="desc">${esc(m.description)}</p>` : ""}
${form}
${footer}
</main>
<script>${CHECKOUT_SCRIPT}</script></body></html>`;
}

export function renderStoreCheckoutDone(m: StoreCheckoutDoneModel): string {
  const { theme } = m.site;
  const storeName = nameOf(m.site);
  const css = `${baseCss(theme)}
.done{text-align:center;padding-top:24px}
.th{display:block;width:120px;height:120px;margin:0 auto 20px;border-radius:16px;object-fit:cover;background:${theme.card}}
h1{font-size:24px;margin:0 0 8px}
p{margin:0 0 6px;color:${theme.muted};font-size:15px}
.num{color:${theme.fg};font-weight:600}
.btn{margin-top:28px}`;
  return `${head({ title: `Thank you · ${storeName}`, desc: m.title, canonical: m.site.canonicalUrl, theme, ogImage: null, ogType: "website", css, noindex: true })}
<body><main>
<div class="top"><a class="ib" href="${esc(m.storePath)}" aria-label="Back to ${esc(storeName)}">${svg(BACK_ICON, 26)}</a></div>
<section class="done">
${https(m.image) ? `<img class="th" src="${esc(m.image)}" alt="" width="120" height="120">` : ""}
<h1>Thank you!</h1>
<p>${esc(m.title)}</p>
${m.shipByLabel ? `<p>${esc(m.shipByLabel)}</p>` : ""}
<p class="num" id="num" hidden></p>
<a class="btn" href="${esc(m.storePath)}">Back to ${esc(storeName)}</a>
</section>
${footer}
</main>
<script>${DONE_SCRIPT}</script></body></html>`;
}
