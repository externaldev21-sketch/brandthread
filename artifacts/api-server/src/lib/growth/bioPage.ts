/** Pure, server-rendered link-in-bio HTML. No JS, no third-party requests. */
import { SOCIAL_KEYS } from "./bioValidation";

export type BioPageModel = {
  slug: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  theme: "mono" | "dark";
  accentColor: string | null;
  /** Where "Shop my store" goes (tracked redirect), or null to hide the button. */
  shop: { href: string; label: string } | null;
  products: { href: string; name: string; image: string | null; priceLabel: string }[];
  links: { href: string; title: string }[];
  socials: { key: string; href: string }[];
  /** Absolute canonical URL of this page. */
  canonicalUrl: string;
};

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
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

function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#0a0a0b" : "#ffffff";
}

export function renderBioPage(m: BioPageModel): string {
  const dark = m.theme === "dark";
  const bg = dark ? "#0a0a0b" : "#ffffff";
  const fg = dark ? "#f5f5f5" : "#0a0a0b";
  const muted = dark ? "#a6a6a6" : "#6b6b6b";
  const line = dark ? "#2b2b2b" : "#e4e4e4";
  const btnBg = m.accentColor ?? fg;
  const btnFg = m.accentColor ? textOn(m.accentColor) : bg;

  const name = m.displayName || "Link in bio";
  const desc = m.bio || `${name} on Brandthread`;
  const initial = esc((name.trim()[0] ?? "B").toUpperCase());
  const avatar = m.avatarUrl && /^https:\/\//i.test(m.avatarUrl)
    ? `<img class="avatar" src="${esc(m.avatarUrl)}" alt="" width="96" height="96" fetchpriority="high">`
    : `<div class="avatar ph" aria-hidden="true">${initial}</div>`;

  const socials = m.socials.filter((s) => (SOCIAL_KEYS as readonly string[]).includes(s.key)).map((s) =>
    `<a class="soc" href="${esc(s.href)}" rel="noopener nofollow" aria-label="${esc(SOCIAL_LABEL[s.key] ?? s.key)}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[s.key] ?? ""}</svg></a>`).join("");

  const shop = m.shop ? `<a class="btn primary" href="${esc(m.shop.href)}" rel="nofollow">${esc(m.shop.label)}</a>` : "";
  const products = m.products.length
    ? `<section aria-label="Featured products"><ul class="prods">${m.products.map((p) =>
        `<li><a href="${esc(p.href)}" rel="nofollow">${p.image && /^https:\/\//i.test(p.image) ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" width="160" height="200">` : `<span class="noimg" aria-hidden="true"></span>`}<span class="pn">${esc(p.name)}</span><span class="pp">${esc(p.priceLabel)}</span></a></li>`).join("")}</ul></section>`
    : "";
  const links = m.links.length
    ? `<ul class="links">${m.links.map((l) => `<li><a class="btn" href="${esc(l.href)}" rel="noopener nofollow">${esc(l.title)}</a></li>`).join("")}</ul>`
    : "";

  const ogImage = m.avatarUrl && /^https:\/\//i.test(m.avatarUrl) ? `<meta property="og:image" content="${esc(m.avatarUrl)}"><meta name="twitter:image" content="${esc(m.avatarUrl)}">` : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)} · Links</title>
<meta name="description" content="${esc(desc.slice(0, 200))}">
<link rel="canonical" href="${esc(m.canonicalUrl)}">
<meta property="og:type" content="profile"><meta property="og:site_name" content="Brandthread">
<meta property="og:title" content="${esc(name)}"><meta property="og:description" content="${esc(desc.slice(0, 200))}"><meta property="og:url" content="${esc(m.canonicalUrl)}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(name)}"><meta name="twitter:description" content="${esc(desc.slice(0, 200))}">
${ogImage}
<meta name="theme-color" content="${bg}">
<style>
*{box-sizing:border-box}html{color-scheme:${dark ? "dark" : "light"}}
body{margin:0;background:${bg};color:${fg};font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh}
main{width:min(100%,480px);margin:0 auto;padding:48px 20px 40px;text-align:center}
.avatar{display:block;width:96px;height:96px;border-radius:50%;object-fit:cover;margin:0 auto 16px;border:1px solid ${line}}
.ph{display:grid;place-items:center;background:${line};font-size:36px;font-weight:700}
h1{font-size:22px;line-height:1.25;margin:0 0 8px;font-weight:700;overflow-wrap:anywhere}
.bio{margin:0 auto 20px;max-width:36ch;color:${muted};font-size:15px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.socs{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-bottom:24px}
.soc{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;color:${fg};text-decoration:none}
.soc:hover{background:${line}}
.btn{display:block;width:100%;padding:16px 20px;border:1.5px solid ${fg};border-radius:14px;color:${fg};text-decoration:none;font-weight:600;font-size:15px;overflow-wrap:anywhere;min-height:52px}
.btn.primary{background:${btnBg};border-color:${btnBg};color:${btnFg};margin-bottom:12px}
.btn:hover{opacity:.88}
a:focus-visible{outline:3px solid ${fg};outline-offset:3px}
ul{list-style:none;margin:0;padding:0}
.links{display:grid;gap:12px;margin:12px 0 28px}
.prods{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:20px 0 28px;text-align:left}
.prods a{display:block;color:${fg};text-decoration:none}
.prods img,.noimg{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:12px;background:${line}}
.pn{display:block;margin-top:8px;font-size:14px;font-weight:600;overflow-wrap:anywhere}
.pp{display:block;font-size:13px;color:${muted}}
footer{margin-top:24px;font-size:12px;color:${muted}}
footer a{color:${muted}}
@media (prefers-reduced-motion:no-preference){.btn{transition:opacity .15s}}
</style></head><body><main>
${avatar}
<h1>${esc(name)}</h1>
${m.bio ? `<p class="bio">${esc(m.bio)}</p>` : ""}
${socials ? `<nav class="socs" aria-label="Social links">${socials}</nav>` : ""}
${shop}
${products}
${links}
<footer>Made with <a href="https://brandthread.app" rel="noopener">Brandthread</a></footer>
</main></body></html>`;
}
