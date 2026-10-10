import type { Request, Response } from "express";
import { and, eq, ne } from "drizzle-orm";
import { db, giveaways, products, users } from "@workspace/db";
import { giveawayPhase, SHARE_BASE_URL } from "../lib/giveaways";
import { isHttpsUrl, publicProductCoverUrl } from "../lib/publicMedia";
import { getWebOrigin } from "../lib/webOrigin";

/** Store listing links, set once the apps are live (docs/launch/growth-links.md). */
export function appStoreLinks(env: NodeJS.ProcessEnv = process.env): { ios: string | null; android: string | null } {
  const ios = env.APP_STORE_URL?.trim();
  const android = env.PLAY_STORE_URL?.trim();
  return { ios: ios && isHttpsUrl(ios) ? ios : null, android: android && isHttpsUrl(android) ? android : null };
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Signed-out landing page for a shared giveaway link (https://brandthread.app/g/:code). */
export async function giveawayLanding(req: Request, res: Response): Promise<void> {
  const code = String(req.params.code ?? "").toUpperCase();
  if (!/^[A-Z0-9]{6,12}$/.test(code)) { res.status(404).send("Giveaway not found"); return; }
  try {
    const [g] = await db.select().from(giveaways)
      .where(and(eq(giveaways.shareCode, code), ne(giveaways.status, "cancelled"))).limit(1);
    if (!g) { res.status(404).send("Giveaway not found"); return; }
    const [seller] = await db.select({
      displayName: users.displayName, name: users.name, username: users.username,
      avatarUrl: users.avatarUrl, profileImageUrl: users.profileImageUrl,
    }).from(users).where(eq(users.clerkId, g.sellerId)).limit(1);
    // og:image (BT-319): the prize product's photo, else the brand's avatar.
    let image: string | null = null;
    if (g.productId) {
      const [p] = await db.select({ id: products.id, images: products.images }).from(products)
        .where(eq(products.id, g.productId)).limit(1);
      if (p) image = publicProductCoverUrl(p.id, p.images);
    }
    image ??= [seller?.profileImageUrl, seller?.avatarUrl].find(isHttpsUrl) ?? null;
    const webEntry = `${getWebOrigin()}/giveaway?code=${encodeURIComponent(g.shareCode)}`;
    const stores = appStoreLinks();
    const brand = escapeHtml(seller?.displayName || seller?.name || seller?.username || "Brandthread");
    const phase = giveawayPhase(g);
    const status = phase === "live" ? "Open now" : phase === "upcoming" ? "Starts soon" : phase === "drawn" ? "Winners drawn" : "Ended";
    const ends = g.endsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
    const title = escapeHtml(g.title);
    const prize = escapeHtml(g.prizeText);
    const how = g.postId ? "Follow the brand and comment on the featured post." : "Follow the brand.";
    const url = `${SHARE_BASE_URL}${g.shareCode}`;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src https:; base-uri 'none'; form-action 'none'");
    res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Giveaway</title>
<meta property="og:title" content="${title}"><meta property="og:description" content="Win ${prize}. Hosted by ${brand}.">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Brandthread">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${title}"><meta name="twitter:description" content="Win ${prize}. Hosted by ${brand}.">
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ""}
<style>
*{box-sizing:border-box}body{margin:0;background:#0a0a0b;color:#f8f8f8;font-family:Inter,system-ui,-apple-system,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
main{width:min(100%,440px);text-align:center}.brand{font-weight:700;letter-spacing:.08em;font-size:14px;margin-bottom:40px}
.tag{display:inline-block;border:1px solid #484848;border-radius:100px;padding:6px 14px;font-size:12px;color:#bdbdbd}
h1{font-size:28px;line-height:1.2;margin:22px 0 8px}.prize{font-size:18px;margin:0 0 6px}.host{color:#a6a6a6;margin:0 0 24px}
.meta{color:#bdbdbd;line-height:1.6;margin:0 0 30px;font-size:14px}
.button{display:block;background:#fff;color:#0a0a0b;text-decoration:none;font-weight:700;border-radius:100px;padding:17px 24px;margin:0 0 12px}
.button.outline{background:transparent;color:#fff;border:1px solid #484848}
.small{display:inline-block;color:#bdbdbd;font-size:13px;margin:4px 0 16px}
.link{font-size:13px;overflow-wrap:anywhere;color:#bdbdbd}
</style></head><body><main>
<div class="brand">BRANDTHREAD</div><span class="tag">${status}</span>
<h1>${title}</h1><p class="prize">${prize}</p><p class="host">Hosted by ${brand}</p>
<p class="meta">${escapeHtml(how)}<br>Ends ${escapeHtml(ends)} (UTC)<br>No purchase necessary.</p>
<a class="button" href="${escapeHtml(webEntry)}">${phase === "live" ? "Enter giveaway" : "See giveaway"}</a>
${stores.ios ? `<a class="button outline" href="${escapeHtml(stores.ios)}">Get the app on the App Store</a>` : ""}
${stores.android ? `<a class="button outline" href="${escapeHtml(stores.android)}">Get the app on Google Play</a>` : ""}
<a class="small" href="brandthread://giveaway?code=${encodeURIComponent(g.shareCode)}">Open in the Brandthread app</a>
<p class="link">${escapeHtml(url)}</p>
</main></body></html>`);
  } catch (err) {
    req.log.error({ err }, "Failed to render giveaway landing page");
    res.status(500).send("Giveaway temporarily unavailable");
  }
}
