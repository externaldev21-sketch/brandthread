/**
 * One banner per seller: the profile banner (GIF / ≤10s video) is also the
 * storefront cover. A seller's former 3:1 storefront banner (`users.banner_url`,
 * a private object) is adopted as their profile banner the first time any
 * surface that shows a banner reads them — so nobody loses theirs:
 *
 *  - only when they have no profile banner yet (a set profile banner wins);
 *  - the object is made public and served through /api/profile/cover-media
 *    like every other banner (moderation status, cleanup on replace);
 *  - `banner_url` is cleared in the same guarded UPDATE, so it runs once.
 *
 * Idempotent and race-safe: the UPDATE only lands while the row still has
 * no cover and the same banner_url.
 */
import type { Request } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { profileBannerFromRow } from "./profileCover";

export interface StorefrontBannerRow {
  clerkId: string;
  bannerUrl?: string | null;
  coverVideoUrl?: string | null;
  coverPosterUrl?: string | null;
  coverImageUrl?: string | null;
  coverMediaType?: string | null;
}

export interface BannerAclStorage {
  trySetObjectEntityAclPolicy(path: string, policy: { owner: string; visibility: "public" | "private" }): Promise<unknown>;
}

/** True when a legacy storefront banner still waits to become the profile banner. */
export function needsStorefrontBannerAdoption(row: StorefrontBannerRow): boolean {
  return !!row.bannerUrl && !profileBannerFromRow(row);
}

function coverMediaUrlFor(req: Request, objectPath: string): string {
  return `${req.protocol}://${req.get("host")}/api/profile/cover-media/${objectPath.replace(/^\/objects\//, "")}`;
}

/**
 * Adopt the row's storefront banner as its profile banner (still image).
 * Returns the cover fields to merge into the row (also when another request
 * won the race), or null when there was nothing to adopt.
 */
export async function adoptStorefrontBanner(
  req: Request,
  row: StorefrontBannerRow,
  storage: BannerAclStorage,
): Promise<Pick<StorefrontBannerRow, "coverVideoUrl" | "coverPosterUrl" | "coverImageUrl" | "coverMediaType" | "bannerUrl"> | null> {
  if (!needsStorefrontBannerAdoption(row)) return null;
  const legacy = row.bannerUrl as string;
  let url: string;
  if (legacy.startsWith("/objects/") && !legacy.split("/").includes("..")) {
    await storage.trySetObjectEntityAclPolicy(legacy, { owner: row.clerkId, visibility: "public" });
    url = coverMediaUrlFor(req, legacy);
  } else if (/^https?:\/\//i.test(legacy)) {
    url = legacy;
  } else {
    return null;
  }
  const fields = { coverMediaType: "image", coverImageUrl: url, coverPosterUrl: url, coverVideoUrl: null, bannerUrl: null };
  const updated = await db.update(users)
    .set({ ...fields, coverVideoModerationStatus: "visible" })
    .where(and(
      eq(users.clerkId, row.clerkId),
      eq(users.bannerUrl, legacy),
      isNull(users.coverVideoUrl),
      isNull(users.coverImageUrl),
    ))
    .returning({ id: users.id });
  if (updated.length > 0) return fields;
  // Someone else adopted it (or set a banner) in between — read what's there now.
  const [current] = await db.select({
    coverMediaType: users.coverMediaType,
    coverImageUrl: users.coverImageUrl,
    coverPosterUrl: users.coverPosterUrl,
    coverVideoUrl: users.coverVideoUrl,
    bannerUrl: users.bannerUrl,
  }).from(users).where(eq(users.clerkId, row.clerkId)).limit(1);
  return current ?? null;
}

/**
 * Adopt in place when needed (best effort: a storage hiccup never fails the
 * request — the row is returned unchanged and the next read retries).
 */
export async function withStorefrontBannerAdopted<T extends StorefrontBannerRow>(
  req: Request,
  row: T,
  storage: BannerAclStorage,
): Promise<T> {
  if (!needsStorefrontBannerAdoption(row)) return row;
  try {
    const adopted = await adoptStorefrontBanner(req, row, storage);
    return adopted ? { ...row, ...adopted } : row;
  } catch (err) {
    (req as any).log?.warn?.({ err, clerkId: row.clerkId }, "Could not adopt storefront banner as profile banner");
    return row;
  }
}
