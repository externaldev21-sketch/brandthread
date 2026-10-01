/**
 * Meta / TikTok pixel injection for the public store site.
 *
 * SAFETY MODEL: sellers type an ID, never code. An ID is only ever placed in
 * the page after passing a strict allow-list regex, and then only inside a
 * JSON-encoded JS string literal (and, for the Meta <noscript> fallback, a
 * digits-only URL parameter). Everything else in the output is a constant.
 * `buildPixelInjection` re-validates its inputs, so even a bad value that
 * somehow reached the database cannot turn into markup.
 *
 * PRIVACY: nothing is emitted when the request carries Sec-GPC: 1 or DNT: 1,
 * and the emitted script also checks navigator.globalPrivacyControl /
 * navigator.doNotTrack at runtime (covers cached HTML). Events go through
 * window.btPixel, which no-ops when the base code did not load.
 */

/** Meta Pixel IDs are numeric, 15-16 digits in practice; accept 10-20. */
export const META_PIXEL_RE = /^[0-9]{10,20}$/;
/** TikTok Pixel IDs are 20 uppercase alphanumerics in practice; accept 10-30. */
export const TIKTOK_PIXEL_RE = /^[A-Z0-9]{10,30}$/;

export function validateMetaPixelId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return META_PIXEL_RE.test(v) ? v : null;
}

export function validateTikTokPixelId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return TIKTOK_PIXEL_RE.test(v) ? v : null;
}

/** True when the visitor signalled they do not want to be tracked. */
export function requestOptsOutOfTracking(headers: Record<string, string | string[] | undefined>): boolean {
  const one = (name: string) => {
    const v = headers[name];
    return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
  };
  return one("sec-gpc") === "1" || one("dnt") === "1";
}

const CART_KEY_RE = /^bt_cart_[0-9a-zA-Z-]{1,64}$/;

export type PixelInjection = { head: string; body: string };

const EMPTY: PixelInjection = { head: "", body: "" };

// Escape a JSON string so it is safe inside an inline <script> (no </script>, no U+2028/9).
function jsString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const OPT_OUT_GUARD =
  `var n=navigator;if(n.globalPrivacyControl===true||n.doNotTrack==="1"||window.doNotTrack==="1"||n.msDoNotTrack==="1")return;`;

function metaBase(id: string): string {
  return (
    `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};` +
    `if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;` +
    `s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");` +
    `fbq("init",${jsString(id)});fbq("track","PageView");`
  );
}

function tiktokBase(id: string): string {
  return (
    `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],` +
    `ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};` +
    `for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);` +
    `ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},` +
    `ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};` +
    `var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};` +
    `ttq.load(${jsString(id)});ttq.page();}(window,document,"ttq");`
  );
}

/**
 * Constant event wiring. Holds no seller data: the cart storage key is passed
 * in separately as a validated JSON string.
 */
function eventsScript(cartKeyLiteral: string, hasMeta: boolean, hasTikTok: boolean): string {
  return (
    `(function(){` + OPT_OUT_GUARD +
    `var HAS_META=${hasMeta ? "true" : "false"},HAS_TT=${hasTikTok ? "true" : "false"},CART_KEY=${cartKeyLiteral};` +
    `var TT={ViewContent:"ViewContent",AddToCart:"AddToCart",InitiateCheckout:"InitiateCheckout",Purchase:"CompletePayment"};` +
    `function track(name,data){try{if(HAS_META&&window.fbq)window.fbq("track",name,data);` +
    `if(HAS_TT&&window.ttq)window.ttq.track(TT[name]||name,data);}catch(e){}}` +
    `window.btPixel={track:track};` +
    `function readCart(){try{return JSON.parse(localStorage.getItem(CART_KEY)||"[]")||[]}catch(e){return[]}}` +
    `function ss(k,v){try{if(v===undefined)return sessionStorage.getItem(k);if(v===null)sessionStorage.removeItem(k);else sessionStorage.setItem(k,v)}catch(e){return null}}` +
    `function ready(f){document.readyState==="loading"?document.addEventListener("DOMContentLoaded",f):f()}` +
    `ready(function(){var ids=[].map.call(document.querySelectorAll(".add-to-cart-btn[data-product-id]"),function(b){return b.getAttribute("data-product-id")});` +
    `if(ids.length)track("ViewContent",{content_type:"product",content_ids:ids,currency:"USD"});` +
    `if(/[?&]checkout=success(&|$)/.test(location.search)&&!ss("bt_px_done")){var last={};try{last=JSON.parse(ss("bt_px_last")||"{}")||{}}catch(e){}` +
    `track("Purchase",{value:(last.value||0)/100,currency:"USD",content_type:"product",content_ids:last.ids||[]});ss("bt_px_done","1");ss("bt_px_last",null)}});` +
    `document.addEventListener("click",function(e){var t=e.target&&e.target.closest?e.target:null;if(!t)return;` +
    `var add=t.closest(".add-to-cart-btn");if(add&&!add.disabled){var p=parseInt(add.getAttribute("data-price"),10)||0;` +
    `track("AddToCart",{content_type:"product",content_ids:[add.getAttribute("data-product-id")],contents:[{id:add.getAttribute("data-product-id"),quantity:1}],value:p/100,currency:"USD"});return}` +
    `if(t.closest("#bt-cart-checkout-btn")){var items=readCart();var v=items.reduce(function(n,i){return n+(i.priceCents||0)*(i.quantity||1)},0);` +
    `var ids2=items.map(function(i){return i.productId});ss("bt_px_last",JSON.stringify({value:v,ids:ids2}));ss("bt_px_done",null);` +
    `track("InitiateCheckout",{content_type:"product",content_ids:ids2,num_items:items.length,value:v/100,currency:"USD"})}},true);` +
    `})();`
  );
}

export type PixelInput = {
  metaPixelId?: string | null;
  tiktokPixelId?: string | null;
  /** localStorage key the store page keeps its cart under. */
  cartKey?: string | null;
  /** Result of requestOptsOutOfTracking for this request. */
  optOut?: boolean;
};

/**
 * Returns HTML to place in <head> (`head`) — base codes and event wiring in a
 * single <script> plus the Meta <noscript> image. `body` is reserved (empty)
 * so callers have one stable shape.
 */
export function buildPixelInjection(input: PixelInput): PixelInjection {
  if (input.optOut) return EMPTY;
  const meta = validateMetaPixelId(input.metaPixelId);
  const tiktok = validateTikTokPixelId(input.tiktokPixelId);
  if (!meta && !tiktok) return EMPTY;
  const cartKey = typeof input.cartKey === "string" && CART_KEY_RE.test(input.cartKey) ? input.cartKey : "bt_cart_unknown";

  const bases = [meta ? metaBase(meta) : "", tiktok ? tiktokBase(tiktok) : ""].join("");
  const script = `<script>(function(){${OPT_OUT_GUARD}${bases}})();</script>\n<script>${eventsScript(jsString(cartKey), !!meta, !!tiktok)}</script>`;
  const noscript = meta
    ? `\n<noscript><img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${meta}&amp;ev=PageView&amp;noscript=1"></noscript>`
    : "";
  return { head: script + noscript, body: "" };
}

/**
 * First-party attribution capture (no third party involved): remembers the
 * tracked-link code and UTM params from the landing URL for this tab, so the
 * checkout request can carry them. Constant script, no interpolation.
 */
export const ATTRIBUTION_SCRIPT =
  `<script>(function(){try{var q=new URLSearchParams(location.search),a={};` +
  `var m={source:"utm_source",medium:"utm_medium",campaign:"utm_campaign",code:"bt_lc"};` +
  `var any=false;for(var k in m){var v=q.get(m[k]);if(v){a[k]=v.slice(0,80);any=true}}` +
  `if(any)sessionStorage.setItem("bt_attr",JSON.stringify(a));` +
  `window.__btAttribution=JSON.parse(sessionStorage.getItem("bt_attr")||"null")||undefined}catch(e){}})();</script>`;
