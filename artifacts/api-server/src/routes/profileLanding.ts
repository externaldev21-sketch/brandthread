import type { Request, Response } from "express";
import { db, users } from "@workspace/db";
import { sql } from "drizzle-orm";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] ?? char);

/** aff / utm_* params to carry from a shared link to the page it forwards to. */
export function forwardedQuery(query: Request["query"]): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (typeof value !== "string" || value.length > 200) continue;
    if (key === "aff" || /^utm_(source|medium|campaign|term|content)$/.test(key)) out.set(key, value);
  }
  const qs = out.toString();
  return qs ? `&${qs}` : "";
}

/** A signed-out landing page for shared profile links on the API-only domain. */
export async function profileLanding(req: Request, res: Response): Promise<void> {
  const rawUsername = req.params.username;
  const username = typeof rawUsername === "string" ? rawUsername.toLowerCase() : null;
  if (!username || !/^[a-z0-9_]{3,30}$/.test(username)) {
    res.status(404).send("Profile not found");
    return;
  }

  try {
    const [profile] = await db.select({
      id: users.id,
      username: users.username,
      accountType: users.accountType,
      displayName: users.displayName,
      name: users.name,
      bio: users.bio,
      avatarUrl: users.avatarUrl,
      profileImageUrl: users.profileImageUrl,
      deletedAt: users.deletedAt,
      deletionRequestedAt: users.deletionRequestedAt,
      suspendedAt: users.suspendedAt,
    }).from(users).where(sql`lower(${users.username}) = ${username}`).limit(1);

    if (!profile || profile.deletedAt || profile.deletionRequestedAt || profile.suspendedAt || !profile.username || !profile.accountType) {
      res.status(404).send("Profile not found");
      return;
    }

    const name = escapeHtml(profile.displayName || profile.name || `@${profile.username}`);
    const handle = escapeHtml(profile.username);
    const bio = escapeHtml(profile.bio ?? "");
    const avatar = [profile.profileImageUrl, profile.avatarUrl]
      .find((url) => typeof url === "string" && url.startsWith("https://"));
    const image = avatar ? `<img src="${escapeHtml(avatar)}" alt="" class="avatar">` :
      `<div class="avatar placeholder" aria-hidden="true">${escapeHtml(profile.username.slice(0, 1).toUpperCase())}</div>`;
    const url = `https://brandthread.app/u/${encodeURIComponent(profile.username)}`;
    // Sellers (BT-305/324): people on a shared store or creator (?aff=) link
    // land on the guest-browsable seller profile with real products and
    // checkout. The query string (aff, utm_*) is carried over so the creator
    // click is still captured. Crawlers read this page's Open Graph tags.
    const shopHref = profile.accountType === "seller"
      ? `/seller-profile?sellerId=${encodeURIComponent(profile.id)}&isOwner=false${forwardedQuery(req.query)}`
      : null;

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src https:; base-uri 'none'; form-action 'none'");
    res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} · Brandthread</title>
<meta name="description" content="View ${name}'s public profile on Brandthread">
<meta property="og:type" content="profile"><meta property="og:title" content="${name} on Brandthread">
<meta property="og:description" content="${bio || `View @${handle}'s public profile` }">
<meta property="og:url" content="${escapeHtml(url)}">
${avatar ? `<meta property="og:image" content="${escapeHtml(avatar)}">` : ""}
${shopHref ? `<meta http-equiv="refresh" content="0;url=${escapeHtml(shopHref)}">` : ""}
<style>
*{box-sizing:border-box}body{margin:0;background:#0a0a0b;color:#f8f8f8;font-family:Inter,system-ui,-apple-system,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
main{width:min(100%,440px);text-align:center}.brand{font-weight:700;letter-spacing:.08em;font-size:14px;margin-bottom:56px}
.avatar{width:104px;height:104px;object-fit:cover;border-radius:50%;margin:auto;border:2px solid #484848}
.placeholder{display:grid;place-items:center;background:#292929;font-size:40px}
h1{font-size:26px;line-height:1.2;margin:22px 0 6px}.handle{color:#a6a6a6;margin:0}
.bio{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;margin:20px 0 34px}
.button{display:block;background:#fff;color:#0a0a0b;text-decoration:none;font-weight:700;border-radius:100px;padding:17px 24px;margin:28px 0 16px}
.link{font-size:13px;overflow-wrap:anywhere;color:#bdbdbd}
</style></head><body><main>
<div class="brand">BRANDTHREAD</div>${image}
<h1>${name}</h1><p class="handle">@${handle}</p>
${bio ? `<p class="bio">${bio}</p>` : `<p class="bio">On Brandthread</p>`}
${shopHref
  ? `<a class="button" href="${escapeHtml(shopHref)}">Shop ${name}</a>`
  : `<a class="button" href="brandthread://u/${encodeURIComponent(profile.username)}">Open in Brandthread</a>`}
<p class="link">${escapeHtml(url)}</p>
</main></body></html>`);
  } catch (err) {
    req.log.error({ err }, "Failed to render shared profile");
    res.status(500).send("Profile temporarily unavailable");
  }
}