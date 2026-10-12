import type { Request, Response } from "express";
import { db, users } from "@workspace/db";
import { sql } from "drizzle-orm";
import { publicCoverFields, storefrontCoverUrl } from "../lib/profileCover";
import { withStorefrontBannerAdopted } from "../lib/storefrontBanner";
import { ObjectStorageService } from "../lib/objectStorage";

const bannerStorage = new ObjectStorageService();

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] ?? char);

/** A signed-out landing page for shared profile links on the API-only domain. */
export async function profileLanding(req: Request, res: Response): Promise<void> {
  const rawUsername = req.params.username;
  const username = typeof rawUsername === "string" ? rawUsername.toLowerCase() : null;
  if (!username || !/^[a-z0-9_]{3,30}$/.test(username)) {
    res.status(404).send("Profile not found");
    return;
  }

  try {
    const [profileRow] = await db.select({
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
      clerkId: users.clerkId,
      bannerUrl: users.bannerUrl,
      coverVideoUrl: users.coverVideoUrl,
      coverPosterUrl: users.coverPosterUrl,
      coverImageUrl: users.coverImageUrl,
      coverMediaType: users.coverMediaType,
      coverVideoModerationStatus: users.coverVideoModerationStatus,
    }).from(users).where(sql`lower(${users.username}) = ${username}`).limit(1);

    if (!profileRow || profileRow.deletedAt || profileRow.deletionRequestedAt || profileRow.suspendedAt || !profileRow.username || !profileRow.accountType) {
      res.status(404).send("Profile not found");
      return;
    }
    // The profile banner's still frame is the share preview's cover (one banner).
    const profileHandle = profileRow.username;
    const profile = { ...(await withStorefrontBannerAdopted(req, profileRow, bannerStorage)), username: profileHandle };
    const cover = storefrontCoverUrl(publicCoverFields(profile).profileBanner);
    const coverImage = cover && cover.startsWith("https://") ? cover : null;

    const name = escapeHtml(profile.displayName || profile.name || `@${profile.username}`);
    const handle = escapeHtml(profile.username);
    const bio = escapeHtml(profile.bio ?? "");
    const avatar = [profile.profileImageUrl, profile.avatarUrl]
      .find((url) => typeof url === "string" && url.startsWith("https://"));
    const image = avatar ? `<img src="${escapeHtml(avatar)}" alt="" class="avatar">` :
      `<div class="avatar placeholder" aria-hidden="true">${escapeHtml(profile.username.slice(0, 1).toUpperCase())}</div>`;
    const url = `https://brandthread.app/u/${encodeURIComponent(profile.username)}`;

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src https:; base-uri 'none'; form-action 'none'");
    res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} · Brandthread</title>
<meta name="description" content="View ${name}'s public profile on Brandthread">
<meta property="og:type" content="profile"><meta property="og:title" content="${name} on Brandthread">
<meta property="og:description" content="${bio || `View @${handle}'s public profile` }">
<meta property="og:url" content="${escapeHtml(url)}">
${(coverImage ?? avatar) ? `<meta property="og:image" content="${escapeHtml((coverImage ?? avatar) as string)}">` : ""}
<style>
*{box-sizing:border-box}body{margin:0;background:#0a0a0b;color:#f8f8f8;font-family:Inter,system-ui,-apple-system,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
main{width:min(100%,440px);text-align:center}.brand{font-weight:700;letter-spacing:.08em;font-size:14px;margin-bottom:56px}
.avatar{width:104px;height:104px;object-fit:cover;border-radius:50%;margin:auto;border:2px solid #484848}
.cover{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:16px;margin:0 0 -52px}
.cover + .avatar,.cover + .placeholder{position:relative}
.placeholder{display:grid;place-items:center;background:#292929;font-size:40px}
h1{font-size:26px;line-height:1.2;margin:22px 0 6px}.handle{color:#a6a6a6;margin:0}
.bio{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;margin:20px 0 34px}
.button{display:block;background:#fff;color:#0a0a0b;text-decoration:none;font-weight:700;border-radius:100px;padding:17px 24px;margin:28px 0 16px}
.link{font-size:13px;overflow-wrap:anywhere;color:#bdbdbd}
</style></head><body><main>
<div class="brand">BRANDTHREAD</div>${coverImage ? `<img src="${escapeHtml(coverImage)}" alt="" class="cover">` : ""}${image}
<h1>${name}</h1><p class="handle">@${handle}</p>
${bio ? `<p class="bio">${bio}</p>` : `<p class="bio">On Brandthread</p>`}
<a class="button" href="brandthread://u/${encodeURIComponent(profile.username)}">Open in Brandthread</a>
<p class="link">${escapeHtml(url)}</p>
</main></body></html>`);
  } catch (err) {
    req.log.error({ err }, "Failed to render shared profile");
    res.status(500).send("Profile temporarily unavailable");
  }
}