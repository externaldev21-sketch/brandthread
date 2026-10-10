/**
 * The seller's store website at brandthread.app/@handle — pure, server-rendered
 * HTML. Layout follows Linktree's public page (logo, name, bio, social icons,
 * then content, then a small footer), with a 3:4 product grid in place of most
 * links. No web fonts, no third-party requests; one tiny inline script for the
 * share button (allowed by hash in the CSP, see SHARE_SCRIPT_HASH).
 */
import crypto from "node:crypto";
import { esc } from "./bioPage";
import { SOCIAL_KEYS } from "./bioValidation";
import { STORE_SITE_FONTS, type ButtonStyle, type StoreSiteFont, type StoreSiteTheme } from "./storeSiteDesign";

export type StoreSiteProduct = {
  id: string;
  name: string;
  /** Link to the product page on this site. */
  href: string;
  image: string | null;
  priceLabel: string;
};

export type StoreSiteModel = {
  handle: string;
  displayName: string;
  bio: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  theme: StoreSiteTheme;
  buttonStyle: ButtonStyle;
  font: StoreSiteFont;
  socials: { key: string; href: string }[];
  products: StoreSiteProduct[];
  links: { href: string; title: string }[];
  /** Absolute https://brandthread.app/@handle. */
  canonicalUrl: string;
  /** Absolute URL of the generated link-preview card. */
  ogImageUrl: string | null;
};

export type StoreSiteProductModel = {
  site: Pick<StoreSiteModel, "handle" | "displayName" | "logoUrl" | "theme" | "buttonStyle" | "font" | "canonicalUrl">;
  product: { name: string; description: string; images: string[]; priceLabel: string };
  /** Where Buy goes: the app when installed (Android intent), else web checkout. */
  buyHref: string;
  canonicalUrl: string;
};

const SHARE_SCRIPT =
  "document.getElementById('share').addEventListener('click',function(){var u=this.getAttribute('data-url');" +
  "if(navigator.share){navigator.share({url:u}).catch(function(){});return}" +
  "if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){var t=document.getElementById('toast');t.hidden=false;setTimeout(function(){t.hidden=true},1600)})}})";

/** CSP source for the inline share script. */
export const SHARE_SCRIPT_HASH = `'sha256-${crypto.createHash("sha256").update(SHARE_SCRIPT).digest("base64")}'`;

export const STORE_SITE_CSP =
  `default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; script-src ${SHARE_SCRIPT_HASH}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

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

const https = (u: string | null | undefined): u is string => typeof u === "string" && /^https:\/\//i.test(u);
const svg = (paths: string, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

function baseCss(theme: StoreSiteTheme, buttonStyle: ButtonStyle, font: StoreSiteFont): string {
  const r = buttonStyle === "square" ? "0" : "12px";
  const tile = buttonStyle === "square" ? "0" : "8px";
  return `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:${theme.bg};color:${theme.fg};font-family:${STORE_SITE_FONTS[font].stack};-webkit-font-smoothing:antialiased;min-height:100vh}
main{width:min(100%,560px);margin:0 auto;padding:0 16px 32px;position:relative}
a{color:inherit}a:focus-visible,button:focus-visible{outline:3px solid ${theme.fg};outline-offset:3px}
ul{list-style:none;margin:0;padding:0}
.top{display:flex;justify-content:flex-end;align-items:center;height:56px;padding-top:env(safe-area-inset-top)}
.ib{display:grid;place-items:center;width:44px;height:44px;border:0;border-radius:50%;background:${theme.line};color:${theme.fg};cursor:pointer;text-decoration:none}
.btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;padding:14px 20px;border-radius:${r};background:${theme.buttonBg};color:${theme.buttonFg};text-decoration:none;font-weight:600;font-size:16px;text-align:center;overflow-wrap:anywhere}
.btn:active{opacity:.8}
.img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:${tile};background:${theme.line}}
.price{font-variant-numeric:tabular-nums}
footer{margin-top:40px;text-align:center;font-size:13px;color:${theme.muted}}
footer a{text-decoration:none;font-weight:600;color:${theme.fg}}
.toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:${theme.fg};color:${theme.bg};padding:10px 16px;border-radius:12px;font-size:15px;font-weight:600}`;
}

function head(opts: { title: string; desc: string; canonical: string; theme: StoreSiteTheme; ogImage: string | null; ogType: string; css: string; noindex?: boolean }): string {
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
${opts.noindex ? '<meta name="robots" content="noindex">' : ""}
<style>${opts.css}</style></head>`;
}

const footer = `<footer>Powered by <a href="https://brandthread.app" rel="noopener">Brandthread</a></footer>`;

export function renderStoreSite(m: StoreSiteModel): string {
  const { theme } = m;
  const name = m.displayName.trim() || `@${m.handle}`;
  const desc = m.bio.trim() || `Shop ${name} on Brandthread`;
  const initial = esc((name.replace(/^@/, "").trim()[0] ?? "B").toUpperCase());
  const hasBanner = https(m.bannerUrl);

  const css = `${baseCss(theme, m.buttonStyle, m.font)}
.banner{display:block;width:calc(100% + 32px);margin:0 -16px;aspect-ratio:3/1;object-fit:cover;background:${theme.line}}
.top.over{position:absolute;top:0;right:16px;left:16px}
.hero{text-align:center}
.logo{display:block;width:96px;height:96px;border-radius:50%;object-fit:cover;margin:8px auto 16px;background:${theme.line}}
.with-banner .logo{margin-top:-48px;border:3px solid ${theme.bg}}
.ph{display:grid;place-items:center;font-size:36px;font-weight:700;color:${theme.fg}}
h1{font-size:22px;line-height:1.25;margin:0 0 6px;font-weight:700;overflow-wrap:anywhere}
.bio{margin:0 auto;max-width:40ch;color:${theme.muted};font-size:15px;line-height:1.45;overflow-wrap:anywhere}
.socs{display:flex;gap:4px;justify-content:center;flex-wrap:wrap;margin-top:12px}
.soc{display:grid;place-items:center;width:44px;height:44px;color:${theme.fg};text-decoration:none}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 12px;margin-top:28px}
@media (min-width:720px){main{width:min(100%,880px)}.grid{grid-template-columns:repeat(3,minmax(0,1fr))}.links{width:min(100%,560px);margin-left:auto;margin-right:auto}}
.grid a{display:block;text-decoration:none}
.pn{display:block;margin-top:8px;font-size:15px;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp{display:block;margin-top:2px;font-size:15px;color:${theme.muted}}
.links{display:grid;gap:12px;margin-top:28px}`;

  const banner = hasBanner ? `<img class="banner" src="${esc(m.bannerUrl)}" alt="" fetchpriority="high">` : "";
  const logo = https(m.logoUrl)
    ? `<img class="logo" src="${esc(m.logoUrl)}" alt="${esc(name)}" width="96" height="96"${hasBanner ? "" : ' fetchpriority="high"'}>`
    : `<div class="logo ph" aria-hidden="true">${initial}</div>`;
  const socials = m.socials.filter((s) => (SOCIAL_KEYS as readonly string[]).includes(s.key) && ICONS[s.key]).map((s) =>
    `<a class="soc" href="${esc(s.href)}" rel="noopener nofollow me" aria-label="${esc(SOCIAL_LABEL[s.key] ?? s.key)}">${svg(ICONS[s.key])}</a>`).join("");
  const grid = m.products.length
    ? `<section aria-label="Products"><ul class="grid">${m.products.map((p, i) =>
        `<li><a href="${esc(p.href)}">${https(p.image) ? `<img class="img" src="${esc(p.image)}" alt="${esc(p.name)}"${i < 4 ? "" : ' loading="lazy"'} width="300" height="400">` : `<span class="img" aria-hidden="true"></span>`}<span class="pn">${esc(p.name)}</span>${p.priceLabel ? `<span class="pp price">${esc(p.priceLabel)}</span>` : ""}</a></li>`).join("")}</ul></section>`
    : "";
  const links = m.links.length
    ? `<ul class="links">${m.links.map((l) => `<li><a class="btn" href="${esc(l.href)}" rel="noopener nofollow">${esc(l.title)}</a></li>`).join("")}</ul>`
    : "";

  return `${head({ title: name, desc, canonical: m.canonicalUrl, theme, ogImage: m.ogImageUrl, ogType: "profile", css })}
<body><main${hasBanner ? ' class="with-banner"' : ""}>
<div class="top${hasBanner ? " over" : ""}"><button class="ib" id="share" type="button" data-url="${esc(m.canonicalUrl)}" aria-label="Share">${svg(SHARE_ICON, 20)}</button></div>
${banner}
<header class="hero">${logo}<h1>${esc(name)}</h1>${m.bio.trim() ? `<p class="bio">${esc(m.bio.trim())}</p>` : ""}${socials ? `<nav class="socs" aria-label="Social links">${socials}</nav>` : ""}</header>
${grid}
${links}
${footer}
</main><div class="toast" id="toast" role="status" hidden>Link copied</div>
<script>${SHARE_SCRIPT}</script></body></html>`;
}

export function renderStoreSiteProduct(m: StoreSiteProductModel): string {
  const { theme } = m.site;
  const storeName = m.site.displayName.trim() || `@${m.site.handle}`;
  const images = m.product.images.filter(https).slice(0, 8);
  const css = `${baseCss(theme, m.site.buttonStyle, m.site.font)}
.top{justify-content:space-between}
.store{display:flex;align-items:center;gap:8px;text-decoration:none;font-weight:600;font-size:15px;min-height:44px}
.store img{width:28px;height:28px;border-radius:50%;object-fit:cover}
.gal{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;margin:0 -16px;padding:0 16px;scrollbar-width:none}
.gal::-webkit-scrollbar{display:none}
.gal .img{flex:0 0 ${images.length > 1 ? "86%" : "100%"};scroll-snap-align:center}
h1{font-size:22px;line-height:1.25;margin:20px 0 4px;font-weight:700;overflow-wrap:anywhere}
.pp{font-size:17px;color:${theme.fg};margin:0}
.desc{margin:16px 0 0;color:${theme.muted};font-size:15px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.buy{margin-top:24px}
@media (min-width:720px){main{width:min(100%,560px)}}`;
  const gallery = images.length
    ? `<div class="gal">${images.map((src, i) => `<img class="img" src="${esc(src)}" alt="${esc(m.product.name)}${images.length > 1 ? ` ${i + 1} of ${images.length}` : ""}"${i ? ' loading="lazy"' : ' fetchpriority="high"'} width="600" height="800">`).join("")}</div>`
    : `<div class="gal"><span class="img" aria-hidden="true"></span></div>`;
  const title = `${m.product.name} · ${storeName}`;
  return `${head({ title, desc: m.product.description || `${m.product.name} from ${storeName}`, canonical: m.canonicalUrl, theme, ogImage: images[0] ?? null, ogType: "product", css })}
<body><main>
<div class="top"><a class="store" href="${esc(m.site.canonicalUrl)}"><span class="ib" aria-hidden="true">${svg(BACK_ICON, 20)}</span>${https(m.site.logoUrl) ? `<img src="${esc(m.site.logoUrl)}" alt="">` : ""}<span>${esc(storeName)}</span></a><button class="ib" id="share" type="button" data-url="${esc(m.canonicalUrl)}" aria-label="Share">${svg(SHARE_ICON, 20)}</button></div>
${gallery}
<h1>${esc(m.product.name)}</h1>
${m.product.priceLabel ? `<p class="pp price">${esc(m.product.priceLabel)}</p>` : ""}
<a class="btn buy" href="${esc(m.buyHref)}" rel="nofollow">Buy</a>
${m.product.description ? `<p class="desc">${esc(m.product.description)}</p>` : ""}
${footer}
</main><div class="toast" id="toast" role="status" hidden>Link copied</div>
<script>${SHARE_SCRIPT}</script></body></html>`;
}

/**
 * Buy link. Android opens the app when installed (intent URL with a browser
 * fallback); everywhere else it's the web product page, which iOS hands to the
 * app through universal links when it is installed and the link comes from
 * another site, and otherwise offers web checkout.
 */
export function storeSiteBuyHref(userAgent: string | undefined, webUrl: string, productId: string): string {
  if (/Android/i.test(userAgent ?? "")) {
    return `intent://store/product/${encodeURIComponent(productId)}#Intent;scheme=brandthread;package=com.brandthread.mobile;S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
  }
  return webUrl;
}
