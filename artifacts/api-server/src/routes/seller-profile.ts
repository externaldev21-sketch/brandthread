/**
 * Seller profile settings — verified status, return / cancellation policies.
 * GET   /api/seller/profile   — read current seller's profile fields
 * PATCH /api/seller/policy    — update return / cancellation policy text
 */
import express, { Router } from "express";
import { db, interactions, orders, posts, storefronts, users } from "@workspace/db";
import { and, count, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "@workspace/api-zod";
import { bodyObject, validateInput } from "../lib/commerceValidation";
import { checkCoverChangeAllowed, profileBannerFromRow, storefrontCoverUrl } from "../lib/profileCover";
import { withStorefrontBannerAdopted } from "../lib/storefrontBanner";
import { coverMediaUrl, coverObjectPath } from "./profile-cover";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";
import { isUsernameUniqueViolation } from "../lib/dbErrors";
import {
  normalizeSocialLink,
  normalizeStoreAccent,
  validateBrandName,
  validateHandle,
  type SocialPlatform,
} from "../lib/storeIdentity";
import { normalizeUploadedImage } from "../lib/productImageResize";
import { MEDIA_REJECTED_MESSAGE, screenImageBuffer } from "../lib/mediaModeration";
import { acceptUploadSession } from "../lib/uploadSessions";
import { checkProfileImageUpload, hasValidImageSignature, MAX_PROFILE_IMAGE_BYTES, PROFILE_IMAGE_MIMES } from "../lib/profileImageUpload";
import { SELLER_CANCEL_WINDOW_HOURS, parseSellerCancelWindowHours } from "../lib/buyerCancellationPolicy";
import { decideUsernameChange, USERNAME_COOLDOWN_MESSAGE } from "../lib/usernameCooldown";
import { getOrCreateStorefront } from "./store";
import { normalizeOnboardingGoals } from "../lib/sellerSetupChecklist";

// ─── Startup migration — add tutorial flag + questionnaire + profile columns ───
(async () => {
  try {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS has_seen_seller_tutorial BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS seller_goals JSONB`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS buyer_style_interests JSONB`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS category TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS social_links JSONB NOT NULL DEFAULT '{}'`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_email TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS logo_url TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS store_accent_color TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS buyer_cancel_window_hours INTEGER`);
  } catch (err) {
    logger.error({ err }, "Seller profile migration failed");
  }
})();

const router = Router();
router.use(requireAuth);

// ── Request schemas ──────────────────────────────────────────────────────────
// validateBrandName / validateHandle / normalizeStoreAccent / normalizeSocialLink
// own the business rules and seller-facing messages; these only bound types
// and sizes.
const identityBody = bodyObject({
  brandName: z.string().max(500).nullish(),
  handle: z.string().max(500).nullish(),
});
const accentBody = bodyObject({ color: z.string().max(64).nullish() });
const socialLinksBody = bodyObject({
  instagram: z.string().max(2_048).nullish(),
  tiktok: z.string().max(2_048).nullish(),
});
const policyBody = bodyObject({
  returnPolicy: z.string().max(20_000).nullish(),
  cancellationPolicy: z.string().max(20_000).nullish(),
});
const onboardingDataBody = bodyObject({
  goals: z.array(z.string().max(200)).max(50).nullish(),
  brandStage: z.string().max(200).nullish(),
  sellModel: z.string().max(200).nullish(),
  styleInterests: z.array(z.string().max(200)).max(100).nullish(),
});
const objectStorage = new ObjectStorageService();

const IMAGE_MIMES = PROFILE_IMAGE_MIMES;
const MAX_AVATAR_BYTES = MAX_PROFILE_IMAGE_BYTES;
const MAX_BANNER_BYTES = 20 * 1024 * 1024;

async function displayProfileImage(
  uploadedImagePath: string | null,
  clerkAvatarUrl: string | null,
): Promise<string | null> {
  if (uploadedImagePath?.startsWith("/objects/")) {
    return objectStorage.getObjectEntityDownloadURL(uploadedImagePath).catch(() => clerkAvatarUrl);
  }
  return uploadedImagePath ?? clerkAvatarUrl;
}

async function displayObjectImage(path: string | null): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith("/objects/")) {
    return objectStorage.getObjectEntityDownloadURL(path).catch(() => null);
  }
  return path;
}

// ─── GET /api/seller/profile ──────────────────────────────────────────────────
router.get("/profile", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const [[selected], [likeTotal], [paidOrderMetrics]] = await Promise.all([
    db
      .select({
        id:                  users.id,
        clerkId:             users.clerkId,
        displayName:         users.displayName,
        brandName:           users.brandName,
        bio:                 users.bio,
        website:             users.website,
        coverVideoUrl:       users.coverVideoUrl,
        coverPosterUrl:      users.coverPosterUrl,
        coverImageUrl: users.coverImageUrl,
        coverMediaType: users.coverMediaType,
        avatarVideoUrl:      users.avatarVideoUrl,
        avatarPosterUrl:     users.avatarPosterUrl,
        username:            users.username,
        profileImageUrl:     users.profileImageUrl,
        avatarUrl:           users.avatarUrl,
        logoUrl:             users.logoUrl,
        bannerUrl:           users.bannerUrl,
        storeAccentColor:    users.storeAccentColor,
        risingBrandsOptIn:   users.risingBrandsOptIn,
        storeLayout: users.storeLayout,
        category:            users.category,
        tags:                users.tags,
        location:            users.location,
        socialLinks:         users.socialLinks,
        contactEmail:        users.contactEmail,
        storefrontVisits:    users.storefrontVisitCount,
        verified:            users.verified,
        verificationStatus:  users.verificationStatus,
        returnPolicy:        users.returnPolicy,
        cancellationPolicy:  users.cancellationPolicy,
        subscriptionStatus:  users.subscriptionStatus,
        subscriptionPlanId:  users.subscriptionPlanId,
        foundingSellerNumber: users.foundingSellerNumber,
      })
      .from(users)
      .where(eq(users.clerkId, clerkId)),
    db
      .select({ totalLikes: count() })
      .from(interactions)
      .innerJoin(posts, eq(posts.id, interactions.postId))
      .where(and(eq(posts.userId, clerkId), eq(interactions.type, "like"))),
    db
      .select({
        orders:       count(),
        revenueCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      })
      .from(orders)
      .where(and(
        eq(orders.ownerId, clerkId),
        isNotNull(orders.stripeCheckoutSessionId),
        notInArray(orders.status, ["cancelled", "refund_pending", "refunded"]),
      )),
  ]);

  if (!selected) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  // One banner: a former storefront banner becomes the profile banner.
  const user = await withStorefrontBannerAdopted(req, selected, objectStorage);
  const profileBanner = profileBannerFromRow(user);

  const storefrontVisits = user.storefrontVisits ?? 0;
  const paidOrders = Number(paidOrderMetrics?.orders ?? 0);
  const [profileImageUrl, logoUrl] = await Promise.all([
    displayProfileImage(user.profileImageUrl, user.avatarUrl),
    displayObjectImage(user.logoUrl),
  ]);
  // `bannerUrl` (storefront cover, read by store setup and ads) is the
  // profile banner's still frame — there is only one banner.
  const bannerUrl = storefrontCoverUrl(profileBanner);
  res.json({
    ...user,
    profileImageUrl,
    logoUrl,
    bannerUrl,
    // TikTok-style profile banner (GIF or looping video), see profile-cover.ts.
    profileBanner,
    totalLikes: Number(likeTotal?.totalLikes ?? 0),
    metrics: {
      revenueCents: Number(paidOrderMetrics?.revenueCents ?? 0),
      visitors: storefrontVisits,
      orders: paidOrders,
      conversionRate: storefrontVisits > 0
        ? Math.round((paidOrders / storefrontVisits) * 10_000) / 100
        : 0,
    },
  });
});

// ─── Generic profile-image upload (avatar / logo / banner) ────────────────────
// A seller-uploaded identity image is stored separately from Clerk's avatar URL,
// so a later Clerk sync cannot overwrite a deliberate brand profile photo.
type ProfileImageColumn = "profileImageUrl" | "logoUrl" | "bannerUrl";

function createProfileImageUploadHandler(
  column: ProfileImageColumn,
  dbColumn: typeof users.profileImageUrl | typeof users.logoUrl | typeof users.bannerUrl,
  maxBytes: number,
  label: string,
) {
  return [
    acceptUploadSession({ allowedTypes: ["image/*"], maxBytes: maxBytes }),
    express.raw({ type: "image/*", limit: maxBytes }),
    async (req: express.Request, res: express.Response): Promise<void> => {
      const clerkId = (req as any).clerkUserId as string;
      const contentType = String(req.headers["content-type"] ?? "").split(";")[0].toLowerCase();
      const check = await checkProfileImageUpload({ bytes: req.body, contentType, maxBytes, label, ownerId: clerkId });
      if (!check.ok) {
        res.status(check.status).json(check.body);
        return;
      }

      const [seller] = await db
        .select({ existing: dbColumn })
        .from(users)
        .where(eq(users.clerkId, clerkId))
        .limit(1);
      if (!seller) {
        res.status(404).json({ error: "Seller profile not found" });
        return;
      }

      let objectPath: string | null = null;
      try {
        const stored = check.image;
        objectPath = await objectStorage.createObjectEntityFromBuffer(stored.buffer, stored.contentType);
        await objectStorage.trySetObjectEntityAclPolicy(objectPath, {
          owner: clerkId,
          visibility: "private",
        });
        await db
          .update(users)
          .set({ [column]: objectPath, updatedAt: new Date() })
          .where(eq(users.clerkId, clerkId));

        if (seller.existing?.startsWith("/objects/")) {
          void objectStorage.deleteObjectEntity(seller.existing).catch((err) => {
            req.log.warn({ err }, `Could not remove replaced ${label}`);
          });
        }

        res.status(201).json({
          [column]: await objectStorage.getObjectEntityDownloadURL(objectPath),
        });
      } catch (err) {
        if (objectPath) {
          await objectStorage.deleteObjectEntity(objectPath).catch(() => undefined);
        }
        req.log.error({ err }, `Seller ${label} upload failed`);
        res.status(500).json({ error: `Could not save your ${label}. Please try again.` });
      }
    },
  ] as const;
}

// ─── POST /api/seller/profile/avatar/upload ───────────────────────────────────
router.post("/profile/avatar/upload", ...createProfileImageUploadHandler("profileImageUrl", users.profileImageUrl, MAX_AVATAR_BYTES, "avatar"));

// ─── POST /api/seller/profile/logo/upload ─────────────────────────────────────
router.post("/profile/logo/upload", ...createProfileImageUploadHandler("logoUrl", users.logoUrl, MAX_AVATAR_BYTES, "logo"));

// ─── POST /api/seller/profile/banner/upload ───────────────────────────────────
// Older app builds still upload a 3:1 storefront banner here. There is only
// one banner now, so a still uploaded here becomes the profile banner
// (public, served via /api/profile/cover-media, same 24h change window).
router.post(
  "/profile/banner/upload",
  express.raw({ type: "image/*", limit: MAX_BANNER_BYTES }),
  async (req: express.Request, res: express.Response): Promise<void> => {
    const clerkId = (req as any).clerkUserId as string;
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0].toLowerCase();
    const bytes = req.body as Buffer;
    if (!IMAGE_MIMES.has(contentType)) {
      res.status(400).json({ error: "Use a JPEG, PNG, or WebP image for your banner." });
      return;
    }
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_BANNER_BYTES) {
      res.status(400).json({ error: `Your banner image must be no larger than ${Math.round(MAX_BANNER_BYTES / (1024 * 1024))} MB.` });
      return;
    }
    if (!hasValidImageSignature(bytes, contentType)) {
      res.status(400).json({ error: "The uploaded file does not match its declared image type." });
      return;
    }
    const [row] = await db.select({
      coverVideoUrl: users.coverVideoUrl,
      coverPosterUrl: users.coverPosterUrl,
      coverImageUrl: users.coverImageUrl,
      coverVideoUpdatedAt: users.coverVideoUpdatedAt,
    }).from(users).where(eq(users.clerkId, clerkId)).limit(1);
    if (!row) {
      res.status(404).json({ error: "Seller profile not found" });
      return;
    }
    const check = checkCoverChangeAllowed(row.coverVideoUpdatedAt);
    if (!check.allowed) {
      res.status(429).json({ error: check.message, code: "cover_change_rate_limited", retryAfterHours: check.retryAfterHours });
      return;
    }
    const screened = await screenImageBuffer(bytes, contentType);
    if ((screened.verdict === "hold" && !screened.unverified) || screened.verdict === "reject") {
      void import("../lib/mediaModerationStore").then((m) => m.recordRejectedUpload({ ownerId: clerkId, surface: "banner", verdict: { ...screened, verdict: "reject" } }));
      res.status(422).json({ error: MEDIA_REJECTED_MESSAGE, code: "IMAGE_REJECTED" });
      return;
    }
    let objectPath: string | null = null;
    try {
      const stored = await normalizeUploadedImage(bytes, contentType);
      objectPath = await objectStorage.createObjectEntityFromBuffer(stored.buffer, stored.contentType);
      await objectStorage.trySetObjectEntityAclPolicy(objectPath, { owner: clerkId, visibility: "public" });
      const url = coverMediaUrl(req, objectPath);
      await db.update(users)
        .set({
          coverMediaType: "image", coverImageUrl: url, coverPosterUrl: url, coverVideoUrl: null,
          coverVideoUpdatedAt: new Date(), coverVideoModerationStatus: "visible", bannerUrl: null, updatedAt: new Date(),
        })
        .where(eq(users.clerkId, clerkId));
      const old = [row.coverVideoUrl, row.coverPosterUrl, row.coverImageUrl]
        .map((value) => coverObjectPath(value))
        .filter((path, index, all): path is string => !!path && path !== objectPath && all.indexOf(path) === index);
      for (const path of old) void objectStorage.deleteObjectEntity(path).catch(() => undefined);
      res.status(201).json({ bannerUrl: url, profileBanner: { type: "image", url, posterUrl: url, gifUrl: null } });
    } catch (err) {
      if (objectPath) await objectStorage.deleteObjectEntity(objectPath).catch(() => undefined);
      req.log.error({ err }, "Seller banner upload failed");
      res.status(500).json({ error: "Could not save your banner. Please try again." });
    }
  },
);

// ─── Store identity setup ─────────────────────────────────────────────────────
// Claim a store name + @handle, pick a monochrome accent, connect socials.
// Every write re-validates server-side; the mobile screens only preview.
type AvailabilityResult = { available: boolean; error?: string; code?: string; nextChangeAt?: string };

async function nameAvailability(clerkId: string, raw: unknown): Promise<AvailabilityResult & { name: string }> {
  const { name, problem } = validateBrandName(raw);
  if (problem) return { name, available: false, error: problem.error, code: problem.code };
  const [taken] = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(and(eq(sql`lower(trim(${users.brandName}))`, name.toLowerCase()), sql`${users.clerkId} <> ${clerkId}`))
    .limit(1);
  if (taken) return { name, available: false, error: "That name is already taken.", code: "NAME_TAKEN" };
  return { name, available: true };
}

async function handleAvailability(clerkId: string, raw: unknown): Promise<AvailabilityResult & { handle: string; stamp?: boolean }> {
  const { handle, problem } = validateHandle(raw);
  if (problem) return { handle, available: false, error: problem.error, code: problem.code };
  // Same @handle change cooldown as PATCH /api/auth/profile: the first-ever
  // handle is free, keeping the current one is a no-op, anything else waits.
  const [own] = await db
    .select({ username: users.username, usernameChangedAt: users.usernameChangedAt })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  const decision = decideUsernameChange({
    current: own?.username ?? null,
    requested: handle,
    changedAt: own?.usernameChangedAt ?? null,
  });
  if (decision.kind === "blocked") {
    return {
      handle,
      available: false,
      error: USERNAME_COOLDOWN_MESSAGE,
      code: "USERNAME_COOLDOWN",
      nextChangeAt: decision.nextChangeAt.toISOString(),
    };
  }
  const stamp = decision.kind === "allowed" && decision.stamp;
  const [taken] = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(eq(sql`lower(${users.username})`, handle))
    .limit(1);
  if (taken && taken.clerkId !== clerkId) {
    return { handle, available: false, error: "That handle is already taken.", code: "USERNAME_TAKEN" };
  }
  return { handle, available: true, stamp };
}

// ─── GET /api/seller/identity/check?name=&handle= ─────────────────────────────
router.get("/identity/check", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const out: { name?: AvailabilityResult; handle?: AvailabilityResult } = {};
  if (typeof req.query.name === "string") {
    const { name: _n, ...rest } = await nameAvailability(clerkId, req.query.name);
    out.name = rest;
  }
  if (typeof req.query.handle === "string") {
    const { handle: _h, stamp: _s, ...rest } = await handleAvailability(clerkId, req.query.handle);
    out.handle = rest;
  }
  res.json(out);
});

// ─── PUT /api/seller/identity ─────────────────────────────────────────────────
router.put("/identity", validateInput({ body: identityBody }), async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const nameCheck = await nameAvailability(clerkId, req.body?.brandName);
  if (!nameCheck.available) {
    res.status(nameCheck.code === "NAME_TAKEN" ? 409 : 400).json({ error: nameCheck.error, code: nameCheck.code, field: "brandName" });
    return;
  }
  const handleCheck = await handleAvailability(clerkId, req.body?.handle);
  if (!handleCheck.available) {
    if (handleCheck.code === "USERNAME_COOLDOWN" && handleCheck.nextChangeAt) {
      const retryAfterSec = Math.max(1, Math.ceil((new Date(handleCheck.nextChangeAt).getTime() - Date.now()) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({ error: handleCheck.error, code: handleCheck.code, nextChangeAt: handleCheck.nextChangeAt, field: "handle" });
      return;
    }
    res.status(handleCheck.code === "USERNAME_TAKEN" ? 409 : 400).json({ error: handleCheck.error, code: handleCheck.code, field: "handle" });
    return;
  }
  try {
    const now = new Date();
    const [updated] = await db
      .update(users)
      .set({
        brandName: nameCheck.name,
        username: handleCheck.handle,
        ...(handleCheck.stamp ? { usernameChangedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(users.clerkId, clerkId))
      .returning({ brandName: users.brandName, username: users.username });
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    // The pre-check races with concurrent claims; the unique index decides.
    if (isUsernameUniqueViolation(err)) {
      res.status(409).json({ error: "That handle is already taken.", code: "USERNAME_TAKEN", field: "handle" });
      return;
    }
    req.log.error({ err }, "Store identity save failed");
    res.status(500).json({ error: "Could not save your store name. Please try again." });
  }
});

// ─── PUT /api/seller/profile/accent ───────────────────────────────────────────
router.put("/profile/accent", validateInput({ body: accentBody }), async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const raw = req.body?.color;
  const color = raw === null ? null : normalizeStoreAccent(raw);
  if (raw !== null && !color) {
    res.status(400).json({ error: "Choose one of the available colors." });
    return;
  }
  const [updated] = await db
    .update(users)
    .set({ storeAccentColor: color, updatedAt: new Date() })
    .where(eq(users.clerkId, clerkId))
    .returning({ storeAccentColor: users.storeAccentColor });
  if (!updated) {
    res.status(404).json({ error: "Seller profile not found" });
    return;
  }
  // The public storefront renders its accent from storefronts.theme
  // (primaryColor / accentColor), not users.store_accent_color — keep the two
  // in step so the color the seller picks is the color buyers see.
  if (color) {
    try {
      const sf = await getOrCreateStorefront(clerkId);
      const theme = { ...((sf.theme as Record<string, unknown> | null) ?? {}), primaryColor: color, accentColor: color };
      await db.update(storefronts).set({ theme: theme as any, updatedAt: new Date() }).where(eq(storefronts.id, sf.id));
    } catch (err) {
      req.log.error({ err }, "Store accent theme sync failed");
      res.status(500).json({ error: "Could not apply your accent to your store. Please try again." });
      return;
    }
  }
  res.json(updated);
});

// ─── PUT /api/seller/profile/rising-brands ────────────────────────────────────
// Store Settings > "Show in Rising brands": opt in to (or out of) the Discover
// > Brands "Rising this week" leaderboard. Off by default (migration 294).
export const STORE_LAYOUTS = ["grid", "lookbook"] as const;
export type StoreLayout = (typeof STORE_LAYOUTS)[number];
export function parseStoreLayout(value: unknown): StoreLayout | null {
  return typeof value === "string" && (STORE_LAYOUTS as readonly string[]).includes(value) ? value as StoreLayout : null;
}
router.put("/profile/store-layout", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const layout = parseStoreLayout(req.body?.layout);
  if (!layout) {
    res.status(400).json({ error: "layout must be 'grid' or 'lookbook'" });
    return;
  }
  const [profile] = await db.update(users)
    .set({ storeLayout: layout, updatedAt: new Date() })
    .where(eq(users.clerkId, clerkId))
    .returning({ storeLayout: users.storeLayout });
  res.json(profile);
});

router.put("/profile/rising-brands", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const optIn = req.body?.optIn;
  if (typeof optIn !== "boolean") {
    res.status(400).json({ error: "optIn must be true or false" });
    return;
  }
  const [updated] = await db
    .update(users)
    .set({ risingBrandsOptIn: optIn, updatedAt: new Date() })
    .where(eq(users.clerkId, clerkId))
    .returning({ risingBrandsOptIn: users.risingBrandsOptIn });
  if (!updated) {
    res.status(404).json({ error: "Seller profile not found" });
    return;
  }
  res.json(updated);
});

// ─── PUT /api/seller/social-links ─────────────────────────────────────────────
// Merges into users.socialLinks, leaving any other keys untouched. An empty
// value removes that platform's link.
router.put("/social-links", validateInput({ body: socialLinksBody }), async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const platforms: SocialPlatform[] = ["instagram", "tiktok"];
  const next: Partial<Record<SocialPlatform, string>> = {};
  for (const platform of platforms) {
    if (req.body?.[platform] === undefined) continue;
    const link = normalizeSocialLink(platform, req.body[platform]);
    if (link === null) {
      const label = platform === "instagram" ? "Instagram" : "TikTok";
      res.status(400).json({ error: `Enter a ${label} handle or a link to your ${label} profile.`, field: platform });
      return;
    }
    next[platform] = link;
  }
  const [seller] = await db.select({ socialLinks: users.socialLinks }).from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!seller) {
    res.status(404).json({ error: "Seller profile not found" });
    return;
  }
  const merged: Record<string, string> = { ...(seller.socialLinks ?? {}) };
  for (const platform of platforms) {
    if (next[platform] === undefined) continue;
    if (next[platform]) merged[platform] = next[platform]!;
    else delete merged[platform];
  }
  await db.update(users).set({ socialLinks: merged, updatedAt: new Date() }).where(eq(users.clerkId, clerkId));
  res.json({ socialLinks: merged });
});

// ─── GET / PUT /api/seller/cancel-window ──────────────────────────────────────
// How long buyers can cancel an order themselves (migration 272). `hours` is
// one of SELLER_CANCEL_WINDOW_HOURS, or null for the default ("until shipped",
// capped at day 21; see lib/buyerCancellationPolicy.ts).
router.get("/cancel-window", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const [seller] = await db.select({ hours: users.buyerCancelWindowHours }).from(users)
    .where(eq(users.clerkId, clerkId)).limit(1);
  if (!seller) {
    res.status(404).json({ error: "Seller profile not found" });
    return;
  }
  res.json({ hours: parseSellerCancelWindowHours(seller.hours).ok ? seller.hours : null, options: SELLER_CANCEL_WINDOW_HOURS });
});

router.put("/cancel-window", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = parseSellerCancelWindowHours(req.body?.hours);
  if (!parsed.ok) {
    res.status(400).json({ error: "Choose one of the available cancellation windows." });
    return;
  }
  const [updated] = await db
    .update(users)
    .set({ buyerCancelWindowHours: parsed.hours, updatedAt: new Date() })
    .where(eq(users.clerkId, clerkId))
    .returning({ hours: users.buyerCancelWindowHours });
  if (!updated) {
    res.status(404).json({ error: "Seller profile not found" });
    return;
  }
  res.json(updated);
});

// ─── PATCH /api/seller/policy ─────────────────────────────────────────────────
router.patch("/policy", validateInput({ body: policyBody }), async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { returnPolicy, cancellationPolicy } = req.body as {
    returnPolicy?:       string;
    cancellationPolicy?: string;
  };

  const updates: { returnPolicy?: string; cancellationPolicy?: string; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (returnPolicy       !== undefined) updates.returnPolicy       = returnPolicy       ?? null as any;
  if (cancellationPolicy !== undefined) updates.cancellationPolicy = cancellationPolicy ?? null as any;

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.clerkId, clerkId))
    .returning({
      returnPolicy:       users.returnPolicy,
      cancellationPolicy: users.cancellationPolicy,
    });

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(updated);
});

// ─── POST /api/seller/tutorial/seen ──────────────────────────────────────────
router.post("/tutorial/seen", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  await db.execute(sql`
    UPDATE users
    SET    has_seen_seller_tutorial = TRUE,
           updated_at               = now()
    WHERE  clerk_id = ${clerkId}
  `);
  return res.json({ ok: true });
});

// ─── POST /api/seller/onboarding/data ────────────────────────────────────────
router.post("/onboarding/data", validateInput({ body: onboardingDataBody }), async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { goals, brandStage, sellModel, styleInterests } = req.body as {
    goals?:          string[];
    brandStage?:     string;
    sellModel?:      string;
    styleInterests?: string[];
  };

  await db.execute(sql`
    UPDATE users
    SET
      seller_goals          = ${JSON.stringify(goals          ?? [])}::jsonb,
      buyer_style_interests = ${JSON.stringify(styleInterests ?? [])}::jsonb,
      brand_stage = COALESCE(NULLIF(${brandStage ?? ''}, ''), brand_stage),
      sell_model  = COALESCE(NULLIF(${sellModel  ?? ''}, ''), sell_model),
      updated_at  = now()
    WHERE clerk_id = ${clerkId}
  `);
  // Also keep the answers on the storefront (migration 270) so the setup
  // checklist can prioritise tasks around the seller's goals.
  const sf = await getOrCreateStorefront(clerkId);
  const onboarding = {
    ...((sf.onboarding as Record<string, unknown> | null) ?? {}),
    goals: normalizeOnboardingGoals(goals),
    ...(brandStage ? { brandStage } : {}),
    ...(sellModel ? { sellModel } : {}),
  };
  await db.update(storefronts).set({ onboarding, updatedAt: new Date() } as any).where(eq(storefronts.id, sf.id));
  return res.json({ ok: true });
});

export default router;
